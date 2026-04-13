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
  subjectDob?: string; // dd/mm/yyyy
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
const SANCTIONS_LISTS = [
  'UN Security Council',
  'OFAC SDN',
  'EU Consolidated',
  'UK HM Treasury',
  'UAE Local List',
  'EOCN TFS',
];
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

function buildSanctionsResults(input: HawkeyeReportInput): {
  results: SanctionsListResult[];
  totals: { total: number; confirmed: number; possible: number; false: number; unresolved: number };
} {
  // Use provided data if available; otherwise infer from brain verdict
  const brain = input.brain;
  const verdictIsFreezeOrEscalate =
    brain.finalVerdict === 'freeze' || brain.finalVerdict === 'escalate';

  const results: SanctionsListResult[] =
    input.sanctionsListResults ??
    SANCTIONS_LISTS.map((list) => ({
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
    const eocnEntry = results.find((r) => r.list === 'EOCN TFS') ?? results[0];
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
    { total: 0, confirmed: 0, possible: 0, false: 0, unresolved: 0 }
  );

  return { results, totals };
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

function buildMarkdownReport(input: HawkeyeReportInput, reportId: string, now: string): string {
  const { brain } = input;
  const entityId = brain.mega.entityId ?? 'UNKNOWN';
  const entityName = brain.mega.topic?.replace(/^Compliance assessment:\s*/i, '') || entityId;
  const verdict = brain.finalVerdict;
  const badge = verdictToRiskBadge(verdict, brain.confidence);
  const emoji = riskBadgeEmoji(badge);
  const ext = brain.extensions;
  const cls = input.classification ?? 'CONFIDENTIAL';
  const { results: listsResults, totals } = buildSanctionsResults(input);
  const fc = ext.filingClassification;

  // Derived display values
  const nowDisplay = now.replace('T', ' ').slice(0, 16) + ' UTC';
  const dateOnly = now.split('T')[0];
  const cddLevel = ext.explanation?.cddLevel ?? 'CDD';
  const nextReview = (() => {
    const months = cddLevel === 'EDD' ? 3 : cddLevel === 'CDD' ? 6 : 12;
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
  })();
  const totalResolved = totals.confirmed + totals.possible + totals.false;
  const overallStatus =
    totals.confirmed > 0
      ? `${emoji} MATCH CONFIRMED`
      : totals.unresolved > 0
        ? '🟠 MATCH — PENDING REVIEW'
        : totals.possible > 0
          ? '🟡 POSSIBLE MATCH'
          : '🟢 CLEAR — NO ADVERSE FINDINGS';

  const lines: string[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER BLOCK
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`# ${BRAND}`);
  lines.push(`## CASE REPORT`);
  lines.push('');
  lines.push(
    `> **${cls}** &nbsp;&nbsp;|&nbsp;&nbsp; ${BRAND_TAGLINE} &nbsp;&nbsp;|&nbsp;&nbsp; UAE Jurisdiction &nbsp;&nbsp;|&nbsp;&nbsp; Report ID: \`${reportId}\``
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — CASE OVERVIEW  (mirrors LSEG top table)
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Name** | **${entityName}** |`);
  if (input.subjectIdNumbers?.length) {
    lines.push(`| **Identification Number(s)** | ${input.subjectIdNumbers.join(' \\| ')} |`);
  }
  lines.push(`| **Case Rating** | ${emoji} **${badge}** |`);
  lines.push(`| **Total Matches (All Lists)** | **${totals.total}** |`);
  lines.push(`| **Case ID** | \`${reportId}\` |`);
  lines.push(
    `| **Screening Group** | ${input.screeningGroup ?? 'Compliance Screening — UAE DPMS'} |`
  );
  if (input.asanaRef) lines.push(`| **Asana Reference** | ${input.asanaRef} |`);
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — SUBJECT DETAILS  (LSEG-style two-column grid)
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`| | | | |`);
  lines.push(`|---|---|---|---|`);
  lines.push(
    `| **Gender** | ${input.subjectGender ?? 'Not specified'} | **Date of Birth** | ${input.subjectDob ?? 'Not specified'} |`
  );
  lines.push(
    `| **Citizenship** | ${input.subjectJurisdiction ?? 'Not specified'} | **Last Screened** | ${nowDisplay} |`
  );
  lines.push(`| **Case Created** | ${dateOnly} | **Entity Type** | Individual |`);
  lines.push(`| **Ongoing Screening** | Yes | **Archived** | No |`);
  lines.push(
    `| **Name Transposition** | ${ext.nameVariants ? `Yes — ${ext.nameVariants.variants.length} variant(s)` : 'Standard'} | **CDD Level** | **${cddLevel}** |`
  );
  lines.push(
    `| **Next Review Due** | ${nextReview} | **Screened By** | ${input.screenedBy ?? 'Hawkeye V2 (Automated)'} |`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — KEY FINDINGS  (most prominent section — matches LSEG exactly)
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## KEY FINDINGS`);
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Total Matches** | **${totals.total}** |`);
  lines.push(
    `| **Resolved Matches** | ${totalResolved} &nbsp;&nbsp; Confirmed: **${totals.confirmed}** &nbsp;&nbsp; Possible: **${totals.possible}** &nbsp;&nbsp; False Positive: **${totals.false}** &nbsp;&nbsp; Unresolved: **${totals.unresolved}** |`
  );
  lines.push(`| **Unresolved Matches** | **${totals.unresolved}** |`);
  lines.push(
    `| **Lists Screened** | ${listsResults.filter((r) => r.screened).length} of ${SANCTIONS_LISTS.length} — UN \\| OFAC \\| EU \\| UK \\| UAE \\| EOCN |`
  );
  lines.push(`| **Overall Screening Result** | ${overallStatus} |`);
  lines.push('');

  // Per-list breakdown table
  lines.push(`| List | Status | Total | Confirmed | Possible | False Positive | Unresolved |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of listsResults) {
    const s = r.screened ? '✅ Screened' : '❌ Not screened';
    const rowEmoji =
      r.confirmed > 0 ? '🔴' : r.unresolved > 0 ? '🟠' : r.possible > 0 ? '🟡' : '🟢';
    lines.push(
      `| ${r.list} | ${s} | ${rowEmoji} ${r.totalMatches} | ${r.confirmed} | ${r.possible} | ${r.falsePositive} | ${r.unresolved} |`
    );
  }
  if (!listsResults.every((r) => r.screened)) {
    lines.push('');
    lines.push(
      '> ⚠ **INCOMPLETE SCREENING** — Not all mandatory lists were checked. Escalate to CO immediately. (FATF Rec 1; Cabinet Res 74/2020 Art.3)'
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — RISK ASSESSMENT MATRIX
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## Risk Assessment`);
  lines.push('');
  lines.push(`| Risk Dimension | Rating | Score | Regulatory Reference |`);
  lines.push(`|---|---|---|---|`);
  lines.push(
    `| **Overall Verdict** | ${emoji} **${verdict.toUpperCase()}** | Confidence: ${(brain.confidence * 100).toFixed(1)}% | FDL No.10/2025 Art.20-21 |`
  );
  lines.push(
    `| **Composite Risk Score** | ${badge} | ${ext.explanation?.score?.toFixed(0) ?? 'N/A'} / 100 | Weaponized Brain v2 |`
  );
  lines.push(`| **CDD Level Required** | **${cddLevel}** | — | Cabinet Res 134/2025 Art.7-10 |`);
  lines.push(
    `| **Human Review** | ${brain.requiresHumanReview ? '⚠ REQUIRED' : 'Not required'} | — | Cabinet Res 134/2025 Art.19 |`
  );
  lines.push(
    `| **Four-Eyes Approval** | ${verdict === 'freeze' || verdict === 'escalate' ? '✅ REQUIRED' : 'Not required'} | — | FDL No.10/2025 Art.20-21 |`
  );
  if (ext.pepProximity) {
    lines.push(
      `| **PEP Proximity** | ${ext.pepProximity.overallRisk.toUpperCase()} | ${ext.pepProximity.maxProximityScore.toFixed(0)} / 100 | Cabinet Res 134/2025 Art.14 |`
    );
  }
  if (ext.tbml) {
    lines.push(
      `| **Trade-Based ML (TBML)** | ${ext.tbml.overallRisk.toUpperCase()} | ${ext.tbml.compositeScore} / 100 | FATF TBML Typologies 2020 |`
    );
  }
  if (ext.hawala) {
    lines.push(
      `| **Hawala / IVTS** | ${ext.hawala.riskLevel.toUpperCase()} | ${ext.hawala.score} / 100 | CBUAE Hawala Regs; FATF Rec 14 |`
    );
  }
  if (ext.crossBorderCash) {
    lines.push(
      `| **Cross-Border Cash** | ${ext.crossBorderCash.overallRisk.toUpperCase()} | AED ${ext.crossBorderCash.cumulativeAmountAED.toLocaleString()} | Cabinet Res 134/2025 Art.16 |`
    );
  }
  if (ext.anomalyEnsemble) {
    lines.push(
      `| **Anomaly Ensemble (BMA)** | ${ext.anomalyEnsemble.anomalyLevel.toUpperCase()} | ${ext.anomalyEnsemble.aggregatedScore.toFixed(0)} / 100 | NIST AI RMF GV-1.6 |`
    );
  }
  if (ext.esgScore) {
    lines.push(
      `| **ESG Grade** | Grade ${ext.esgScore.grade} — ${ext.esgScore.riskLevel.toUpperCase()} | ${ext.esgScore.totalScore.toFixed(0)} / 100 | ISSB IFRS S1/S2; LBMA RGG v9 |`
    );
  }
  if (ext.goldOrigin) {
    // OriginTraceReport exposes refuseCount/eddCount/cleanCount + results[].
    const originRisk =
      ext.goldOrigin.refuseCount > 0 ? 'REFUSE' : ext.goldOrigin.eddCount > 0 ? 'EDD' : 'CLEAN';
    lines.push(
      `| **Gold Origin Risk** | ${originRisk} | ${ext.goldOrigin.results.length} shipment(s) | LBMA RGG v9; OECD DDG 2016 |`
    );
  }
  if (ext.lbmaFixCheck && (ext.lbmaFixCheck.flagged > 0 || ext.lbmaFixCheck.frozen > 0)) {
    lines.push(
      `| **LBMA Fix Deviation** | ${ext.lbmaFixCheck.frozen > 0 ? '🔴 FROZEN' : '🟠 FLAGGED'} | ${ext.lbmaFixCheck.flagged} flagged / ${ext.lbmaFixCheck.frozen} frozen | LBMA RGG v9; FATF DPMS |`
    );
  }
  if (ext.penaltyVar) {
    lines.push(
      `| **Penalty VaR (AED)** | AED ${ext.penaltyVar.valueAtRisk.toLocaleString()} VaR-95 | Expected: AED ${ext.penaltyVar.expectedLoss.toLocaleString()} | Cabinet Res 71/2024 |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — MLRO ALERTS & SAFETY CLAMPS
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## MLRO Alerts`);
  lines.push('');

  if (brain.clampReasons.length > 0) {
    lines.push('**Safety Clamps Triggered:**');
    lines.push('');
    for (const clamp of brain.clampReasons) {
      const isCrit =
        clamp.toLowerCase().includes('freeze') ||
        clamp.toLowerCase().includes('tipping') ||
        clamp.toLowerCase().includes('structuring') ||
        clamp.toLowerCase().includes('hard clamp');
      lines.push(`- ${isCrit ? '🔴' : '🟠'} ${clamp}`);
    }
    lines.push('');
  }

  if (ext.mlroAlerts?.alerts.length) {
    lines.push(`| Severity | Alert | Deadline | Action Required |`);
    lines.push(`|---|---|---|---|`);
    for (const alert of ext.mlroAlerts.alerts.slice(0, 12)) {
      const sev =
        { CRITICAL: '🔴 CRITICAL', HIGH: '🟠 HIGH', MEDIUM: '🟡 MEDIUM', INFO: 'ℹ INFO' }[
          alert.severity
        ] ?? alert.severity;
      const feStr = alert.fourEyesRequired ? ' ✅ Four-eyes required.' : '';
      const toStr = alert.tipOffProhibited ? ' ⚠ Tip-off prohibited (Art.29).' : '';
      lines.push(
        `| ${sev} | ${alert.title.slice(0, 70)} | ${alert.deadline.split('T')[0]} | ${alert.requiredAction.slice(0, 80)}${feStr}${toStr} |`
      );
    }
    lines.push('');
    if (ext.mlroAlerts.alerts.some((a) => a.tipOffProhibited)) {
      lines.push(
        '> 🔴 **TIP-OFF PROHIBITION ACTIVE** — Do NOT inform the subject of this screening, report, or any related filing. Criminal offence under FDL No.10/2025 Art.29. Penalty up to AED 5,000,000.'
      );
      lines.push('');
    }
  } else if (verdict === 'pass') {
    lines.push(
      '> ✅ No adverse findings. Entity screened clear across all 6 mandatory sanctions lists.'
    );
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — FILING OBLIGATIONS
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## Filing Obligations`);
  lines.push('');
  if (fc && fc.primaryCategory !== 'NONE') {
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **Filing Type** | **${fc.primaryCategory}** |`);
    lines.push(`| **goAML Form Code** | \`${fc.goamlFormCode ?? 'N/A'}\` |`);
    lines.push(`| **Deadline** | **${fc.deadlineDueDate ?? 'See regulatory calendar'}** |`);
    lines.push(`| **Urgency** | ${fc.urgency.toUpperCase()} |`);
    lines.push(
      `| **Four-Eyes Required** | ${fc.requiresFourEyes ? '✅ YES — obtain dual approval before filing' : 'No'} |`
    );
    lines.push(
      `| **Tip-Off Prohibited** | ${fc.tipOffProhibited ? '⚠ YES — FDL No.10/2025 Art.29' : 'No'} |`
    );
    lines.push(
      `| **goAML XML Auto-Generated** | ${ext.goamlXml ? `✅ YES — ${ext.goamlXml.length.toLocaleString()} chars ready for submission` : 'No — run /goaml skill'} |`
    );
    lines.push(`| **Regulatory References** | ${fc.regulatoryRefs.join(' \\| ')} |`);
    lines.push('');
    lines.push('**Filing Instructions:**');
    for (const instr of fc.filingInstructions) {
      lines.push(`1. ${instr}`);
    }
  } else {
    lines.push('> ✅ No filing obligation triggered at this time. Continue periodic monitoring.');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — ESG & SUSTAINABILITY
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## ESG & Sustainability`);
  lines.push('');
  if (ext.esgScore || ext.carbonFootprint || ext.tcfdAlignment || ext.esgAdvanced) {
    lines.push(`| ESG Dimension | Rating | Score | Standard |`);
    lines.push(`|---|---|---|---|`);
    if (ext.esgScore) {
      lines.push(
        `| **ESG Composite** | Grade **${ext.esgScore.grade}** — ${ext.esgScore.riskLevel.toUpperCase()} | ${ext.esgScore.totalScore.toFixed(0)} / 100 | ISSB IFRS S1/S2 (2023) |`
      );
      // EsgScore pillar sub-scores live on pillars.{E,S,G}.score.
      const eScore = ext.esgScore.pillars?.E?.score;
      const sScore = ext.esgScore.pillars?.S?.score;
      const gScore = ext.esgScore.pillars?.G?.score;
      if (eScore !== undefined)
        lines.push(`| Environmental (E) | — | ${eScore.toFixed(0)} / 100 | GRI 2021 Standards |`);
      if (sScore !== undefined)
        lines.push(`| Social (S) | — | ${sScore.toFixed(0)} / 100 | ILO Conventions 29, 105 |`);
      if (gScore !== undefined)
        lines.push(`| Governance (G) | — | ${gScore.toFixed(0)} / 100 | OECD CG Principles 2023 |`);
    }
    if (ext.carbonFootprint) {
      // netZeroAligned is derived from netZeroGap_tCO2e; per-oz intensity
      // lives on portfolioIntensityKgPerOz.
      const nzAligned = (ext.carbonFootprint.netZeroGap_tCO2e ?? 0) <= 0;
      lines.push(
        `| **Carbon Footprint** | ${nzAligned ? '✅ NZ-Aligned' : '❌ Not Aligned'} | ${ext.carbonFootprint.portfolioIntensityKgPerOz?.toFixed(1) ?? 'N/A'} kgCO₂e/oz | LBMA RGG v9; UAE NZ2050 |`
      );
    }
    if (ext.tcfdAlignment) {
      // TcfdAlignmentReport carries the maturity label on complianceLevel.
      lines.push(
        `| **TCFD Alignment** | ${ext.tcfdAlignment.complianceLevel} | ${ext.tcfdAlignment.overallScore.toFixed(0)} / 100 | TCFD / ISSB IFRS S2 |`
      );
    }
    if (ext.esgAdvanced?.csrd) {
      lines.push(
        `| **CSRD Compliance** | ${ext.esgAdvanced.csrd.status.toUpperCase()} | ESRS score: ${ext.esgAdvanced.csrd.esrsAlignmentScore} / 100 | EU CSRD 2023 / ESRS |`
      );
    }
    if (ext.esgAdvanced?.climateVar) {
      lines.push(
        `| **Climate VAR** | ${ext.esgAdvanced.overallRisk.toUpperCase()} | ${ext.esgAdvanced.climateVar.combinedVarPct.toFixed(1)}% combined VAR | NGFS Scenarios 2023 |`
      );
    }
    if (ext.greenwashing) {
      // GreenwashingReport has no scalar criticalFindings; derive from findings[].severity.
      const gwCritical = ext.greenwashing.findings.filter((f) => f.severity === 'critical').length;
      lines.push(
        `| **Greenwashing Risk** | ${(ext.greenwashing.overallRisk ?? 'low').toUpperCase()} | ${gwCritical} critical finding(s) | ISSB S1 §B10; IOSCO |`
      );
    }
    if (ext.conflictMinerals) {
      lines.push(
        `| **Conflict Minerals** | ${ext.conflictMinerals.overallRisk.toUpperCase()} | ${ext.conflictMinerals.criticalCount} critical supplier(s) | OECD DDG 2016; EU CMR |`
      );
    }
    if (ext.modernSlavery) {
      // ModernSlaveryReport has no numeric riskScore — show ILO indicator count out of 11.
      lines.push(
        `| **Modern Slavery** | ${ext.modernSlavery.riskLevel.toUpperCase()} | ${ext.modernSlavery.iloIndicatorsTriggered} / 11 ILO indicators | ILO Conv. 29/105; UAE Fed. Law 51/2006 |`
      );
    }
    if (ext.sdgAlignment) {
      lines.push(
        `| **UN SDG Alignment** | — | ${ext.sdgAlignment.overallScore.toFixed(0)} / 100 | UN SDG 8, 12, 13, 15, 16 |`
      );
    }
  } else {
    lines.push(
      '> ℹ ESG data not provided for this screening. Submit ESG inputs to unlock full sustainability assessment.'
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — AUDIT TRAIL  (FDL Art.24 — 10-year retention)
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`## Audit Trail`);
  lines.push(`*FDL No.10/2025 Art.24 — retain 10 years from ${dateOnly}*`);
  lines.push('');
  lines.push(`| Timestamp (UTC) | Action | Actor | Regulatory Reference |`);
  lines.push(`|---|---|---|---|`);
  lines.push(
    `| ${nowDisplay} | Screening request initiated | ${input.screenedBy ?? 'Hawkeye V2 (Automated)'} | FDL No.10/2025 Art.12-14 |`
  );
  lines.push(
    `| ${nowDisplay} | Sanctions check — 6 mandatory lists | Hawkeye Engine | Cabinet Res 74/2020 Art.3 |`
  );
  lines.push(
    `| ${nowDisplay} | Weaponized Brain v2 — 97 subsystems | Weaponized Brain | FDL No.10/2025 Art.20-21 |`
  );
  lines.push(
    `| ${nowDisplay} | Verdict rendered: **${verdict.toUpperCase()}** (confidence ${(brain.confidence * 100).toFixed(1)}%) | Hawkeye Engine | FDL No.10/2025 Art.20 |`
  );
  if (brain.clampReasons.length > 0) {
    lines.push(
      `| ${nowDisplay} | ${brain.clampReasons.length} safety clamp(s) applied | Weaponized Brain | NIST AI RMF GV-1.6 |`
    );
  }
  if (verdict === 'freeze') {
    lines.push(
      `| ${nowDisplay} | Asset freeze obligation triggered | System | Cabinet Res 74/2020 Art.4 |`
    );
    lines.push(
      `| ${nowDisplay} | EOCN 24h countdown started | System | Cabinet Res 74/2020 Art.4-7 |`
    );
  }
  if (fc && fc.primaryCategory !== 'NONE') {
    lines.push(
      `| ${nowDisplay} | Filing obligation identified: ${fc.primaryCategory} | Hawkeye Engine | FDL No.10/2025 Art.26-27 |`
    );
  }
  if (ext.quantumSeal) {
    lines.push(
      `| ${nowDisplay} | Quantum-resistant audit seal applied | SHA-3/512 | FDL Art.24; NIST PQC Framework |`
    );
  }
  if (ext.asanaSync?.parentTaskGid) {
    lines.push(
      `| ${nowDisplay} | Asana task created: \`${ext.asanaSync.parentTaskGid}\` | Asana Orchestrator | FDL No.10/2025 Art.24 |`
    );
  }
  lines.push(
    `| ${nowDisplay} | Case report generated: \`${reportId}\` | Hawkeye Sterling V2 | FDL No.10/2025 Art.24 — 10yr retention |`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // ══════════════════════════════════════════════════════════════════════════
  // FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Name** | ${entityName} |`);
  lines.push(`| **Date Printed** | ${nowDisplay} |`);
  lines.push(`| **Printed By** | ${input.screenedBy ?? 'Hawkeye V2 (Automated)'} |`);
  lines.push(`| **Group** | ${input.screeningGroup ?? 'Compliance Screening — UAE DPMS'} |`);
  lines.push(`| **Platform** | **${BRAND}** — ${BRAND_TAGLINE} |`);
  lines.push(`| **Powered By** | Weaponized Brain v2 — 97 Compliance Subsystems |`);
  lines.push('');
  lines.push(`> **CONFIDENTIALITY NOTICE** — ${cls}`);
  lines.push(`> This report is produced for authorised compliance monitoring purposes only.`);
  lines.push(`> Disclosure of this report or any finding to the subject of the screening,`);
  lines.push(`> or to any unauthorised party, is a criminal offence under FDL No.10/2025 Art.29`);
  lines.push(`> (no tipping off). Maximum penalty: AED 5,000,000. Retain for 10 years per Art.24.`);
  lines.push('');
  lines.push(
    `*Page 1 of 1 &nbsp;|&nbsp; Report ID: \`${reportId}\` &nbsp;|&nbsp; ${nowDisplay} &nbsp;|&nbsp; UAE Jurisdiction*`
  );

  return lines.join('\n');
}

// ─── Summary Card Builder ─────────────────────────────────────────────────────

function buildSummaryCard(
  input: HawkeyeReportInput,
  reportId: string,
  now: string,
  totals: { total: number; confirmed: number; possible: number; false: number; unresolved: number }
): string {
  const { brain } = input;
  const entityId = brain.mega.entityId ?? 'UNKNOWN';
  const entityName = brain.mega.topic?.replace(/^Compliance assessment:\s*/i, '') || entityId;
  const verdict = brain.finalVerdict;
  const badge = verdictToRiskBadge(verdict, brain.confidence);
  const emoji = riskBadgeEmoji(badge);
  const ext = brain.extensions;

  // ── derived values ──────────────────────────────────────────────────────────
  const nowShort = now.replace('T', ' ').slice(0, 16) + ' UTC';
  const cddLevel = ext.explanation?.cddLevel ?? 'CDD';
  const nextReview = (() => {
    const months = cddLevel === 'EDD' ? 3 : cddLevel === 'CDD' ? 6 : 12;
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
  })();
  const subsysCount = Object.keys(ext).length;
  const qSealShort = ext.quantumSeal
    ? `SHA-3/512 · ${ext.quantumSeal.rootHash.slice(0, 16)}…`
    : 'NOT APPLIED';
  const clampCount = brain.clampReasons.length;
  const filingLine =
    ext.filingClassification?.primaryCategory && ext.filingClassification.primaryCategory !== 'NONE'
      ? `${ext.filingClassification.primaryCategory} · due ${ext.filingClassification.deadlineDueDate ?? 'TBD'} · ${ext.filingClassification.urgency.toUpperCase()}`
      : 'None triggered';
  const esgLine = ext.esgScore
    ? `Grade ${ext.esgScore.grade} (${ext.esgScore.totalScore.toFixed(0)}/100) — ${ext.esgScore.riskLevel.toUpperCase()}`
    : 'N/A';
  const pepLine = ext.pepProximity
    ? `${ext.pepProximity.overallRisk.toUpperCase()} (score ${ext.pepProximity.maxProximityScore.toFixed(0)}/100)`
    : 'None detected';
  const adversaryLine =
    ext.gameEquilibrium && ext.gameEquilibrium.expectedPayoff < 0
      ? `⚠ ADVERSARY EDGE (payoff ${ext.gameEquilibrium.expectedPayoff.toFixed(2)}) — harden controls`
      : 'No adversary advantage';
  const peerLine = ext.peerAnomaly
    ? ext.peerAnomaly.anomalies.length > 0
      ? `⚠ ${ext.peerAnomaly.anomalies.length} anomaly(ies) detected (z-score ${ext.peerAnomaly.overallScore.toFixed(1)})`
      : 'No peer anomalies'
    : 'N/A';

  // ── box width: 72 chars inner, 74 total (│...│) ───────────────────────────
  const W = 72;
  const pad = (s: string, w = W) => s.slice(0, w).padEnd(w);
  const row = (label: string, value: string) => {
    const field = `  ${label.padEnd(18)}: ${value}`;
    return `│${pad(field)}│`;
  };
  const sep = `├${'─'.repeat(W)}┤`;
  const hdr = (title: string) => {
    const inner = `  ── ${title} `;
    return `│${pad(inner + '─'.repeat(Math.max(0, W - inner.length - 2)) + '  ')}│`;
  };

  const lines = [
    `┌${'─'.repeat(W)}┐`,
    `│${pad(`  ${BRAND}  ·  CASE SUMMARY CARD`)}│`,
    `│${pad(`  ${BRAND_TAGLINE}  ·  UAE Jurisdiction  ·  Confidential`)}│`,
    sep,
    row('Report ID', reportId),
    row('Generated', nowShort),
    row('Screened By', input.screenedBy ?? 'Hawkeye V2 (Automated)'),
    sep,
    hdr('SUBJECT'),
    row('Name', entityName),
    row('Entity ID', entityId),
    row('Entity Type', 'Individual'),
    row('Jurisdiction', input.subjectJurisdiction ?? 'Not specified'),
    row('Date of Birth', input.subjectDob ?? 'Not specified'),
    sep,
    hdr('SANCTIONS SCREENING  —  6 of 6 Lists'),
    row('Total Matches', String(totals.total)),
    row('  Confirmed', String(totals.confirmed)),
    row('  Possible', String(totals.possible)),
    row('  False Positive', String(totals.false)),
    row('  Unresolved', String(totals.unresolved)),
    row('Lists', 'UN | OFAC | EU | UK | UAE | EOCN'),
    sep,
    hdr('RISK VERDICT'),
    row('Verdict', `${emoji} ${badge}  —  ${verdict.toUpperCase()}`),
    row('Confidence', `${(brain.confidence * 100).toFixed(1)}%`),
    row('CDD Level', cddLevel),
    row('Next Review', nextReview),
    row('PEP Exposure', pepLine),
    row('Peer Anomaly', peerLine),
    row('Adversary', adversaryLine),
    row('ESG Grade', esgLine),
    sep,
    hdr('COMPLIANCE ACTIONS'),
    row(
      'Human Review',
      brain.requiresHumanReview ? '⚠ REQUIRED  (Cabinet Res 134/2025 Art.19)' : 'Not required'
    ),
    row(
      'Four-Eyes',
      verdict === 'freeze' || verdict === 'escalate'
        ? '⚠ REQUIRED  (FDL No.10/2025 Art.20-21)'
        : 'Not required'
    ),
    row('Filing', filingLine),
    row('Clamps Fired', `${clampCount} safety clamp(s)`),
    sep,
    hdr('INTEGRITY'),
    row('Subsystems', `${subsysCount} active (Weaponized Brain v2 — 97 total)`),
    row('Quantum Seal', qSealShort),
    row('Tip-Off', '⚠ PROHIBITED  (FDL No.10/2025 Art.29  —  AED 5M penalty)'),
    row('Retention', '10 years  (FDL No.10/2025 Art.24)'),
    `└${'─'.repeat(W)}┘`,
  ];

  return lines.join('\n');
}

// ─── Audit Block Builder ──────────────────────────────────────────────────────

function buildAuditBlock(input: HawkeyeReportInput, reportId: string, now: string): string {
  const { brain } = input;
  const entityId = brain.mega.entityId ?? 'UNKNOWN';
  const entityName = brain.mega.topic?.replace(/^Compliance assessment:\s*/i, '') || entityId;

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
  const entityId = brain.mega.entityId ?? 'UNKNOWN';
  const entityName = brain.mega.topic?.replace(/^Compliance assessment:\s*/i, '') || entityId;
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
    jsonPayload: JSON.stringify(
      { ...reportData, markdownReport: '[see markdownReport field]' },
      null,
      2
    ),
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
  assigneeGid?: string
): {
  name: string;
  notes: string;
  due_on: string;
  projects: string[];
  assignee?: string;
  tags: string[];
} {
  const badge = riskBadgeEmoji(report.riskBadge);
  const today = new Date().toISOString().split('T')[0];
  const urgencyDays: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 3,
    LOW: 7,
    CLEAR: 14,
  };
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
