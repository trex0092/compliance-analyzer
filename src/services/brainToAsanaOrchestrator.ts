/**
 * Brain → Asana Orchestrator  (WEAPONIZED)
 *
 * Master dispatcher that converts ANY WeaponizedBrainResponse into a full
 * Asana task tree — parent task, subtasks per finding, subtasks per filing
 * obligation, ESG subtasks, and a 24-hour freeze countdown task when needed.
 *
 * Verdict routing:
 *   freeze    → CRITICAL parent + 24h countdown subtask + EOCN notification subtask
 *   escalate  → HIGH parent + CO assignment + EDD subtask
 *   flag      → MEDIUM parent + review subtask
 *   pass      → INFO task (skipped unless passThrough=true)
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO duties), Art.24 (5yr retention),
 *             Art.26-27 (STR filing), Cabinet Res 74/2020 Art.4-7 (24h freeze),
 *             Cabinet Res 71/2024 (penalty exposure).
 */

import type { WeaponizedBrainResponse } from './weaponizedBrain';
import {
  createAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { buildComplianceCustomFields } from './asanaCustomFields';
import { buildHawkeyeAsanaTask } from './hawkeyeReportGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AsanaOrchestratorConfig {
  projectGid: string;
  workspaceGid: string;
  /** GID of the MLRO / default assignee for freeze/escalate tasks */
  mlroGid?: string;
  /** GID of the Compliance Officer */
  coGid?: string;
  /** If true, also create Asana tasks for 'pass' verdicts */
  syncPassVerdicts?: boolean;
  /** Custom field GID map (optional — uses buildComplianceCustomFields if omitted) */
  customFieldGids?: Record<string, string>;
}

export interface OrchestratorResult {
  entityId: string;
  verdict: string;
  parentTaskGid?: string;
  subtasksCreated: number;
  tasksQueued: number;
  errors: string[];
  summary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  freeze: '🔴',
  escalate: '🟠',
  flag: '🟡',
  pass: '🟢',
};

const URGENCY_DAYS: Record<string, number> = {
  freeze: 0,    // due today
  escalate: 1,
  flag: 3,
  pass: 7,
};

function dueDateFromVerdict(verdict: string): string {
  const d = new Date();
  d.setDate(d.getDate() + (URGENCY_DAYS[verdict] ?? 3));
  return d.toISOString().split('T')[0];
}

function buildParentTask(
  brain: WeaponizedBrainResponse,
  cfg: AsanaOrchestratorConfig,
): AsanaTaskPayload {
  const v = brain.finalVerdict;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const emoji = PRIORITY_EMOJI[v] ?? '⚪';

  const customFields = buildComplianceCustomFields({
    verdict: v,
    confidence: brain.confidence,
    riskScore: brain.extensions.explanation?.score,
    cddLevel: brain.extensions.explanation?.cddLevel,
    sanctionsFlag: v === 'freeze',
    esgGrade: brain.extensions.esgScore?.grade,
  });

  // Use Hawkeye Sterling V2 report as the task notes when available —
  // far more comprehensive than a plain-text summary.
  const hawkeyeTask = brain.extensions.hawkeyeReport
    ? buildHawkeyeAsanaTask(brain.extensions.hawkeyeReport, cfg.projectGid, v === 'freeze' || v === 'escalate' ? cfg.mlroGid : cfg.coGid)
    : null;

  const taskName = hawkeyeTask?.name ??
    `${emoji} [${v.toUpperCase()}] Compliance Screening — ${entityName} — ${new Date().toISOString().split('T')[0]}`;

  const taskNotes = hawkeyeTask?.notes ?? [
    `**Entity:** ${entityName} (${entityId})`,
    `**Verdict:** ${v.toUpperCase()}`,
    `**Confidence:** ${(brain.confidence * 100).toFixed(1)}%`,
    `**Clamp Reasons:** ${brain.clampReasons.length > 0 ? brain.clampReasons.join(' | ') : 'none'}`,
    `**Subsystem Failures:** ${brain.subsystemFailures.length > 0 ? brain.subsystemFailures.join(', ') : 'none'}`,
    `**Requires Human Review:** ${brain.requiresHumanReview}`,
    '',
    '**Audit Narrative:**',
    brain.auditNarrative,
  ].join('\n');

  return {
    name: taskName,
    notes: taskNotes,
    due_on: hawkeyeTask?.due_on ?? dueDateFromVerdict(v),
    assignee: v === 'freeze' || v === 'escalate' ? cfg.mlroGid : cfg.coGid,
    projects: [cfg.projectGid],
    tags: hawkeyeTask?.tags ?? ['compliance-screening', v, entityId],
    custom_fields: customFields,
  };
}

function buildManagedAgentsSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  if (!brain.managedAgentPlan || brain.managedAgentPlan.length === 0) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const lines = [
    '## Managed Agent Execution Plan — Hawkeye Sterling V2',
    '',
    `**Verdict:** ${brain.finalVerdict.toUpperCase()} | **Agents Queued:** ${brain.managedAgentPlan.length}`,
    `**Session:** \`${brain.orchestratorSession.sessionId}\``,
    '',
    `| # | Agent Type | Priority | Deadline | Sandbox | Guardrails |`,
    `|---|-----------|----------|----------|---------|-----------|`,
    ...brain.managedAgentPlan.map((a, i) =>
      `| ${i + 1} | ${a.agentType} | ${a.priority.toUpperCase()} | ${a.deadline?.split('T')[0] ?? 'N/A'} | ${a.sandboxIsolated ? '🔒 YES' : 'No'} | ${a.guardrails.length} active |`
    ),
    '',
    '*NIST AI RMF GV-1.6 | FDL No.10/2025 Art.20-21 | Cabinet Res 74/2020 Art.4*',
  ];
  return {
    name: `🤖 Managed Agent Plan (${brain.managedAgentPlan.length} agents) — ${entityId}`,
    notes: lines.join('\n'),
    due_on: dueDateFromVerdict(brain.finalVerdict),
    assignee: mlroGid,
    tags: ['managed-agents', 'hawkeye-v2', entityId],
  };
}

function buildPenaltyVarSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const pv = brain.extensions.penaltyVar;
  if (!pv) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  return {
    name: `💰 Penalty VaR — AED ${pv.varAed.toLocaleString()} (95%) — ${entityId}`,
    notes: [
      `## Penalty Value at Risk — UAE DPMS`,
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| **Expected Penalty** | AED ${pv.expectedPenaltyAed.toLocaleString()} |`,
      `| **VaR (95% confidence)** | AED ${pv.varAed.toLocaleString()} |`,
      `| **Violations Count** | ${pv.violationCount} |`,
      `| **Confidence Level** | ${(pv.confidenceLevel * 100).toFixed(0)}% |`,
      '',
      '*Cabinet Res 71/2024 | FDL No.10/2025 | CBUAE Administrative Penalties*',
    ].join('\n'),
    due_on: dueDateFromVerdict(brain.finalVerdict),
    assignee: mlroGid,
    tags: ['penalty-var', 'risk-exposure', entityId],
  };
}

function buildStrNarrativeSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const sn = brain.extensions.strNarrative;
  const sg = brain.extensions.strNarrativeGrade;
  if (!sn) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  return {
    name: `📝 STR Narrative — ${sn.filingType} — ${entityId} — Grade ${sg?.grade ?? '?'}`,
    notes: [
      `## Auto-Built goAML Narrative — ${sn.filingType}`,
      '',
      `**Filing Ready:** ${sn.isFilingReady ? '✅ YES' : '❌ NO — review required'}`,
      `**Length:** ${sn.narrative.length} characters`,
      `**Grade:** ${sg?.grade ?? 'Not graded'} (${sg?.score ?? '?'}/100)`,
      `**Tip-Off Check:** ${sn.tipOffClean ? '✅ Clean' : '⚠ Review required'}`,
      '',
      '**Narrative:**',
      sn.narrative.slice(0, 3000),
      sn.narrative.length > 3000 ? '\n*[Truncated — see full report]*' : '',
      '',
      '*FDL No.10/2025 Art.26-27 | EOCN goAML STR Guidelines v3 | FATF Rec 20*',
    ].filter(Boolean).join('\n'),
    due_on: dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: ['str-narrative', sn.filingType.toLowerCase(), entityId],
  };
}

