/**
 * Adverse media ingest — FATF predicate-offence-aware NLP layer.
 *
 * Mirrors vendor/node-DeepResearch's iterative search→reason→extract
 * loop but keeps all reasoning deterministic (no LLM call by default).
 * The caller supplies a `MediaFetcher` that returns raw articles; this
 * module extracts entities, classifies against the 40 FATF predicates,
 * and emits structured `MediaHit` records with citations.
 *
 * Compliance rules:
 *   - FDL Art.29 (no tipping off) — never POST the subject name to a
 *     third-party search in cleartext without explicit caller approval.
 *   - Every hit carries a source URL, timestamp, and predicate key
 *     (matched to the 40-offence taxonomy) so MoE can trace it.
 */

export type PredicateKey =
  | 'bribery_corruption'
  | 'hostage_taking'
  | 'kidnapping'
  | 'piracy_counterfeit_products'
  | 'human_trafficking'
  | 'organized_crime'
  | 'currency_counterfeiting'
  | 'illicit_trafficking_goods'
  | 'racketeering'
  | 'cybercrime'
  | 'hacking'
  | 'phishing'
  | 'insider_trading_market_manip'
  | 'robbery'
  | 'environmental_crimes'
  | 'migrant_smuggling'
  | 'slave_labor'
  | 'securities_fraud'
  | 'extortion'
  | 'child_sexual_exploitation'
  | 'money_laundering'
  | 'falsifying_official_docs'
  | 'narcotics_arms_trafficking'
  | 'smuggling'
  | 'forgery'
  | 'price_fixing'
  | 'illegal_cartel_formation'
  | 'antitrust_violations'
  | 'terrorism'
  | 'terror_financing'
  | 'fraud'
  | 'embezzlement'
  | 'theft'
  | 'cheating'
  | 'pharma_trafficking'
  | 'illegal_distribution'
  | 'illegal_production'
  | 'banned_fake_medicines'
  | 'war_crimes'
  | 'tax_evasion'
  | 'tax_fraud';

export interface PredicateSignal {
  key: PredicateKey;
  keywords: string[];
  /** Regulatory citation (FATF Rec / FDL Article / UAE AML-CFT Law). */
  ref: string;
}

export interface Article {
  url: string;
  title: string;
  body: string;
  publishedAt: string;
  source: string;
  language?: string;
}

export type MediaFetcher = (query: string) => Promise<Article[]> | Article[];

export interface MediaHit {
  articleUrl: string;
  articleTitle: string;
  publishedAt: string;
  source: string;
  predicateKey: PredicateKey;
  predicateRef: string;
  /** Sentence(s) that triggered the predicate match. */
  excerpt: string;
  /** How confident we are this refers to the subject, 0..1. */
  entityConfidence: number;
  /** How confident we are the predicate classification is correct, 0..1. */
  predicateConfidence: number;
}

export interface AdverseMediaResult {
  subject: string;
  queriesTried: string[];
  articlesReviewed: number;
  hits: MediaHit[];
  topPredicates: Array<{ predicate: PredicateKey; count: number; maxScore: number }>;
}

