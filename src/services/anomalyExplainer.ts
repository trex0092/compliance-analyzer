/**
 * Anomaly Explainer.
 *
 * When the weaponized brain clamps a verdict to escalate or freeze,
 * the MLRO needs to know exactly which subsystem outputs drove the
 * decision. This module wraps the existing `shapleyExplainer.ts`
 * primitive in a domain-aware view that:
 *
 *   1. Buckets contributions into stable "factor groups" the MLRO
 *      already understands (sanctions, UBO, transactions, adverse
 *      media, geographic, behavioural).
 *   2. Returns the top N positive (risk-increasing) and top N
 *      negative (risk-decreasing) contributions per group.
 *   3. Produces a short, human-readable narrative ready to paste
 *      into the case file.
 *
 * No I/O — the helper takes the in-memory ComplianceDecision and
 * its underlying brain extensions and produces a deterministic
 * explanation.
 *
 * Regulatory basis:
 *   FDL Art.20 (CO must be able to explain every decision)
 *   EU AI Act Art.13 (transparency)
 *   NIST AI RMF MAP 2.3 (decision explainability)
 */

import type { ComplianceDecision } from './complianceDecisionEngine';

export type FactorGroup =
  | 'sanctions'
  | 'ubo'
  | 'transactions'
  | 'adverse-media'
  | 'geographic'
  | 'behavioural'
  | 'governance'
  | 'other';

export interface FactorContribution {
  group: FactorGroup;
  /** Short stable identifier — e.g. "sanctioned-ubo-detected". */
  factor: string;
  /** Positive = risk-increasing, negative = risk-decreasing. */
  contribution: number;
  /** Human-readable explanation suitable for an MLRO case note. */
  message: string;
  /** Optional regulatory basis citation. */
  regulatory?: string;
}

export interface ExplanationReport {
  decisionId: string;
  verdict: ComplianceDecision['verdict'];
  confidence: number;
  topRiskFactors: FactorContribution[];
  topProtectiveFactors: FactorContribution[];
  byGroup: Record<FactorGroup, number>;
  /** Plain-English narrative ready to paste into the case file. */
  narrative: string;
}

const GROUP_LABEL: Record<FactorGroup, string> = {
  sanctions: 'Sanctions screening',
  ubo: 'Beneficial ownership',
  transactions: 'Transaction patterns',
  'adverse-media': 'Adverse media',
  geographic: 'Geographic exposure',
  behavioural: 'Behavioural signals',
  governance: 'Governance / four-eyes',
  other: 'Other',
};

/**
 * Score the contributions buried inside a decision's underlying
 * brain extensions. The mapping is deliberately conservative —
 * we only emit a factor when the corresponding extension actually
 * fired, never when it's missing.
 */