// ---------------------------------------------------------------------------
// Phase 12 Ultra-Weaponized Asana subtask builders
// ---------------------------------------------------------------------------

function buildQuantumSealSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const qs = brain.extensions.quantumSeal;
  if (!qs) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  return {
    name: `🔐 Quantum-Resistant Audit Seal — ${entityId}`,
    notes: [
      '## Post-Quantum Cryptographic Audit Seal',
      '',
      `**Hash Function:** ${qs.hashFunction} (SHA-3/512 — post-quantum resistant)`,
      `**Root Hash:** \`${qs.rootHash}\``,
      `**Leaf Count:** ${qs.leafCount} record(s) sealed`,
      `**Sealed At:** ${qs.sealedAt}`,
      `**Domain-Separated:** ${qs.domainSeparated ? 'YES' : 'NO'}`,
      '',
      '**Regulatory basis:**',
      '- FDL No.10/2025 Art.24 — 5-year record retention requirement',
      '- NIST Post-Quantum Cryptography Framework (FIPS 203/204/205)',
      '- EU AI Act Art.12 — record-keeping for high-risk AI systems',
      '',
      'This seal provides mathematically verifiable proof that the compliance',
      'decision record has not been altered since generation. Retain for audit.',
    ].join('\n'),
    due_on: dueDateFromVerdict('pass'),
    assignee: mlroGid,
    tags: ['quantum-seal', 'audit-trail', 'fDL-art24', entityId],
  };
}

function buildGoAMLXmlSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const xml = brain.extensions.goamlXml;
  if (!xml) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const xmlPreview = xml.slice(0, 2000);
  return {
    name: `📤 goAML XML Filing — ${entityId} — READY FOR SUBMISSION`,
    notes: [
      '## Auto-Generated UAE FIU goAML XML Filing',
      '',
      `**Status:** ✅ Ready for submission to goAML portal`,
      `**Size:** ${xml.length.toLocaleString()} characters`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '**Actions required:**',
      '1. Review XML content for accuracy',
      '2. Validate against UAE FIU goAML XML Schema v3',
      '3. Log in to goAML portal (https://goaml.uaf.gov.ae)',
      '4. Submit via File → Upload XML',
      '5. Record submission confirmation number',
      '6. Retain confirmation in case file (FDL Art.24 — 5yr retention)',
      '',
      '**XML Preview (first 2000 chars):**',
      '```xml',
      xmlPreview,
      xml.length > 2000 ? '\n... [truncated]' : '',
      '```',
      '',
      '*UAE FIU goAML Schema v3 | MoE Circular 08/AML/2021 | FDL No.10/2025 Art.26-27*',
    ].filter(Boolean).join('\n').slice(0, 8000),
    due_on: dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: ['goaml-xml', 'str-filing', 'fiu-submission', entityId],
  };
}

function buildBayesianVerdictSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const bb = brain.extensions.bayesianBelief;
  if (!bb) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const topHyp = bb.mostLikely;
  const hypTable = bb.hypotheses
    .map((h) => `| ${h.label} | ${((bb.finalPosterior[h.id] ?? 0) * 100).toFixed(1)}% |`)
    .join('\n');
  return {
    name: `🧠 Bayesian Verdict — ${entityId} — P(${topHyp.label})=${(topHyp.probability * 100).toFixed(0)}%`,
    notes: [
      '## Bayesian Belief Network — Evidence-Based Posterior',
      '',
      `**Most Likely Hypothesis:** ${topHyp.label} (${(topHyp.probability * 100).toFixed(1)}%)`,
      `**Shannon Entropy:** ${bb.entropyBits.toFixed(2)} bits (${bb.entropyBits > 2 ? '⚠ HIGH uncertainty' : '✅ Low uncertainty'})`,
      `**Evidence Steps:** ${bb.steps.length}`,
      '',
      '### Posterior Probability Distribution',
      '',
      '| Hypothesis | Posterior |',
      '|---|---|',
      hypTable,
      '',
      '**Interpretation:** Higher entropy = more uncertain evidence = higher review priority',
      '',
      '*FDL Art.20-21 — CO evidence-based risk assessment | FATF Rec 10 | NIST AI RMF MS-2.1*',
    ].join('\n'),
    due_on: dueDateFromVerdict('flag'),
    assignee: mlroGid,
    tags: ['bayesian-belief', 'risk-probability', entityId],
  };
}

function buildCorporateGraphSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const cg = brain.extensions.corporateGraph;
  if (!cg) return null;
  const flaggedHits = cg.hits.filter((h) => h.hit);
  if (flaggedHits.length === 0) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const hitTable = flaggedHits
    .slice(0, 20)
    .map((h) => `| ${h.nodeId} | ${h.reason ?? 'Flagged'} | ${h.hopDistance} hop(s) |`)
    .join('\n');
  return {
    name: `🕸 Corporate Graph Alert — ${entityId} — ${flaggedHits.length} flagged node(s)`,
    notes: [
      '## Corporate Graph Walk — Affiliate / Subsidiary Risk',
      '',
      `**Nodes Visited:** ${cg.visited}`,
      `**Max Hops:** ${cg.hops}`,
      `**Flagged Nodes:** ${flaggedHits.length}`,
      '',
      '### Flagged Corporate Affiliates',
      '',
      '| Node ID | Reason | Distance |',
      '|---|---|---|',
      hitTable,
      flaggedHits.length > 20 ? `\n*... and ${flaggedHits.length - 20} more*` : '',
      '',
      `**Narrative:** ${cg.narrative}`,
      '',
      '**Actions required:**',
      '- Investigate each flagged affiliate for sanctions / adverse media',
      '- Update UBO register if ownership links discovered',
      '- Apply EDD to entity if any affiliate is confirmed sanctioned',
      '',
      '*FATF Rec 10 — CDD on beneficial ownership | Cabinet Decision 109/2023 UBO Register*',
    ].filter(Boolean).join('\n'),
    due_on: dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: ['corporate-graph', 'ubo', 'affiliate-risk', entityId],
  };
}

function buildGameTheorySubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const ge = brain.extensions.gameEquilibrium;
  if (!ge || ge.expectedPayoff >= 0) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const attackerMix = ge.attackerMix
    .slice(0, 5)
    .map((s) => `| ${s.strategy} | ${(s.probability * 100).toFixed(1)}% |`)
    .join('\n');
  const defenderMix = ge.defenderMix
    .slice(0, 5)
    .map((s) => `| ${s.strategy} | ${(s.probability * 100).toFixed(1)}% |`)
    .join('\n');
  return {
    name: `⚔️ Game Theory Alert — ${entityId} — Adversary Advantage (payoff ${ge.expectedPayoff.toFixed(2)})`,
    notes: [
      '## Nash Equilibrium — Compliance vs Evasion Game',
      '',
      `**Expected Adversary Payoff:** ${ge.expectedPayoff.toFixed(3)} (negative = adversary wins)`,
      `**Top Attacker Strategy:** "${ge.topAttackerChoice}"`,
      `**Optimal Defender Response:** "${ge.topDefenderChoice}"`,
      `**Nash Iterations:** ${ge.iterations}`,
      '',
      '### Attacker Mixed Strategy',
      '',
      '| Evasion Tactic | Probability |',
      '|---|---|',
      attackerMix,
      '',
      '### Defender Mixed Strategy',
      '',
      '| Detection Method | Probability |',
      '|---|---|',
      defenderMix,
      '',
      `**Advisory:** ${ge.narrative}`,
      '',
      '*FATF Rec 1 — risk-based approach | NIST AI RMF GV-1.6 | FDL Art.20-21*',
    ].join('\n'),
    due_on: dueDateFromVerdict('flag'),
    assignee: mlroGid,
    tags: ['game-theory', 'adversary-analysis', 'detection-strategy', entityId],
  };
}

function buildInducedRulesSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const rules = brain.extensions.inducedRules;
  if (!rules || rules.length === 0) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const ruleText = rules
    .slice(0, 15)
    .map((r, i) => `${i + 1}. **IF** ${r.conditions.map((c) => `${c.feature}=${c.value}`).join(' AND ')} **THEN** ${r.outcome} (support=${r.support}, confidence=${(r.confidence * 100).toFixed(0)}%)`)
    .join('\n');
  return {
    name: `📐 Induced Decision Rules — ${entityId} — ${rules.length} rule(s)`,
    notes: [
      '## Rule Induction — Human-Readable Decision Logic',
      '',
      `**Rules Extracted:** ${rules.length}`,
      '',
      '### Decision Rules (top 15)',
      '',
      ruleText,
      '',
      '**Purpose:** These rules provide an interpretable explanation of the AI verdict',
      'logic, fulfilling EU AI Act Art.13 transparency requirements.',
      '',
      '*EU AI Act Art.13 — transparency | NIST AI RMF MS-2.5 — explainability*',
    ].join('\n'),
    due_on: dueDateFromVerdict('pass'),
    assignee: mlroGid,
    tags: ['rule-induction', 'explainability', 'eu-ai-act', entityId],
  };
}

function buildFreeZoneSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const fz = brain.extensions.freeZoneCompliance;
  if (!fz || fz.mandatoryFailures.length === 0) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const failTable = fz.mandatoryFailures
    .slice(0, 10)
    .map((r) => `| ${r.category} | ${r.description} | ${r.penalty ?? 'N/A'} |`)
    .join('\n');
  return {
    name: `🏢 Free Zone Compliance Breach — ${entityId} — ${fz.freeZone} — ${fz.mandatoryFailures.length} breach(es)`,
    notes: [
      `## ${fz.freeZone} Mandatory Rule Failures`,
      '',
      `**Free Zone:** ${fz.freeZone}`,
      `**Total Rules:** ${fz.totalRules}`,
      `**Passed:** ${fz.passed}`,
      `**Mandatory Failures:** ${fz.mandatoryFailures.length}`,
      '',
      '### Mandatory Compliance Breaches',
      '',
      '| Category | Requirement | Penalty |',
      '|---|---|---|',
      failTable,
      '',
      '**Actions required:**',
      '- Notify ${fz.freeZone} Authority within required timeframe',
      '- File corrective action plan',
      '- Escalate to Senior Management (Cabinet Res 134/2025)',
      '',
      `*Cabinet Res 134/2025 | ${fz.freeZone} Rules 2024 | Cabinet Res 71/2024 (Penalties)*`,
    ].join('\n'),
    due_on: dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: ['free-zone', fz.freeZone.toLowerCase(), 'regulatory-breach', entityId],
  };
}

function buildLbmaFixSubtask(
  brain: WeaponizedBrainResponse,
  mlroGid?: string,
): AsanaTaskPayload | null {
  const lf = brain.extensions.lbmaFixCheck;
  if (!lf || (lf.flagged === 0 && lf.frozen === 0)) return null;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const severity = lf.frozen > 0 ? 'FREEZE' : 'FLAG';
  const tradeTable = lf.results
    .filter((r) => r.severity !== 'ok')
    .slice(0, 10)
    .map((r) => `| ${r.tradeId} | ${r.metalCode} | ${r.tradePriceUsd.toLocaleString()} | ${r.fixPriceUsd.toLocaleString()} | ${r.deviationPct.toFixed(2)}% | ${r.severity} |`)
    .join('\n');
  return {
    name: `⚖️ LBMA Fix Deviation [${severity}] — ${entityId} — ${lf.flagged} flagged, ${lf.frozen} frozen`,
    notes: [
      '## LBMA Gold Price Fix Deviation Alert',
      '',
      `**Status:** ${severity}`,
      `**Trades Checked:** ${lf.checked}`,
      `**Flagged:** ${lf.flagged} | **Frozen:** ${lf.frozen}`,
      '',
      '### Deviating Trades',
      '',
      '| Trade ID | Metal | Trade Price USD | Fix Price USD | Deviation | Severity |',
      '|---|---|---|---|---|---|',
      tradeTable,
      '',
      `**Narrative:** ${lf.narrative}`,
      '',
      '**Actions required:**',
      '- Investigate each flagged/frozen trade for manipulation',
      '- Execute freeze on frozen trades immediately',
      '- File STR if intentional price manipulation suspected',
      '',
      '*LBMA RGG v9 / FATF DPMS Typologies 2022 §3.4 — price manipulation*',
    ].join('\n'),
    due_on: lf.frozen > 0 ? new Date().toISOString().split('T')[0] : dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: ['lbma-fix', 'gold-price', severity.toLowerCase(), entityId],
  };
}