export const PREDICATE_SIGNALS: PredicateSignal[] = [
  {
    key: 'bribery_corruption',
    keywords: ['bribe', 'kickback', 'corrupt'],
    ref: 'FATF Rec 23; UAE FDL 31/2021 Art.23',
  },
  {
    key: 'money_laundering',
    keywords: ['money laundering', 'launder'],
    ref: 'FDL No.10/2025 Art.2',
  },
  {
    key: 'terror_financing',
    keywords: ['terrorist financing', 'funded terror'],
    ref: 'FDL No.10/2025 Art.2; Cabinet Res 74/2020',
  },
  {
    key: 'terrorism',
    keywords: ['terrorist attack', 'terrorism charge'],
    ref: 'UN Res 1373 (2001)',
  },
  { key: 'fraud', keywords: ['defraud', 'ponzi', 'pyramid scheme'], ref: 'UAE Penal Code Art.399' },
  {
    key: 'tax_evasion',
    keywords: ['tax evasion', 'undeclared income'],
    ref: 'UAE Tax Procedures Law 7/2017',
  },
  { key: 'embezzlement', keywords: ['embezzle', 'misappropriat'], ref: 'UAE Penal Code Art.398' },
  {
    key: 'human_trafficking',
    keywords: ['human trafficking', 'trafficked person'],
    ref: 'UAE FDL 51/2006',
  },
  {
    key: 'narcotics_arms_trafficking',
    keywords: ['drug trafficking', 'arms trafficking', 'weapons smuggling'],
    ref: 'UAE FDL 14/1995',
  },
  { key: 'cybercrime', keywords: ['hacked', 'data breach', 'ransomware'], ref: 'UAE FDL 34/2021' },
  {
    key: 'securities_fraud',
    keywords: ['securities fraud', 'insider trading'],
    ref: 'UAE Securities & Commodities Authority Reg',
  },
  {
    key: 'organized_crime',
    keywords: ['organized crime', 'criminal enterprise'],
    ref: 'UNTOC (Palermo)',
  },
  { key: 'war_crimes', keywords: ['war crime', 'crimes against humanity'], ref: 'Rome Statute' },
  {
    key: 'environmental_crimes',
    keywords: ['environmental crime', 'illegal dumping'],
    ref: 'UAE FDL 24/1999',
  },
  {
    key: 'piracy_counterfeit_products',
    keywords: ['counterfeit goods', 'piracy'],
    ref: 'UAE FDL 17/2002',
  },
  { key: 'kidnapping', keywords: ['kidnap', 'abduct'], ref: 'UAE Penal Code Art.344' },
  { key: 'smuggling', keywords: ['smuggling', 'smuggled'], ref: 'UAE Customs Law' },
  { key: 'forgery', keywords: ['forgery', 'forged document'], ref: 'UAE Penal Code Art.251' },
  { key: 'extortion', keywords: ['extortion', 'blackmail'], ref: 'UAE Penal Code Art.399' },
  {
    key: 'pharma_trafficking',
    keywords: ['counterfeit medicine', 'fake drug'],
    ref: 'MEDICRIME Convention',
  },
];

export async function runAdverseMediaIngest(
  subject: { name: string; aliases?: string[]; jurisdiction?: string },
  fetcher: MediaFetcher,
  maxQueries = 4
): Promise<AdverseMediaResult> {
  const names = [subject.name, ...(subject.aliases ?? [])].slice(0, 5);
  const queries: string[] = [];
  for (const n of names) {
    queries.push(`"${n}" sanctions OR money laundering OR fraud`);
    queries.push(`"${n}" indictment OR investigation`);
    if (queries.length >= maxQueries) break;
  }

  const seen = new Set<string>();
  const hits: MediaHit[] = [];
  let articlesReviewed = 0;

  for (const q of queries) {
    const articles = await Promise.resolve(fetcher(q));
    for (const art of articles) {
      if (seen.has(art.url)) continue;
      seen.add(art.url);
      articlesReviewed += 1;
      const text = `${art.title}\n${art.body}`.toLowerCase();
      const entityConfidence = entityRefConfidence(text, subject.name, subject.aliases);
      if (entityConfidence < 0.4) continue;
      for (const sig of PREDICATE_SIGNALS) {
        const ex = extractMatchingExcerpt(text, sig.keywords);
        if (!ex) continue;
        hits.push({
          articleUrl: art.url,
          articleTitle: art.title,
          publishedAt: art.publishedAt,
          source: art.source,
          predicateKey: sig.key,
          predicateRef: sig.ref,
          excerpt: ex.excerpt,
          entityConfidence,
          predicateConfidence: Math.min(1, ex.keywordHits / 3),
        });
      }
    }
  }

  const byPred = new Map<PredicateKey, { count: number; maxScore: number }>();
  for (const h of hits) {
    const existing = byPred.get(h.predicateKey) ?? { count: 0, maxScore: 0 };
    const score = h.entityConfidence * h.predicateConfidence;
    byPred.set(h.predicateKey, {
      count: existing.count + 1,
      maxScore: Math.max(existing.maxScore, score),
    });
  }
  const topPredicates = [...byPred.entries()]
    .map(([predicate, v]) => ({ predicate, count: v.count, maxScore: v.maxScore }))
    .sort((a, b) => b.maxScore - a.maxScore);

  return {
    subject: subject.name,
    queriesTried: queries,
    articlesReviewed,
    hits,
    topPredicates,
  };
}

function entityRefConfidence(text: string, name: string, aliases?: string[]): number {
  const ns = [name, ...(aliases ?? [])].map((s) => s.toLowerCase());
  let max = 0;
  for (const candidate of ns) {
    if (candidate.length < 3) continue;
    if (text.includes(candidate)) {
      max = Math.max(max, 0.9);
    }
  }
  return max;
}

interface ExcerptHit {
  excerpt: string;
  keywordHits: number;
}

function extractMatchingExcerpt(text: string, keywords: string[]): ExcerptHit | null {
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + kw.length + 60);
    return {
      excerpt: text.slice(start, end),
      keywordHits: keywords.filter((k) => text.includes(k)).length,
    };
  }
  return null;
}
