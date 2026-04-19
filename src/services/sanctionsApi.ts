/**
 * Real Sanctions API Connector
 *
 * Connects to actual, publicly available sanctions list APIs.
 * Replaces AI-simulated screening with real data.
 *
 * Sources:
 * - UN Consolidated Sanctions: https://scsanctions.un.org/resources/xml/en/consolidated.xml
 * - OFAC SDN: https://sanctionslistservice.ofac.treas.gov/api (requires no auth)
 * - EU Consolidated: https://webgate.ec.europa.eu/fsd/fsf (public)
 *
 * Note: These are fetched via the Netlify proxy to avoid CORS issues.
 */

import { normalize, similarity, FUZZY_MATCH_THRESHOLD } from '../utils/fuzzyMatch';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

export interface SanctionsEntry {
  id: string;
  name: string;
  aliases: string[];
  listSource: string;
  listDate?: string;
  type: 'individual' | 'entity';
  nationality?: string;
  designationRef?: string;
}

export interface ScreeningResult {
  entityName: string;
  screenedAt: string;
  listsChecked: string[];
  matches: SanctionsMatch[];
  totalEntriesChecked: number;
}

export interface SanctionsMatch {
  matchedName: string;
  listSource: string;
  confidence: number;
  entryId: string;
  type: 'individual' | 'entity';
  designationRef?: string;
}

/**
 * Fetch the UN Consolidated Sanctions List (XML).
 * This is the definitive global sanctions list — free, public, no auth.
 */
