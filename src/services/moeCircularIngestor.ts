/**
 * MoE Circular Ingestor — Tier D2.
 *
 * Parses inbound MoE circulars into an ImpactedPolicy[]
 * diff so the compliance team can open workflow tasks for
 * every affected policy. Uses a keyword-based classifier
 * (deterministic) as a first-pass; downstream can swap for
 * a real LLM impact analyzer.
 *
 * Pure parser + classifier. No network, no LLM call.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.5 (risk appetite — policy updates must
 *     reflect circulars within 30 days)
 *   - MoE Circular 08/AML/2021 + successors
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoeCircular {
  id: string;
  title: string;
  publishedAtIso: string;
  body: string;
  /** Optional metadata the feed attaches. */
  sourceUrl?: string;
  version?: string;
}

export type PolicyArea =
  | 'cdd'
  | 'edd'
  | 'sanctions'
  | 'tfs'
  | 'str'
  | 'ctr'
  | 'record-retention'
  | 'training'
  | 'pep'
  | 'pf'
  | 'responsible-sourcing'
  | 'goaml'
  | 'governance';

export interface ImpactedPolicy {
  area: PolicyArea;
  confidence: number;
  /** Short excerpt from the circular body that triggered the match. */
  evidence: string;
  /** Citation for the rule that got matched. */
  matchedKeyword: string;
}

export interface CircularImpactReport {
  circular: MoeCircular;
  impactedPolicies: ImpactedPolicy[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Suggested task title for the workflow engine. */
  suggestedTaskTitle: string;
  /** Action deadline — always 30 days per CLAUDE.md policy. */
  actionDeadlineIso: string;
}

// ---------------------------------------------------------------------------
// Keyword classifier
// ---------------------------------------------------------------------------

const KEYWORD_MAP: Record<string, PolicyArea> = {
  'customer due diligence': 'cdd',
  cdd: 'cdd',
  'enhanced due diligence': 'edd',
  edd: 'edd',
  sanction: 'sanctions',
  ofac: 'sanctions',
  'un list': 'sanctions',
  tfs: 'tfs',
  'targeted financial sanctions': 'tfs',
  'suspicious transaction report': 'str',
  str: 'str',
  sar: 'str',
  'cash transaction report': 'ctr',
  ctr: 'ctr',
  'cash threshold': 'ctr',
  '55,000': 'ctr',
  retention: 'record-retention',
  'record keeping': 'record-retention',
  training: 'training',
  pep: 'pep',
  'politically exposed': 'pep',
  proliferation: 'pf',
  'dual-use': 'pf',
  'responsible sourcing': 'responsible-sourcing',
  lbma: 'responsible-sourcing',
  goaml: 'goaml',
  fiu: 'goaml',
  governance: 'governance',
  'internal controls': 'governance',
};

const CRITICAL_KEYWORDS = ['sanctions', 'freeze', 'immediate', '24 hour', 'without delay'];
const HIGH_KEYWORDS = ['mandatory', 'required', 'shall', 'must'];

// ---------------------------------------------------------------------------
// Pure classifier
// ---------------------------------------------------------------------------

export function classifyCircular(circular: MoeCircular): CircularImpactReport {
  const text = `${circular.title}\n${circular.body}`.toLowerCase();
  const impactedPolicies: ImpactedPolicy[] = [];
  const seen = new Set<PolicyArea>();

  for (const [keyword, area] of Object.entries(KEYWORD_MAP)) {
    const idx = text.indexOf(keyword);
    if (idx < 0) continue;
    if (seen.has(area)) continue;
    seen.add(area);
    const excerptStart = Math.max(0, idx - 30);
    const excerptEnd = Math.min(text.length, idx + keyword.length + 60);
    impactedPolicies.push({
      area,
      confidence: 0.7,
      evidence: text.slice(excerptStart, excerptEnd).trim(),
      matchedKeyword: keyword,
    });
  }

  // Severity derivation from keyword overlap.
  const hasCritical = CRITICAL_KEYWORDS.some((k) => text.includes(k));
  const hasHigh = HIGH_KEYWORDS.some((k) => text.includes(k));
  const severity: CircularImpactReport['severity'] = hasCritical
    ? 'critical'
    : hasHigh
      ? 'high'
      : impactedPolicies.length > 2
        ? 'medium'
        : 'low';

  // 30-day action deadline from CLAUDE.md policy.
  const publishedMs = Date.parse(circular.publishedAtIso);
  const deadlineMs = Number.isFinite(publishedMs)
    ? publishedMs + 30 * 86_400_000
    : Date.now() + 30 * 86_400_000;

  return {
    circular,
    impactedPolicies,
    severity,
    suggestedTaskTitle: `[${severity.toUpperCase()}] Implement MoE Circular: ${circular.title}`,
    actionDeadlineIso: new Date(deadlineMs).toISOString(),
  };
}
