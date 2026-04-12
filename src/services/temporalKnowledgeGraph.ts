/**
 * Temporal Knowledge Graph — subsystem #92 (Phase 8).
 *
 * Represents compliance entities AND their relationships across time.
 * Unlike a static knowledge graph, every edge carries a validity
 * window: "entity A HAD director X between date Y and Z". Supports:
 *
 *   - Point-in-time snapshots: "who directed this company on
 *     15/03/2026?"
 *   - Change timelines: "when did the registered address change?"
 *   - Period-overlap queries: "was X a director while Y was UBO?"
 *
 * Pure in-memory, deterministic, dependency-free. Designed for
 * thousands of entities — not a replacement for Neo4j but enough
 * for a mid-sized DPMS compliance desk.
 *
 * Regulatory basis:
 *   - Cabinet Decision 109/2023 (UBO chain with re-verification
 *     dates — requires temporal queries)
 *   - FDL No.10/2025 Art.24 (10-year retention with reconstructable
 *     historical state)
 *   - FATF Rec 11 (record-keeping integrity + historical queries)
 *   - NIST AI RMF MP-1.1 (context of use — historical context matters)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalEntity {
  id: string;
  kind: 'natural_person' | 'legal_entity' | 'account' | 'wallet' | 'asset';
  displayName: string;
}

export interface TemporalEdge {
  fromId: string;
  toId: string;
  /** Relationship kind, e.g. 'director_of', 'ubo_of', 'controls', 'owns', 'signatory'. */
  kind: string;
  /** Inclusive start of validity. */
  validFrom: string;
  /** Inclusive end of validity. undefined = still valid. */
  validTo?: string;
  /** Optional metadata (percentage, shares, etc.). */
  attributes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export class TemporalKnowledgeGraph {
  private readonly entities = new Map<string, TemporalEntity>();
  private readonly edges: TemporalEdge[] = [];

  addEntity(entity: TemporalEntity): void {
    this.entities.set(entity.id, entity);
  }

  addEdge(edge: TemporalEdge): void {
    // Defensive: require both endpoints to exist.
    if (!this.entities.has(edge.fromId)) {
      throw new Error(`Unknown from-entity: ${edge.fromId}`);
    }
    if (!this.entities.has(edge.toId)) {
      throw new Error(`Unknown to-entity: ${edge.toId}`);
    }
    this.edges.push(edge);
  }

  getEntity(id: string): TemporalEntity | undefined {
    return this.entities.get(id);
  }

  /** All edges valid at a specific instant. */
  edgesAt(atIso: string): TemporalEdge[] {
    const t = Date.parse(atIso);
    if (!Number.isFinite(t)) return [];
    return this.edges.filter((e) => {
      const from = Date.parse(e.validFrom);
      const to = e.validTo ? Date.parse(e.validTo) : Infinity;
      return t >= from && t <= to;
    });
  }

  /** All edges of a specific kind valid at a specific instant. */
  edgesOfKindAt(kind: string, atIso: string): TemporalEdge[] {
    return this.edgesAt(atIso).filter((e) => e.kind === kind);
  }

  /** Find the directors of a legal entity at a specific instant. */
  directorsOf(entityId: string, atIso: string): TemporalEntity[] {
    return this.edgesOfKindAt('director_of', atIso)
      .filter((e) => e.toId === entityId)
      .map((e) => this.entities.get(e.fromId))
      .filter((e): e is TemporalEntity => !!e);
  }

  /** Find the UBOs of a legal entity at a specific instant. */
  ubosOf(entityId: string, atIso: string): TemporalEntity[] {
    return this.edgesOfKindAt('ubo_of', atIso)
      .filter((e) => e.toId === entityId)
      .map((e) => this.entities.get(e.fromId))
      .filter((e): e is TemporalEntity => !!e);
  }

  /** All changes to the graph centred on an entity, sorted chronologically. */
  timelineOf(entityId: string): TemporalEdge[] {
    return this.edges
      .filter((e) => e.fromId === entityId || e.toId === entityId)
      .slice()
      .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
  }

  /**
   * Returns true if two edges overlap in time — used for "was X a
   * director while Y was UBO?" queries.
   */
  edgesOverlap(a: TemporalEdge, b: TemporalEdge): boolean {
    const aFrom = Date.parse(a.validFrom);
    const aTo = a.validTo ? Date.parse(a.validTo) : Infinity;
    const bFrom = Date.parse(b.validFrom);
    const bTo = b.validTo ? Date.parse(b.validTo) : Infinity;
    return aFrom <= bTo && bFrom <= aTo;
  }

  stats(): { entities: number; edges: number; kinds: readonly string[] } {
    const kinds = Array.from(new Set(this.edges.map((e) => e.kind))).sort();
    return { entities: this.entities.size, edges: this.edges.length, kinds };
  }
}
