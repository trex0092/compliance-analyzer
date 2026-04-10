/**
 * Adverse Media Ranker.
 *
 * Raw adverse media search results are noisy. Given a set of hits for
 * an entity name, this module ranks them by regulatory salience so
 * the MLRO reviews the most important first.
 *
 * Salience factors:
 *
 *  1. CRIME CATEGORY — criminal investigations > civil proceedings >
 *     industry gossip. We use a simple keyword classifier with a
 *     published category-weight table.
 *  2. NAME SPECIFICITY — headline contains the FULL entity name + a
 *     disambiguator (city, nationality, industry) outranks first-name-
 *     only matches.
 *  3. SOURCE CREDIBILITY — tier-1 outlets (Reuters, AP, BBC, major
 *     regulators) outrank blogs and aggregators.
 *  4. RECENCY — newer hits outrank older ones (half-life = 365 days).
 *  5. LANGUAGE CONFIDENCE — if we can detect the language of the hit
 *     and it is one we handle, credibility is higher.
 *
 * The output is a ranked list with a `saliencyScore` in [0, 1] and an
 * `impactCategory` ∈ {critical, material, ambient, low-signal}.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing monitoring, adverse media as input)
 *   - Cabinet Res 134/2025 Art.14 (PEP + EDD monitoring)
 *   - FDL Art.19 (risk-based internal review)
 */

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface AdverseMediaHit {
  id: string;
  entityNameQueried: string;
  headline: string;
  snippet?: string;
  sourceDomain: string;
  publishedAtIso?: string;
  language?: string;
}

export type ImpactCategory = 'critical' | 'material' | 'ambient' | 'low-signal';

export interface RankedHit {
  hit: AdverseMediaHit;
  saliencyScore: number;
  impactCategory: ImpactCategory;
  factors: {
    crimeCategoryScore: number;
    nameSpecificityScore: number;
    sourceCredibilityScore: number;
    recencyScore: number;
    languageScore: number;
  };
  reasons: string[];
}

export interface AdverseMediaReport {
  ranked: RankedHit[];
  counts: Record<ImpactCategory, number>;
  topCategory: ImpactCategory;
}

// ---------------------------------------------------------------------------
// Keyword tables (conservative, explainable, no ML)
// ---------------------------------------------------------------------------

const CRIMINAL_KEYWORDS = [
  'money laundering',
  'terrorism',
  'terror financing',
  'proliferation financing',
  'sanctions evasion',
  'sanctions violation',
  'fraud',
  'bribery',
  'corruption',
  'embezzlement',
  'smuggling',
  'drug trafficking',
  'human trafficking',
  'arrested',
  'indicted',
  'charged',
  'convicted',
  'arraigned',
  'prosecuted',
  'interpol',
  'red notice',
  'ofac',
];

const CIVIL_KEYWORDS = [
  'lawsuit',
  'settled',
  'damages',
  'class action',
  'breach of contract',
  'arbitration',
  'civil penalty',
];

const REGULATORY_KEYWORDS = [
  'fined',
  'penalty',
  'enforcement action',
  'consent order',
  'censure',
  'suspended',
  'struck off',
  'license revoked',
];

const TIER1_DOMAINS = new Set([
  'reuters.com',
  'ap.org',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'ft.com',
  'wsj.com',
  'bloomberg.com',
  'eocn.gov.ae',
  'centralbank.ae',
  'ofac.treasury.gov',
  'sanctionslist.ofac.treas.gov',
  'fatf-gafi.org',
  'un.org',
]);

const TIER2_DOMAINS = new Set([
  'nytimes.com',
  'theguardian.com',
  'economist.com',
  'thenationalnews.com',
  'gulfnews.com',
  'khaleejtimes.com',
]);

// ---------------------------------------------------------------------------
// Feature scoring
// ---------------------------------------------------------------------------

function containsAny(text: string, needles: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return needles.filter((n) => lower.includes(n));
}

function crimeCategoryScore(text: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const criminalHits = containsAny(text, CRIMINAL_KEYWORDS);
  const civilHits = containsAny(text, CIVIL_KEYWORDS);
  const regHits = containsAny(text, REGULATORY_KEYWORDS);
  let score = 0;
  if (criminalHits.length > 0) {
    score = 1;
    reasons.push(`criminal keywords: ${criminalHits.slice(0, 3).join(', ')}`);
  } else if (regHits.length > 0) {
    score = 0.7;
    reasons.push(`regulatory keywords: ${regHits.slice(0, 3).join(', ')}`);
  } else if (civilHits.length > 0) {
    score = 0.4;
    reasons.push(`civil keywords: ${civilHits.slice(0, 3).join(', ')}`);
  } else {
    score = 0.1;
    reasons.push('no criminal/regulatory keywords detected');
  }
  return { score, reasons };
}

