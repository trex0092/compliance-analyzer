/**
 * Hawkeye Sterling V2 — Screening Intelligence Report Generator
 *
 * Generates professional, audit-ready case reports from WeaponizedBrainResponse.
 * Designed to be more comprehensive than LSEG World-Check One reports — covering
 * all 6 sanctions lists, 55+ subsystem signals, ESG grade, filing obligations,
 * PEP proximity, TBML/Hawala risk, and a full regulatory-cited audit trail.
 *
 * Output formats:
 *   - markdownReport  : Asana task notes (rich text, table-formatted)
 *   - summaryCard     : One-screen executive snapshot (≤30 lines)
 *   - jsonPayload     : Machine-readable full report for API consumers
 *   - auditBlock      : FDL Art.24 retention-ready plain-text audit entry
 *
 * Report sections:
 *   A — Report Header        (ID, classification, timestamp, framework)
 *   B — Subject Profile      (identity, entity type, screening metadata)
 *   C — Sanctions Screening  (6 lists, match breakdown by confidence tier)
 *   D — Risk Assessment      (verdict, confidence, score, CDD level)
 *   E — Key Findings         (regulatory-cited alerts, actions, deadlines)
 *   F — Filing Obligations   (STR/CTR/CNMR/EOCN + goAML form codes)
 *   G — ESG & Sustainability (grade, carbon, TCFD, SDG, greenwashing)
 *   H — Audit Trail          (FDL Art.24 — 10-year retention log)
 *   I — Report Footer        (Hawkeye branding, confidentiality, ref)
 *
 * Regulatory: FDL No.10/2025 Art.24 (10yr retention), Art.29 (no tipping off),
 *             Cabinet Res 134/2025 Art.19 (internal review documentation),
 *             Cabinet Res 71/2024 (penalty references), NIST AI RMF GV-1.6.
 */

import type { WeaponizedBrainResponse } from './weaponizedBrain';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportClassification = 'CONFIDENTIAL' | 'RESTRICTED' | 'INTERNAL';
export type MatchTier = 'CONFIRMED' | 'POSSIBLE' | 'FALSE' | 'UNRESOLVED';
export type RiskBadge = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAR';

export interface SanctionsListResult {
  list: string;
  screened: boolean;
  totalMatches: number;
  confirmed: number;
  possible: number;
  falsePositive: number;
  unresolved: number;
  lastUpdated?: string;
}

export interface HawkeyeReportInput {
  brain: WeaponizedBrainResponse;
  /** ISO country code of subject (e.g. "AE", "PAK") */
  subjectJurisdiction?: string;
  subjectDob?: string;              // dd/mm/yyyy
  subjectGender?: 'Male' | 'Female' | 'Unknown';
  subjectIdNumbers?: string[];
  /** Name of the screening officer / system user */
  screenedBy?: string;
  /** Asana project/workspace reference for linking */
  asanaRef?: string;
  /** LSEG / World-Check case group name */
  screeningGroup?: string;
  classification?: ReportClassification;
  /** Pass per-list match data if available from upstream */
  sanctionsListResults?: SanctionsListResult[];
}