export async function fetchUNSanctionsList(
  proxyUrl?: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<SanctionsEntry[]> {
  const UN_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
  const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(UN_URL)}` : UN_URL;

  const response = await fetchWithTimeout(url, {
    timeoutMs: opts?.timeoutMs ?? 30_000,
    signal: opts?.signal,
  });
  if (!response.ok) throw new Error(`UN API returned ${response.status}`);

  const xmlText = await response.text();
  return parseUNXml(xmlText, opts?.signal);
}

/**
 * Yield control back to the Node event loop. Used between chunks of a
 * long synchronous XML parse so that setTimeout-based abort and hard
 * timers inside screening-run.mts can actually fire. Without these
 * yields a 5 MB UN or EU payload can block the event loop for 10+
 * seconds, silently pushing the whole function past Netlify's 10 s
 * sync ceiling — which surfaces to the browser as
 * "Stream idle timeout - partial response received" even though the
 * upstream fetch completed cleanly. The yield itself costs ~0 ms but
 * it is what lets the clock actually tick.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const si = (globalThis as { setImmediate?: (cb: () => void) => unknown }).setImmediate;
    if (typeof si === 'function') {
      si(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Throw an AbortError if the signal is aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Iterate all non-overlapping occurrences of `<tag>...</tag>` in `xml`
 * using indexOf instead of a global regex. Avoids the pathological
 * backtracking cost of `/<tag>[\s\S]*?<\/tag>/g` on a 5 MB string,
 * which is the primary driver of the EU-parser event-loop stall.
 */
function* iterateBlocks(xml: string, tag: string): IterableIterator<string> {
  const openLower = `<${tag.toLowerCase()}`;
  const closeLower = `</${tag.toLowerCase()}>`;
  const xmlLower = xml.toLowerCase();
  let cursor = 0;
  while (cursor < xmlLower.length) {
    const openIdx = xmlLower.indexOf(openLower, cursor);
    if (openIdx === -1) return;
    // Ensure we match `<tag ` or `<tag>` — not `<tagOther>`.
    const afterTag = xmlLower.charCodeAt(openIdx + openLower.length);
    // ' ' (0x20), '>' (0x3e), '/' (0x2f), '\t' (0x09), '\n' (0x0a), '\r' (0x0d)
    if (
      afterTag !== 0x20 &&
      afterTag !== 0x3e &&
      afterTag !== 0x2f &&
      afterTag !== 0x09 &&
      afterTag !== 0x0a &&
      afterTag !== 0x0d
    ) {
      cursor = openIdx + openLower.length;
      continue;
    }
    const closeIdx = xmlLower.indexOf(closeLower, openIdx + openLower.length);
    if (closeIdx === -1) return;
    const blockEnd = closeIdx + closeLower.length;
    yield xml.slice(openIdx, blockEnd);
    cursor = blockEnd;
  }
}

/** How many blocks to parse between event-loop yields. */
const PARSE_YIELD_EVERY = 100;

/**
 * Parse UN Consolidated Sanctions XML into structured entries.
 * Async + signal-aware so abort timers in the caller can fire while
 * we're chewing through the payload.
 */
async function parseUNXml(xml: string, signal?: AbortSignal): Promise<SanctionsEntry[]> {
  const entries: SanctionsEntry[] = [];
  let parsed = 0;
  // Parse INDIVIDUAL entries
  for (const block of iterateBlocks(xml, 'INDIVIDUAL')) {
    throwIfAborted(signal);
    if (parsed > 0 && parsed % PARSE_YIELD_EVERY === 0) await yieldToEventLoop();
    parsed++;
    const id = extractTag(block, 'DATAID') || extractTag(block, 'REFERENCE_NUMBER') || '';
    const firstName = extractTag(block, 'FIRST_NAME') || '';
    const secondName = extractTag(block, 'SECOND_NAME') || '';
    const thirdName = extractTag(block, 'THIRD_NAME') || '';
    const name = [firstName, secondName, thirdName].filter(Boolean).join(' ').trim();
    const aliases = extractAllTags(block, 'ALIAS_NAME');
    const nationality = extractTag(block, 'NATIONALITY_VALUE') || undefined;
    const listed = extractTag(block, 'LISTED_ON') || undefined;

    if (name) {
      entries.push({
        id: `UN-IND-${id}`,
        name,
        aliases,
        listSource: 'UN Consolidated Sanctions',
        listDate: listed,
        type: 'individual',
        nationality,
        designationRef: extractTag(block, 'UN_LIST_TYPE') || undefined,
      });
    }
  }

  // Parse ENTITY entries
  for (const block of iterateBlocks(xml, 'ENTITY')) {
    throwIfAborted(signal);
    if (parsed > 0 && parsed % PARSE_YIELD_EVERY === 0) await yieldToEventLoop();
    parsed++;
    const id = extractTag(block, 'DATAID') || extractTag(block, 'REFERENCE_NUMBER') || '';
    const name = extractTag(block, 'FIRST_NAME') || '';
    const aliases = extractAllTags(block, 'ALIAS_NAME');
    const listed = extractTag(block, 'LISTED_ON') || undefined;

    if (name) {
      entries.push({
        id: `UN-ENT-${id}`,
        name,
        aliases,
        listSource: 'UN Consolidated Sanctions',
        listDate: listed,
        type: 'entity',
        designationRef: extractTag(block, 'UN_LIST_TYPE') || undefined,
      });
    }
  }

  return entries;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTag(xml: string, tag: string): string | null {
  const safeTag = escapeRegex(tag);
  const match = xml.match(new RegExp(`<${safeTag}>([^<]*)</${safeTag}>`));
  return match ? match[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const safeTag = escapeRegex(tag);
  const matches = xml.match(new RegExp(`<${safeTag}>([^<]*)</${safeTag}>`, 'g')) || [];
  return matches
    .map((m) => m.replace(new RegExp(`</?${safeTag}>`, 'g'), '').trim())
    .filter(Boolean);
}

/**
 * Screen an entity name against a list of sanctions entries.
 * Uses fuzzy matching (normalized, case-insensitive, alias-checked).
 */
export function screenAgainstList(entityName: string, entries: SanctionsEntry[]): SanctionsMatch[] {
  const matches: SanctionsMatch[] = [];
  const normalized = normalize(entityName);

  for (const entry of entries) {
    // Check primary name
    const nameScore = similarity(normalized, normalize(entry.name));
    if (nameScore >= FUZZY_MATCH_THRESHOLD) {
      matches.push({
        matchedName: entry.name,
        listSource: entry.listSource,
        confidence: Math.round(nameScore * 100) / 100,
        entryId: entry.id,
        type: entry.type,
        designationRef: entry.designationRef,
      });
      continue;
    }

    // Check aliases
    for (const alias of entry.aliases) {
      const aliasScore = similarity(normalized, normalize(alias));
      if (aliasScore >= FUZZY_MATCH_THRESHOLD) {
        matches.push({
          matchedName: `${entry.name} (alias: ${alias})`,
          listSource: entry.listSource,
          confidence: Math.round(aliasScore * 100) / 100,
          entryId: entry.id,
          type: entry.type,
          designationRef: entry.designationRef,
        });
        break;
      }
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Fetch the OFAC SDN (Specially Designated Nationals) list (XML).
 * Maintained by the US Treasury — free, public, no auth.
 */
export async function fetchOFACSanctionsList(
  proxyUrl?: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<SanctionsEntry[]> {
  const OFAC_URL =
    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
  const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(OFAC_URL)}` : OFAC_URL;

  const response = await fetchWithTimeout(url, {
    timeoutMs: opts?.timeoutMs ?? 30_000,
    signal: opts?.signal,
  });
  if (!response.ok) throw new Error(`OFAC API returned ${response.status}`);

  const xmlText = await response.text();
  return parseOFACXml(xmlText);
}

