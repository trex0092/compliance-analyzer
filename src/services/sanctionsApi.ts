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
export async function fetchUNSanctionsList(proxyUrl?: string): Promise<SanctionsEntry[]> {
  const UN_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
  const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(UN_URL)}` : UN_URL;

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`UN API returned ${response.status}`);

  const xmlText = await response.text();
  return parseUNXml(xmlText);
}

/**
 * Parse UN Consolidated Sanctions XML into structured entries.
 */
function parseUNXml(xml: string): SanctionsEntry[] {
  const entries: SanctionsEntry[] = [];
  // Parse INDIVIDUAL entries
  const individualBlocks = xml.match(/<INDIVIDUAL>[\s\S]*?<\/INDIVIDUAL>/g) || [];
  for (const block of individualBlocks) {
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
  const entityBlocks = xml.match(/<ENTITY>[\s\S]*?<\/ENTITY>/g) || [];
  for (const block of entityBlocks) {
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
    if (nameScore >= 0.75) {
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
      if (aliasScore >= 0.75) {
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
 * Normalize a name for comparison — lowercase, remove diacritics, trim.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bigram similarity (Dice coefficient) — fast fuzzy matching.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) intersection++;
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}