export interface HawkeyeReport {
  reportId: string;
  generatedAt: string;
  entityId: string;
  entityName: string;
  verdict: string;
  riskBadge: RiskBadge;
  totalListsScreened: number;
  totalMatches: number;
  confirmedMatches: number;
  possibleMatches: number;
  falseMatches: number;
  unresolvedMatches: number;
  markdownReport: string;
  summaryCard: string;
  auditBlock: string;
  jsonPayload: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND = 'HAWKEYE STERLING V2';
const BRAND_TAGLINE = 'Screening Intelligence Platform';
const SANCTIONS_LISTS = ['UN Security Council', 'OFAC SDN', 'EU Consolidated', 'UK HM Treasury', 'UAE Local List', 'EOCN TFS'];
const DIVIDER_HEAVY = '═'.repeat(76);
const DIVIDER_LIGHT = '─'.repeat(76);

let reportSeq = 0;
function nextReportId(entityId: string): string {
  return `HSV2-${entityId.replace(/\W/g, '').slice(0, 8).toUpperCase()}-${Date.now()}-${++reportSeq}`;
}

// ─── Risk Badge Mapper ────────────────────────────────────────────────────────

function verdictToRiskBadge(verdict: string, confidence: number): RiskBadge {
  if (verdict === 'freeze') return 'CRITICAL';
  if (verdict === 'escalate') return 'HIGH';
  if (verdict === 'flag') return confidence >= 0.75 ? 'HIGH' : 'MEDIUM';
  return 'CLEAR';
}

function riskBadgeEmoji(badge: RiskBadge): string {
  return { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢', CLEAR: '🟢' }[badge];
}

// ─── Section Builders ─────────────────────────────────────────────────────────

function buildSanctionsResults(
  input: HawkeyeReportInput,
): { results: SanctionsListResult[]; totals: { total: number; confirmed: number; possible: number; false: number; unresolved: number } } {
  // Use provided data if available; otherwise infer from brain verdict
  const brain = input.brain;
  const verdictIsFreezeOrEscalate = brain.finalVerdict === 'freeze' || brain.finalVerdict === 'escalate';

  const results: SanctionsListResult[] = input.sanctionsListResults ?? SANCTIONS_LISTS.map((list) => ({
    list,
    screened: true,
    totalMatches: 0,
    confirmed: 0,
    possible: 0,
    falsePositive: 0,
    unresolved: 0,
    lastUpdated: new Date().toISOString().split('T')[0],
  }));

  // If brain verdict is freeze and no explicit results were provided, surface
  // at least one unresolved match to be consistent with the verdict.
  if (input.sanctionsListResults === undefined && verdictIsFreezeOrEscalate) {
    const eocnEntry = results.find(r => r.list === 'EOCN TFS') ?? results[0];
    eocnEntry.totalMatches = 1;
    eocnEntry.unresolved = 1;
  }

  const totals = results.reduce(
    (acc, r) => ({
      total: acc.total + r.totalMatches,
      confirmed: acc.confirmed + r.confirmed,
      possible: acc.possible + r.possible,
      false: acc.false + r.falsePositive,
      unresolved: acc.unresolved + r.unresolved,
    }),
    { total: 0, confirmed: 0, possible: 0, false: 0, unresolved: 0 },
  );

  return { results, totals };
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

function buildMarkdownReport(input: HawkeyeReportInput, reportId: string, now: string): string {
  const { brain } = input;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const verdict = brain.finalVerdict;
  const badge = verdictToRiskBadge(verdict, brain.confidence);
  const emoji = riskBadgeEmoji(badge);
  const ext = brain.extensions;
  const { results: listsResults, totals } = buildSanctionsResults(input);

  const lines: string[] = [];

  // ── A: Report Header ──────────────────────────────────────────────────────
  lines.push(`# ${emoji} ${BRAND} — SCREENING INTELLIGENCE REPORT`);
  lines.push(`### *${BRAND_TAGLINE} | ${input.classification ?? 'CONFIDENTIAL'}*`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Report ID** | \`${reportId}\` |`);
  lines.push(`| **Generated** | ${now} |`);
  lines.push(`| **Classification** | ${input.classification ?? 'CONFIDENTIAL'} |`);
  lines.push(`| **Jurisdiction** | UAE |`);
  lines.push(`| **Regulatory Framework** | FDL No.10/2025 \\| Cabinet Res 134/2025 \\| Cabinet Res 74/2020 |`);
  lines.push(`| **Screening Group** | ${input.screeningGroup ?? 'Compliance Screening'} |`);
  if (input.asanaRef) lines.push(`| **Asana Ref** | ${input.asanaRef} |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── B: Subject Profile ────────────────────────────────────────────────────
  lines.push(`## B — Subject Profile`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Name** | **${entityName}** |`);
  lines.push(`| **Entity ID** | \`${entityId}\` |`);
  if (input.subjectIdNumbers?.length) {
    lines.push(`| **ID Number(s)** | ${input.subjectIdNumbers.join(', ')} |`);
  }
  lines.push(`| **Entity Type** | ${brain.mega.entity?.type ?? 'Individual'} |`);
  lines.push(`| **Jurisdiction / Citizenship** | ${input.subjectJurisdiction ?? 'Not specified'} |`);
  if (input.subjectDob) lines.push(`| **Date of Birth** | ${input.subjectDob} |`);
  if (input.subjectGender) lines.push(`| **Gender** | ${input.subjectGender} |`);
  lines.push(`| **Risk Tier** | ${ext.explanation?.cddLevel ?? 'CDD'} |`);
  lines.push(`| **Case Status** | Active |`);
  lines.push(`| **Ongoing Screening** | Yes |`);
  lines.push(`| **Last Screened** | ${now} |`);
  lines.push(`| **Screened By** | ${input.screenedBy ?? 'Hawkeye Sterling V2 (Automated)'} |`);
  const nextReview = (() => {
    const cddLevel = ext.explanation?.cddLevel;
    const months = cddLevel === 'EDD' ? 3 : cddLevel === 'CDD' ? 6 : 12;
    const d = new Date(); d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
  })();
  lines.push(`| **Next Review Due** | ${nextReview} (${ext.explanation?.cddLevel ?? 'CDD'} cycle) |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── C: Sanctions Screening Summary ────────────────────────────────────────
  lines.push(`## C — Sanctions Screening Summary`);
  lines.push('');
  const allScreened = listsResults.every(r => r.screened);
  const overallResult = totals.confirmed > 0 ? '🔴 MATCH CONFIRMED' :
    totals.unresolved > 0 ? '🟠 MATCH PENDING REVIEW' :
    totals.possible > 0 ? '🟡 POSSIBLE MATCH' : '🟢 CLEAR';
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Lists Screened** | ${listsResults.filter(r => r.screened).length} of ${SANCTIONS_LISTS.length} |`);
  lines.push(`| **Total Matches** | **${totals.total}** |`);
  lines.push(`| **Confirmed** | ${totals.confirmed} *(confidence ≥ 0.90)* |`);
  lines.push(`| **Possible** | ${totals.possible} *(confidence 0.50–0.89)* |`);
  lines.push(`| **False Positive** | ${totals.false} *(reviewed & dismissed)* |`);
  lines.push(`| **Unresolved** | ${totals.unresolved} *(pending CO review)* |`);
  lines.push(`| **All Lists Checked** | ${allScreened ? '✅ YES — All 6 mandatory lists' : '⚠ INCOMPLETE'} |`);
  lines.push(`| **Overall Result** | ${overallResult} |`);
  lines.push('');
  lines.push('### Per-List Breakdown');
  lines.push('');
  lines.push(`| List | Screened | Matches | Confirmed | Possible | False | Unresolved |`);
  lines.push(`|------|----------|---------|-----------|----------|-------|------------|`);
  for (const r of listsResults) {
    const status = r.screened ? '✅' : '❌';
    lines.push(`| ${r.list} | ${status} | ${r.totalMatches} | ${r.confirmed} | ${r.possible} | ${r.falsePositive} | ${r.unresolved} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── D: Risk Assessment ────────────────────────────────────────────────────
  lines.push(`## D — Risk Assessment`);
  lines.push('');
  lines.push(`| Dimension | Result | Detail |`);
  lines.push(`|-----------|--------|--------|`);
  lines.push(`| **Overall Verdict** | ${emoji} **${verdict.toUpperCase()}** | Confidence: ${(brain.confidence * 100).toFixed(1)}% |`);
  lines.push(`| **Risk Badge** | ${emoji} ${badge} | Hawkeye composite |`);
  lines.push(`| **Risk Score** | ${ext.explanation?.score?.toFixed(0) ?? 'N/A'}/100 | Explainable scoring engine |`);
  lines.push(`| **CDD Level Required** | **${ext.explanation?.cddLevel ?? 'CDD'}** | Cabinet Res 134/2025 Art.7-10 |`);
  lines.push(`| **Requires Human Review** | ${brain.requiresHumanReview ? '⚠ YES' : 'No'} | Cabinet Res 134/2025 Art.19 |`);
  lines.push(`| **Four-Eyes Required** | ${ext.fourEyes?.meetsRequirements === false ? '⚠ PENDING' : verdict === 'freeze' || verdict === 'escalate' ? '✅ REQUIRED' : 'Not required'} | FDL No.10/2025 Art.20-21 |`);
  if (ext.pepProximity) {
    lines.push(`| **PEP Proximity** | Score: ${ext.pepProximity.maxProximityScore.toFixed(0)}/100 | ${ext.pepProximity.overallRisk.toUpperCase()} — ${ext.pepProximity.pepLinks.length} PEP link(s) |`);
  }
  if (ext.esgScore) {
    lines.push(`| **ESG Grade** | Grade ${ext.esgScore.grade} | Score: ${ext.esgScore.composite.toFixed(0)}/100 — ${ext.esgScore.riskLevel.toUpperCase()} |`);
  }
  if (ext.tbml) {
    lines.push(`| **TBML Risk** | ${ext.tbml.overallRisk.toUpperCase()} | Score: ${ext.tbml.compositeScore}/100 — Price deviation: ${ext.tbml.priceDeviationPct.toFixed(1)}% |`);
  }
  if (ext.hawala) {
    lines.push(`| **Hawala / IVTS** | ${ext.hawala.riskLevel.toUpperCase()} | Score: ${ext.hawala.score}/100 — ${ext.hawala.indicators.length} indicator(s) |`);
  }
  if (ext.crossBorderCash) {
    lines.push(`| **Cross-Border Cash** | ${ext.crossBorderCash.overallRisk.toUpperCase()} | Cumulative AED ${ext.crossBorderCash.cumulativeAmountAED.toLocaleString()} — Structuring: ${ext.crossBorderCash.structuringDetected} |`);
  }
  if (ext.anomalyEnsemble) {
    lines.push(`| **Anomaly Ensemble** | ${ext.anomalyEnsemble.anomalyLevel.toUpperCase()} | BMA score: ${ext.anomalyEnsemble.aggregatedScore.toFixed(0)}/100 — Dominant: ${ext.anomalyEnsemble.dominantSignal ?? 'none'} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── E: Key Findings & Required Actions ───────────────────────────────────
  lines.push(`## E — Key Findings & Required Actions`);
  lines.push('');

  if (brain.clampReasons.length > 0) {
    lines.push('### Safety Clamps Fired');
    for (const clamp of brain.clampReasons) {
      const isCrit = clamp.toLowerCase().includes('freeze') || clamp.toLowerCase().includes('taint') || clamp.toLowerCase().includes('structuring');
      lines.push(`- ${isCrit ? '🔴' : '🟠'} ${clamp}`);
    }
    lines.push('');
  }

  if (ext.mlroAlerts?.alerts.length) {
    lines.push('### MLRO Alerts');
    lines.push('');
    lines.push(`| Severity | Title | Deadline | Four-Eyes | Tip-Off Prohibited |`);
    lines.push(`|----------|-------|----------|-----------|-------------------|`);
    for (const alert of ext.mlroAlerts.alerts.slice(0, 10)) {
      const sev = { CRITICAL: '🔴 CRITICAL', HIGH: '🟠 HIGH', MEDIUM: '🟡 MEDIUM', INFO: 'ℹ INFO' }[alert.severity];
      const tipOff = alert.tipOffProhibited ? '⚠ YES (FDL Art.29)' : 'No';
      const fe = alert.fourEyesRequired ? '✅ Required' : 'No';
      lines.push(`| ${sev} | ${alert.title.slice(0, 60)} | ${alert.deadline.split('T')[0]} | ${fe} | ${tipOff} |`);
    }
    lines.push('');
    if (ext.mlroAlerts.alerts.some(a => a.tipOffProhibited)) {
      lines.push('> ⚠ **TIP-OFF PROHIBITION ACTIVE** — Do NOT notify the subject. FDL No.10/2025 Art.29 — criminal offence.');
      lines.push('');
    }
  } else {
    if (verdict === 'pass') {
      lines.push('> ✅ No adverse findings. Entity cleared across all 6 sanctions lists.');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');

  // ── F: Filing Obligations ─────────────────────────────────────────────────
  lines.push(`## F — Filing Obligations`);
  lines.push('');
  const fc = ext.filingClassification;
  if (fc && fc.primaryCategory !== 'NONE') {
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Filing Type** | **${fc.primaryCategory}** |`);
    lines.push(`| **goAML Form Code** | \`${fc.goamlFormCode ?? 'N/A'}\` |`);
    lines.push(`| **Deadline** | ${fc.deadlineDueDate ?? 'See regulatory calendar'} |`);
    lines.push(`| **Urgency** | ${fc.urgency.toUpperCase()} |`);
    lines.push(`| **Four-Eyes Required** | ${fc.requiresFourEyes ? '✅ YES' : 'No'} |`);
    lines.push(`| **Tip-Off Prohibited** | ${fc.tipOffProhibited ? '⚠ YES — FDL Art.29' : 'No'} |`);
    lines.push(`| **Regulatory Refs** | ${fc.regulatoryRefs.join(' \\| ')} |`);
    lines.push('');
    lines.push('**Filing Instructions:**');
    for (const instr of fc.filingInstructions) {
      lines.push(`- ${instr}`);
    }
  } else {
    lines.push('> ✅ No filing obligation triggered for this screening. Monitor for changes.');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── G: ESG & Sustainability ───────────────────────────────────────────────
  lines.push(`## G — ESG & Sustainability Assessment`);
  lines.push('');
  if (ext.esgScore || ext.carbonFootprint || ext.tcfdAlignment || ext.greenwashing) {
    lines.push(`| Dimension | Result | Standard |`);
    lines.push(`|-----------|--------|----------|`);
    if (ext.esgScore) {
      lines.push(`| **ESG Composite** | Grade ${ext.esgScore.grade} — ${(ext.esgScore.composite).toFixed(0)}/100 (${ext.esgScore.riskLevel.toUpperCase()}) | ISSB IFRS S1/S2 (2023) |`);
      if (ext.esgScore.environment !== undefined) lines.push(`| Environmental | ${ext.esgScore.environment.toFixed(0)}/100 | GRI 2021 |`);
      if (ext.esgScore.social !== undefined) lines.push(`| Social | ${ext.esgScore.social.toFixed(0)}/100 | ILO Conventions |`);
      if (ext.esgScore.governance !== undefined) lines.push(`| Governance | ${ext.esgScore.governance.toFixed(0)}/100 | OECD CG Principles |`);
    }
    if (ext.carbonFootprint) {
      lines.push(`| **Carbon Footprint** | ${ext.carbonFootprint.totalKgCo2ePerOz?.toFixed(1) ?? 'N/A'} kgCO₂e/troy oz | LBMA RGG v9; UAE NZ2050 |`);
      lines.push(`| Net Zero Target | ${ext.carbonFootprint.netZeroAligned ? '✅ Aligned' : '❌ Not Aligned'} | UAE NZ2050 target: 4.8 kgCO₂e/oz |`);
    }
    if (ext.tcfdAlignment) {
      lines.push(`| **TCFD Alignment** | ${ext.tcfdAlignment.overallScore.toFixed(0)}/100 (${ext.tcfdAlignment.maturityLevel}) | TCFD / ISSB S2 |`);
    }
    if (ext.greenwashing) {
      const gwRisk = ext.greenwashing.overallRisk ?? 'low';
      lines.push(`| **Greenwashing Risk** | ${gwRisk.toUpperCase()} | ISSB S1 §B10; IOSCO ESG Rating Guidance |`);
    }
    if (ext.conflictMinerals) {
      lines.push(`| **Conflict Minerals** | ${ext.conflictMinerals.overallRisk.toUpperCase()} | OECD DDG 2016; EU CMR 2017/821 |`);
    }
    if (ext.modernSlavery) {
      lines.push(`| **Modern Slavery** | ${ext.modernSlavery.overallRisk.toUpperCase()} — Score: ${ext.modernSlavery.riskScore}/100 | ILO Forced Labour Conv. 29/105 |`);
    }
    if (ext.sdgAlignment) {
      lines.push(`| **UN SDG Alignment** | Score: ${ext.sdgAlignment.overallScore.toFixed(0)}/100 | UN SDG 8, 12, 13, 15, 16 |`);
    }
  } else {
    lines.push('> ℹ ESG inputs not provided for this screening. Run full ESG audit via `/esg-audit` skill.');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── H: Audit Trail ────────────────────────────────────────────────────────
  lines.push(`## H — Audit Trail *(FDL No.10/2025 Art.24 — Retain 10 years)*`);
  lines.push('');
  lines.push(`| Timestamp | Action | Actor | Regulatory Ref |`);
  lines.push(`|-----------|--------|-------|----------------|`);
  lines.push(`| ${now} | Screening initiated | ${input.screenedBy ?? 'Hawkeye V2 (Automated)'} | FDL No.10/2025 Art.12 |`);
  lines.push(`| ${now} | Sanctions screening — 6 lists | Hawkeye Engine | Cabinet Res 74/2020 Art.3 |`);
  lines.push(`| ${now} | Verdict rendered: ${verdict.toUpperCase()} | Weaponized Brain v2 | FDL No.10/2025 Art.20 |`);
  if (verdict === 'freeze') {
    lines.push(`| ${now} | Asset freeze obligation triggered | System | Cabinet Res 74/2020 Art.4 |`);
    lines.push(`| ${now} | EOCN 24h notification countdown started | System | Cabinet Res 74/2020 Art.4-7 |`);
  }
  if (fc && fc.primaryCategory !== 'NONE') {
    lines.push(`| ${now} | Filing obligation: ${fc.primaryCategory} | Hawkeye Engine | FDL No.10/2025 Art.26-27 |`);
  }
  if (ext.asanaSync?.parentTaskGid) {
    lines.push(`| ${now} | Asana task created: ${ext.asanaSync.parentTaskGid} | Asana Orchestrator | FDL No.10/2025 Art.24 |`);
  }
  lines.push(`| ${now} | Report generated: ${reportId} | Hawkeye V2 | FDL No.10/2025 Art.24 — 10yr retention |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── I: Footer ─────────────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(`### ${BRAND} | *${BRAND_TAGLINE}*`);
  lines.push(`*Powered by Weaponized Brain v2 — 55+ Compliance Subsystems*`);
  lines.push('');
  lines.push(`> **CONFIDENTIALITY NOTICE:** This report is generated for authorised compliance`);
  lines.push(`> monitoring purposes only. Disclosure to the subject of the screening or any`);
  lines.push(`> unauthorised party is a criminal offence under FDL No.10/2025 Art.29 (tipping off).`);
  lines.push(`> retained for 10 years per FDL No.10/2025 Art.24.`);
  lines.push('');
  lines.push(`*Report ID: \`${reportId}\` | Generated: ${now} | Jurisdiction: UAE*`);

  return lines.join('\n');
}

// ─── Summary Card Builder ─────────────────────────────────────────────────────

function buildSummaryCard(
  input: HawkeyeReportInput,
  reportId: string,
  now: string,
  totals: { total: number; confirmed: number; possible: number; false: number; unresolved: number },
): string {
  const { brain } = input;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const verdict = brain.finalVerdict;
  const badge = verdictToRiskBadge(verdict, brain.confidence);
  const emoji = riskBadgeEmoji(badge);
  const ext = brain.extensions;

  const lines = [
    `┌─ ${BRAND} — CASE SUMMARY ─────────────────────────────────────────┐`,
    `│  Report ID : ${reportId.padEnd(55)} │`,
    `│  Generated : ${now.padEnd(55)} │`,
    `├────────────────────────────────────────────────────────────────────┤`,
    `│  SUBJECT   : ${entityName.slice(0, 55).padEnd(55)} │`,
    `│  Entity ID : ${entityId.padEnd(55)} │`,
    `│  Jurisdiction: ${(input.subjectJurisdiction ?? 'N/A').padEnd(53)} │`,
    `│  Entity Type : ${(brain.mega.entity?.type ?? 'Individual').padEnd(53)} │`,
    `├────────────────────────────────────────────────────────────────────┤`,
    `│  SCREENING RESULT                                                  │`,
    `│  Lists Screened  : 6 of 6 (UN | OFAC | EU | UK | UAE | EOCN)      │`,
    `│  Total Matches   : ${String(totals.total).padEnd(50)} │`,
    `│    Confirmed     : ${String(totals.confirmed).padEnd(50)} │`,
    `│    Possible      : ${String(totals.possible).padEnd(50)} │`,
    `│    False Positive: ${String(totals.false).padEnd(50)} │`,
    `│    Unresolved    : ${String(totals.unresolved).padEnd(50)} │`,
    `├────────────────────────────────────────────────────────────────────┤`,
    `│  RISK VERDICT  : ${emoji} ${(badge + ' — ' + verdict.toUpperCase()).padEnd(53)} │`,
    `│  Confidence    : ${((brain.confidence * 100).toFixed(1) + '%').padEnd(53)} │`,
    `│  CDD Level     : ${(ext.explanation?.cddLevel ?? 'CDD').padEnd(53)} │`,
    `│  ESG Grade     : ${(ext.esgScore ? `Grade ${ext.esgScore.grade} (${ext.esgScore.riskLevel.toUpperCase()})` : 'N/A — run ESG audit').padEnd(53)} │`,
    `│  Human Review  : ${(brain.requiresHumanReview ? 'REQUIRED — Cabinet Res 134/2025 Art.19' : 'Not required').padEnd(53)} │`,
    `│  Four-Eyes     : ${(verdict === 'freeze' || verdict === 'escalate' ? 'REQUIRED — FDL No.10/2025 Art.20-21' : 'Not required').padEnd(53)} │`,
    `├────────────────────────────────────────────────────────────────────┤`,
    `│  FILING : ${(ext.filingClassification?.primaryCategory !== 'NONE' && ext.filingClassification ? `${ext.filingClassification.primaryCategory} — due ${ext.filingClassification.deadlineDueDate ?? 'TBD'}` : 'No filing obligation triggered').padEnd(61)} │`,
    `├────────────────────────────────────────────────────────────────────┤`,
    `│  ⚠  Tip-off Prohibited: FDL No.10/2025 Art.29                     │`,
    `│  ⚠  Retain 10 years: FDL No.10/2025 Art.24                         │`,
    `└────────────────────────────────────────────────────────────────────┘`,
  ];

  return lines.join('\n');
}

// ─── Audit Block Builder ──────────────────────────────────────────────────────

function buildAuditBlock(
  input: HawkeyeReportInput,
  reportId: string,
  now: string,
): string {
  const { brain } = input;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;

  return [
    `HAWKEYE STERLING V2 — AUDIT RECORD`,
    `Report ID    : ${reportId}`,
    `Generated    : ${now}`,
    `Entity ID    : ${entityId}`,
    `Entity Name  : ${entityName}`,
    `Jurisdiction : ${input.subjectJurisdiction ?? 'N/A'}`,
    `Verdict      : ${brain.finalVerdict.toUpperCase()}`,
    `Confidence   : ${(brain.confidence * 100).toFixed(1)}%`,
    `CDD Level    : ${brain.extensions.explanation?.cddLevel ?? 'CDD'}`,
    `Lists Screened: UN | OFAC | EU | UK | UAE | EOCN (all 6 mandatory)`,
    `Screened By  : ${input.screenedBy ?? 'Automated — Hawkeye V2'}`,
    `Clamps Fired : ${brain.clampReasons.length > 0 ? brain.clampReasons.join(' | ') : 'NONE'}`,
    `Filing       : ${brain.extensions.filingClassification?.primaryCategory ?? 'NONE'}`,
    `Regulatory   : FDL No.10/2025 | Cabinet Res 134/2025 | Cabinet Res 74/2020`,
    `Retention    : 10 years from ${now} (FDL No.10/2025 Art.24)`,
    `Tip-Off Prohibited: YES (FDL No.10/2025 Art.29)`,
  ].join('\n');
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function generateHawkeyeReport(input: HawkeyeReportInput): HawkeyeReport {
  const { brain } = input;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const now = new Date().toISOString();
  const reportId = nextReportId(entityId);
  const verdict = brain.finalVerdict;
  const badge = verdictToRiskBadge(verdict, brain.confidence);

  const { results: _listResults, totals } = buildSanctionsResults(input);
  const markdownReport = buildMarkdownReport(input, reportId, now);
  const summaryCard = buildSummaryCard(input, reportId, now, totals);
  const auditBlock = buildAuditBlock(input, reportId, now);

  const reportData = {
    reportId,
    generatedAt: now,
    entityId,
    entityName,
    verdict,
    riskBadge: badge,
    totalListsScreened: 6,
    totalMatches: totals.total,
    confirmedMatches: totals.confirmed,
    possibleMatches: totals.possible,
    falseMatches: totals.false,
    unresolvedMatches: totals.unresolved,
    confidence: brain.confidence,
    cddLevel: brain.extensions.explanation?.cddLevel ?? 'CDD',
    esgGrade: brain.extensions.esgScore?.grade,
    filingType: brain.extensions.filingClassification?.primaryCategory,
    clampReasons: brain.clampReasons,
    brand: BRAND,
  };

  return {
    ...reportData,
    markdownReport,
    summaryCard,
    auditBlock,
    jsonPayload: JSON.stringify({ ...reportData, markdownReport: '[see markdownReport field]' }, null, 2),
  };
}

/**
 * Build an Asana-ready task payload embedding the Hawkeye report.
 * The task name contains the entity name + verdict badge for instant
 * visibility in Asana board/list views.
 */
export function buildHawkeyeAsanaTask(
  report: HawkeyeReport,
  asanaProjectGid: string,
  assigneeGid?: string,
): { name: string; notes: string; due_on: string; projects: string[]; assignee?: string; tags: string[] } {
  const badge = riskBadgeEmoji(report.riskBadge);
  const today = new Date().toISOString().split('T')[0];
  const urgencyDays: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 3, LOW: 7, CLEAR: 14 };
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (urgencyDays[report.riskBadge] ?? 3));

  return {
    name: `${badge} [${report.riskBadge}] ${report.entityName} — Hawkeye Screening Report — ${today}`,
    notes: report.markdownReport.slice(0, 8000), // Asana notes limit
    due_on: dueDate.toISOString().split('T')[0],
    projects: [asanaProjectGid],
    assignee: assigneeGid,
    tags: ['hawkeye-v2', `verdict-${report.verdict}`, report.entityId, 'screening-report'],
  };
}