/**
 * Parse OFAC SDN XML into structured entries.
 */
function parseOFACXml(xml: string): SanctionsEntry[] {
  const entries: SanctionsEntry[] = [];
  const sdnBlocks = xml.match(/<sdnEntry>[\s\S]*?<\/sdnEntry>/gi) || [];

  for (const block of sdnBlocks) {
    const uid = extractTag(block, 'uid') || '';
    const lastName = extractTag(block, 'lastName') || '';
    const firstName = extractTag(block, 'firstName') || '';
    const sdnType = extractTag(block, 'sdnType') || '';

    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (!name) continue;

    // Extract aliases from <akaList><aka><lastName>...</lastName></aka></akaList>
    const akaListMatch = block.match(/<akaList>[\s\S]*?<\/akaList>/i);
    const aliases: string[] = [];
    if (akaListMatch) {
      const akaBlocks = akaListMatch[0].match(/<aka>[\s\S]*?<\/aka>/gi) || [];
      for (const aka of akaBlocks) {
        const akaFirst = extractTag(aka, 'firstName') || '';
        const akaLast = extractTag(aka, 'lastName') || '';
        const aliasName = [akaFirst, akaLast].filter(Boolean).join(' ').trim();
        if (aliasName) aliases.push(aliasName);
      }
    }

    const type: 'individual' | 'entity' =
      sdnType.toLowerCase() === 'individual' ? 'individual' : 'entity';

    entries.push({
      id: `OFAC-SDN-${uid}`,
      name,
      aliases,
      listSource: 'OFAC SDN',
      type,
      designationRef: extractTag(block, 'programList') ? `SDN Program` : undefined,
    });
  }

  return entries;
}

/**
 * Fetch the EU Consolidated Sanctions List (XML).
 * Maintained by the European Commission — free, public, no auth.
 */
export async function fetchEUSanctionsList(
  proxyUrl?: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<SanctionsEntry[]> {
  const EU_URL =
    'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
  const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(EU_URL)}` : EU_URL;

  const response = await fetchWithTimeout(url, {
    timeoutMs: opts?.timeoutMs ?? 30_000,
    signal: opts?.signal,
  });
  if (!response.ok) throw new Error(`EU API returned ${response.status}`);

  const xmlText = await response.text();
  return parseEUXml(xmlText, opts?.signal);
}

/**
 * Extract an XML attribute value from a tag string.
 */
function extractAttribute(tagString: string, attrName: string): string | null {
  const safeAttr = escapeRegex(attrName);
  const match = tagString.match(new RegExp(`${safeAttr}="([^"]*)"`));
  return match ? match[1].trim() : null;
}

/**
 * Parse EU Consolidated Sanctions XML into structured entries.
 * Async + signal-aware so abort timers in the caller can fire while
 * we're chewing through the ~5 MB payload. Uses indexOf-based block
 * iteration instead of `/<sanctionEntity[\s\S]*?<\/sanctionEntity>/gi`
 * against the whole string, which was the primary event-loop stall
 * the "aborted at 10364ms" diagnostic in screening-run.mts was
 * catching.
 */
