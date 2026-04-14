/**
 * Asana Comment Slash-Command Skill Router.
 *
 * MLROs live inside Asana. Instead of opening the SPA every time
 * they want to run a compliance skill, they should be able to
 * type a slash command as an Asana task comment and get the
 * skill result back as a reply comment.
 *
 * Example:
 *     /screen ACME LLC
 *     /incident case-42 sanctions-match
 *     /goaml case-42
 *     /audit-pack company-1
 *
 * The inbound webhook handler forwards comment_added events to
 * this router. The router:
 *
 *   1. Parses the comment text with a deterministic regex
 *   2. Looks up the skill in the catalogue
 *   3. Returns a SkillInvocation object (pure function — no
 *      execution here)
 *
 * Actual execution lives in the Netlify function that consumes
 * this router. Today execution is a stub that posts back a
 * canned acknowledgement + the catalogue entry. Real execution
 * can swap the stub for a subprocess call into the skills/
 * runner without changing the router contract.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (MLRO duty of care —
 *     auditable skill invocations)
 *   - FDL No.10/2025 Art.29 (no tipping off — the router
 *     NEVER echoes entity legal names into the acknowledgement;
 *     it uses the raw args the MLRO supplied)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillCategory =
  | 'screening'
  | 'onboarding'
  | 'incident'
  | 'filing'
  | 'audit'
  | 'review'
  | 'reporting'
  | 'governance';

export interface SkillCatalogueEntry {
  /** Slash name — without the leading slash. */
  name: string;
  category: SkillCategory;
  /** Short human-readable description. */
  description: string;
  /** Minimum required argument count. */
  minArgs: number;
  /** Regulatory basis citation. */
  citation: string;
}

export interface SkillInvocation {
  /** Matched skill catalogue entry. */
  skill: SkillCatalogueEntry;
  /** Raw args passed after the slash name. */
  args: string[];
  /** The original comment body, trimmed. */
  rawComment: string;
}

export interface SkillRouteResult {
  ok: boolean;
  invocation?: SkillInvocation;
  error?: string;
  /** True when the comment was not a slash command at all. */
  notSlash?: boolean;
}

// ---------------------------------------------------------------------------
// Catalogue — mirrors the skills/ directory
// ---------------------------------------------------------------------------

