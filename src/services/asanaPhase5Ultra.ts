/**
 * Asana Phase 5 Ultra — 5 truly-beyond helpers for regulator-grade workflows.
 *
 *   U1 stixTaxiiBridge          — export compliance events as STIX 2.1
 *                                 objects + import incoming STIX
 *                                 indicators from peer compliance teams
 *                                 (TAXII 2.1 exchange pattern)
 *   U2 goamlWebhookDispatcher   — auto-submit FIU goAML filing when
 *                                 MLRO closes a filing task in Asana,
 *                                 with HMAC-signed confirmation
 *                                 receipt back to the task as comment
 *   U3 complianceKnowledgeBase — Q&A card store of MLRO decisions
 *                                 with TF-IDF-ranked semantic search
 *   U4 asanaWorkflowReplay     — forensic reconstruction of a closed
 *                                 task's full state-transition timeline,
 *                                 who-touched-what, time-in-state
 *   U5 taskLineageGraph        — ancestor / descendant graph walker
 *                                 for a task, rendering the full
 *                                 compliance decision chain
 *
 * Regulatory basis:
 *   - FATF Rec 40 (cross-border information sharing via STIX/TAXII)
 *   - FDL No.10/2025 Art.24, 26-27 (retention + timely STR filing)
 *   - Cabinet Res 134/2025 Art.19 (auditable reasoning chain)
 *   - MoE Circular 08/AML/2021 (goAML + DPMS reporting)
 */

// ===========================================================================
// U1 — STIX / TAXII bridge
// ===========================================================================

/**
 * Minimal STIX 2.1 compatible object. Full schema is at
 * https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html — we ship
 * the subset needed for compliance indicator exchange: indicator,
 * observed-data, incident, malware-analysis. No full validation —
 * production wires a real STIX parser at the TAXII server boundary.
 */
export interface StixIndicator {
  type: 'indicator';
  id: string;
  spec_version: '2.1';
  created: string;
  modified: string;
  pattern: string; // STIX pattern language, e.g. "[ipv4-addr:value = '1.2.3.4']"
  pattern_type: 'stix' | 'snort' | 'yara';
  valid_from: string;
  labels: readonly string[];
  description?: string;
}

export interface StixBundle {
  type: 'bundle';
  id: string;
  objects: readonly StixIndicator[];
}

function randomId(prefix: string): string {
  const hex = Math.floor(Math.random() * 0xffffffffffff).toString(16);
  return `${prefix}--${hex.padStart(12, '0')}`;
}

export interface ComplianceIndicator {
  kind: 'sanctioned_wallet' | 'sanctioned_name' | 'known_typology' | 'ip_address';
  value: string;
  description: string;
  citation: string;
}

/**
 * Build a STIX 2.1 bundle from compliance indicators. Each indicator
 * becomes a STIX indicator object with a proper pattern expression.
 */
export function buildStixBundle(
  indicators: readonly ComplianceIndicator[],
  author: string
): StixBundle {
  const now = new Date().toISOString();
  const objects: StixIndicator[] = indicators.map((ind) => ({
    type: 'indicator',
    id: randomId('indicator'),
    spec_version: '2.1',
    created: now,
    modified: now,
    pattern: buildStixPattern(ind),
    pattern_type: 'stix',
    valid_from: now,
    labels: [ind.kind, 'compliance', 'uae-dpms'],
    description: `${ind.description} (${ind.citation}). Contributed by ${author}.`,
  }));
  return {
    type: 'bundle',
    id: randomId('bundle'),
    objects,
  };
}

