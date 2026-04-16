/**
 * Sanctions List Ingestor — real-list fetch + normalise + delta.
 *
 * Consumes the six authoritative sanctions sources and normalises them
 * to a common internal shape (`NormalisedSanction`) so the rest of the
 * compliance pipeline can screen against one unified list.
 *
 * Sources (all publicly downloadable):
 *   - OFAC SDN — https://www.treasury.gov/ofac/downloads/sdn.csv
 *   - OFAC Consolidated — https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv
 *   - UN Consolidated — https://scsanctions.un.org/resources/xml/en/consolidated.xml
 *   - EU Consolidated — https://data.europa.eu/api/hub/repo/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions
 *   - UK OFSI Consolidated — https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv
 *   - UAE EOCN (local terrorist list) — manual XML from EOCN circulars
 *
 * The live URLs are defined in `SANCTIONS_SOURCES` below. This module
 * is pure: fetching is done by the ingest worker, parsing is pure, so
 * tests can drive the parser with fixture strings.
 *
 * Delta detection:
 *   - Each run produces a normalised list
 *   - Compared to the previous run (persisted as a hash-indexed snapshot)
 *   - Added / removed / modified entries produce a `SanctionsDelta`
 *   - New additions are auto-screened against the customer portfolio
 *     via nameMatching.findBestMatch — any hit fires a brain event
 *
 * Regulatory teeth: Cabinet Res 74/2020 Art.4 requires screening
 * "without delay" after a new designation. This ingestor is the
 * without-delay mechanism.
 */

import { createHash } from 'node:crypto';
import { matchScore, type MatchBreakdown } from './nameMatching';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SanctionsSource = 'OFAC_SDN' | 'OFAC_CONS' | 'UN' | 'EU' | 'UK_OFSI' | 'UAE_EOCN';

export interface NormalisedSanction {
  source: SanctionsSource;
  /** Source-specific unique id (OFAC Ent. Num, UN Permanent Reference, etc.). */
  sourceId: string;
  /** Primary name as it appears on the list. */
  primaryName: string;
  /** Aliases / AKAs / "also known as" entries. */
  aliases: string[];
  /** SDN-style "individual" or "entity" classification. */
  type: 'individual' | 'entity' | 'vessel' | 'aircraft' | 'unknown';
  /** Date of birth for individuals, incorporation date for entities. */
  dateOfBirth?: string;
  /** Nationality (ISO alpha-2 where known). */
  nationality?: string;
  /** Programme code(s): e.g. "SDGT", "UKRAINE-EO13662", "DPRK". */
  programmes: string[];
  /** Free-text remarks for the MLRO. */
  remarks?: string;
  /** SHA-256 of the normalised record — used for delta detection. */
  hash: string;
}

export interface SanctionsDelta {
  added: NormalisedSanction[];
  removed: NormalisedSanction[];
  modified: Array<{ before: NormalisedSanction; after: NormalisedSanction }>;
  unchanged: number;
}

export interface SanctionsScreeningHit {
  customer: string;
  match: NormalisedSanction;
  breakdown: MatchBreakdown;
  classification: 'confirmed' | 'potential' | 'weak';
}

/**
 * Canonical source URLs. Kept in the source so the ingest worker is
 * self-contained, but each URL should be verified against the source's
 * current publication schedule before production use.
 */
export const SANCTIONS_SOURCES: Record<SanctionsSource, { url: string; format: 'csv' | 'xml' }> = {
  OFAC_SDN: {
    url: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
    format: 'csv',
  },
  OFAC_CONS: {
    url: 'https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv',
    format: 'csv',
  },
  UN: {
    url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    format: 'xml',
  },
  EU: {
    // EU publishes via hub.europa.eu; URL may require auth depending
    // on the deploy. Needs verification.
    url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
    format: 'xml',
  },
  UK_OFSI: {
    url: 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv',
    format: 'csv',
  },
  UAE_EOCN: {
    // EOCN distributes via PDF/XML circulars, not a stable URL.
    // Typically scraped from https://www.uaeiec.gov.ae.
    url: 'https://www.uaeiec.gov.ae/en-us/un-page',
    format: 'xml',
  },
};

// ---------------------------------------------------------------------------
// Hashing — stable SHA-256 over the normalised shape
// ---------------------------------------------------------------------------