export const SKILL_CATALOGUE: readonly SkillCatalogueEntry[] = [
  {
    name: 'screen',
    category: 'screening',
    description: 'Sanctions + PEP + adverse media screening across UN/OFAC/EU/UK/UAE/EOCN lists',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.35; Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'multi-agent-screen',
    category: 'screening',
    description: 'Parallel multi-agent screening across all sanctions lists',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.35; Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'onboard',
    category: 'onboarding',
    description: 'Customer onboarding workflow (CDD tier + risk assessment)',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.12-14; Cabinet Res 134/2025 Art.7-14',
  },
  {
    name: 'incident',
    category: 'incident',
    description: 'Incident response with 24h EOCN countdown',
    minArgs: 1,
    citation: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'goaml',
    category: 'filing',
    description: 'Generate goAML XML for STR/SAR/CTR/DPMSR/CNMR',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.26-27; MoE Circular 08/AML/2021',
  },
  {
    name: 'filing-compliance',
    category: 'filing',
    description: 'Prove every filing hit its regulatory deadline',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.26-27',
  },
  {
    name: 'audit',
    category: 'audit',
    description: 'Compliance audit report for pre-audit prep',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.22; Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'audit-pack',
    category: 'audit',
    description: 'Complete audit pack for MoE/LBMA/internal',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.24; LBMA RGG v9',
  },
  {
    name: 'moe-readiness',
    category: 'audit',
    description: '25-item MoE inspection readiness checklist',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.42-44',
  },
  {
    name: 'traceability',
    category: 'audit',
    description: 'Regulatory traceability matrix (req → code → test → evidence)',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.22',
  },
  {
    name: 'timeline',
    category: 'audit',
    description: 'Entity compliance history / chronological audit trail',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.24',
  },
  {
    name: 'review-pr',
    category: 'review',
    description: 'Risk-scored PR review before merge',
    minArgs: 0,
    citation: 'Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'agent-review',
    category: 'review',
    description: 'Multi-agent compliance code review',
    minArgs: 0,
    citation: 'Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'agent-orchestrate',
    category: 'review',
    description: 'Multi-agent compliance workflow orchestration',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'deploy-check',
    category: 'governance',
    description: 'Pre-deployment verification',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.20-21',
  },
  {
    name: 'regulatory-update',
    category: 'governance',
    description: 'Process a new regulation + impact analysis',
    minArgs: 1,
    citation: 'FDL No.10/2025; Cabinet Res 134/2025',
  },
  {
    name: 'kpi-report',
    category: 'reporting',
    description: '30-KPI DPMS compliance report',
    minArgs: 0,
    citation: 'MoE Circular 08/AML/2021',
  },

  // ─── Expansion pack — brain-integrated and regulation-specific skills ───
  // Every entry below is a new skill added in commit 5. Each cites a
  // specific UAE regulation and is reachable from the Asana slash-command
  // surface + the unified orchestrator façade.

  {
    name: 'brain-analyze',
    category: 'screening',
    description: 'Run full weaponized brain analysis (MegaBrain + 30+ subsystems)',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.19-21; Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'ubo-trace',
    category: 'screening',
    description: 'Ultimate beneficial owner chain traversal (UBO ≥25% including layered)',
    minArgs: 1,
    citation: 'Cabinet Decision 109/2023',
  },
  {
    name: 'pep-check',
    category: 'screening',
    description: 'Politically Exposed Person screening with senior-management approval trigger',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    name: 'adverse-media',
    category: 'screening',
    description: 'Adverse media ranked scan across risk categories',
    minArgs: 1,
    citation: 'FATF Rec 10; Cabinet Res 134/2025 Art.14',
  },
  {
    name: 'tfs-check',
    category: 'screening',
    description: 'Targeted Financial Sanctions check across UN/OFAC/EU/UK/UAE/EOCN',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.35; Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'freeze',
    category: 'incident',
    description: 'Execute 24h EOCN freeze protocol with countdown + CNMR scheduling',
    minArgs: 1,
    citation: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'unfreeze',
    category: 'incident',
    description: 'Request freeze release with four-eyes approval + regulator notification',
    minArgs: 1,
    citation: 'Cabinet Res 74/2020 Art.7',
  },
  {
    name: 'edd',
    category: 'onboarding',
    description: 'Trigger Enhanced Due Diligence flow with Senior Management approval gate',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    name: 'sdd',
    category: 'onboarding',
    description: 'Apply Simplified Due Diligence tier for low-risk entities',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.7-10',
  },
  {
    name: 'cdd-review',
    category: 'onboarding',
    description: 'Periodic CDD re-review for an existing entity',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.11',
  },
  {
    name: 'str',
    category: 'filing',
    description: 'Draft STR (Suspicious Transaction Report) with narrative + filing deadline',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.26-27',
  },
  {
    name: 'sar',
    category: 'filing',
    description: 'Draft SAR (Suspicious Activity Report) via goAML schema',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.26-27',
  },
  {
    name: 'ctr',
    category: 'filing',
    description: 'Draft CTR (Cash Transaction Report) — AED 55K+ threshold',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.16; MoE Circular 08/AML/2021',
  },
  {
    name: 'dpmsr',
    category: 'filing',
    description: 'Draft DPMSR (Dealers in Precious Metals / Stones Report)',
    minArgs: 1,
    citation: 'MoE Circular 08/AML/2021',
  },
  {
    name: 'cnmr',
    category: 'filing',
    description: 'Draft CNMR (Compliance Non-Match Report) — 5-business-day deadline',
    minArgs: 1,
    citation: 'Cabinet Res 74/2020 Art.6',
  },
  {
    name: 'bni',
    category: 'filing',
    description: 'Cross-border Bearer Negotiable Instrument declaration (AED 60K threshold)',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.17',
  },
  {
    name: 'four-eyes-status',
    category: 'governance',
    description: 'List pending four-eyes approvals with decision type + remaining hours',
    minArgs: 0,
    citation: 'Cabinet Res 134/2025 Art.12-14',
  },
  {
    name: 'four-eyes-approve',
    category: 'governance',
    description: 'Approve a pending four-eyes decision (role-gated)',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.12-14',
  },
  {
    name: 'drift-check',
    category: 'governance',
    description: 'Detect regulatory drift vs. current REGULATORY_CONSTANTS_VERSION',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.42-44',
  },
  {
    name: 'cross-case',
    category: 'review',
    description: 'Cross-case pattern correlation across the active case store',
    minArgs: 0,
    citation: 'FATF Rec 20-23',
  },
  {
    name: 'risk-score',
    category: 'review',
    description: 'Full explainable risk score for an entity (likelihood × impact + multipliers)',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.5',
  },
  {
    name: 'supply-chain',
    category: 'review',
    description: 'Supply-chain risk assessment (LBMA RGG v9 + Dubai Good Delivery)',
    minArgs: 1,
    citation: 'LBMA RGG v9; UAE MoE RSG Framework',
  },
  {
    name: 'penalty-forecast',
    category: 'reporting',
    description: 'Penalty Value-at-Risk forecast (Monte Carlo, 95% confidence)',
    minArgs: 0,
    citation: 'Cabinet Res 71/2024',
  },
  {
    name: 'board-report',
    category: 'reporting',
    description: 'Quarterly board-level compliance report with KPIs + incidents',
    minArgs: 0,
    citation: 'FDL No.10/2025 Art.22; Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'brain-status',
    category: 'governance',
    description: 'Show Brain Power Score + subsystem health + advisor status',
    minArgs: 0,
    citation: 'NIST AI RMF 1.0 MANAGE-2',
  },
  {
    name: 'training-plan',
    category: 'governance',
    description: 'Generate compliance training plan for a team / role / frequency',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.22; Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'raci',
    category: 'governance',
    description: 'RACI matrix for a given compliance process',
    minArgs: 1,
    citation: 'Cabinet Res 134/2025 Art.19',
  },
  {
    name: 'gap-register',
    category: 'audit',
    description: 'Open gap register entry with remediation plan + due date',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.22',
  },
  {
    name: 'zk-attest',
    category: 'audit',
    description: 'Generate zk-compliance attestation commitment for cross-border sharing',
    minArgs: 1,
    citation: 'FDL No.10/2025 Art.24; FATF Rec 40',
  },
];

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw comment string into a slash-command invocation.
 * Returns `notSlash: true` when the comment is not a slash
 * command at all, or `ok: false` + error when it's a slash
 * command but the skill is unknown / args are insufficient.
 */
