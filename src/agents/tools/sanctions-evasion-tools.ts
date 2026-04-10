/**
 * Sanctions Evasion Detection Engine
 *
 * Advanced name matching that catches what fuzzy match misses:
 * 1. Soundex — phonetic hashing for English names
 * 2. Metaphone — improved phonetic algorithm
 * 3. Arabic↔Latin transliteration with variant generation
 * 4. Alias expansion — honorifics, patronymics, tribal names
 * 5. Nickname detection — common short forms
 * 6. Character substitution — Cyrillic/Latin lookalikes
 * 7. Composite scoring — multi-algorithm consensus
 *
 * Regulatory: FDL No.10/2025 Art.22, Art.35; FATF Rec 6-7
 */

import type { ToolResult } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NameVariant {
  variant: string;
  source: 'transliteration' | 'phonetic' | 'alias' | 'nickname' | 'substitution' | 'original';
  confidence: number;
}

export interface EvasionMatch {
  queryName: string;
  matchedName: string;
  algorithms: Array<{ algorithm: string; score: number; details: string }>;
  compositeScore: number;
  evasionTechnique: string;
  confidence: number;
}

export interface EvasionReport {
  queryName: string;
  generatedVariants: NameVariant[];
  matches: EvasionMatch[];
  evasionRisk: 'none' | 'low' | 'medium' | 'high';
  alerts: string[];
}

// ---------------------------------------------------------------------------
// Soundex
// ---------------------------------------------------------------------------

export function soundex(name: string): string {
  const s = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 0) return '0000';

  const map: Record<string, string> = {
    B: '1',
    F: '1',
    P: '1',
    V: '1',
    C: '2',
    G: '2',
    J: '2',
    K: '2',
    Q: '2',
    S: '2',
    X: '2',
    Z: '2',
    D: '3',
    T: '3',
    L: '4',
    M: '5',
    N: '5',
    R: '6',
  };

  let result = s[0];
  let lastCode = map[s[0]] ?? '0';

  for (let i = 1; i < s.length && result.length < 4; i++) {
    const code = map[s[i]] ?? '0';
    if (code !== '0' && code !== lastCode) {
      result += code;
    }
    lastCode = code;
  }

  return (result + '0000').slice(0, 4);
}

// ---------------------------------------------------------------------------
// Double Metaphone (simplified)
// ---------------------------------------------------------------------------

export function metaphone(name: string): string {
  let s = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 0) return '';

  // Initial letter rules
  if (/^(KN|GN|PN|AE|WR)/.test(s)) s = s.slice(1);
  if (s[0] === 'X') s = 'S' + s.slice(1);

  let result = '';
  let i = 0;

  while (i < s.length && result.length < 6) {
    const c = s[i];
    const next = s[i + 1] ?? '';

    switch (c) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
        if (i === 0) result += c;
        break;
      case 'B':
        result += s[i - 1] !== 'M' ? 'B' : '';
        break;
      case 'C':
        if (next === 'H') {
          result += 'X';
          i++;
        } else if ('EIY'.includes(next)) {
          result += 'S';
        } else {
          result += 'K';
        }
        break;
      case 'D':
        if (next === 'G' && 'EIY'.includes(s[i + 2] ?? '')) {
          result += 'J';
          i++;
        } else {
          result += 'T';
        }
        break;
      case 'F':
        result += 'F';
        break;
      case 'G':
        if (next === 'H' && !'AEIOU'.includes(s[i + 2] ?? '')) {
          i++;
        } else if (i > 0 && next === 'N') {
          /* silent */
        } else {
          result += 'K';
        }
        break;
      case 'H':
        if ('AEIOU'.includes(next) && (i === 0 || !'AEIOU'.includes(s[i - 1]))) result += 'H';
        break;
      case 'J':
        result += 'J';
        break;
      case 'K':
        if (i === 0 || s[i - 1] !== 'C') result += 'K';
        break;
      case 'L':
        result += 'L';
        break;
      case 'M':
        result += 'M';
        break;
      case 'N':
        result += 'N';
        break;
      case 'P':
        result += next === 'H' ? (i++, 'F') : 'P';
        break;
      case 'Q':
        result += 'K';
        break;
      case 'R':
        result += 'R';
        break;
      case 'S':
        if (next === 'H') {
          result += 'X';
          i++;
        } else if (next === 'I' && 'AO'.includes(s[i + 2] ?? '')) {
          result += 'X';
          i++;
        } else {
          result += 'S';
        }
        break;
      case 'T':
        if (next === 'H') {
          result += '0';
          i++;
        } else {
          result += 'T';
        }
        break;
      case 'V':
        result += 'F';
        break;
      case 'W':
      case 'Y':
        if ('AEIOU'.includes(next)) result += c;
        break;
      case 'X':
        result += 'KS';
        break;
      case 'Z':
        result += 'S';
        break;
    }
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Arabic ↔ Latin Transliteration
// ---------------------------------------------------------------------------

