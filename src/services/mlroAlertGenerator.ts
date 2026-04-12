/**
 * MLRO Alert Generator  (WEAPONIZED)
 *
 * Generates structured, regulation-cited MLRO alerts from a WeaponizedBrainResponse.
 * Produces alerts at four severity levels (CRITICAL/HIGH/MEDIUM/INFO) with:
 *  - Exact regulatory citation for every trigger
 *  - Required action + deadline
 *  - Filing type + goAML form code
 *  - Four-eyes requirement flag
 *  - Tip-off prohibition reminder where applicable
 *
 * Output formats: plain text (for email/Asana notes), JSON (for API), markdown.
 *
 * Regulatory: FDL No.10/2025, Cabinet Res 74/2020, Cabinet Res 134/2025,
 *             MoE Circular 08/AML/2021, FATF Rec 20/26/40.
 */

import type { WeaponizedBrainResponse } from './weaponizedBrain';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';

export interface MlroAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  entityId: string;
  entityName: string;
  generatedAt: string;
  verdict: string;
  trigger: string;
  regulatoryRef: string;
  requiredAction: string;
  deadline: string;
  filingRequired?: string;
  goamlFormCode?: string;
  fourEyesRequired: boolean;
  tipOffProhibited: boolean;
  penaltyExposure?: string;
  narrative: string;
}

export interface MlroAlertBundle {
  entityId: string;
  entityName: string;
  generatedAt: string;
  overallVerdict: string;
  confidence: number;
  criticalCount: number;
  highCount: number;
  alerts: MlroAlert[];
  executiveFlash: string; // ≤5-line summary for email subject/body
  markdownReport: string;
  jsonPayload: string;
}

// ─── Alert Builders ───────────────────────────────────────────────────────────

let alertSeq = 0;
function nextId(entityId: string): string {
  return `MLRO-${entityId.replace(/\W/g, '').slice(0, 8).toUpperCase()}-${Date.now()}-${++alertSeq}`;
}

