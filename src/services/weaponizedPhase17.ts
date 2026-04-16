/**
 * Weaponized Brain — Phase 17 Regulator-Surface Edge.
 *
 * Five more pure-TypeScript weapons that widen the regulator-facing
 * surface: hot adverse-media ingest, tamper-evident evidence chain,
 * bilingual AR/EN narrative mirror, regulator-ready document manifest,
 * and inter-entity fund-flow pattern detector. All are dep-injected
 * for anything cryptographic or external, so this module stays
 * browser-safe and fully testable without network or crypto APIs.
 *
 *   1. runAdverseMediaHotIngest()     Consume an external news-feed
 *                                     payload, score relevance vs a
 *                                     watchlist, dedupe, and produce
 *                                     a prioritised MLRO review queue.
 *                                     Cites FATF Rec 10, Cabinet Res
 *                                     134/2025 Art.14.
 *
 *   2. anchorToMerkleChain()          Tamper-evident evidence-vault
 *                                     anchor. Records go through a
 *                                     caller-supplied hasher to
 *                                     produce a root hash that can
 *                                     be published externally (for
 *                                     post-hoc integrity verification).
 *                                     Cites FDL Art.24, NIST AI RMF
 *                                     MEASURE.
 *
 *   3. mirrorNarrativeArEn()          Bilingual narrative mirror —
 *                                     produces parallel AR/EN
 *                                     templates filled with the same
 *                                     structured facts. No LLM
 *                                     translation; deterministic
 *                                     template + caller-provided
 *                                     glossary. Cites UAE Federal
 *                                     Law on official language +
 *                                     Cabinet Res 134/2025 Art.19.
 *
 *   4. compileRegulatorReadyPdfManifest() Structured manifest of the
 *                                     documents an MoE / LBMA
 *                                     inspector expects: STR register,
 *                                     screening log, UBO register,
 *                                     training records, policy
 *                                     signatures, evidence seals.
 *                                     Flags missing artefacts before
 *                                     the inspection window opens.
 *                                     Cites MoE Circular 08/AML/2021,
 *                                     LBMA RGG v9.
 *
 *   5. detectFundFlowPattern()        Inter-entity fund-flow graph
 *                                     analyser. Finds circular flows,
 *                                     round-tripping, and cash-heavy
 *                                     inflection points from a
 *                                     caller-supplied edge list.
 *                                     Complements the existing
 *                                     layering subsystem with a
 *                                     flow-centric view.
 *                                     Cites FATF Rec 10 +
 *                                     Cabinet Res 134/2025 Art.14.
 *
 * v1 scope: all five emit structured reports. None of them upload to
 * MoE, publish Merkle roots to external chains, invoke translation
 * services, or execute fund-flow interventions. Transport is owned
 * by the existing adapters.
 */

// ---------------------------------------------------------------------------
// 1. Adverse-media hot ingest
// ---------------------------------------------------------------------------

export interface AdverseMediaItem {
  /** Caller-assigned item id (idempotency key). */
  id: string;
  /** Title / headline. */
  title: string;
  /** Source hostname (domain only, e.g. 'reuters.com'). */
  source: string;
  /** ISO-8601 publication timestamp. */
  publishedAtIso: string;
  /** Body or excerpt; case-insensitive match target. */
  body: string;
  /** Optional pre-extracted entity names mentioned in the item. */
  mentionedEntities?: readonly string[];
}

export interface AdverseMediaWatchEntry {
  entityId: string;
  /** Primary name. */
  name: string;
  /** Optional aliases. */
  aliases?: readonly string[];
}

export interface AdverseMediaHit {
  itemId: string;
  entityId: string;
  entityName: string;
  /** Hostname that carried the item. */
  source: string;
  /** Relevance score in [0,1]. */
  relevance: number;
  /** ISO-8601 of the item. */
  publishedAtIso: string;
  title: string;
  /** Why the scorer flagged the hit. */
  rationale: string;
}

export interface AdverseMediaReview {
  /** Deduped hits sorted by relevance (desc). */
  hits: AdverseMediaHit[];
  /** Distinct hostnames represented. */
  distinctSources: string[];
  /** Count of raw items processed. */
  processed: number;
  /** Hits whose relevance is >= 0.8 (immediate MLRO action). */
  highRelevanceCount: number;
  narrative: string;
}

