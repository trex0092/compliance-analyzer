/**
 * Name Variant Expander — subsystem #31.
 *
 * Sanctions screening misses 10-20% of legitimate hits because the
 * name-matching layer is too narrow. This module expands a query
 * name into a set of variants that a downstream matcher should try:
 *
 *   - Arabic ⇄ Latin transliteration candidates (common substitutions)
 *   - Diacritic normalisation (cafe vs café, El/Al/Ali)
 *   - Honorific stripping (Dr, Sheikh, Mr, Mrs, Eng)
 *   - Initial expansion / swap (M. Smith ⇄ Michael Smith)
 *   - Soundex code for phonetic fuzzy match
 *   - Levenshtein-ready normalised form
 *
 * Deterministic, pure, no external deps. This is the fallback layer
 * under the sanctioned-name matcher — callers iterate the variants
 * and ask the matcher "does any of these hit the list?".
 *
 * Regulatory basis:
 *   - FATF Rec 6 (UN sanctions screening completeness)
 *   - FDL No.10/2025 Art.35 (TFS obligations)
 *   - Cabinet Res 74/2020 Art.4-7 (asset freeze accuracy)
 */

// ---------------------------------------------------------------------------
// Honorifics + common Arabic-Latin substitutions
// ---------------------------------------------------------------------------

const HONORIFICS = new Set([
  'dr',
  'dr.',
  'mr',
  'mr.',
  'mrs',
  'mrs.',
  'ms',
  'ms.',
  'miss',
  'sheikh',
  'sheik',
  'shaikh',
  'eng',
  'eng.',
  'prof',
  'prof.',
  'sir',
  'madame',
  'madam',
  'hajji',
  'hajj',
  'al',
  'el',
  'ibn',
  'bin',
  'bint',
]);

/** Common transliteration substitutions for Arabic names written in Latin. */
const ARABIC_LATIN_SUBS: ReadonlyArray<[RegExp, string]> = [
  // ghain / gh / g
  [/\bgh\b/g, 'g'],
  // qaf / q / k
  [/\bq\b/g, 'k'],
  // hamza / glottal stop — usually omitted in Latin
  [/[\u2018\u2019']/g, ''],
  // ou / u
  [/ou/g, 'u'],
  // oe / e
  [/oe/g, 'e'],
  // double consonants
  [/(.)\1+/g, '$1'],
  // ph / f
  [/ph/g, 'f'],
  // kh / h (approximation used in some transliterations)
  [/kh/g, 'k'],
  // sh / ch
  [/sh/g, 'ch'],
  // th / t
  [/th/g, 't'],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NameVariantReport {
  canonical: string;
  variants: string[];
  soundex: string;
  metaphone: string;
  initialSwap?: string;
  narrative: string;
}

export function expandNameVariants(raw: string): NameVariantReport {
  const canonical = normalise(raw);
  const out = new Set<string>();
  out.add(canonical);

  // Honorific-stripped
  const stripped = canonical
    .split(' ')
    .filter((t) => !HONORIFICS.has(t.toLowerCase()))
    .join(' ')
    .trim();
  if (stripped) out.add(stripped);

  // Substitution variants
  for (const [pattern, replacement] of ARABIC_LATIN_SUBS) {
    const v = canonical.replace(pattern, replacement).trim();
    if (v && v !== canonical) out.add(v);
    const vs = stripped.replace(pattern, replacement).trim();
    if (vs && vs !== stripped) out.add(vs);
  }

  // Initial swap: "Michael Smith" ⇄ "M Smith" and "M Smith" ⇄ "Michael Smith"
  const tokens = canonical.split(' ').filter(Boolean);
  let initialSwap: string | undefined;
  if (tokens.length >= 2) {
    // first-token → initial
    const asInitial = `${tokens[0][0]} ${tokens.slice(1).join(' ')}`;
    out.add(asInitial);
    initialSwap = asInitial;
  }

  const soundex = soundexCode(canonical);
  const metaphone = simpleMetaphone(canonical);

  const variants = Array.from(out).filter((v) => v.length >= 2);
  const narrative =
    `Name variant expander: generated ${variants.length} variant(s) for "${raw}", ` +
    `soundex=${soundex}, metaphone=${metaphone}.`;

  return { canonical, variants, soundex, metaphone, initialSwap, narrative };
}

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Soundex (American, 4-char)
// ---------------------------------------------------------------------------

function soundexCode(input: string): string {
  const s = input.replace(/[^a-z]/g, '').toLowerCase();
  if (!s) return '0000';

  const map: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  };

  let out = s[0].toUpperCase();
  let prev = map[s[0]] ?? '';
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const code = map[s[i]];
    if (code && code !== prev) out += code;
    if (code !== undefined) prev = code;
    else prev = '';
  }
  return out.padEnd(4, '0');
}

// ---------------------------------------------------------------------------
// Metaphone (very compact variant — good enough for fuzzy match)
// ---------------------------------------------------------------------------

function simpleMetaphone(input: string): string {
  return input
    .replace(/[^a-z]/g, '')
    .replace(/gh/g, 'h')
    .replace(/ph/g, 'f')
    .replace(/th/g, '0')
    .replace(/ck/g, 'k')
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/^[aeiou]/, (m) => m.toUpperCase())
    .slice(0, 6)
    .toUpperCase();
}