async function parseEUXml(xml: string, signal?: AbortSignal): Promise<SanctionsEntry[]> {
  const entries: SanctionsEntry[] = [];
  let parsed = 0;

  for (const block of iterateBlocks(xml, 'sanctionEntity')) {
    throwIfAborted(signal);
    if (parsed > 0 && parsed % PARSE_YIELD_EVERY === 0) await yieldToEventLoop();
    parsed++;
    const logicalId =
      extractAttribute(block, 'logicalId') || extractAttribute(block, 'designationId') || '';

    // Extract all <nameAlias> elements and their wholeName attribute
    const nameAliasTags = block.match(/<nameAlias[^>]*\/?>[\s\S]*?(?:<\/nameAlias>|(?=<))/gi) || [];
    const names: string[] = [];
    for (const tag of nameAliasTags) {
      const wholeName = extractAttribute(tag, 'wholeName');
      if (wholeName) names.push(wholeName);
    }

    if (names.length === 0) continue;

    const primaryName = names[0];
    const aliases = names.slice(1);

    // Determine type from subjectType attribute if available
    const subjectType = extractAttribute(block, 'subjectType') || '';
    const type: 'individual' | 'entity' =
      subjectType.toLowerCase().indexOf('person') >= 0 ? 'individual' : 'entity';

    // Extract regulation reference
    const regulationBlock = block.match(/<regulation[\s\S]*?(?:<\/regulation>|\/>)/i);
    const designationRef = regulationBlock
      ? extractAttribute(regulationBlock[0], 'programme') ||
        extractTag(regulationBlock[0], 'programme') ||
        undefined
      : undefined;

    entries.push({
      id: `EU-${logicalId}`,
      name: primaryName,
      aliases,
      listSource: 'EU Consolidated Sanctions',
      type,
      designationRef,
    });
  }

  return entries;
}

/**
 * Fetch UK OFSI Consolidated List.
 * Required by FDL No.10/2025 Art.35 — must screen against UK sanctions.
 *
 * Parses the HM Treasury OFSI Consolidated List CSV (the public
 * "2022 format" file) and returns structured entries. The CSV groups
 * names by `Group ID`: the first row per group carries the primary
 * name, and subsequent rows with `Alias Type = 'AKA'` or similar
 * become aliases attached to the same logical sanctioned party.
 *
 * Closes deep-review gap C1: prior to this commit the function
 * returned [] silently, causing screenAgainstList to miss every
 * UK-designated entity — an Art.35 violation.
 */