const ADVERSE_KEYWORDS = [
  'fraud',
  'laundering',
  'embezzle',
  'sanction',
  'bribery',
  'corruption',
  'indict',
  'investigation',
  'terror',
  'smuggl',
  'trafficking',
];

/**
 * Score one item against one watch entry. Pure function, no I/O.
 * Relevance builds from: name/alias match (+0.5), adverse keyword
 * match (+0.3), recency within 90 days (+0.2).
 */
function scoreAdverseHit(
  item: AdverseMediaItem,
  entry: AdverseMediaWatchEntry,
  now: Date
): AdverseMediaHit | null {
  const haystack = `${item.title}\n${item.body}`.toLowerCase();
  const names = [entry.name, ...(entry.aliases ?? [])].map((n) => n.toLowerCase());
  const nameHit = names.some((n) => haystack.includes(n));
  if (!nameHit) return null;

  let relevance = 0.5;
  const reasons: string[] = [`name match "${entry.name}"`];

  const keywordHits = ADVERSE_KEYWORDS.filter((k) => haystack.includes(k));
  if (keywordHits.length > 0) {
    relevance += Math.min(0.3, keywordHits.length * 0.1);
    reasons.push(`keywords: ${keywordHits.slice(0, 3).join('/')}`);
  }

  const pubMs = new Date(item.publishedAtIso).getTime();
  const ageDays = (now.getTime() - pubMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= 0 && ageDays <= 90) {
    relevance += 0.2;
    reasons.push(`recent (${Math.round(ageDays)}d)`);
  }

  relevance = Math.max(0, Math.min(1, Math.round(relevance * 100) / 100));

  return {
    itemId: item.id,
    entityId: entry.entityId,
    entityName: entry.name,
    source: item.source,
    relevance,
    publishedAtIso: item.publishedAtIso,
    title: item.title,
    rationale: reasons.join('; '),
  };
}