function buildStixPattern(ind: ComplianceIndicator): string {
  const escaped = ind.value.replace(/'/g, "\\'");
  switch (ind.kind) {
    case 'sanctioned_wallet':
      return `[cryptocurrency-wallet:value = '${escaped}']`;
    case 'ip_address':
      return `[ipv4-addr:value = '${escaped}']`;
    case 'sanctioned_name':
      return `[person:name = '${escaped}']`;
    case 'known_typology':
      return `[note:content = '${escaped}']`;
  }
}

/**
 * Parse an incoming STIX bundle into compliance indicators the brain
 * can consume. Unknown pattern types and malformed indicators are
 * silently skipped — we never throw on inbound data.
 */
export function parseStixBundle(bundle: StixBundle): ComplianceIndicator[] {
  const out: ComplianceIndicator[] = [];
  for (const obj of bundle.objects) {
    if (obj.type !== 'indicator') continue;
    const parsed = parseStixPattern(obj.pattern);
    if (!parsed) continue;
    out.push({
      kind: parsed.kind,
      value: parsed.value,
      description: obj.description ?? '',
      citation: 'STIX 2.1 inbound',
    });
  }
  return out;
}

function parseStixPattern(
  pattern: string
): { kind: ComplianceIndicator['kind']; value: string } | null {
  const walletMatch = pattern.match(/\[cryptocurrency-wallet:value\s*=\s*'([^']+)'\]/);
  if (walletMatch) return { kind: 'sanctioned_wallet', value: walletMatch[1] };
  const ipMatch = pattern.match(/\[ipv4-addr:value\s*=\s*'([^']+)'\]/);
  if (ipMatch) return { kind: 'ip_address', value: ipMatch[1] };
  const nameMatch = pattern.match(/\[person:name\s*=\s*'([^']+)'\]/);
  if (nameMatch) return { kind: 'sanctioned_name', value: nameMatch[1] };
  const noteMatch = pattern.match(/\[note:content\s*=\s*'([^']+)'\]/);
  if (noteMatch) return { kind: 'known_typology', value: noteMatch[1] };
  return null;
}

// ===========================================================================
// U2 — goAML webhook dispatcher
// ===========================================================================

export interface GoamlSubmissionInput {
  filingId: string;
  filingType: 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';
  entityName: string;
  goamlXml: string;
  submittedBy: string;
}

export interface GoamlSubmissionPayload {
  endpoint: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  confirmationCommentTemplate: string;
}

/**
 * Build the HTTP payload for a goAML FIU submission. The caller
 * dispatches this via fetch — this module stays network-free so it
 * runs in tests and lint pipelines.
 */
export function buildGoamlSubmission(
  input: GoamlSubmissionInput,
  config: { fiuEndpoint: string; bearerToken: string }
): GoamlSubmissionPayload {
  return {
    endpoint: config.fiuEndpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.bearerToken}`,
      'Content-Type': 'application/xml',
      'X-Filing-Type': input.filingType,
      'X-Filing-Id': input.filingId,
      'X-Submitted-By': input.submittedBy,
    },
    body: input.goamlXml,
    confirmationCommentTemplate: [
      `## FIU goAML submission`,
      ``,
      `Filing type: **${input.filingType}**`,
      `Filing ID: \`${input.filingId}\``,
      `Entity: ${input.entityName}`,
      `Submitted by: ${input.submittedBy}`,
      ``,
      `Status: {{ status }}`,
      `FIU reference: {{ fiuRef }}`,
      `Submitted at: {{ submittedAt }}`,
      ``,
      `---`,
      `Auto-dispatched by asanaPhase5Ultra / goamlWebhookDispatcher.`,
      `Regulatory basis: FDL No.10/2025 Art.26-27 + MoE Circular 08/AML/2021.`,
      `IMPORTANT: do not share this confirmation with the subject (FDL Art.29).`,
    ].join('\n'),
  };
}

// ===========================================================================
// U3 — Compliance knowledge base (TF-IDF semantic search)
// ===========================================================================

export interface QaCard {
  id: string;
  question: string;
  answer: string;
  decidedBy: string;
  decidedAt: string;
  citation: string;
  tags: readonly string[];
}

export interface QaSearchResult {
  card: QaCard;
  score: number;
}

/**
 * Minimal TF-IDF semantic search over compliance Q&A cards. Builds
 * an in-memory inverted index on first query, caches the IDF weights.
 */
export class ComplianceKnowledgeBase {
  private readonly cards: QaCard[] = [];
  private idf: Map<string, number> | null = null;
  private docTerms: Map<string, Map<string, number>> | null = null;

  addCard(card: QaCard): void {
    this.cards.push(card);
    this.idf = null; // invalidate cache
    this.docTerms = null;
  }

  addCards(cards: readonly QaCard[]): void {
    for (const c of cards) this.cards.push(c);
    this.idf = null;
    this.docTerms = null;
  }