const ARABIC_LATIN_MAP: Array<[string, string[]]> = [
  ['محمد', ['Mohammed', 'Muhammad', 'Mohamed', 'Mohamad', 'Muhammed', 'Mohammad']],
  ['أحمد', ['Ahmed', 'Ahmad', 'Ahmet']],
  ['علي', ['Ali', 'Aly']],
  ['عبد', ['Abdul', 'Abdel', 'Abd']],
  ['الله', ['Allah', 'Alla', 'Ellah']],
  ['الرحمن', ['Rahman', 'Al-Rahman', 'Alrahman']],
  ['حسن', ['Hassan', 'Hasan', 'Hassen']],
  ['حسين', ['Hussein', 'Hussain', 'Husain', 'Husein']],
  ['إبراهيم', ['Ibrahim', 'Ebrahim', 'Abraham']],
  ['يوسف', ['Youssef', 'Yousef', 'Yusuf', 'Josef', 'Joseph']],
  ['خالد', ['Khalid', 'Khaled']],
  ['عمر', ['Omar', 'Umar', 'Omer']],
  ['فاطمة', ['Fatima', 'Fatma', 'Fatemeh']],
  ['سعيد', ['Saeed', 'Said', 'Saeid']],
  ['الشركة', ['Al-Sharika', 'Al Sharika', 'Alsharika']],
  ['التجارة', ['Al-Tijara', 'Altijara', 'Trading']],
  ['الذهب', ['Al-Dhahab', 'Al Dhahab', 'Gold']],
  ['المجوهرات', ['Al-Mujawaharat', 'Jewellery', 'Jewelry']],
];