function nameSpecificityScore(
  entityName: string,
  text: string
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const nameTokens = entityName.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const hits = nameTokens.filter((t) => t.length >= 3 && lower.includes(t));
  const fullNameIncluded = lower.includes(entityName.toLowerCase());
  if (fullNameIncluded) {
    reasons.push('full entity name found');
    return { score: 1, reasons };
  }
  if (nameTokens.length === 0) return { score: 0.2, reasons: ['empty entity name'] };
  const ratio = hits.length / nameTokens.length;
  reasons.push(`${hits.length}/${nameTokens.length} name tokens matched`);
  return { score: ratio, reasons };
}

function sourceCredibilityScore(domain: string): { score: number; reasons: string[] } {
  const lower = domain.toLowerCase().replace(/^www\./, '');
  if (TIER1_DOMAINS.has(lower)) return { score: 1, reasons: [`tier-1 source: ${lower}`] };
  if (TIER2_DOMAINS.has(lower)) return { score: 0.75, reasons: [`tier-2 source: ${lower}`] };
  return { score: 0.4, reasons: [`unclassified source: ${lower}`] };
}

function recencyScore(
  publishedAtIso: string | undefined,
  now: Date
): { score: number; reasons: string[] } {
  if (!publishedAtIso) return { score: 0.5, reasons: ['no publication date'] };
  const published = Date.parse(publishedAtIso);
  if (!Number.isFinite(published)) return { score: 0.5, reasons: ['invalid publication date'] };
  const ageDays = (now.getTime() - published) / (24 * 60 * 60 * 1000);
  if (ageDays < 0) return { score: 1, reasons: ['future date treated as present'] };
  // Half-life of 365 days.
  const score = Math.pow(0.5, ageDays / 365);
  return {
    score: Math.max(0.1, score),
    reasons: [`age=${Math.round(ageDays)}d, recency=${score.toFixed(2)}`],
  };
}

function languageScore(lang: string | undefined): { score: number; reasons: string[] } {
  if (!lang) return { score: 0.7, reasons: ['unknown language'] };
  if (['en', 'ar', 'fr', 'es'].includes(lang.toLowerCase())) {
    return { score: 1, reasons: [`supported language: ${lang}`] };
  }
  return { score: 0.6, reasons: [`unsupported language: ${lang}`] };
}

// ---------------------------------------------------------------------------
// Rank + classify
// ---------------------------------------------------------------------------

const WEIGHTS = {
  crime: 0.45,
  nameSpec: 0.2,
  source: 0.15,
  recency: 0.1,
  language: 0.1,
};

function categoryFromScore(score: number): ImpactCategory {
  if (score >= 0.75) return 'critical';
  if (score >= 0.55) return 'material';
  if (score >= 0.35) return 'ambient';
  return 'low-signal';
}

export function rankAdverseMedia(
  hits: readonly AdverseMediaHit[],
  options: { now?: Date } = {}
): AdverseMediaReport {
  const now = options.now ?? new Date();
  const ranked: RankedHit[] = hits.map((hit) => {
    const text = `${hit.headline} ${hit.snippet ?? ''}`;
    const crime = crimeCategoryScore(text);
    const name = nameSpecificityScore(hit.entityNameQueried, text);
    const source = sourceCredibilityScore(hit.sourceDomain);
    const recency = recencyScore(hit.publishedAtIso, now);
    const lang = languageScore(hit.language);
    const score =
      WEIGHTS.crime * crime.score +
      WEIGHTS.nameSpec * name.score +
      WEIGHTS.source * source.score +
      WEIGHTS.recency * recency.score +
      WEIGHTS.language * lang.score;
    return {
      hit,
      saliencyScore: round4(score),
      impactCategory: categoryFromScore(score),
      factors: {
        crimeCategoryScore: round4(crime.score),
        nameSpecificityScore: round4(name.score),
        sourceCredibilityScore: round4(source.score),
        recencyScore: round4(recency.score),
        languageScore: round4(lang.score),
      },
      reasons: [
        ...crime.reasons,
        ...name.reasons,
        ...source.reasons,
        ...recency.reasons,
        ...lang.reasons,
      ],
    };
  });

  ranked.sort((a, b) => b.saliencyScore - a.saliencyScore);

  const counts: Record<ImpactCategory, number> = {
    critical: 0,
    material: 0,
    ambient: 0,
    'low-signal': 0,
  };
  for (const r of ranked) counts[r.impactCategory]++;

  const topCategory: ImpactCategory =
    counts.critical > 0
      ? 'critical'
      : counts.material > 0
        ? 'material'
        : counts.ambient > 0
          ? 'ambient'
          : 'low-signal';

  return { ranked, counts, topCategory };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