function buildAlerts(brain: WeaponizedBrainResponse): MlroAlert[] {
  const alerts: MlroAlert[] = [];
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const now = new Date().toISOString();

  const add = (
    severity: AlertSeverity,
    title: string,
    trigger: string,
    regulatoryRef: string,
    requiredAction: string,
    deadline: string,
    opts: Partial<MlroAlert> = {}
  ) => {
    alerts.push({
      id: nextId(entityId),
      severity,
      title,
      entityId,
      entityName,
      generatedAt: now,
      verdict: brain.finalVerdict,
      trigger,
      regulatoryRef,
      requiredAction,
      deadline,
      fourEyesRequired: opts.fourEyesRequired ?? false,
      tipOffProhibited: opts.tipOffProhibited ?? false,
      ...opts,
      narrative: opts.narrative ?? trigger,
    });
  };

  const todayISO = new Date().toISOString().split('T')[0];
  const in24h = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const _in5bd = (() => {
    const d = new Date();
    let cnt = 0;
    while (cnt < 5) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 5 && d.getDay() !== 6) cnt++;
    }
    return d.toISOString().split('T')[0];
  })();
  const in10bd = (() => {
    const d = new Date();
    let cnt = 0;
    while (cnt < 10) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 5 && d.getDay() !== 6) cnt++;
    }
    return d.toISOString().split('T')[0];
  })();

  // ── Verdict-level alerts ─────────────────────────────────────────────────
  if (brain.finalVerdict === 'freeze') {
    add(
      'CRITICAL',
      `ASSET FREEZE REQUIRED — ${entityName}`,
      'Confirmed sanctions match — Cabinet Res 74/2020 Art.4 freeze obligation triggered',
      'Cabinet Res 74/2020 Art.4-7; FDL No.10/2025 Art.35',
      'Freeze all assets immediately. Notify EOCN within 24 clock hours. File CNMR within 5 business days. DO NOT notify the subject.',
      in24h,
      {
        fourEyesRequired: true,
        tipOffProhibited: true,
        penaltyExposure: 'AED 100K–100M + criminal (Cabinet Res 71/2024)',
        filingRequired: 'CNMR + EOCN_FREEZE',
        goamlFormCode: 'CNMR_V3 + EOCN_TFS_V3',
        narrative: brain.auditNarrative.slice(0, 500),
      }
    );
  }

  if (brain.finalVerdict === 'escalate') {
    add(
      'HIGH',
      `ESCALATION — EDD Required — ${entityName}`,
      'Brain verdict escalated — Enhanced Due Diligence mandatory',
      'Cabinet Res 134/2025 Art.9-14; FDL No.10/2025 Art.12-14',
      'Run full EDD. Verify source of funds/wealth. Senior management approval required before proceeding.',
      todayISO,
      {
        fourEyesRequired: true,
        narrative:
          brain.clampReasons.join(' | ') || 'Escalation triggered by compound risk signals',
      }
    );
  }

  // ── Clamp-level alerts ───────────────────────────────────────────────────
  for (const clamp of brain.clampReasons) {
    const isCritical =
      clamp.includes('freeze') ||
      clamp.includes('FREEZE') ||
      clamp.includes('taint') ||
      clamp.includes('structuring');
    add(
      isCritical ? 'CRITICAL' : 'HIGH',
      `Safety Clamp — ${clamp.replace('CLAMP: ', '').slice(0, 80)}`,
      clamp,
      'See clamp reason for regulatory ref',
      'Review and confirm the underlying data. Four-eyes required for freeze clamps.',
      isCritical ? in24h : todayISO,
      { fourEyesRequired: isCritical, tipOffProhibited: isCritical }
    );
  }

  // ── Filing classification alert ──────────────────────────────────────────
  const fc = brain.extensions.filingClassification;
  if (fc && fc.primaryCategory !== 'NONE') {
    const isCrit = ['EOCN_FREEZE', 'CNMR'].includes(fc.primaryCategory);
    add(
      isCrit ? 'CRITICAL' : 'HIGH',
      `${fc.primaryCategory} Filing Required — ${entityName}`,
      fc.rationale,
      fc.regulatoryRefs.join('; '),
      fc.filingInstructions.join(' | '),
      fc.deadlineDueDate ?? in10bd,
      {
        filingRequired: fc.primaryCategory,
        goamlFormCode: fc.goamlFormCode,
        fourEyesRequired: fc.requiresFourEyes,
        tipOffProhibited: fc.tipOffProhibited,
        penaltyExposure: 'AED 10K–100M (Cabinet Res 71/2024)',
      }
    );
  }

  // ── ESG alerts ────────────────────────────────────────────────────────────
  const esg = brain.extensions.esgScore;
  if (esg && (esg.riskLevel === 'critical' || esg.riskLevel === 'high')) {
    add(
      esg.riskLevel === 'critical' ? 'HIGH' : 'MEDIUM',
      `ESG Risk ${esg.riskLevel.toUpperCase()} — Grade ${esg.grade} — ${entityName}`,
      `ESG composite score ${esg.composite.toFixed(0)}/100 — risk level ${esg.riskLevel}`,
      'ISSB IFRS S1/S2 (2023); LBMA RGG v9 §6.2; GRI 2021',
      'Review ESG sub-scores. Escalate to sustainability committee. Disclose in next IFRS S1 report.',
      todayISO
    );
  }

  // ── PEP proximity alert ───────────────────────────────────────────────────
  const pep = brain.extensions.pepProximity;
  if (pep && pep.requiresBoardApproval) {
    add(
      'CRITICAL',
      `PEP Board Approval Required — ${entityName}`,
      `PEP proximity score ${pep.maxProximityScore.toFixed(0)}/100 — board approval mandatory`,
      'Cabinet Res 134/2025 Art.14; FATF Rec 12',
      'Obtain board-level approval before continuing PEP relationship. Run full EDD. Review annually.',
      todayISO,
      { fourEyesRequired: true }
    );
  }

  // ── TBML alert ────────────────────────────────────────────────────────────
  const tbml = brain.extensions.tbml;
  if (tbml && (tbml.overallRisk === 'critical' || tbml.overallRisk === 'high')) {
    add(
      tbml.overallRisk === 'critical' ? 'CRITICAL' : 'HIGH',
      `TBML ${tbml.overallRisk.toUpperCase()} — ${entityName}`,
      `Trade-Based ML score ${tbml.compositeScore}/100 — ${tbml.patterns.length} pattern(s)`,
      'FATF TBML Guidance 2020; FDL No.10/2025 Art.12',
      tbml.requiresStr
        ? 'File STR via goAML immediately. Reject/suspend transaction.'
        : 'Run EDD. Request invoice + shipping documentation.',
      tbml.requiresStr ? in10bd : todayISO,
      {
        filingRequired: tbml.requiresStr ? 'STR' : undefined,
        goamlFormCode: tbml.requiresStr ? 'STR_DPMS_V4' : undefined,
        fourEyesRequired: tbml.requiresStr,
        tipOffProhibited: tbml.requiresStr,
      }
    );
  }

  // ── Hawala alert ──────────────────────────────────────────────────────────
  const hawala = brain.extensions.hawala;
  if (hawala && (hawala.riskLevel === 'critical' || hawala.riskLevel === 'high')) {
    add(
      hawala.riskLevel === 'critical' ? 'CRITICAL' : 'HIGH',
      `Hawala/IVTS ${hawala.riskLevel.toUpperCase()} — ${entityName}`,
      `Hawala score ${hawala.score}/100 — ${hawala.indicators.length} indicator(s)`,
      'FATF Rec 14; UAE CBUAE Hawala Registration Requirement 2022',
      hawala.requiresCbuaeReport
        ? 'Report to CBUAE Hawala Registry. File STR if suspicion confirmed.'
        : 'Conduct enhanced CDD. Verify payment channels.',
      todayISO,
      { fourEyesRequired: hawala.requiresStr, tipOffProhibited: hawala.requiresStr }
    );
  }

  // ── Cross-border cash structuring alert ───────────────────────────────────
  const cbc = brain.extensions.crossBorderCash;
  if (cbc?.structuringDetected) {
    add(
      'CRITICAL',
      `Cross-Border Structuring — ${entityName} — AED ${cbc.cumulativeAmountAED.toLocaleString()}`,
      `Cumulative AED ${cbc.cumulativeAmountAED.toLocaleString()} structured below AED 60K threshold`,
      'Cabinet Res 134/2025 Art.16; FATF Rec 32',
      'File STR. Freeze pending investigation. Document structuring pattern.',
      in10bd,
      {
        filingRequired: 'STR',
        goamlFormCode: 'STR_DPMS_V4',
        fourEyesRequired: true,
        tipOffProhibited: true,
        penaltyExposure: 'AED 100K–100M (Cabinet Res 71/2024)',
      }
    );
  }

  // Sort: CRITICAL first, then HIGH, then MEDIUM, then INFO
  const order: Record<AlertSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return alerts;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function buildMarkdownReport(
  bundle: Omit<MlroAlertBundle, 'markdownReport' | 'jsonPayload'>
): string {
  const lines: string[] = [
    `# MLRO Alert Report — ${bundle.entityName} (${bundle.entityId})`,
    `**Generated:** ${bundle.generatedAt}`,
    `**Verdict:** ${bundle.overallVerdict.toUpperCase()} | **Confidence:** ${(bundle.confidence * 100).toFixed(1)}%`,
    `**Alerts:** 🔴 ${bundle.criticalCount} CRITICAL | 🟠 ${bundle.highCount} HIGH`,
    '',
    '---',
    '',
    '## Executive Flash',
    bundle.executiveFlash,
    '',
    '---',
    '',
    '## Alerts',
  ];

  for (const alert of bundle.alerts) {
    const sev = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', INFO: 'ℹ️' }[alert.severity];
    lines.push(`### ${sev} [${alert.severity}] ${alert.title}`);
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Trigger | ${alert.trigger.slice(0, 120)} |`);
    lines.push(`| Regulatory Ref | ${alert.regulatoryRef.slice(0, 120)} |`);
    lines.push(`| Required Action | ${alert.requiredAction.slice(0, 150)} |`);
    lines.push(`| Deadline | ${alert.deadline} |`);
    if (alert.filingRequired)
      lines.push(`| Filing | ${alert.filingRequired} (${alert.goamlFormCode}) |`);
    if (alert.penaltyExposure) lines.push(`| Penalty Exposure | ${alert.penaltyExposure} |`);
    lines.push(`| Four-Eyes Required | ${alert.fourEyesRequired} |`);
    if (alert.tipOffProhibited) lines.push(`| ⚠ Tip-Off Prohibited | YES — FDL Art.29 |`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function generateMlroAlerts(brain: WeaponizedBrainResponse): MlroAlertBundle {
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const generatedAt = new Date().toISOString();
  const alerts = buildAlerts(brain);
  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const highCount = alerts.filter((a) => a.severity === 'HIGH').length;

  const executiveFlash = [
    `Entity: ${entityName} | Verdict: ${brain.finalVerdict.toUpperCase()} | Confidence: ${(brain.confidence * 100).toFixed(0)}%`,
    `Critical alerts: ${criticalCount} | High alerts: ${highCount}`,
    brain.finalVerdict === 'freeze'
      ? '⚠ ASSET FREEZE REQUIRED — notify EOCN within 24h (Cabinet Res 74/2020 Art.4)'
      : brain.finalVerdict === 'escalate'
        ? '⚠ EDD required — senior management approval needed (Cabinet Res 134/2025 Art.14)'
        : 'Review flagged indicators before proceeding.',
    brain.extensions.filingClassification?.primaryCategory !== 'NONE'
      ? `Filing: ${brain.extensions.filingClassification?.primaryCategory} due ${brain.extensions.filingClassification?.deadlineDueDate}`
      : '',
    `Tip-off prohibited: ${alerts.some((a) => a.tipOffProhibited)} (FDL Art.29)`,
  ]
    .filter(Boolean)
    .join('\n');

  const base = {
    entityId,
    entityName,
    generatedAt,
    overallVerdict: brain.finalVerdict,
    confidence: brain.confidence,
    criticalCount,
    highCount,
    alerts,
    executiveFlash,
  };

  const markdownReport = buildMarkdownReport(base);

  return {
    ...base,
    markdownReport,
    jsonPayload: JSON.stringify({ ...base, markdownReport: '[see markdownReport field]' }, null, 2),
  };
}