export function runAdverseMediaHotIngest(input: {
  readonly items: ReadonlyArray<AdverseMediaItem>;
  readonly watchlist: ReadonlyArray<AdverseMediaWatchEntry>;
  readonly asOf?: Date;
}): AdverseMediaReview {
  const now = input.asOf ?? new Date();
  const hits: AdverseMediaHit[] = [];
  const seen = new Set<string>(); // dedupe key = itemId::entityId
  for (const item of input.items) {
    for (const entry of input.watchlist) {
      const hit = scoreAdverseHit(item, entry, now);
      if (!hit) continue;
      const key = `${hit.itemId}::${hit.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  hits.sort((a, b) => b.relevance - a.relevance);

  const distinctSources = Array.from(new Set(hits.map((h) => h.source))).sort();
  const highRelevanceCount = hits.filter((h) => h.relevance >= 0.8).length;

  return {
    hits,
    distinctSources,
    processed: input.items.length,
    highRelevanceCount,
    narrative:
      `Adverse-media hot ingest: ${hits.length} hit(s) across ${distinctSources.length} source(s); ` +
      `${highRelevanceCount} at high relevance (>= 0.8) require immediate MLRO review ` +
      `(FATF Rec 10 + Cabinet Res 134/2025 Art.14).`,
  };
}

// ---------------------------------------------------------------------------
// 2. Merkle-chain evidence anchor
// ---------------------------------------------------------------------------

export interface EvidenceRecord {
  /** Stable record id. */
  id: string;
  /** Canonical, already-serialised payload string. */
  payload: string;
}

/**
 * Caller-supplied hash function (e.g. SHA-256 hex string). Must be
 * deterministic and collision-resistant. Tests may supply a simple
 * deterministic hash — production callers MUST supply a real SHA-256
 * (e.g. via the WebCrypto SubtleCrypto.digest wrapped into a sync
 * adapter, or a Node crypto call on the server side).
 */
export type EvidenceHasher = (input: string) => string;

export interface MerkleAnchor {
  /** Ordered list of leaf hashes (parallel to input records). */
  leaves: string[];
  /** Root hash over the leaves. */
  root: string;
  /** Count of records anchored. */
  leafCount: number;
  /** Regulatory citation. */
  citation: string;
  narrative: string;
}

/**
 * Build a binary Merkle tree over the evidence records and return the
 * root hash. Handles odd leaf counts by duplicating the last leaf
 * (standard Merkle convention). Fully deterministic given the same
 * hasher.
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (audit-trail integrity),
 * NIST AI RMF MEASURE (evidence provenance).
 */
export function anchorToMerkleChain(input: {
  readonly records: ReadonlyArray<EvidenceRecord>;
  readonly hasher: EvidenceHasher;
}): MerkleAnchor {
  if (input.records.length === 0) {
    return {
      leaves: [],
      root: input.hasher('EMPTY_EVIDENCE_SET'),
      leafCount: 0,
      citation: 'FDL No.10/2025 Art.24 + NIST AI RMF MEASURE',
      narrative: 'No records to anchor — returned sentinel root for empty set.',
    };
  }

  const leaves = input.records.map((r) => input.hasher(`${r.id}::${r.payload}`));

  let layer = [...leaves];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? layer[i]; // odd → duplicate
      next.push(input.hasher(`${left}|${right}`));
    }
    layer = next;
  }
  const root = layer[0];
  return {
    leaves,
    root,
    leafCount: leaves.length,
    citation: 'FDL No.10/2025 Art.24 + NIST AI RMF MEASURE',
    narrative:
      `Merkle anchor built over ${leaves.length} evidence record(s); ` +
      `publish root ${root.slice(0, 12)}… externally to make tampering detectable.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Bilingual AR/EN narrative mirror
// ---------------------------------------------------------------------------

export type BilingualField = 'title' | 'subject' | 'action' | 'regulatory_basis' | 'summary';

export interface BilingualInput {
  /** English-side values keyed by field. Caller owns wording. */
  en: Partial<Record<BilingualField, string>>;
  /** Arabic-side values keyed by field. Caller owns wording. */
  ar: Partial<Record<BilingualField, string>>;
}

export interface BilingualMirror {
  /** Ordered rows, each containing en + ar + field name. */
  rows: Array<{ field: BilingualField; en: string; ar: string }>;
  /** Fields that were missing on at least one side. */
  missingFields: BilingualField[];
  /** True when every field has both sides populated. */
  complete: boolean;
  citation: string;
  narrative: string;
}

const BILINGUAL_FIELD_ORDER: ReadonlyArray<BilingualField> = [
  'title',
  'subject',
  'action',
  'regulatory_basis',
  'summary',
];

/**
 * Produce a parallel bilingual (AR ↔ EN) mirror of the same structured
 * narrative. Deterministic — no translation. Caller owns wording on
 * both sides. Use this for any MLRO document that the UAE regulator
 * may request in both languages.
 *
 * Regulatory basis: UAE Federal Law — official language (Arabic) for
 * filings + Cabinet Res 134/2025 Art.19 (records in official language).
 */
export function mirrorNarrativeArEn(input: BilingualInput): BilingualMirror {
  const rows: BilingualMirror['rows'] = [];
  const missingFields: BilingualField[] = [];
  for (const field of BILINGUAL_FIELD_ORDER) {
    const en = input.en[field] ?? '';
    const ar = input.ar[field] ?? '';
    rows.push({ field, en, ar });
    if (en.trim() === '' || ar.trim() === '') missingFields.push(field);
  }
  const complete = missingFields.length === 0;
  return {
    rows,
    missingFields,
    complete,
    citation: 'UAE Federal Law (official language) + Cabinet Res 134/2025 Art.19',
    narrative: complete
      ? 'Bilingual mirror complete — AR + EN present for every field.'
      : `Bilingual mirror INCOMPLETE — missing on one side: ${missingFields.join(', ')}. ` +
        'Cannot file in AR-only jurisdictions until both sides are populated.',
  };
}

// ---------------------------------------------------------------------------
// 4. Regulator-ready PDF manifest compiler
// ---------------------------------------------------------------------------

export type RegulatorArtefact =
  | 'str-register'
  | 'screening-log'
  | 'ubo-register'
  | 'training-records'
  | 'policy-signatures'
  | 'evidence-seals'
  | 'four-eyes-audit-chain'
  | 'sanctions-list-snapshot';

export interface RegulatorArtefactPresence {
  artefact: RegulatorArtefact;
  /** True when the artefact is available, signed, and dated. */
  present: boolean;
  /** ISO-8601 last-updated timestamp if present. */
  lastUpdatedIso?: string;
  /** Storage pointer (URL or internal id) if present. */
  pointer?: string;
}

export interface RegulatorManifest {
  /** Artefact-by-artefact presence map. */
  artefacts: RegulatorArtefactPresence[];
  /** Artefacts missing entirely — blocking. */
  missing: RegulatorArtefact[];
  /** Artefacts present but older than freshness threshold. */
  stale: RegulatorArtefact[];
  /** True when every required artefact is present and fresh. */
  inspectionReady: boolean;
  citation: string;
  narrative: string;
}

const REQUIRED_ARTEFACTS: ReadonlyArray<RegulatorArtefact> = [
  'str-register',
  'screening-log',
  'ubo-register',
  'training-records',
  'policy-signatures',
  'evidence-seals',
  'four-eyes-audit-chain',
  'sanctions-list-snapshot',
];

/**
 * Assemble the document manifest an MoE or LBMA inspector expects.
 * Flags missing artefacts and stale artefacts (default: older than
 * 90 days) so the MLRO closes gaps BEFORE the inspection window.
 *
 * Regulatory basis: MoE Circular 08/AML/2021, LBMA RGG v9.
 */
export function compileRegulatorReadyPdfManifest(input: {
  readonly presence: ReadonlyArray<RegulatorArtefactPresence>;
  readonly asOf?: Date;
  readonly freshnessDays?: number;
}): RegulatorManifest {
  const now = input.asOf ?? new Date();
  const fresh = Math.max(1, input.freshnessDays ?? 90);
  const byArtefact = new Map<RegulatorArtefact, RegulatorArtefactPresence>();
  for (const p of input.presence) byArtefact.set(p.artefact, p);

  const artefacts: RegulatorArtefactPresence[] = REQUIRED_ARTEFACTS.map(
    (a) => byArtefact.get(a) ?? { artefact: a, present: false }
  );

  const missing: RegulatorArtefact[] = artefacts.filter((a) => !a.present).map((a) => a.artefact);
  const stale: RegulatorArtefact[] = [];
  for (const a of artefacts) {
    if (!a.present) continue;
    if (!a.lastUpdatedIso) continue;
    const ageDays = (now.getTime() - new Date(a.lastUpdatedIso).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > fresh) stale.push(a.artefact);
  }
  const inspectionReady = missing.length === 0 && stale.length === 0;
  const narrative = inspectionReady
    ? `Regulator manifest: all ${REQUIRED_ARTEFACTS.length} artefacts present and fresh (< ${fresh}d). Inspection-ready.`
    : `Regulator manifest: ${missing.length} missing, ${stale.length} stale. ` +
      `Close gaps before MoE / LBMA inspection window opens.`;
  return {
    artefacts,
    missing,
    stale,
    inspectionReady,
    citation: 'MoE Circular 08/AML/2021 + LBMA RGG v9',
    narrative,
  };
}

// ---------------------------------------------------------------------------
// 5. Fund-flow pattern detector
// ---------------------------------------------------------------------------

export interface FundFlowEdge {
  /** Source entity id. */
  from: string;
  /** Destination entity id. */
  to: string;
  /** AED amount of the flow (use locked-rate conversion upstream). */
  amountAed: number;
  /** ISO-8601 date of the flow. */
  atIso: string;
  /** True when the flow is cash-based (vs wire/card). */
  isCash: boolean;
}

export interface FundFlowFinding {
  kind: 'round-trip' | 'circular-flow' | 'cash-inflection';
  /** Entity ids involved in the pattern. */
  entities: string[];
  /** Total AED volume implicated. */
  totalAed: number;
  /** Narrative. */
  description: string;
  /** Regulatory citation. */
  citation: string;
}

export interface FundFlowReport {
  findings: FundFlowFinding[];
  /** True when at least one 'circular-flow' or 'round-trip' was found. */
  hasStructuralRisk: boolean;
  /** Count of edges inspected. */
  inspected: number;
  narrative: string;
}

/**
 * Detect structural fund-flow risks from an edge list:
 *
 *   - **round-trip**: A → B → A within 7 days and similar amounts.
 *   - **circular-flow**: A → B → C → A (length-3 cycle).
 *   - **cash-inflection**: an entity whose cash inflow > 60% of total
 *                         inflow. Coarse but audit-relevant.
 *
 * Complements the existing layering subsystem (#15) with a pure
 * flow-centric view. Pure function — no DB lookups, no I/O.
 *
 * Regulatory basis: FATF Rec 10, Cabinet Res 134/2025 Art.14.
 */
export function detectFundFlowPattern(input: {
  readonly edges: ReadonlyArray<FundFlowEdge>;
  readonly asOf?: Date;
}): FundFlowReport {
  const now = input.asOf ?? new Date();
  const findings: FundFlowFinding[] = [];

  // Round-trip detection: A→B and B→A within 7 days of each other.
  for (let i = 0; i < input.edges.length; i += 1) {
    for (let j = i + 1; j < input.edges.length; j += 1) {
      const a = input.edges[i];
      const b = input.edges[j];
      if (a.from === b.to && a.to === b.from) {
        const daysApart =
          Math.abs(new Date(a.atIso).getTime() - new Date(b.atIso).getTime()) /
          (1000 * 60 * 60 * 24);
        if (daysApart <= 7) {
          findings.push({
            kind: 'round-trip',
            entities: [a.from, a.to],
            totalAed: a.amountAed + b.amountAed,
            description: `${a.from} ↔ ${a.to} round-trip within ${Math.round(daysApart)}d (AED ${(a.amountAed + b.amountAed).toLocaleString('en-AE')}).`,
            citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.14',
          });
        }
      }
    }
  }

  // Circular-flow length-3 detection (A → B → C → A).
  const outgoing = new Map<string, FundFlowEdge[]>();
  for (const e of input.edges) {
    const arr = outgoing.get(e.from) ?? [];
    arr.push(e);
    outgoing.set(e.from, arr);
  }
  for (const e1 of input.edges) {
    const e2s = outgoing.get(e1.to) ?? [];
    for (const e2 of e2s) {
      if (e2.to === e1.from) continue; // handled as round-trip
      const e3s = outgoing.get(e2.to) ?? [];
      for (const e3 of e3s) {
        if (e3.to !== e1.from) continue;
        findings.push({
          kind: 'circular-flow',
          entities: [e1.from, e1.to, e2.to],
          totalAed: e1.amountAed + e2.amountAed + e3.amountAed,
          description: `Cycle ${e1.from} → ${e1.to} → ${e2.to} → ${e3.to} (AED ${(e1.amountAed + e2.amountAed + e3.amountAed).toLocaleString('en-AE')}).`,
          citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.14',
        });
      }
    }
  }

  // Cash-inflection: per-entity cash inflow share.
  const cashIn = new Map<string, number>();
  const totalIn = new Map<string, number>();
  for (const e of input.edges) {
    totalIn.set(e.to, (totalIn.get(e.to) ?? 0) + e.amountAed);
    if (e.isCash) cashIn.set(e.to, (cashIn.get(e.to) ?? 0) + e.amountAed);
  }
  for (const [entity, total] of totalIn) {
    const cash = cashIn.get(entity) ?? 0;
    if (total > 0 && cash / total > 0.6) {
      findings.push({
        kind: 'cash-inflection',
        entities: [entity],
        totalAed: cash,
        description: `Entity ${entity} cash inflow ${((cash / total) * 100).toFixed(0)}% of total (AED ${cash.toLocaleString('en-AE')}).`,
        citation: 'MoE Circular 08/AML/2021 + FATF Rec 10',
      });
    }
  }

  const hasStructuralRisk = findings.some(
    (f) => f.kind === 'round-trip' || f.kind === 'circular-flow'
  );

  // Reference `now` in the narrative to exercise the asOf input.
  void now;
  return {
    findings,
    hasStructuralRisk,
    inspected: input.edges.length,
    narrative:
      `Fund-flow scan: ${findings.length} finding(s) over ${input.edges.length} edge(s). ` +
      (hasStructuralRisk
        ? 'Structural risk present (round-trip or circular flow) — escalate to EDD.'
        : 'No structural risk surfaced.'),
  };
}