export function hashSanction(s: Omit<NormalisedSanction, 'hash'>): string {
  const canonical = [
    s.source,
    s.sourceId,
    s.primaryName,
    [...s.aliases].sort().join('|'),
    s.type,
    s.dateOfBirth ?? '',
    s.nationality ?? '',
    [...s.programmes].sort().join('|'),
    s.remarks ?? '',
  ].join('\x1f'); // ASCII unit separator — unlikely to appear in real data
  return createHash('sha256').update(canonical).digest('hex');
}

export function withHash(s: Omit<NormalisedSanction, 'hash'>): NormalisedSanction {
  return { ...s, hash: hashSanction(s) };
}

// ---------------------------------------------------------------------------
// Parsers — pure, fixture-drivable
// ---------------------------------------------------------------------------

/**
 * Parse OFAC SDN CSV format. Columns (positional):
 *   ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vess_type,Tonnage,GRT,Vess_flag,Vess_owner,Remarks
 *
 * OFAC uses `-0-` as the null marker.
 */
export function parseOfacSdnCsv(csv: string): NormalisedSanction[] {
  const out: NormalisedSanction[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const fields = parseOfacCsvLine(line);
    if (fields.length < 12) continue;
    const [
      ent_num,
      name,
      sdn_type,
      program /*title*/ /*call*/ /*vess_type*/ /*tonnage*/ /*grt*/ /*flag*/ /*owner*/,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      remarks,
    ] = fields;
    if (!ent_num || !name) continue;

    const typeLower = (sdn_type ?? '').toLowerCase();
    let type: NormalisedSanction['type'] = 'unknown';
    if (typeLower.includes('individual')) type = 'individual';
    else if (typeLower.includes('entity')) type = 'entity';
    else if (typeLower.includes('vessel')) type = 'vessel';
    else if (typeLower.includes('aircraft')) type = 'aircraft';

    out.push(
      withHash({
        source: 'OFAC_SDN',
        sourceId: ent_num.trim(),
        primaryName: name.replace(/^"|"$/g, '').trim(),
        aliases: [], // AKAs live in a separate OFAC file (alt.csv)
        type,
        programmes: (program ?? '')
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p && p !== '-0-'),
        remarks: remarks && remarks !== '-0-' ? remarks.trim() : undefined,
      })
    );
  }
  return out;
}

/**
 * Minimal CSV line parser that honours OFAC's quoting rules.
 * OFAC wraps any field containing a comma in double quotes.
 */
function parseOfacCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a minimal subset of the UN Consolidated XML format.
 *
 * Real structure:
 *   <CONSOLIDATED_LIST>
 *     <INDIVIDUALS>
 *       <INDIVIDUAL>
 *         <DATAID>6908507</DATAID>
 *         <FIRST_NAME>Mohammed</FIRST_NAME>
 *         <SECOND_NAME>Bin</SECOND_NAME>
 *         <THIRD_NAME>Rashid</THIRD_NAME>
 *         <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
 *         <INDIVIDUAL_ALIAS>...</INDIVIDUAL_ALIAS>
 *         ...
 *       </INDIVIDUAL>
 *     </INDIVIDUALS>
 *     <ENTITIES>...</ENTITIES>
 *   </CONSOLIDATED_LIST>
 */
export function parseUnConsolidatedXml(xml: string): NormalisedSanction[] {
  const out: NormalisedSanction[] = [];

  const extract = (container: string, tag: 'INDIVIDUAL' | 'ENTITY') => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(container)) !== null) {
      const block = m[1];
      const dataId = tagContent(block, 'DATAID') ?? tagContent(block, 'REFERENCE_NUMBER') ?? '';
      const firstName = tagContent(block, 'FIRST_NAME') ?? '';
      const secondName = tagContent(block, 'SECOND_NAME') ?? '';
      const thirdName = tagContent(block, 'THIRD_NAME') ?? '';
      const fourthName = tagContent(block, 'FOURTH_NAME') ?? '';
      const entityName =
        tagContent(block, 'FIRST_NAME') ?? tagContent(block, 'NAME_ORIGINAL_SCRIPT') ?? '';
      const listType = tagContent(block, 'UN_LIST_TYPE') ?? '';
      const nationality = tagContent(block, 'NATIONALITY') ?? undefined;

      const primaryName =
        tag === 'INDIVIDUAL'
          ? [firstName, secondName, thirdName, fourthName].filter(Boolean).join(' ')
          : entityName;
      if (!primaryName || !dataId) continue;

      const aliases: string[] = [];
      const aliasRe = /<[A-Z_]*ALIAS_NAME>([^<]+)<\/[A-Z_]*ALIAS_NAME>/g;
      let am: RegExpExecArray | null;
      while ((am = aliasRe.exec(block)) !== null) {
        aliases.push(am[1].trim());
      }

      out.push(
        withHash({
          source: 'UN',
          sourceId: dataId.trim(),
          primaryName: primaryName.trim(),
          aliases,
          type: tag === 'INDIVIDUAL' ? 'individual' : 'entity',
          nationality: nationality?.trim(),
          programmes: listType ? [listType.trim()] : [],
        })
      );
    }
  };

  const individualsMatch = /<INDIVIDUALS>([\s\S]*?)<\/INDIVIDUALS>/.exec(xml);
  if (individualsMatch) extract(individualsMatch[1], 'INDIVIDUAL');
  const entitiesMatch = /<ENTITIES>([\s\S]*?)<\/ENTITIES>/.exec(xml);
  if (entitiesMatch) extract(entitiesMatch[1], 'ENTITY');
  return out;
}