export async function fetchUKSanctionsList(
  proxyUrl?: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<SanctionsEntry[]> {
  const UK_URL = 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv';
  const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(UK_URL)}` : UK_URL;

  const res = await fetchWithTimeout(url, {
    timeoutMs: opts?.timeoutMs ?? 30_000,
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`UK OFSI API returned ${res.status}`);

  const csv = await res.text();
  return parseUKOfsiCsv(csv);
}

/**
 * Parse the UK OFSI CSV into SanctionsEntry objects. The parser is
 * intentionally tolerant: the OFSI format has evolved over time and
 * downstream screening should never crash on an unknown header.
 */
export function parseUKOfsiCsv(csv: string): SanctionsEntry[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  // Find the header row. Real OFSI CSVs start with a leading blank
  // and a metadata row; the header is the first row containing a
  // 'Name 1' column, not necessarily row 0.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].some((c) => /^Name\s*1$/i.test(c.trim()))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map((h) => h.trim());
  const col = (name: string): number =>
    header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const nameCols = [1, 2, 3, 4, 5, 6].map((i) => col(`Name ${i}`)).filter((i) => i >= 0);
  const groupIdCol = col('Group ID');
  const groupTypeCol = col('Group Type');
  const aliasTypeCol = col('Alias Type');
  const regimeCol = col('Regime');
  const listedOnCol = col('Listed On');
  const nationalityCol = col('Nationality');

  if (nameCols.length === 0 || groupIdCol < 0) return [];

  // Group records by Group ID so aliases attach to their primary party.
  interface Accumulator {
    primaryName: string;
    aliases: Set<string>;
    type: 'individual' | 'entity';
    regime?: string;
    listedOn?: string;
    nationality?: string;
  }
  const byGroup = new Map<string, Accumulator>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= 1) continue;
    const groupId = (row[groupIdCol] || '').trim();
    if (!groupId) continue;

    const fullName = nameCols
      .map((c) => (row[c] || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!fullName) continue;

    const groupType = groupTypeCol >= 0 ? (row[groupTypeCol] || '').trim() : '';
    const aliasType = aliasTypeCol >= 0 ? (row[aliasTypeCol] || '').trim() : '';
    const type: 'individual' | 'entity' =
      groupType.toLowerCase() === 'individual' ? 'individual' : 'entity';

    const existing = byGroup.get(groupId);
    if (!existing) {
      byGroup.set(groupId, {
        primaryName: fullName,
        aliases: new Set<string>(),
        type,
        regime: regimeCol >= 0 ? (row[regimeCol] || '').trim() || undefined : undefined,
        listedOn: listedOnCol >= 0 ? (row[listedOnCol] || '').trim() || undefined : undefined,
        nationality:
          nationalityCol >= 0 ? (row[nationalityCol] || '').trim() || undefined : undefined,
      });
    } else {
      // Any non-primary row becomes an alias.
      if (aliasType || fullName !== existing.primaryName) {
        existing.aliases.add(fullName);
      }
    }
  }

  const entries: SanctionsEntry[] = [];
  for (const [groupId, acc] of byGroup) {
    entries.push({
      id: `UK-OFSI-${groupId}`,
      name: acc.primaryName,
      aliases: Array.from(acc.aliases),
      listSource: 'UK OFSI',
      listDate: acc.listedOn,
      type: acc.type,
      nationality: acc.nationality,
      designationRef: acc.regime,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// UAE / EOCN Local Terrorist List
// ---------------------------------------------------------------------------
//
// The UAE EOCN (Executive Office for Control and Non-Proliferation) does
// NOT publish a machine-readable list. Designations arrive via gazetted
// notifications, circulars, and the goAML portal. The tfs-refresh.js
// root module ingests these into a tenant-side cache and seeds this
// module via `seedUaeSanctionsList()`.
//
// Behaviour change vs. the previous stub:
//   - If the cache has been seeded, fetchUAESanctionsList returns the
//     cached entries.
//   - If the cache is empty, it THROWS with a diagnostic error rather
//     than silently returning []. The caller (fetchAllSanctionsLists)
//     handles the throw via Promise.allSettled and surfaces the gap in
//     `errors[]` — exactly the signal an MLRO audit needs to catch the
//     Art.35 Violation before it becomes a regulator finding.

let uaeSanctionsCache: readonly SanctionsEntry[] | null = null;

/**
 * Seed the UAE / EOCN sanctions cache. Called by tfs-refresh.js once
 * the latest designations have been fetched from the operator's
 * tenant store or the goAML XML upload.
 *
 * Accepts either plain SanctionsEntry objects or minimal records with
 * just name + type + designationRef. Validates and normalises before
 * caching so a malformed feed can't poison later screening runs.
 */
export function seedUaeSanctionsList(
  entries: ReadonlyArray<Partial<SanctionsEntry> & Pick<SanctionsEntry, 'name' | 'type'>>
): number {
  const normalised: SanctionsEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || e.name.trim().length === 0) continue;
    if (e.type !== 'individual' && e.type !== 'entity') continue;
    normalised.push(
      Object.freeze({
        id: e.id ?? `UAE-EOCN-${normalised.length + 1}`,
        name: e.name.trim(),
        aliases: Object.freeze(
          Array.isArray(e.aliases)
            ? e.aliases.filter((a): a is string => typeof a === 'string' && a.length > 0)
            : []
        ) as string[],
        listSource: 'UAE EOCN',
        listDate: e.listDate,
        type: e.type,
        nationality: e.nationality,
        designationRef: e.designationRef,
      })
    );
  }
  uaeSanctionsCache = Object.freeze(normalised);
  return normalised.length;
}

/**
 * Clear the UAE / EOCN cache. Test-only — production code should
 * never need to unload an active sanctions list.
 */
export function __clearUaeSanctionsCacheForTests(): void {
  uaeSanctionsCache = null;
}

/**
 * Fetch UAE Local Terrorist List / EOCN TFS designations.
 * Required by Cabinet Res 74/2020 — UAE-specific sanctions.
 *
 * Reads from the seeded cache. If the cache is empty, throws so the
 * caller sees the gap (previously this returned [] and screenings
 * silently ignored UAE designations).
 */
export async function fetchUAESanctionsList(): Promise<SanctionsEntry[]> {
  if (uaeSanctionsCache === null) {
    throw new Error(
      'UAE EOCN sanctions cache is empty — seed via seedUaeSanctionsList() ' +
        'from tfs-refresh.js before screening. FDL No.10/2025 Art.35 / ' +
        'Cabinet Res 74/2020 Art.4 require UAE list coverage.'
    );
  }
  return [...uaeSanctionsCache];
}

// ---------------------------------------------------------------------------
// CSV parser — RFC 4180-ish, tolerant of CRLF and quoted fields with
// embedded commas / quotes / newlines. Written inline (not dependency-
// added) because the rest of the project has no CSV parsing need.
// ---------------------------------------------------------------------------

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote?
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\r') {
        // swallow; paired \n handles row end
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  // Trailing cell / row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Exported for tests only.
export const __test__ = { parseCsvRows };

export interface FetchAllSanctionsResult {
  entries: SanctionsEntry[];
  listsChecked: string[];
  errors: string[];
}

/**
 * Fetch all sanctions lists in parallel.
 * REGULATORY: Must check ALL lists — UN, OFAC, EU, UK, UAE/EOCN (FDL Art.35).
 * Uses Promise.allSettled so a single list failure doesn't block the rest.
 */
export async function fetchAllSanctionsLists(proxyUrl?: string): Promise<FetchAllSanctionsResult> {
  const listNames = [
    'UN Consolidated Sanctions',
    'OFAC SDN',
    'EU Consolidated Sanctions',
    'UK OFSI',
    'UAE/EOCN',
  ];

  const results = await Promise.allSettled([
    fetchUNSanctionsList(proxyUrl),
    fetchOFACSanctionsList(proxyUrl),
    fetchEUSanctionsList(proxyUrl),
    fetchUKSanctionsList(proxyUrl),
    fetchUAESanctionsList(),
  ]);

  const entries: SanctionsEntry[] = [];
  const listsChecked: string[] = [];
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      entries.push(...result.value);
      listsChecked.push(listNames[index]);
      // REGULATORY WARNING: If a list fetch succeeds but returns zero entries,
      // it may indicate a parsing failure or empty stub (e.g. UK OFSI, UAE/EOCN).
      // This must NOT be silently reported as "checked" — flag it as a gap.
      if (result.value.length === 0) {
        const warnMsg = `WARNING: ${listNames[index]} returned 0 entries — list may not be fully implemented. Screening coverage is incomplete.`;
        console.warn(warnMsg);
        errors.push(warnMsg);
      }
    } else {
      const errorMsg = `Failed to fetch ${listNames[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
      console.warn(errorMsg);
      errors.push(errorMsg);
    }
  });

  return { entries, listsChecked, errors };
}

/**
 * Screen an entity against ALL available sanctions lists (UN, OFAC, EU).
 * Returns a comprehensive ScreeningResult with all lists checked.
 */
export async function screenEntityComprehensive(
  entityName: string,
  proxyUrl?: string
): Promise<ScreeningResult> {
  const { entries, listsChecked, errors } = await fetchAllSanctionsLists(proxyUrl);

  if (errors.length > 0) {
    console.warn(`Screening completed with ${errors.length} list error(s): ${errors.join('; ')}`);
  }

  const matches = screenAgainstList(entityName, entries);

  return {
    entityName,
    screenedAt: new Date().toISOString(),
    listsChecked,
    matches,
    totalEntriesChecked: entries.length,
  };
}