export function generateTransliterations(name: string): NameVariant[] {
  const variants: NameVariant[] = [];
  const lowerName = name.toLowerCase();

  for (const [arabic, latinVariants] of ARABIC_LATIN_MAP) {
    // Arabic → Latin
    if (name.includes(arabic)) {
      for (const latin of latinVariants) {
        variants.push({
          variant: name.replace(arabic, latin),
          source: 'transliteration',
          confidence: 0.85,
        });
      }
    }
    // Latin → other Latin variants
    for (const latin of latinVariants) {
      if (lowerName.includes(latin.toLowerCase())) {
        for (const otherLatin of latinVariants) {
          if (otherLatin.toLowerCase() !== latin.toLowerCase()) {
            variants.push({
              variant: name.replace(new RegExp(latin, 'i'), otherLatin),
              source: 'transliteration',
              confidence: 0.8,
            });
          }
        }
      }
    }
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Alias & Nickname Generation
// ---------------------------------------------------------------------------

const HONORIFICS = [
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Sheikh',
  'Haj',
  'Hajj',
  'Sayyid',
  'Bin',
  'Ibn',
  'Abu',
  'Al',
  'El',
];
const COMPANY_SUFFIXES = [
  'LLC',
  'Ltd',
  'Limited',
  'Inc',
  'Corp',
  'FZE',
  'FZC',
  'FZCO',
  'DMCC',
  'Trading',
  'General Trading',
  'International',
  'Intl',
  'Group',
  'Holdings',
  'Co',
  'Company',
];

export function generateAliases(name: string): NameVariant[] {
  const variants: NameVariant[] = [];

  // Remove honorifics
  for (const hon of HONORIFICS) {
    const pattern = new RegExp(`\\b${hon}\\.?\\s+`, 'gi');
    if (pattern.test(name)) {
      variants.push({
        variant: name.replace(pattern, '').trim(),
        source: 'alias',
        confidence: 0.9,
      });
    }
  }

  // Remove/swap company suffixes
  for (const suffix of COMPANY_SUFFIXES) {
    const pattern = new RegExp(`\\s+${suffix}\\.?$`, 'gi');
    if (pattern.test(name)) {
      variants.push({
        variant: name.replace(pattern, '').trim(),
        source: 'alias',
        confidence: 0.9,
      });
    }
  }

  // Name part reordering (for "LastName, FirstName" patterns)
  if (name.includes(',')) {
    const parts = name.split(',').map((p) => p.trim());
    variants.push({ variant: parts.reverse().join(' '), source: 'alias', confidence: 0.85 });
  }

  // Initials
  const words = name.split(/\s+/);
  if (words.length >= 2) {
    const initialed = words[0][0] + '. ' + words.slice(1).join(' ');
    variants.push({ variant: initialed, source: 'nickname', confidence: 0.6 });
  }

  // "Al-X" ↔ "Al X" ↔ "AlX"
  if (
    name.includes('Al-') ||
    name.includes('Al ') ||
    name.includes('El-') ||
    name.includes('El ')
  ) {
    variants.push({
      variant: name.replace(/\bAl[- ]/gi, 'Al-'),
      source: 'alias',
      confidence: 0.95,
    });
    variants.push({
      variant: name.replace(/\bAl[- ]/gi, 'Al '),
      source: 'alias',
      confidence: 0.95,
    });
    variants.push({
      variant: name.replace(/\bEl[- ]/gi, 'El-'),
      source: 'alias',
      confidence: 0.95,
    });
    variants.push({
      variant: name.replace(/\bEl[- ]/gi, 'El '),
      source: 'alias',
      confidence: 0.95,
    });
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Character Substitution Detection
// ---------------------------------------------------------------------------

const LOOKALIKES: Array<[string, string]> = [
  ['a', 'а'],
  ['e', 'е'],
  ['o', 'о'],
  ['p', 'р'],
  ['c', 'с'],
  ['x', 'х'],
  ['y', 'у'],
  ['H', 'Н'],
  ['B', 'В'],
  ['T', 'Т'],
  ['0', 'O'],
  ['1', 'l'],
  ['1', 'I'],
];

export function detectCharacterSubstitution(
  name1: string,
  name2: string
): { isSubstitution: boolean; substitutions: string[] } {
  const subs: string[] = [];
  const n1 = name1.normalize('NFC');
  const n2 = name2.normalize('NFC');

  if (n1.length !== n2.length) return { isSubstitution: false, substitutions: [] };

  for (let i = 0; i < n1.length; i++) {
    if (n1[i] !== n2[i]) {
      const isLookalike = LOOKALIKES.some(
        ([a, b]) => (n1[i] === a && n2[i] === b) || (n1[i] === b && n2[i] === a)
      );
      if (isLookalike) {
        subs.push(`Position ${i}: '${n1[i]}' ↔ '${n2[i]}'`);
      } else {
        return { isSubstitution: false, substitutions: [] };
      }
    }
  }

  return { isSubstitution: subs.length > 0, substitutions: subs };
}

// ---------------------------------------------------------------------------
// Composite Name Matching
// ---------------------------------------------------------------------------

export function matchNameAdvanced(
  queryName: string,
  targetNames: string[]
): ToolResult<EvasionReport> {
  // Generate all variants
  const transliterations = generateTransliterations(queryName);
  const aliases = generateAliases(queryName);
  const allVariants: NameVariant[] = [
    { variant: queryName, source: 'original', confidence: 1 },
    ...transliterations,
    ...aliases,
  ];

  // Deduplicate
  const seen = new Set<string>();
  const uniqueVariants = allVariants.filter((v) => {
    const key = v.variant.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const querySoundex = soundex(queryName);
  const queryMetaphone = metaphone(queryName);

  const matches: EvasionMatch[] = [];

  for (const target of targetNames) {
    const algorithms: EvasionMatch['algorithms'] = [];

    // 1. Exact match on any variant
    const exactVariant = uniqueVariants.find(
      (v) => v.variant.toLowerCase() === target.toLowerCase()
    );
    if (exactVariant) {
      algorithms.push({
        algorithm: 'variant-match',
        score: 1.0,
        details: `Exact match via ${exactVariant.source}`,
      });
    }

    // 2. Soundex comparison
    const targetSoundex = soundex(target);
    if (querySoundex === targetSoundex) {
      algorithms.push({
        algorithm: 'soundex',
        score: 0.8,
        details: `Both produce ${querySoundex}`,
      });
    }

    // 3. Metaphone comparison
    const targetMetaphone = metaphone(target);
    if (queryMetaphone === targetMetaphone) {
      algorithms.push({
        algorithm: 'metaphone',
        score: 0.85,
        details: `Both produce ${queryMetaphone}`,
      });
    }

    // 4. Normalized comparison (case, whitespace, punctuation)
    const normQuery = queryName.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
    const normTarget = target.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
    if (normQuery === normTarget) {
      algorithms.push({
        algorithm: 'normalized',
        score: 0.95,
        details: 'Match after removing punctuation/spaces',
      });
    }

    // 5. Character substitution
    const subResult = detectCharacterSubstitution(queryName, target);
    if (subResult.isSubstitution) {
      algorithms.push({
        algorithm: 'char-substitution',
        score: 0.9,
        details: `Lookalike chars: ${subResult.substitutions.join(', ')}`,
      });
    }

    // 6. Check all generated variants against target
    for (const variant of uniqueVariants) {
      if (variant.source === 'original') continue;
      const normVariant = variant.variant.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const normTgt = target.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      if (normVariant === normTgt) {
        algorithms.push({
          algorithm: `variant-${variant.source}`,
          score: variant.confidence,
          details: `Variant "${variant.variant}" matches`,
        });
        break;
      }
    }

    if (algorithms.length > 0) {
      const compositeScore = Math.max(...algorithms.map((a) => a.score));
      const technique = algorithms[0].algorithm.includes('substitution')
        ? 'Character substitution (Cyrillic/Latin)'
        : algorithms[0].algorithm.includes('transliteration')
          ? 'Name transliteration variant'
          : algorithms[0].algorithm.includes('soundex') ||
              algorithms[0].algorithm.includes('metaphone')
            ? 'Phonetic similarity'
            : algorithms[0].algorithm.includes('alias')
              ? 'Alias/naming convention'
              : 'Direct variant';

      matches.push({
        queryName,
        matchedName: target,
        algorithms,
        compositeScore,
        evasionTechnique: technique,
        confidence: compositeScore,
      });
    }
  }

  matches.sort((a, b) => b.compositeScore - a.compositeScore);

  const alerts: string[] = [];
  if (matches.some((m) => m.algorithms.some((a) => a.algorithm === 'char-substitution'))) {
    alerts.push('CHARACTER SUBSTITUTION detected — possible deliberate evasion attempt');
  }
  if (matches.length > 0 && matches[0].compositeScore >= 0.9) {
    alerts.push(
      `High-confidence evasion match: "${matches[0].matchedName}" (${(matches[0].compositeScore * 100).toFixed(0)}%)`
    );
  }

  let evasionRisk: EvasionReport['evasionRisk'] = 'none';
  if (matches.some((m) => m.compositeScore >= 0.9)) evasionRisk = 'high';
  else if (matches.some((m) => m.compositeScore >= 0.7)) evasionRisk = 'medium';
  else if (matches.length > 0) evasionRisk = 'low';

  return {
    ok: true,
    data: { queryName, generatedVariants: uniqueVariants, matches, evasionRisk, alerts },
  };
}

export const EVASION_TOOL_SCHEMAS = [
  {
    name: 'detect_sanctions_evasion',
    description:
      'Advanced name matching: Soundex, Metaphone, Arabic↔Latin transliteration, alias generation, character substitution (Cyrillic lookalikes). Catches what standard fuzzy match misses.',
    inputSchema: {
      type: 'object',
      properties: {
        queryName: { type: 'string' },
        targetNames: { type: 'array', items: { type: 'string' } },
      },
      required: ['queryName', 'targetNames'],
    },
  },
] as const;
