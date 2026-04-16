/**
 * Regulatory Citation Enricher — Phase 19 W-E (pure compute).
 *
 * Every brain → Asana dispatch should end with a canonical citation
 * block so an inspector picking any Asana task sees the regulatory
 * anchor without having to chase the task back into HAWKEYE. This
 * module produces the block. It does NOT append to any task; the
 * integration into the dispatch path is a separate follow-on PR.
 *
 * The enricher is deterministic and stateless. Given the same inputs
 * it always returns the same block. That makes the block cacheable
 * and easy to reason about in test.
 *
 * Design notes:
 *   - The block is pure plain text (no HTML). Asana renders both
 *     plain-text and HTML notes; keeping plain text avoids escaping
 *     concerns and keeps the block readable in the Asana mobile app.
 *   - Verdict-specific citations are additive: every block carries
 *     the common AML/CFT anchor; freeze and escalate verdicts add
 *     the TFS anchor; flag adds nothing beyond the common set.
 *   - Additional citations from the brain verdict (if any) are
 *     appended as "Additional citations" so the brain's own
 *     reasoning is preserved alongside the canonical block.
 *
 * Regulatory anchor for this file:
 *   FDL No. 10 of 2025 Art.24 — 10-year retention with reportable
 *     structure (the block IS the reportable structure at task level).
 *   Cabinet Resolution 134/2025 Art.19 — internal review; every task
 *     must trace to its regulatory source.
 */

import type { Verdict, DeadlineType } from './asanaCustomFields';

export interface CitationEnricherInput {
  verdict: Verdict;
  deadlineType?: DeadlineType;
  /** Optional, already-held citations from the brain verdict. */
  additionalCitations?: readonly string[];
  /** Optional case id to echo back in the block. */
  caseId?: string;
  /** Optional tenant id to echo back in the block. */
  tenantId?: string;
}

export interface CitationBlock {
  /** The formatted block, ready to append to task notes. */
  text: string;
  /** Machine-readable anchor list for downstream audit tooling. */
  anchors: readonly string[];
}

// ---------------------------------------------------------------------------
// Canonical anchor map
// ---------------------------------------------------------------------------

/**
 * Every verdict carries this minimum set. Refs taken from the
 * "Regulatory Domain Knowledge" section of CLAUDE.md.
 */
const COMMON_ANCHORS: readonly string[] = [
  'UAE Federal Decree-Law No. 10 of 2025, Article 20 (MLRO duties)',
  'UAE Federal Decree-Law No. 10 of 2025, Article 24 (10-year retention)',
  'UAE Federal Decree-Law No. 10 of 2025, Article 29 (no tipping off)',
  'Cabinet Resolution 134/2025, Article 19 (internal review)',
];

const FREEZE_ANCHORS: readonly string[] = [
  'Cabinet Resolution 74/2020, Article 4 (24-hour freeze)',
  'Cabinet Resolution 74/2020, Article 7 (CNMR within 5 business days)',
  'UAE Federal Decree-Law No. 10 of 2025, Article 35 (TFS)',
];

// Escalate uses the same Article 4 anchor as freeze so that upgrading
// an escalate → freeze does not change the cited string for the
// freeze-trigger article. The EOCN deadline anchor below also
// references Article 4; dedupe keeps the block clean.
const ESCALATE_ANCHORS: readonly string[] = [
  'Cabinet Resolution 74/2020, Article 4 (24-hour freeze)',
];

/**
 * Deadline-type anchors — added when the task carries a specific
 * filing deadline so the inspector sees the filing rule next to the
 * countdown.
 */
// Deadline anchors intentionally use the same canonical strings as
// the verdict-driven anchors above so dedupe keeps the block clean
// (e.g. freeze + EOCN both cite Article 4, rendered once).
const DEADLINE_ANCHORS: Record<DeadlineType, readonly string[]> = {
  STR: ['UAE Federal Decree-Law No. 10 of 2025, Articles 26-27 (STR filing)'],
  SAR: ['UAE Federal Decree-Law No. 10 of 2025, Articles 26-27 (SAR filing)'],
  CTR: [
    'MoE Circular 08/AML/2021 (DPMS cash threshold AED 55,000)',
    'UAE Federal Decree-Law No. 10 of 2025, Articles 26-27 (CTR filing)',
  ],
  DPMSR: [
    'MoE Circular 08/AML/2021 (DPMSR obligation)',
    'UAE Federal Decree-Law No. 10 of 2025, Articles 26-27 (DPMSR filing)',
  ],
  CNMR: [
    'Cabinet Resolution 74/2020, Article 7 (CNMR within 5 business days)',
    'Cabinet Resolution 134/2025, Article 16 (cross-border cash AED 60,000)',
  ],
  EOCN: [
    'Cabinet Resolution 74/2020, Article 4 (24-hour freeze)',
    'Cabinet Resolution 74/2020, Article 6 (Executive Office notification)',
  ],
};

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function dedupePreservingOrder<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Compose the canonical citation block for a verdict. Pure function;
 * safe to call any number of times with the same input.
 */
export function buildRegulatoryCitationBlock(input: CitationEnricherInput): CitationBlock {
  const parts: string[] = [];

  // Verdict-driven anchors, in the order an inspector would read them.
  parts.push(...COMMON_ANCHORS);

  if (input.verdict === 'freeze') {
    parts.push(...FREEZE_ANCHORS);
  } else if (input.verdict === 'escalate') {
    parts.push(...ESCALATE_ANCHORS);
  }
  // 'flag' and 'pass' carry only the common set; intentional.

  if (input.deadlineType) {
    const deadlineAnchors = DEADLINE_ANCHORS[input.deadlineType];
    if (deadlineAnchors) {
      parts.push(...deadlineAnchors);
    }
  }

  const canonical = dedupePreservingOrder(parts);

  // Additional citations from the brain are kept separate so the
  // provenance is clear — canonical set first, then the brain's
  // own extras.
  const additional = dedupePreservingOrder(input.additionalCitations ?? []);

  const header = '--- Regulatory citation (auto-generated) ---';
  const canonLines = canonical.map((a) => `• ${a}`);
  const footerLines: string[] = [];
  if (additional.length > 0) {
    footerLines.push('');
    footerLines.push('Additional citations from the originating decision:');
    footerLines.push(...additional.map((a) => `• ${a}`));
  }
  if (input.caseId) {
    footerLines.push('');
    footerLines.push(`Case id: ${input.caseId}`);
  }
  if (input.tenantId) {
    footerLines.push(`Tenant: ${input.tenantId}`);
  }

  const text = [header, ...canonLines, ...footerLines].join('\n');
  const anchors = [...canonical, ...additional];

  return { text, anchors };
}

/**
 * Append the canonical citation block to existing task notes,
 * separating with a blank line. Idempotent: if the block header
 * already appears in the notes, the notes are returned unchanged
 * so a re-enrichment of already-enriched notes does not double the
 * block.
 *
 * The idempotency check looks for the exact header string, which is
 * stable across calls because the builder is deterministic.
 */
export function appendCitationBlock(
  existingNotes: string | undefined,
  input: CitationEnricherInput
): string {
  const existing = existingNotes ?? '';
  const block = buildRegulatoryCitationBlock(input);
  if (existing.includes('--- Regulatory citation (auto-generated) ---')) {
    return existing;
  }
  if (existing.length === 0) return block.text;
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return existing + sep + block.text;
}