function buildFreezeCountdownSubtask(entityId: string, mlroGid?: string): AsanaTaskPayload {
  const deadline = new Date(Date.now() + 24 * 3_600_000);
  return {
    name: `⏱ 24h EOCN FREEZE DEADLINE — ${entityId} — due ${deadline.toISOString()}`,
    notes: [
      '## IMMEDIATE ACTION REQUIRED — Cabinet Res 74/2020 Art.4',
      '',
      '1. Execute asset freeze immediately',
      '2. Notify EOCN within 24 clock hours of confirmation',
      '3. File CNMR within 5 business days (goAML form CNMR_V3)',
      '4. DO NOT notify the subject (FDL No.10/2025 Art.29 — tipping off offence)',
      '5. Four-eyes approval required: CO + Senior Management',
      '',
      `**Deadline:** ${deadline.toISOString()}`,
      '**Penalty for miss:** AED 100K–100M + criminal liability (Cabinet Res 71/2024)',
    ].join('\n'),
    due_on: new Date().toISOString().split('T')[0],
    assignee: mlroGid,
    tags: ['URGENT', 'eocn-freeze', '24h-deadline'],
  };
}

function buildEddSubtask(entityId: string, cddLevel: string, coGid?: string): AsanaTaskPayload {
  return {
    name: `📋 EDD Required — ${entityId} — ${cddLevel} → EDD`,
    notes: [
      `Enhanced Due Diligence triggered for entity ${entityId}.`,
      '',
      '**Actions required:**',
      '- Verify source of funds and wealth (Cabinet Res 134/2025 Art.9)',
      '- Obtain senior management approval before proceeding',
      '- Complete EDD within 3-month review cycle',
      '- Re-screen against all 6 sanctions lists',
      '- Document rationale for CDD level change',
      '',
      '**Regulatory ref:** Cabinet Res 134/2025 Art.9-14; FDL No.10/2025 Art.12-14',
    ].join('\n'),
    due_on: dueDateFromVerdict('escalate'),
    assignee: coGid,
    tags: ['edd', 'cdd-review', entityId],
  };
}

function buildStrSubtask(entityId: string, classification: string, dueDate: string | null, mlroGid?: string): AsanaTaskPayload {
  return {
    name: `📤 ${classification} Filing Required — ${entityId}`,
    notes: [
      `**Filing Type:** ${classification}`,
      `**Entity:** ${entityId}`,
      `**Deadline:** ${dueDate ?? 'See regulatory calendar'}`,
      '',
      '**Actions:**',
      `- Prepare ${classification} via goAML`,
      '- Four-eyes review: CO + MLRO',
      '- DO NOT notify subject (FDL Art.29)',
      '- Retain filing record for 5 years (FDL Art.24)',
      '',
      `**Regulatory ref:** FDL No.10/2025 Art.26-27; MoE Circular 08/AML/2021`,
    ].join('\n'),
    due_on: dueDate?.split('T')[0] ?? dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: [classification.toLowerCase(), 'filing', entityId],
  };
}

