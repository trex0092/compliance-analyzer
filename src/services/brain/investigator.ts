/**
 * Layer 1 — Investigation Agent.
 *
 * Iterative search → reason → extract → cite loop. Inspired by
 * vendor/node-DeepResearch but deterministic and network-free by
 * default. Accepts a pluggable `searchFn` so a caller can swap in
 * node-DeepResearch, an external RAG, or a cached sanctions snapshot.
 *
 * Every atom extracted carries a citation (source id + timestamp) so
 * the transcript is audit-ready under FDL Art.24 (10-year retention).
 *
 * Pure TypeScript. No Netlify, no Anthropic, no Web Crypto. Safe to
 * call from both Netlify functions and browser code.
 */

export interface SubjectProfile {
  name: string;
  aliases?: string[];
  jurisdiction?: string;
  entityType?: 'individual' | 'entity';
  dob?: string;
  notes?: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  /** Which hypothesis this question helps adjudicate. */
  targets: string[];
  /** Cost budget unit. 1 = cheap (cache lookup); 5 = expensive (web). */
  cost: number;
}

export interface ResearchAtom {
  id: string;
  questionId: string;
  fact: string;
  source: string;
  sourceTimestamp?: string;
  confidence: number;
  contradicts?: string[];
}

export interface SearchHit {
  fact: string;
  source: string;
  sourceTimestamp?: string;
  confidence: number;
}

/**
 * Pluggable search function. Implementations can hit cached
 * sanctions blobs, an embedded PEP index, an external adverse-media
 * API, or a vendored node-DeepResearch instance. The caller is
 * responsible for respecting FDL Art.29 — never leak subject data to
 * a third-party search that could tip off the subject.
 */
export type SearchFn = (
  question: ResearchQuestion,
  subject: SubjectProfile
) => Promise<SearchHit[]> | SearchHit[];

export interface InvestigationConfig {
  /** Max iterations of the research loop. Default 4. */
  maxIterations?: number;
  /** Max total cost units. Default 20. */
  maxCost?: number;
  /** Stop when a hypothesis reaches this confidence. Default 0.85. */
  targetConfidence?: number;
  /** Seed questions; if omitted, built from the subject. */
  seedQuestions?: ResearchQuestion[];
}

export interface InvestigationTranscript {
  subject: SubjectProfile;
  questions: ResearchQuestion[];
  atoms: ResearchAtom[];
  iterations: number;
  costSpent: number;
  budgetExhausted: boolean;
  /** Final confidence that we have enough evidence for a verdict. */
  coverage: number;
  summary: string;
}

const DEFAULT_CONFIG: Required<Omit<InvestigationConfig, 'seedQuestions'>> = {
  maxIterations: 4,
  maxCost: 20,
  targetConfidence: 0.85,
};

/**
 * Build the default seed questions from a subject profile. These
 * are the five canonical investigation threads every UAE AML
 * screening must cover.
 */
export function buildDefaultQuestions(subject: SubjectProfile): ResearchQuestion[] {
  const base: ResearchQuestion[] = [
    {
      id: 'q-sanctions',
      question: `Is "${subject.name}" on any sanctions list (UN, OFAC, EU, UK OFSI, UAE EOCN)?`,
      targets: ['direct_sanctions_hit'],
      cost: 1,
    },
    {
      id: 'q-pep',
      question: `Is "${subject.name}" a PEP, family member of a PEP, or known close associate?`,
      targets: ['pep_status'],
      cost: 2,
    },
    {
      id: 'q-adverse',
      question: `Does adverse media link "${subject.name}" to any FATF predicate offence?`,
      targets: ['adverse_media', 'predicate_offence'],
      cost: 3,
    },
    {
      id: 'q-ubo',
      question: `What entities does "${subject.name}" control or beneficially own (>25%)?`,
      targets: ['ubo_chain', 'shell_risk'],
      cost: 3,
    },
    {
      id: 'q-jurisdiction',
      question: `Does the subject's jurisdiction (${subject.jurisdiction ?? 'unknown'}) appear on any FATF grey/black list?`,
      targets: ['jurisdiction_risk'],
      cost: 1,
    },
  ];
  if (subject.aliases && subject.aliases.length > 0) {
    base.push({
      id: 'q-aliases',
      question: `Do any of the aliases (${subject.aliases.slice(0, 5).join(', ')}) resolve to a different primary name on a list?`,
      targets: ['alias_pivot'],
      cost: 2,
    });
  }
  return base;
}