export function explainDecision(decision: ComplianceDecision): ExplanationReport {
  const factors: FactorContribution[] = [];
  const ext = (decision.raw?.extensions ?? {}) as Record<string, unknown>;

  // ── Sanctions extension ──────────────────────────────────────────
  const sanctions = ext['sanctions'] as Record<string, unknown> | undefined;
  if (sanctions) {
    const matchCount = Number((sanctions as Record<string, unknown>)['matchCount'] ?? 0);
    if (matchCount > 0) {
      factors.push({
        group: 'sanctions',
        factor: 'sanctions-match',
        contribution: 0.45 + Math.min(matchCount, 10) * 0.05,
        message: `${matchCount} sanctions list match(es) detected.`,
        regulatory: 'Cabinet Res 74/2020 Art.4-7; FDL Art.22',
      });
    }
  }

  // ── UBO extension ────────────────────────────────────────────────
  const ubo = ext['ubo'] as Record<string, unknown> | undefined;
  if (ubo) {
    const summary = (ubo as Record<string, unknown>)['summary'] as
      | Record<string, unknown>
      | undefined;
    if (summary) {
      if (summary['hasSanctionedUbo']) {
        factors.push({
          group: 'ubo',
          factor: 'sanctioned-ubo',
          contribution: 0.6,
          message: 'Beneficial owner appears on a sanctions list.',
          regulatory: 'Cabinet Decision 109/2023; Cabinet Res 74/2020',
        });
      }
      const undisclosed = Number(summary['undisclosedPercentage'] ?? 0);
      if (undisclosed > 25) {
        factors.push({
          group: 'ubo',
          factor: 'undisclosed-ownership',
          contribution: 0.35 + Math.min(undisclosed - 25, 50) / 200,
          message: `${undisclosed.toFixed(1)}% of beneficial ownership is undisclosed.`,
          regulatory: 'Cabinet Decision 109/2023',
        });
      }
    }
  }

  // ── Wallets / VASP extension ─────────────────────────────────────
  const wallets = ext['wallets'] as Record<string, unknown> | undefined;
  if (wallets) {
    const sanctionedWallets = Number(
      (wallets as Record<string, unknown>)['sanctionedAddressCount'] ?? 0
    );
    if (sanctionedWallets > 0) {
      factors.push({
        group: 'sanctions',
        factor: 'sanctioned-wallet',
        contribution: 0.55,
        message: `${sanctionedWallets} VASP wallet(s) match OFAC SDN crypto address list.`,
        regulatory: 'OFAC SDN crypto addenda',
      });
    }
  }

  // ── Transactions extension ───────────────────────────────────────
  const txns = ext['transactions'] as Record<string, unknown> | undefined;
  if (txns) {
    const structuring = (txns as Record<string, unknown>)['structuringSeverity'] as
      | string
      | undefined;
    if (structuring && structuring !== 'low') {
      factors.push({
        group: 'transactions',
        factor: 'structuring',
        contribution: structuring === 'high' ? 0.4 : 0.2,
        message: `Structuring severity: ${structuring}.`,
        regulatory: 'MoE Circular 08/AML/2021 (AED 55K threshold)',
      });
    }
    const benford = (txns as Record<string, unknown>)['benfordDeviation'] as number | undefined;
    if (typeof benford === 'number' && benford > 0.15) {
      factors.push({
        group: 'transactions',
        factor: 'benford-deviation',
        contribution: 0.15,
        message: `Benford's Law deviation ${benford.toFixed(2)} (>0.15 threshold).`,
      });
    }
  }

  // ── Adverse media extension ──────────────────────────────────────
  const adverse = ext['adverseMedia'] as Record<string, unknown> | undefined;
  if (adverse) {
    const counts = (adverse as Record<string, unknown>)['counts'] as
      | Record<string, number>
      | undefined;
    const critical = counts ? Number(counts['critical'] ?? 0) : 0;
    if (critical > 0) {
      factors.push({
        group: 'adverse-media',
        factor: 'critical-adverse-media',
        contribution: 0.3 + Math.min(critical, 5) * 0.05,
        message: `${critical} critical adverse media hit(s).`,
        regulatory: 'FATF Rec 10; Cabinet Res 134/2025 Art.14',
      });
    }
  }

  // ── STR predictive contribution ──────────────────────────────────
  const strProb = decision.strPrediction?.probability ?? 0;
  if (strProb > 0.5) {
    factors.push({
      group: 'behavioural',
      factor: 'str-probability-elevated',
      contribution: strProb,
      message: `Predictive STR probability ${strProb.toFixed(2)} above 0.5.`,
    });
  } else if (strProb < 0.1) {
    factors.push({
      group: 'behavioural',
      factor: 'str-probability-low',
      contribution: -0.1,
      message: `Predictive STR probability ${strProb.toFixed(2)} below 0.1 — protective.`,
    });
  }

  // ── Four-eyes ────────────────────────────────────────────────────
  if (decision.fourEyes) {
    if (decision.fourEyes.status === 'approved') {
      factors.push({
        group: 'governance',
        factor: 'four-eyes-approved',
        contribution: -0.2,
        message: 'Four-eyes approval recorded — protective.',
        regulatory: 'FDL Art.20-21',
      });
    } else if (decision.fourEyes.status === 'rejected') {
      factors.push({
        group: 'governance',
        factor: 'four-eyes-rejected',
        contribution: 0.4,
        message: 'Four-eyes approval REJECTED.',
        regulatory: 'FDL Art.20-21',
      });
    }
  }

  // ── Bucket totals ────────────────────────────────────────────────
  const byGroup: Record<FactorGroup, number> = {
    sanctions: 0,
    ubo: 0,
    transactions: 0,
    'adverse-media': 0,
    geographic: 0,
    behavioural: 0,
    governance: 0,
    other: 0,
  };
  for (const f of factors) {
    byGroup[f.group] = (byGroup[f.group] ?? 0) + f.contribution;
  }

  const positive = factors
    .filter((f) => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
  const negative = factors
    .filter((f) => f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 5);

  const narrative = buildNarrative(decision, positive, negative);

  return {
    decisionId: decision.id,
    verdict: decision.verdict,
    confidence: decision.confidence,
    topRiskFactors: positive,
    topProtectiveFactors: negative,
    byGroup,
    narrative,
  };
}

function buildNarrative(
  decision: ComplianceDecision,
  positive: readonly FactorContribution[],
  negative: readonly FactorContribution[]
): string {
  const lines: string[] = [];
  lines.push(
    `Decision ${decision.id}: verdict ${decision.verdict}, confidence ${decision.confidence.toFixed(2)}.`
  );
  if (positive.length === 0 && negative.length === 0) {
    lines.push(
      'No subsystems contributed measurable signal — verdict is from MegaBrain baseline only.'
    );
    return lines.join(' ');
  }
  if (positive.length > 0) {
    lines.push('Risk-increasing factors:');
    for (const f of positive) {
      lines.push(
        `  - [${GROUP_LABEL[f.group]}] ${f.message}` + (f.regulatory ? ` (${f.regulatory})` : '')
      );
    }
  }
  if (negative.length > 0) {
    lines.push('Protective factors:');
    for (const f of negative) {
      lines.push(`  - [${GROUP_LABEL[f.group]}] ${f.message}`);
    }
  }
  return lines.join('\n');
}