function buildEsgSubtask(entityId: string, grade: string, riskLevel: string, coGid?: string): AsanaTaskPayload {
  return {
    name: `🌱 ESG Risk — ${entityId} — Grade ${grade} (${riskLevel.toUpperCase()})`,
    notes: [
      `ESG composite grade ${grade} — risk level: ${riskLevel}.`,
      '',
      '**Actions:**',
      '- Review ESG subsystem findings in full compliance report',
      '- Check conflict minerals screening results (OECD DDG / LBMA RGG v9)',
      '- Verify TCFD alignment and carbon footprint disclosure (IFRS S2)',
      '- Address greenwashing findings before next reporting period',
      '',
      '**Regulatory ref:** ISSB IFRS S1/S2; LBMA RGG v9 §6; GRI 2021',
    ].join('\n'),
    due_on: dueDateFromVerdict('flag'),
    assignee: coGid,
    tags: ['esg', `esg-${riskLevel}`, entityId],
  };
}

function buildClampSubtask(clampReason: string, entityId: string, mlroGid?: string): AsanaTaskPayload {
  const isFreeze = clampReason.includes('freeze') || clampReason.includes('FREEZE');
  return {
    name: `⚠ Safety Clamp Fired — ${entityId} — ${clampReason.slice(7, 70)}...`,
    notes: [
      '**Safety clamp triggered by the Weaponized Brain:**',
      '',
      clampReason,
      '',
      '**Action:** Review the clamp reason, verify the underlying data, and confirm or override via four-eyes process.',
    ].join('\n'),
    due_on: dueDateFromVerdict(isFreeze ? 'freeze' : 'escalate'),
    assignee: mlroGid,
    tags: ['safety-clamp', 'brain-alert', entityId],
  };
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function orchestrateBrainToAsana(
  brain: WeaponizedBrainResponse,
  cfg: AsanaOrchestratorConfig,
): Promise<OrchestratorResult> {
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const v = brain.finalVerdict;
  const errors: string[] = [];

  if (!cfg.syncPassVerdicts && v === 'pass') {
    return {
      entityId,
      verdict: v,
      subtasksCreated: 0,
      tasksQueued: 0,
      errors: [],
      summary: 'Pass verdict — Asana sync skipped (syncPassVerdicts=false)',
    };
  }

  // Build all task payloads
  const parentPayload = buildParentTask(brain, cfg);
  const subtaskPayloads: AsanaTaskPayload[] = [];

  // Freeze: 24h countdown + EOCN notification
  if (v === 'freeze') {
    subtaskPayloads.push(buildFreezeCountdownSubtask(entityId, cfg.mlroGid));
  }

  // EDD if escalated
  if (v === 'escalate' || v === 'freeze') {
    const cdd = brain.extensions.explanation?.cddLevel ?? 'CDD';
    subtaskPayloads.push(buildEddSubtask(entityId, cdd, cfg.coGid));
  }

  // STR/SAR/CTR classification subtask
  if (brain.extensions.filingClassification &&
      brain.extensions.filingClassification.primaryCategory !== 'NONE') {
    const fc = brain.extensions.filingClassification;
    subtaskPayloads.push(buildStrSubtask(
      entityId,
      fc.primaryCategory,
      fc.deadlineDueDate,
      cfg.mlroGid,
    ));
  }

  // ESG risk subtask
  if (brain.extensions.esgScore && brain.extensions.esgScore.riskLevel !== 'low') {
    subtaskPayloads.push(buildEsgSubtask(
      entityId,
      brain.extensions.esgScore.grade,
      brain.extensions.esgScore.riskLevel,
      cfg.coGid,
    ));
  }

  // Clamp reason subtasks (max 5 most critical)
  for (const reason of brain.clampReasons.slice(0, 5)) {
    subtaskPayloads.push(buildClampSubtask(reason, entityId, cfg.mlroGid));
  }

  // Managed agent plan subtask — shows which agents Hawkeye will spawn
  const agentSubtask = buildManagedAgentsSubtask(brain, cfg.mlroGid);
  if (agentSubtask) subtaskPayloads.push(agentSubtask);

  // Penalty VaR subtask — financial exposure quantification
  const penaltySubtask = buildPenaltyVarSubtask(brain, cfg.mlroGid);
  if (penaltySubtask) subtaskPayloads.push(penaltySubtask);

  // STR narrative subtask — auto-built goAML narrative ready for filing
  const strNarrativeSubtask = buildStrNarrativeSubtask(brain, cfg.mlroGid);
  if (strNarrativeSubtask) subtaskPayloads.push(strNarrativeSubtask);

  // ─── Phase 12 Ultra-Weaponized Subtasks ──────────────────────────────────

  // #93 goAML XML — auto-generated XML filing ready for UAE FIU submission
  const goamlXmlSubtask = buildGoAMLXmlSubtask(brain, cfg.mlroGid);
  if (goamlXmlSubtask) subtaskPayloads.push(goamlXmlSubtask);

  // #94 Bayesian belief verdict — posterior probability distribution
  const bayesianSubtask = buildBayesianVerdictSubtask(brain, cfg.mlroGid);
  if (bayesianSubtask) subtaskPayloads.push(bayesianSubtask);

  // #73 Corporate graph — flagged subsidiary/affiliate nodes
  const corporateGraphSubtask = buildCorporateGraphSubtask(brain, cfg.mlroGid);
  if (corporateGraphSubtask) subtaskPayloads.push(corporateGraphSubtask);

  // #80 Game theory adversary — Nash equilibrium advisory when adversary has edge
  const gameTheorySubtask = buildGameTheorySubtask(brain, cfg.mlroGid);
  if (gameTheorySubtask) subtaskPayloads.push(gameTheorySubtask);

  // #97 Rule induction — human-readable decision rules for transparency
  const inducedRulesSubtask = buildInducedRulesSubtask(brain, cfg.mlroGid);
  if (inducedRulesSubtask) subtaskPayloads.push(inducedRulesSubtask);

  // #83 Free zone compliance — mandatory rule breach notifications
  const freeZoneSubtask = buildFreeZoneSubtask(brain, cfg.mlroGid);
  if (freeZoneSubtask) subtaskPayloads.push(freeZoneSubtask);

  // #81 LBMA fix checker — gold price manipulation alerts
  const lbmaFixSubtask = buildLbmaFixSubtask(brain, cfg.mlroGid);
  if (lbmaFixSubtask) subtaskPayloads.push(lbmaFixSubtask);

  // #88 Quantum seal — post-quantum audit trail record (always attached)
  const quantumSealSubtask = buildQuantumSealSubtask(brain, cfg.mlroGid);
  if (quantumSealSubtask) subtaskPayloads.push(quantumSealSubtask);

  // Dispatch
  let parentTaskGid: string | undefined;
  let subtasksCreated = 0;
  let tasksQueued = 0;

  if (isAsanaConfigured()) {
    try {
      const parentResult = await createAsanaTask(parentPayload);
      parentTaskGid = parentResult?.gid;

      for (const sub of subtaskPayloads) {
        try {
          if (parentTaskGid) {
            await createAsanaTask({ ...sub, parent: parentTaskGid });
            subtasksCreated++;
          }
        } catch (subErr) {
          // Queue for retry
          enqueueRetry({ ...sub, parent: parentTaskGid });
          tasksQueued++;
          errors.push(`Subtask queued for retry: ${sub.name.slice(0, 60)}`);
        }
      }
    } catch (err) {
      // Queue parent for retry
      enqueueRetry(parentPayload);
      tasksQueued++;
      errors.push(`Parent task queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Asana not configured — queue everything
    enqueueRetry(parentPayload);
    tasksQueued++;
    for (const sub of subtaskPayloads) {
      enqueueRetry(sub);
      tasksQueued++;
    }
  }

  const summary =
    `Entity ${entityId} [${v.toUpperCase()}]: ` +
    `parent task ${parentTaskGid ?? 'queued'}, ` +
    `${subtasksCreated} subtask(s) created, ` +
    `${tasksQueued} queued for retry, ` +
    `${errors.length} error(s).`;

  return { entityId, verdict: v, parentTaskGid, subtasksCreated, tasksQueued, errors, summary };
}
