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
  /**
   * ISO date; results before this are excluded. Default: 30 days ago.
   *
   * The 30-day default is tuned for ONGOING MONITORING where you're
   * checking the same subject repeatedly and only care about what's new.
   * Older adverse media was already seen on prior runs. For a one-shot
   * historical onboarding screen, pass a longer window explicitly
   * (e.g. `sinceDate: '2023-01-01'` for a 3-year look).
   */
  sinceDate?: string;
  /** Language hint for the search engine. */
  language?: 'en' | 'ar' | 'fa' | 'ur' | 'hi' | 'zh';
  /** Extra negative exclusion tokens (e.g. for the subject's legitimate domain). */
  negativeExclusions?: string[];
}

/**
 * Token-optimised adverse-media lexicon.
 *
 * The groups exist for code maintainability — at query-build time they
 * are flattened into a single OR list (no per-group parentheses) so the
 * URL-encoded query stays under Google CSE's ~2048 char limit even with
 * a typical subject name. Synonyms, generic noise terms, and overlap-
 * with-existing-terms additions have been deliberately dropped (e.g.
 * "weapons of mass destruction" was dropped because WMD covers it;
 * "fine"/"penalty"/"settlement" were dropped because they fire on every
 * sports/parking news story; "verdict"/"breach"/"jail" were never added
 * for the same reason).
 *
 * Each group's coverage rationale:
 *   1. ML/TF/PF + sanctions list signals (incl. UAE EOCN list)
 *   2. Criminal justice verbs (only the high-signal forms)
 *   3. Financial crime predicate offences (FATF Rec 1-3 schedule)
 *   4. Organised crime + trafficking (FATF Rec 22-23)
 *   5. PEP, kleptocracy, governance integrity (Cabinet Res 134/2025 Art.14)
 *   6. PF / strategic goods / virtual assets (Cabinet Res 156/2025, FATF Rec 15)
 *   7. TF specifics + extremism (FDL Art.29 — never tip off)
 *   8. Document fraud + cybercrime (FATF Rec 16, FDL Art.26-27)
 *   9. UAE regulator name signals (catches local Arabic/English press)
 */
const TYPOLOGY_GROUPS = [
  // 1. ML/TF/PF + sanctions list signals
  // (dropped "UN consolidated" — niche phrasing rarely in adverse media;
  // sanctioned/designated already cover UN-listed entities)
  [
    '"money laundering"',
    '"terrorist financing"',
    '"proliferation financing"',
    '"sanctions evasion"',
    'sanctioned',
    'designated',
    'debarred',
    'blacklisted',
    'OFAC',
    '"UAE local terrorist list"',
  ],
  // 2. Criminal justice verbs (high-signal only — dropped fine/penalty/
  //    settlement/sentenced/cease-and-desist as they generate too much
  //    noise; dropped "deferred prosecution" as it's US-specific legal terminology)
  ['convicted', 'indicted', 'charged', 'prosecuted', 'arrested', '"found guilty"'],
  // 3. Financial crime predicate offences
  [
    'fraud',
    '"financial crime"',
    '"economic crime"',
    'embezzlement',
    'bribery',
    'corruption',
    '"abuse of office"',
    'kickback',
    '"insider trading"',
    '"market manipulation"',
    'Ponzi',
    '"pyramid scheme"',
    '"accounting fraud"',
    '"asset misappropriation"',
    '"tax evasion"',
    '"tax fraud"',
    '"VAT fraud"',
    'blackmail',
    'extort',
  ],
  // 4. Serious organised crime + trafficking
  [
    '"organised crime"',
    'cartel',
    '"drug trafficking"',
    'narcotics',
    '"arms trafficking"',
    '"human trafficking"',
    '"people smuggling"',
    '"wildlife trafficking"',
    '"modern slavery"',
    '"forced labour"',
  ],
  // 5. PEP + kleptocracy + governance integrity
  [
    '"politically exposed"',
    'oligarch',
    'kleptocrat',
    '"state capture"',
    '"conflict of interest"',
    '"misuse of funds"',
  ],
  // 6. PF / strategic / virtual assets (dropped "strategic goods" — overlap
  //    with "dual-use"; dropped full "weapons of mass destruction" — WMD
  //    covers it; dropped "crypto mixer" — VASP is the canonical regulator term)
  [
    '"dual-use"',
    'WMD',
    '"chemical weapons"',
    '"biological weapons"',
    'nuclear',
    '"virtual asset"',
    'VASP',
  ],
  // 7. TF specifics + extremism
  ['extremist', 'radicalisation', 'militant', '"designated terrorist"'],
  // 8. Document fraud + cybercrime (NEW category)
  [
    'forgery',
    'counterfeiting',
    '"identity theft"',
    '"cyber fraud"',
    '"wire fraud"',
    'cybercrime',
    'ransomware',
    'darknet',
  ],
  // 9. UAE regulator signals — most important for UAE-based subjects
  // (dropped "Cabinet Resolution 74"/"134" — adverse media rarely cites
  // them by number; EOCN + Ministry of Economy + goAML cover the same
  // regulatory signal space more efficiently)
  ['MoE', '"Ministry of Economy"', '"Central Bank of the UAE"', 'goAML', 'EOCN', 'CNMR'],
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
 * Build the boolean adverse-media search query.
 *
 * Output shape:
 *   "Subject Name" (term1 OR term2 OR ... OR termN) -neg1 -neg2 ... after:YYYY-MM-DD
 *
 * Structural guarantees (tested in adverseMediaSearch.test.ts):
 *   - Subject anchored as a quoted phrase (precision)
 *   - Typology terms wrapped in a single OR group (no per-group parens
 *     — flattened to save URL chars; semantically equivalent to nested
 *     OR groupings since OR is associative)
 *   - Default negative exclusions filter out sports/entertainment noise
 *   - Date filter caps the search window (default 30 days — tuned for
 *     ongoing monitoring; pass `sinceDate` for historical screens)
 *
 * Length budget: the URL-encoded result stays under Google CSE's ~2048
 * char limit for typical subject names (under 30 chars). For longer
 * names or more aggressive coverage, prefer Brave Search or SerpAPI as
 * the upstream provider.
 */
export function buildAdverseMediaQuery(subject: string, options: SearchPromptOptions = {}): string {
  if (!subject || subject.trim().length === 0) {
    throw new Error('buildAdverseMediaQuery: subject is required');
  }

  const sinceDate =
    options.sinceDate ??
    (() => {
      // Default 30-day lookback — tuned for ongoing monitoring where
      // the same subject is checked repeatedly and only new news matters.
      // Older hits were already seen on prior runs. Callers doing a
      // one-shot historical onboarding screen should pass sinceDate
      // explicitly (e.g. '2023-01-01' for a 3-year look).
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();

  // Flatten all groups into a single OR list. Inner per-group parens were
  // removed to save ~80 URL-encoded chars without changing semantics
  // (OR is associative — `(a OR b) OR (c OR d)` ≡ `a OR b OR c OR d`).
  const typology = TYPOLOGY_GROUPS.flat().join(' OR ');
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
  options: SearchPromptOptions = {}
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
  refId: string
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
