/**
 * Case Clusterer — group similar pending cases so MLROs review batches
 * instead of individual tasks.
 *
 * Why this exists:
 *   When 50 freeze tasks land in the same hour from the same upstream
 *   pattern (one new sanctions delta, or one structuring ring), the
 *   MLRO has to open and read 50 individual cases. Most of them have
 *   identical reasoning, identical citations, identical recommended
 *   actions. The MLRO ends up rubber-stamping after the first 5,
 *   which defeats the four-eyes purpose.
 *
 *   Clustering groups similar cases by feature-vector cosine
 *   similarity + verdict + top STR factor overlap. The MLRO can
 *   review one cluster representative, apply the same decision to
 *   the cluster, and the system records a per-case approval log
 *   so the four-eyes record stays intact.
 *
 *   Pure function. Same input → same clusters. Deterministic seed.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO efficient review)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 1               (proportional response)
 *   NIST AI RMF 1.0 MANAGE-2 (resource allocation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaseSummary {
  /** Opaque case id. */
  id: string;
  tenantId: string;
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  confidence: number;
  /** Numeric feature vector (StrFeatures shape). */
  features: Record<string, number>;
  /** Top contributing factors by name. */
  topFactors: readonly string[];
}

export interface CaseCluster {
  /** Stable cluster id. */
  id: string;
  /** The single case used as the cluster centroid representative. */
  representativeCaseId: string;
  /** Cases in the cluster (always includes the representative). */
  caseIds: readonly string[];
  /** Verdict shared by every case in the cluster. */
  verdict: CaseSummary['verdict'];
  /** Mean confidence across the cluster. */
  meanConfidence: number;
  /** Top factor labels common to ≥50% of cluster members. */
  sharedFactors: readonly string[];
  /** Plain-English finding for the audit log. */
  finding: string;
}

export interface ClusteringReport {
  schemaVersion: 1;
  clusters: readonly CaseCluster[];
  /** Cases not absorbed into any cluster (singletons). */
  singletons: readonly string[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function sharedFactors(cases: readonly CaseSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    for (const f of c.topFactors) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const half = cases.length / 2;
  return Array.from(counts.entries())
    .filter(([, n]) => n >= half)
    .map(([f]) => f)
    .sort();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClusterOptions {
  /** Minimum cosine similarity to merge into a cluster. Default 0.9. */
  minSimilarity?: number;
}

/**
 * Greedy single-link clustering. O(N^2) but fine for ≤500 cases per
 * MLRO batch. Cases with the same verdict are grouped if their
 * feature vectors meet `minSimilarity`.
 */
export function clusterCases(
  cases: readonly CaseSummary[],
  opts: ClusterOptions = {}
): ClusteringReport {
  const minSim = opts.minSimilarity ?? 0.9;
  const used = new Set<string>();
  const clusters: CaseCluster[] = [];

  // Sort cases by id so the same input always produces the same output.
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    const members: CaseSummary[] = [seed];
    used.add(seed.id);
    for (const candidate of sorted) {
      if (used.has(candidate.id)) continue;
      if (candidate.verdict !== seed.verdict) continue;
      const sim = cosine(seed.features, candidate.features);
      if (sim >= minSim) {
        members.push(candidate);
        used.add(candidate.id);
      }
    }
    if (members.length < 2) continue; // singleton — handled below
    const meanConfidence = members.reduce((acc, c) => acc + c.confidence, 0) / members.length;
    const cluster: CaseCluster = {
      id: `cluster:${seed.tenantId}:${seed.id}`,
      representativeCaseId: seed.id,
      caseIds: members.map((m) => m.id),
      verdict: seed.verdict,
      meanConfidence,
      sharedFactors: sharedFactors(members),
      finding:
        `Cluster of ${members.length} ${seed.verdict} case(s) with mean confidence ` +
        `${meanConfidence.toFixed(3)}. Representative: ${seed.id}.`,
    };
    clusters.push(cluster);
  }

  const singletons = sorted
    .filter((c) => !clusters.some((cl) => cl.caseIds.includes(c.id)))
    .map((c) => c.id);

  const summary =
    clusters.length === 0
      ? `No clusters formed across ${cases.length} case(s) (min similarity ${minSim}).`
      : `${clusters.length} cluster(s) formed across ${cases.length} case(s). ` +
        `${cases.length - singletons.length} case(s) absorbed; ${singletons.length} singleton(s).`;

  return {
    schemaVersion: 1,
    clusters,
    singletons,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = { cosine, sharedFactors };