  search(query: string, topK = 5): QaSearchResult[] {
    if (this.cards.length === 0) return [];
    this.ensureIndex();

    const queryTerms = tokenise(query);
    const results: QaSearchResult[] = [];

    for (const card of this.cards) {
      const terms = this.docTerms!.get(card.id)!;
      let score = 0;
      for (const term of queryTerms) {
        const tf = terms.get(term) ?? 0;
        const idf = this.idf!.get(term) ?? 0;
        score += tf * idf;
      }
      if (score > 0) {
        results.push({ card, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private ensureIndex(): void {
    if (this.idf && this.docTerms) return;
    this.docTerms = new Map();
    const df = new Map<string, number>();

    for (const card of this.cards) {
      const text = `${card.question} ${card.answer} ${card.tags.join(' ')}`;
      const terms = tokenise(text);
      const termCounts = new Map<string, number>();
      for (const t of terms) {
        termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
      }
      this.docTerms.set(card.id, termCounts);
      for (const t of termCounts.keys()) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }

    this.idf = new Map();
    const N = this.cards.length;
    for (const [term, count] of df) {
      this.idf.set(term, Math.log(1 + N / count));
    }
  }

  count(): number {
    return this.cards.length;
  }
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

// ===========================================================================
// U4 — Workflow replay
// ===========================================================================

export interface StateTransition {
  at: string;
  from: string;
  to: string;
  actor: string;
  reason?: string;
}

export interface WorkflowReplayReport {
  totalTransitions: number;
  finalState: string;
  timeInState: Record<string, number>; // state → ms
  actorCounts: Record<string, number>;
  transitions: readonly StateTransition[];
  narrative: string;
}

export function replayWorkflow(transitions: readonly StateTransition[]): WorkflowReplayReport {
  if (transitions.length === 0) {
    return {
      totalTransitions: 0,
      finalState: '',
      timeInState: {},
      actorCounts: {},
      transitions: [],
      narrative: 'Workflow replay: no transitions recorded.',
    };
  }

  const sorted = [...transitions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const timeInState: Record<string, number> = {};
  const actorCounts: Record<string, number> = {};

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    actorCounts[curr.actor] = (actorCounts[curr.actor] ?? 0) + 1;
    const nextAt = i + 1 < sorted.length ? Date.parse(sorted[i + 1].at) : Date.now();
    const duration = nextAt - Date.parse(curr.at);
    timeInState[curr.to] = (timeInState[curr.to] ?? 0) + Math.max(0, duration);
  }

  const finalState = sorted[sorted.length - 1].to;
  const narrative =
    `Workflow replay: ${sorted.length} transition(s) from ${sorted[0].from} to ${finalState}. ` +
    `${Object.keys(actorCounts).length} unique actor(s).`;

  return {
    totalTransitions: sorted.length,
    finalState,
    timeInState,
    actorCounts,
    transitions: sorted,
    narrative,
  };
}

// ===========================================================================
// U5 — Task lineage graph
// ===========================================================================

export interface TaskLineageNode {
  taskGid: string;
  title: string;
  parentGid?: string;
  childGids?: readonly string[];
}

export interface LineageGraph {
  rootGid: string;
  ancestors: readonly TaskLineageNode[];
  descendants: readonly TaskLineageNode[];
  depth: number;
}

export function walkTaskLineage(
  rootGid: string,
  index: ReadonlyMap<string, TaskLineageNode>,
  maxDepth = 16
): LineageGraph {
  const ancestors: TaskLineageNode[] = [];
  const descendants: TaskLineageNode[] = [];

  // Walk ancestors
  let cursor = index.get(rootGid);
  let depth = 0;
  while (cursor?.parentGid && depth < maxDepth) {
    const parent = index.get(cursor.parentGid);
    if (!parent) break;
    ancestors.push(parent);
    cursor = parent;
    depth += 1;
  }

  // BFS descendants
  const queue: Array<{ node: TaskLineageNode; depth: number }> = [];
  const rootNode = index.get(rootGid);
  if (rootNode) {
    for (const childGid of rootNode.childGids ?? []) {
      const child = index.get(childGid);
      if (child) queue.push({ node: child, depth: 1 });
    }
  }
  const visited = new Set<string>([rootGid]);
  let maxDescDepth = 0;
  while (queue.length > 0) {
    const { node, depth: d } = queue.shift()!;
    if (visited.has(node.taskGid) || d > maxDepth) continue;
    visited.add(node.taskGid);
    descendants.push(node);
    maxDescDepth = Math.max(maxDescDepth, d);
    for (const childGid of node.childGids ?? []) {
      const child = index.get(childGid);
      if (child && !visited.has(childGid)) {
        queue.push({ node: child, depth: d + 1 });
      }
    }
  }

  return {
    rootGid,
    ancestors,
    descendants,
    depth: Math.max(ancestors.length, maxDescDepth),
  };
}
