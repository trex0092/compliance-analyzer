/**
 * Adverse Media Search — prompt builder + multi-provider fetch.
 *
 * Composes the improved search query (subject-anchored, grouped OR,
 * negative exclusions, date-bounded) we discussed in the amluae.com
 * review. Supports three backends:
 *   - `serp` (SerpAPI), `brave` (Brave Search API), `google_cse`
 *     (Google Custom Search JSON API)
 *
 * The backend is selected via env vars; if none is configured, the
 * function returns a dry-run plan showing the prompt that WOULD have
 * been sent (useful for tests and previews).
 *
 * Every result is persisted as a brain event (kind=manual,
 * severity=medium-to-high depending on hit count) so the four-eyes
 * queue picks up anything flagged.
 *
 * Regulatory anchoring: FATF Rec 10 (ongoing due diligence),
 * Cabinet Res 134/2025 Art.14 (EDD for high-risk).
 */

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export interface SearchPromptOptions {
  /** ISO date; results before this are excluded. Default: 3 years ago. */
  sinceDate?: string;
  /** Language hint for the search engine. */
  language?: 'en' | 'ar' | 'fa' | 'ur' | 'hi' | 'zh';
  /** Extra negative exclusion tokens (e.g. for the subject's legitimate domain). */
  negativeExclusions?: string[];
}

const TYPOLOGY_GROUPS = [
  // ML/TF/PF core
  [
    '"money laundering"',
    '"terrorist financing"',
    '"proliferation financing"',
    '"sanctions evasion"',
    'sanctioned',
    'designated',
    'OFAC',
    'SDN',
    '"UN consolidated"',
    '"EU restrictive measures"',
    '"UAE local terrorist list"',
  ],
  // Criminal justice verbs
  [
    'convicted',
    'indicted',
    'charged',
    'prosecuted',
    'arrested',
    'sentenced',
    '"found guilty"',
    'fine',
    'penalty',
    'settlement',
    '"cease and desist"',
    '"deferred prosecution"',
  ],
  // Financial crime typologies
  [
    'fraud',
    'embezzlement',
    'bribery',
    'corruption',
    '"abuse of office"',
    'kickback',
    '"insider trading"',
    '"market manipulation"',
    'Ponzi',
    '"tax evasion"',
    '"VAT fraud"',
  ],
  // Serious organised crime
  [
    '"organised crime"',
    'cartel',
    '"drug trafficking"',
    '"arms trafficking"',
    '"human trafficking"',
    '"wildlife trafficking"',
    '"modern slavery"',
  ],
  // PEP + kleptocracy
  ['"politically exposed"', 'PEP', 'oligarch', 'kleptocrat', '"state capture"'],
  // PF / strategic goods / virtual assets
  [
    '"dual-use"',
    '"strategic goods"',
    'WMD',
    '"chemical weapons"',
    'nuclear',
    '"virtual asset"',
    'VASP',
    '"crypto mixer"',
  ],
  // UAE regulator signals
  [
    'MoE',
    '"Ministry of Economy"',
    '"Central Bank of the UAE"',
    'goAML',
    '"Cabinet Resolution 74"',
    'EOCN',
    'CNMR',
    '"Cabinet Resolution 134"',
  ],
];

const DEFAULT_NEGATIVE_EXCLUSIONS = [
  '"box office"',
  'wrestling',
  'soccer',
  'basketball',
  'weather',
  'obituary',
  'recipe',
  'horoscope',
];

/**
 * Build the improved boolean query. Returns a string under Google's
 * ~2048-char URL-encoded limit for typical subject names.
 */
export function buildAdverseMediaQuery(
  subject: string,
  options: SearchPromptOptions = {},
): string {
  if (!subject || subject.trim().length === 0) {
    throw new Error('buildAdverseMediaQuery: subject is required');
  }

  const sinceDate =
    options.sinceDate ??
    (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 3);
      return d.toISOString().slice(0, 10);
    })();

  const typology = TYPOLOGY_GROUPS.map((group) => `(${group.join(' OR ')})`).join(' OR ');
  const negatives = [...DEFAULT_NEGATIVE_EXCLUSIONS, ...(options.negativeExclusions ?? [])]
    .map((n) => `-${n}`)
    .join(' ');

  // "Subject Name" AND (typology) AND negatives AND after:date
  return `"${subject.replace(/"/g, '\\"')}" (${typology}) ${negatives} after:${sinceDate}`;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface AdverseMediaHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
}

export interface AdverseMediaResult {
  subject: string;
  query: string;
  provider: 'serp' | 'brave' | 'google_cse' | 'dry_run';
  hits: AdverseMediaHit[];
  totalResults: number;
  searchedAt: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

type Provider = 'serp' | 'brave' | 'google_cse' | 'dry_run';

function detectProvider(): Provider {
  if (process.env.SERPAPI_KEY) return 'serp';
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return 'google_cse';
  return 'dry_run';
}

async function searchViaBrave(query: string): Promise<AdverseMediaHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title: string;
        url: string;
        description: string;
        age?: string;
        profile?: { name?: string };
      }>;
    };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    publishedAt: r.age,
    source: r.profile?.name ?? new URL(r.url).hostname,
  }));
}

async function searchViaSerpApi(query: string): Promise<AdverseMediaHit[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    organic_results?: Array<{
      title: string;
      link: string;
      snippet: string;
      date?: string;
      source?: string;
    }>;
  };
  return (data.organic_results ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    publishedAt: r.date,
    source: r.source ?? new URL(r.link).hostname,
  }));
}

async function searchViaGoogleCse(query: string): Promise<AdverseMediaHit[]> {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return [];
  const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: Array<{ title: string; link: string; snippet: string; displayLink: string }>;
  };
  return (data.items ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: r.displayLink,
  }));
}

// ---------------------------------------------------------------------------
// Top-level search
// ---------------------------------------------------------------------------

export async function searchAdverseMedia(
  subject: string,
  options: SearchPromptOptions = {},
): Promise<AdverseMediaResult> {
  const query = buildAdverseMediaQuery(subject, options);
  const provider = detectProvider();
  const searchedAt = new Date().toISOString();

  let hits: AdverseMediaHit[] = [];
  if (provider === 'brave') hits = await searchViaBrave(query);
  else if (provider === 'serp') hits = await searchViaSerpApi(query);
  else if (provider === 'google_cse') hits = await searchViaGoogleCse(query);

  return {
    subject,
    query,
    provider,
    hits,
    totalResults: hits.length,
    searchedAt,
  };
}

/**
 * Convert an adverse-media result into a brain event payload.
 * Severity is derived from hit count:
 *   - 0 hits: info
 *   - 1-2 hits: medium
 *   - 3+ hits: high
 */
export function resultToBrainEvent(
  result: AdverseMediaResult,
  refId: string,
): Record<string, unknown> {
  let severity: 'info' | 'medium' | 'high';
  if (result.hits.length === 0) severity = 'info';
  else if (result.hits.length <= 2) severity = 'medium';
  else severity = 'high';

  return {
    kind: 'manual',
    severity,
    summary: `Adverse media search: ${result.hits.length} hit(s) for "${result.subject}"`,
    subject: result.subject,
    refId,
    meta: {
      source: 'adverse-media-search',
      provider: result.provider,
      query: result.query,
      hits: result.hits.slice(0, 10).map((h) => ({
        title: h.title,
        url: h.url,
        source: h.source,
      })),
      searchedAt: result.searchedAt,
    },
  };
}