function tagContent(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// OFAC Consolidated parser (cons_prim.csv — same format as SDN)
// ---------------------------------------------------------------------------

/**
 * Parse OFAC Consolidated CSV. Same column layout as the SDN list
 * (cons_prim.csv mirrors sdn.csv columns), but tagged as OFAC_CONS.
 */
export function parseOfacConsCsv(csv: string): NormalisedSanction[] {
  const out: NormalisedSanction[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const fields = parseOfacCsvLine(line);
    if (fields.length < 12) continue;
    const [
      ent_num,
      name,
      sdn_type,
      program,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      remarks,
    ] = fields;
    if (!ent_num || !name) continue;

    const typeLower = (sdn_type ?? '').toLowerCase();
    let type: NormalisedSanction['type'] = 'unknown';
    if (typeLower.includes('individual')) type = 'individual';
    else if (typeLower.includes('entity')) type = 'entity';
    else if (typeLower.includes('vessel')) type = 'vessel';
    else if (typeLower.includes('aircraft')) type = 'aircraft';

    out.push(
      withHash({
        source: 'OFAC_CONS',
        sourceId: ent_num.trim(),
        primaryName: name.replace(/^"|"$/g, '').trim(),
        aliases: [],
        type,
        programmes: (program ?? '')
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p && p !== '-0-'),
        remarks: remarks && remarks !== '-0-' ? remarks.trim() : undefined,
      })
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// UK OFSI ConList.csv parser
// ---------------------------------------------------------------------------

/**
 * Parse UK OFSI Consolidated List CSV (2022 format).
 *
 * Columns (header row present):
 *   Group ID, Group Type, Regime, Listed On, Last Updated, Group Status,
 *   Name 1, Name 2, Name 3, Name 4, Name 5, Name 6,
 *   Title, Name Type, DOB, Town of Birth, Country of Birth,
 *   Nationality, Passport Details, National Identification Details,
 *   Position, Address 1-6, Post/Zip Code, Country, Other Information,
 *   Entity Type, Subsidiary of, ...
 *
 * We use: Group ID (sourceId), Name 1-6 (primaryName), Name Type
 * (AKA for aliases), Group Type (individual/entity), Regime
 * (programme), DOB, Nationality, Other Information (remarks).
 */
export function parseUkOfsiCsv(csv: string): NormalisedSanction[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // header + at least one data row

  // Parse header to find column indices.
  const headerFields = parseOfacCsvLine(lines[0]!);
  const col = (name: string) => {
    const idx = headerFields.findIndex(
      (h) => h.trim().toLowerCase() === name.toLowerCase()
    );
    return idx;
  };
  const iGroupId = col('Group ID');
  const iGroupType = col('Group Type');
  const iRegime = col('Regime');
  const iName1 = col('Name 1');
  const iName2 = col('Name 2');
  const iName3 = col('Name 3');
  const iName4 = col('Name 4');
  const iName5 = col('Name 5');
  const iName6 = col('Name 6');
  const iNameType = col('Name Type');
  const iDob = col('DOB');
  const iNationality = col('Nationality');
  const iOtherInfo = col('Other Information');
  if (iGroupId < 0 || iName1 < 0) return []; // unrecognised format

  // Group rows by Group ID — multiple rows per entity (one per alias).
  const groups = new Map<
    string,
    { primaryName: string; aliases: string[]; type: NormalisedSanction['type']; programmes: string[]; dob?: string; nationality?: string; remarks?: string }
  >();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseOfacCsvLine(lines[i]!);
    const groupId = fields[iGroupId]?.trim();
    if (!groupId) continue;

    const nameparts = [
      fields[iName1],
      fields[iName2],
      fields[iName3],
      fields[iName4],
      fields[iName5],
      fields[iName6],
    ]
      .map((n) => (n ?? '').trim())
      .filter(Boolean);
    const fullName = nameparts.join(' ');
    if (!fullName) continue;

    const nameType = (fields[iNameType] ?? '').trim().toLowerCase();
    const groupType = (fields[iGroupType] ?? '').trim().toLowerCase();
    const regime = (fields[iRegime] ?? '').trim();
    const dob = fields[iDob] !== undefined ? fields[iDob].trim() : undefined;
    const nat = fields[iNationality] !== undefined ? fields[iNationality].trim() : undefined;
    const other = fields[iOtherInfo] !== undefined ? fields[iOtherInfo].trim() : undefined;

    let type: NormalisedSanction['type'] = 'unknown';
    if (groupType.includes('individual')) type = 'individual';
    else if (groupType.includes('entity') || groupType.includes('ship') || groupType.includes('organisation'))
      type = 'entity';

    const existing = groups.get(groupId);
    if (!existing) {
      groups.set(groupId, {
        primaryName: fullName,
        aliases: [],
        type,
        programmes: regime ? [regime] : [],
        dob: dob || undefined,
        nationality: nat || undefined,
        remarks: other || undefined,
      });
    } else {
      // Additional row for same group — treat as alias unless it's the primary name type.
      if (nameType === 'aka' || nameType === 'alias' || nameType === 'formerly known as') {
        existing.aliases.push(fullName);
      } else if (nameType === 'primary name' && !existing.primaryName) {
        existing.primaryName = fullName;
      } else if (fullName !== existing.primaryName) {
        existing.aliases.push(fullName);
      }
      if (regime && !existing.programmes.includes(regime)) {
        existing.programmes.push(regime);
      }
    }
  }

  const out: NormalisedSanction[] = [];
  for (const [groupId, entry] of groups) {
    out.push(
      withHash({
        source: 'UK_OFSI',
        sourceId: groupId,
        primaryName: entry.primaryName,
        aliases: entry.aliases,
        type: entry.type,
        dateOfBirth: entry.dob,
        nationality: entry.nationality,
        programmes: entry.programmes,
        remarks: entry.remarks,
      })
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// EU Consolidated Sanctions XML parser
// ---------------------------------------------------------------------------

/**
 * Parse EU sanctions XML (Full Sanctions List v1.1).
 *
 * Structure:
 *   <export>
 *     <sanctionEntity logicalId="12345" ...>
 *       <nameAlias wholeName="PERSON NAME" ... />
 *       <nameAlias wholeName="ALIAS NAME" nameAliasId="..." />
 *       <identification ... />
 *       <regulation regulationType="..." programme="..." />
 *       <remark>Free text</remark>
 *       <birthdate ...>
 *         <dateOfBirth>1970-01-01</dateOfBirth>
 *       </birthdate>
 *       <citizenship countryIso2Code="XX" />
 *       ...
 *     </sanctionEntity>
 *   </export>
 */
export function parseEuSanctionsXml(xml: string): NormalisedSanction[] {
  const out: NormalisedSanction[] = [];

  const entityRe = /<sanctionEntity\s([^>]*)>([\s\S]*?)<\/sanctionEntity>/g;
  let em: RegExpExecArray | null;
  while ((em = entityRe.exec(xml)) !== null) {
    const attrs = em[1];
    const body = em[2];

    const logicalId = attrValue(attrs, 'logicalId') ?? '';
    if (!logicalId) continue;

    // Determine type from designationDetails or subjectType attribute.
    const subjectType = (attrValue(attrs, 'subjectType') ?? '').toLowerCase();
    let type: NormalisedSanction['type'] = 'unknown';
    if (subjectType.includes('person') || subjectType.includes('individual'))
      type = 'individual';
    else if (
      subjectType.includes('enterprise') ||
      subjectType.includes('entity') ||
      subjectType.includes('organisation')
    )
      type = 'entity';

    // Extract names (nameAlias elements with wholeName attribute).
    const names: string[] = [];
    const nameRe = /<nameAlias\s([^>]*)\/?>/g;
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(body)) !== null) {
      const wholeName = attrValue(nm[1], 'wholeName');
      if (wholeName) names.push(wholeName.trim());
    }
    if (names.length === 0) continue;

    const primaryName = names[0]!;
    const aliases = names.slice(1);

    // Extract programmes from regulation elements.
    const programmes: string[] = [];
    const regRe = /<regulation\s([^>]*)\/?>/g;
    let rm: RegExpExecArray | null;
    while ((rm = regRe.exec(body)) !== null) {
      const prog =
        attrValue(rm[1], 'programme') ?? attrValue(rm[1], 'regulationType') ?? '';
      if (prog && !programmes.includes(prog)) programmes.push(prog.trim());
    }

    // Date of birth — may be nested: <birthdate><dateOfBirth>...</dateOfBirth></birthdate>
    // or direct: <dateOfBirth>...</dateOfBirth>.
    const dob =
      tagContent(body, 'dateOfBirth') ??
      (() => {
        const bdMatch = /<birthdate[^>]*>([\s\S]*?)<\/birthdate>/.exec(body);
        return bdMatch ? tagContent(bdMatch[1], 'dateOfBirth') : undefined;
      })();

    // Nationality / citizenship.
    const citizenRe = /<citizenship\s([^>]*)\/?>/;
    const cm = citizenRe.exec(body);
    const nationality = cm ? attrValue(cm[1], 'countryIso2Code') ?? undefined : undefined;

    // Remarks.
    const remarks = tagContent(body, 'remark') ?? undefined;

    out.push(
      withHash({
        source: 'EU',
        sourceId: logicalId,
        primaryName,
        aliases,
        type,
        dateOfBirth: dob?.trim(),
        nationality: nationality?.trim(),
        programmes,
        remarks: remarks?.trim(),
      })
    );
  }

  return out;
}

/**
 * Extract an XML attribute value from an attributes string.
 * e.g. attrValue('logicalId="123" name="foo"', 'logicalId') => '123'
 */
function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(attrs);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Delta engine
// ---------------------------------------------------------------------------

/**
 * Compare two sanctions snapshots and return the delta.
 * Keyed by `source|sourceId` — so re-ordering within the source is a no-op.
 */
export function computeDelta(
  previous: readonly NormalisedSanction[],
  current: readonly NormalisedSanction[]
): SanctionsDelta {
  const keyOf = (s: NormalisedSanction) => `${s.source}|${s.sourceId}`;

  const prevMap = new Map(previous.map((s) => [keyOf(s), s]));
  const currMap = new Map(current.map((s) => [keyOf(s), s]));

  const added: NormalisedSanction[] = [];
  const removed: NormalisedSanction[] = [];
  const modified: Array<{ before: NormalisedSanction; after: NormalisedSanction }> = [];
  let unchanged = 0;

  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) added.push(curr);
    else if (prev.hash !== curr.hash) modified.push({ before: prev, after: curr });
    else unchanged++;
  }
  for (const [key, prev] of prevMap) {
    if (!currMap.has(key)) removed.push(prev);
  }

  return { added, removed, modified, unchanged };
}

// ---------------------------------------------------------------------------
// Screening — match customer names against the list
// ---------------------------------------------------------------------------

/**
 * Screen a single customer name against the full sanctions list.
 * Returns all hits above `threshold` with their classification.
 */
export function screenCustomer(
  customer: string,
  sanctions: readonly NormalisedSanction[],
  threshold = 0.7
): SanctionsScreeningHit[] {
  const hits: SanctionsScreeningHit[] = [];
  for (const s of sanctions) {
    // Primary name
    const primary = matchScore(customer, s.primaryName);
    if (primary.score >= threshold) {
      hits.push({
        customer,
        match: s,
        breakdown: primary,
        classification:
          primary.score >= 0.9 ? 'confirmed' : primary.score >= 0.7 ? 'potential' : 'weak',
      });
      continue; // one hit per sanction entry — don't also check aliases
    }
    // Aliases
    for (const alias of s.aliases) {
      const a = matchScore(customer, alias);
      if (a.score >= threshold) {
        hits.push({
          customer,
          match: s,
          breakdown: a,
          classification: a.score >= 0.9 ? 'confirmed' : a.score >= 0.7 ? 'potential' : 'weak',
        });
        break;
      }
    }
  }
  // Sort by score descending
  hits.sort((a, b) => b.breakdown.score - a.breakdown.score);
  return hits;
}

/**
 * Screen a customer portfolio against a delta (the new additions).
 * This is the "without-delay" sweep required by Cabinet Res 74/2020 Art.4.
 */
export function screenDeltaAgainstPortfolio(
  customers: readonly string[],
  delta: SanctionsDelta,
  threshold = 0.7
): SanctionsScreeningHit[] {
  const allHits: SanctionsScreeningHit[] = [];
  for (const customer of customers) {
    const hits = screenCustomer(customer, delta.added, threshold);
    allHits.push(...hits);
  }
  return allHits;
}