/**
 * Run the iterative investigation loop. Deterministic: given the same
 * subject and the same searchFn, produces the same transcript.
 */
export async function runInvestigation(
  subject: SubjectProfile,
  searchFn: SearchFn,
  config: InvestigationConfig = {}
): Promise<InvestigationTranscript> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const questions = config.seedQuestions ?? buildDefaultQuestions(subject);
  const atoms: ResearchAtom[] = [];
  let costSpent = 0;
  let iterations = 0;
  let budgetExhausted = false;

  while (iterations < cfg.maxIterations) {
    iterations += 1;
    // Pick the highest-value open question: ones we don't yet have
    // atoms for, cheapest first.
    const remaining = questions.filter((q) => !atoms.some((a) => a.questionId === q.id));
    if (remaining.length === 0) break;
    remaining.sort((a, b) => a.cost - b.cost);

    const next = remaining[0];
    if (costSpent + next.cost > cfg.maxCost) {
      budgetExhausted = true;
      break;
    }
    costSpent += next.cost;

    const hits = await Promise.resolve(searchFn(next, subject));
    for (let i = 0; i < hits.length; i += 1) {
      const h = hits[i];
      atoms.push({
        id: `atom-${next.id}-${i}`,
        questionId: next.id,
        fact: h.fact,
        source: h.source,
        sourceTimestamp: h.sourceTimestamp,
        confidence: clamp01(h.confidence),
      });
    }

    const coverage = computeCoverage(questions, atoms);
    if (coverage >= cfg.targetConfidence) break;
  }

  const coverage = computeCoverage(questions, atoms);
  const summary = buildSummary(subject, questions, atoms, coverage, budgetExhausted);

  return {
    subject,
    questions,
    atoms,
    iterations,
    costSpent,
    budgetExhausted,
    coverage,
    summary,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function computeCoverage(questions: ResearchQuestion[], atoms: ResearchAtom[]): number {
  if (questions.length === 0) return 1;
  let sum = 0;
  for (const q of questions) {
    const qAtoms = atoms.filter((a) => a.questionId === q.id);
    if (qAtoms.length === 0) continue;
    const maxConf = qAtoms.reduce((m, a) => (a.confidence > m ? a.confidence : m), 0);
    sum += maxConf;
  }
  return sum / questions.length;
}

function buildSummary(
  subject: SubjectProfile,
  questions: ResearchQuestion[],
  atoms: ResearchAtom[],
  coverage: number,
  exhausted: boolean
): string {
  const parts: string[] = [];
  parts.push(
    `Subject: ${subject.name}${subject.jurisdiction ? ` (${subject.jurisdiction})` : ''}.`
  );
  parts.push(
    `Investigated ${questions.length} research question(s); extracted ${atoms.length} fact atom(s) with citations.`
  );
  for (const q of questions) {
    const qAtoms = atoms.filter((a) => a.questionId === q.id);
    if (qAtoms.length === 0) {
      parts.push(`- [${q.id}] NO EVIDENCE`);
      continue;
    }
    const top = qAtoms.reduce((best, a) => (a.confidence > best.confidence ? a : best));
    parts.push(
      `- [${q.id}] ${top.fact} — source ${top.source}` +
        (top.sourceTimestamp ? ` (${top.sourceTimestamp})` : '') +
        ` — conf ${top.confidence.toFixed(2)}`
    );
  }
  parts.push(
    `Coverage ${(coverage * 100).toFixed(0)}%${exhausted ? ' (cost budget exhausted)' : ''}.`
  );
  return parts.join('\n');
}

/**
 * Default no-network search function. Returns an empty hit list —
 * callers SHOULD wire in a real search implementation. Provided so
 * the pipeline is composable even without I/O.
 */
export const nullSearchFn: SearchFn = () => [];
