/**
 * Replay From Log — parses a brain log line, reconstructs the input
 * that produced it, and feeds it back through a verdict function so
 * operators can reproduce a production bug from a single log line.
 *
 * Why this exists:
 *   When a production case produces an unexpected verdict, debugging
 *   requires:
 *     1. Find the log line
 *     2. Extract the tenant / entity / features
 *     3. Re-run the brain with the same input
 *     4. Compare verdicts
 *
 *   Today step 2 is a text-scraping exercise. This module is the
 *   pure parser + reconstruction layer. It understands the
 *   structured log format the brain emits (JSON with a `type` field)
 *   and returns a typed `ReplayResult`.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reproducibility)
 *   Cabinet Res 134/2025 Art.19 (internal review — bug repro)
 *   NIST AI RMF 1.0 MEASURE-4 (validation via replay)
 *   EU AI Act Art.15         (robustness debugging)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface LogLine {
  tsIso: string;
  type: 'brain-analyze' | 'asana-dispatch' | 'tierC' | 'cron' | 'unknown';
  raw: string;
  parsed: Record<string, unknown> | null;
  parseError: string | null;
}

export interface BrainCaseInput {
  tenantId: string;
  entityId: string;
  features: Readonly<Record<string, number>>;
  expectedVerdict: Verdict;
}

export interface ReplayResult {
  schemaVersion: 1;
  caseInput: BrainCaseInput;
  originalVerdict: Verdict;
  replayedVerdict: Verdict;
  match: boolean;
  drift: string | null;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseLogLine(raw: string): LogLine {
  const line: LogLine = {
    tsIso: '',
    type: 'unknown',
    raw,
    parsed: null,
    parseError: null,
  };
  if (typeof raw !== 'string' || raw.length === 0) {
    line.parseError = 'empty';
    return line;
  }
  // Try to find the JSON blob — common pattern is "[timestamp] [level] {json}".
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) {
    line.parseError = 'no JSON blob found';
    return line;
  }
  const jsonText = raw.slice(jsonStart);
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    line.parsed = obj;
    if (typeof obj.tsIso === 'string') line.tsIso = obj.tsIso;
    if (typeof obj.type === 'string') {
      const t = obj.type;
      if (t === 'brain-analyze' || t === 'asana-dispatch' || t === 'tierC' || t === 'cron') {
        line.type = t;
      }
    }
  } catch (err) {
    line.parseError = `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return line;
}

/**
 * Extract the BrainCaseInput from a parsed log line. Returns null if
 * the line is not a brain-analyze entry.
 */
export function extractCaseInput(line: LogLine): BrainCaseInput | null {
  if (line.type !== 'brain-analyze') return null;
  if (!line.parsed) return null;
  const raw = line.parsed;
  const tenantId = raw.tenantId;
  const entityId = raw.entityId;
  const features = raw.features;
  const verdict = raw.verdict;

  if (typeof tenantId !== 'string' || typeof entityId !== 'string') return null;
  if (!features || typeof features !== 'object') return null;
  if (
    typeof verdict !== 'string' ||
    !['pass', 'flag', 'escalate', 'freeze'].includes(verdict)
  ) {
    return null;
  }

  const safeFeatures: Record<string, number> = {};
  for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) safeFeatures[k] = v;
  }

  return {
    tenantId,
    entityId,
    features: safeFeatures,
    expectedVerdict: verdict as Verdict,
  };
}

// ---------------------------------------------------------------------------
// Replay driver
// ---------------------------------------------------------------------------

export type ReplayVerdictFn = (
  features: Readonly<Record<string, number>>
) => { verdict: Verdict; confidence: number } | Promise<{ verdict: Verdict; confidence: number }>;

export async function replayFromLogLine(
  raw: string,
  verdictFn: ReplayVerdictFn
): Promise<ReplayResult | null> {
  const line = parseLogLine(raw);
  const caseInput = extractCaseInput(line);
  if (!caseInput) return null;
  const re = await Promise.resolve(verdictFn(caseInput.features));
  return {
    schemaVersion: 1,
    caseInput,
    originalVerdict: caseInput.expectedVerdict,
    replayedVerdict: re.verdict,
    match: re.verdict === caseInput.expectedVerdict,
    drift:
      re.verdict === caseInput.expectedVerdict
        ? null
        : `original=${caseInput.expectedVerdict}, replayed=${re.verdict}`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
    ],
  };
}