export function routeAsanaComment(rawComment: string | undefined | null): SkillRouteResult {
  if (!rawComment || typeof rawComment !== 'string') {
    return { ok: false, notSlash: true, error: 'Empty comment' };
  }
  const trimmed = rawComment.trim();
  if (!trimmed.startsWith('/')) {
    return { ok: false, notSlash: true };
  }

  // Strip leading slash, split on whitespace, first token is the
  // skill name. Quoted args ("foo bar") stay together.
  const tokens = tokenize(trimmed.slice(1));
  if (tokens.length === 0) {
    return { ok: false, error: 'Empty slash command' };
  }
  const name = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  const skill = SKILL_CATALOGUE.find((s) => s.name === name);
  if (!skill) {
    return {
      ok: false,
      error: `Unknown skill "/${name}". Known: ${SKILL_CATALOGUE.map((s) => `/${s.name}`).join(', ')}`,
    };
  }

  if (args.length < skill.minArgs) {
    return {
      ok: false,
      error: `/${name} requires at least ${skill.minArgs} argument(s) — ${skill.description}`,
    };
  }

  return {
    ok: true,
    invocation: {
      skill,
      args,
      rawComment: trimmed,
    },
  };
}

/**
 * Very small tokenizer — splits on whitespace but keeps
 * double-quoted strings together so `/screen "ACME LLC"` passes
 * `ACME LLC` as a single arg.
 */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out.push(match[1] ?? match[2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stub executor — returns a canned acknowledgement
// ---------------------------------------------------------------------------

export interface StubExecutionResult {
  reply: string;
  citation: string;
}

/**
 * Build a canned reply for a parsed invocation. Real execution
 * can swap this for a subprocess call into skills/ — the
 * contract is: in → SkillInvocation, out → StubExecutionResult
 * (or similar). The reply body never echoes entity legal names;
 * it quotes the MLRO's args verbatim so it's the MLRO's
 * responsibility to stay Art.29 compliant.
 */
export function buildStubExecution(invocation: SkillInvocation): StubExecutionResult {
  const { skill, args } = invocation;
  const lines = [
    `Skill \`/${skill.name}\` acknowledged (${skill.category}).`,
    '',
    `Description: ${skill.description}`,
    `Regulatory basis: ${skill.citation}`,
    '',
    args.length > 0
      ? `Arguments received: ${args.map((a) => `\`${a}\``).join(' ')}`
      : 'No arguments',
    '',
    '— This is a stub acknowledgement. Real skill execution is wired separately.',
    '',
    'FDL Art.29 — no tipping off. Do not share this comment with the subject.',
  ];
  return {
    reply: lines.join('\n'),
    citation: skill.citation,
  };
}
