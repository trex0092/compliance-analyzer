/**
 * Sanctions Name-Variant Expander — phonetic + transliteration
 * name variant generator to cut false-negative risk on the
 * sanctions screener.
 *
 * Why this exists:
 *   src/services/sanctionsApi.ts uses a pure fuzzy string similarity
 *   match (Levenshtein-style). That catches "Mohammed" vs "Mohammd"
 *   typos but MISSES transliteration variants like Mohammed /
 *   Mohamed / Muhammad / Muhamad / Mohamad — all legitimate
 *   romanisations of the same Arabic name. The UN, OFAC, and UAE
 *   EOCN lists store each designated party under ONE canonical
 *   spelling, so an account opened under a different transliteration
 *   can slip through.
 *
 *   This module produces a set of plausible name variants for a
 *   single input, which the screener then checks against each
 *   sanctions entry. Pure function, no network, no state,
 *   deterministic — same input → same output.
 *
 * Techniques applied (in order of strength):
 *   1. Normalise: lowercase, strip diacritics, collapse whitespace
 *   2. Apply a targeted Arabic-to-Latin common-variant table
 *      (hand-curated from FATF name-matching guidance + UAE MoE
 *      circulars, grounded in real designated-party transliterations
 *      seen on UN/OFAC lists)
 *   3. Apply double-consonant folding (Mohammed → Mohamed)
 *   4. Apply vowel-insertion folding (Mhmd → Mohamed)
 *   5. Apply a Metaphone-lite phonetic key (not the full algorithm —
 *      a conservative subset that catches the common cases without
 *      the false-positive explosion full Metaphone creates)
 *
 * Conservative by design: the variant set is capped at 20 variants
 * per input. Over-expansion would amplify false positives on the
 * downstream fuzzy matcher and drown the MLRO in alerts.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.35 (must screen against ALL lists — can't
 *                          miss a hit on a transliteration variant)
 *   Cabinet Res 74/2020 Art.4-7 (sanctions freeze — false-negative
 *                                 risk is a legal liability)
 *   FATF Rec 6 (targeted financial sanctions — name-matching is
 *               an explicit obligation)
 *   FATF Guidance on name-matching for sanctions screening (2018)
 */

// ---------------------------------------------------------------------------
// Step 1: normalise (with Cyrillic + Greek transliteration)
// ---------------------------------------------------------------------------

const DIACRITICS = /[\u0300-\u036f]/g;

// ISO 9 Cyrillic-to-Latin map (subset covering Russian + Ukrainian +
// Belarusian + Bulgarian alphabets seen on UN/OFAC list spellings).
const CYRILLIC_LATIN: Record<string, string> = {
  А: 'a',
  а: 'a',
  Б: 'b',
  б: 'b',
  В: 'v',
  в: 'v',
  Г: 'g',
  г: 'g',
  Ґ: 'g',
  ґ: 'g',
  Д: 'd',
  д: 'd',
  Е: 'e',
  е: 'e',
  Ё: 'e',
  ё: 'e',
  Є: 'ye',
  є: 'ye',
  Ж: 'zh',
  ж: 'zh',
  З: 'z',
  з: 'z',
  И: 'i',
  и: 'i',
  І: 'i',
  і: 'i',
  Й: 'i',
  й: 'i',
  Ї: 'yi',
  ї: 'yi',
  К: 'k',
  к: 'k',
  Л: 'l',
  л: 'l',
  М: 'm',
  м: 'm',
  Н: 'n',
  н: 'n',
  О: 'o',
  о: 'o',
  П: 'p',
  п: 'p',
  Р: 'r',
  р: 'r',
  С: 's',
  с: 's',
  Т: 't',
  т: 't',
  У: 'u',
  у: 'u',
  Ф: 'f',
  ф: 'f',
  Х: 'kh',
  х: 'kh',
  Ц: 'ts',
  ц: 'ts',
  Ч: 'ch',
  ч: 'ch',
  Ш: 'sh',
  ш: 'sh',
  Щ: 'sch',
  щ: 'sch',
  Ъ: '',
  ъ: '',
  Ы: 'y',
  ы: 'y',
  Ь: '',
  ь: '',
  Э: 'e',
  э: 'e',
  Ю: 'yu',
  ю: 'yu',
  Я: 'ya',
  я: 'ya',
};

// ISO 843 Greek-to-Latin map (modern Greek + classical letter
// shapes seen on EU + UN list spellings).
const GREEK_LATIN: Record<string, string> = {
  Α: 'a',
  α: 'a',
  Ά: 'a',
  ά: 'a',
  Β: 'v',
  β: 'v',
  Γ: 'g',
  γ: 'g',
  Δ: 'd',
  δ: 'd',
  Ε: 'e',
  ε: 'e',
  Έ: 'e',
  έ: 'e',
  Ζ: 'z',
  ζ: 'z',
  Η: 'i',
  η: 'i',
  Ή: 'i',
  ή: 'i',
  Θ: 'th',
  θ: 'th',
  Ι: 'i',
  ι: 'i',
  Ί: 'i',
  ί: 'i',
  Ϊ: 'i',
  ϊ: 'i',
  Κ: 'k',
  κ: 'k',
  Λ: 'l',
  λ: 'l',
  Μ: 'm',
  μ: 'm',
  Ν: 'n',
  ν: 'n',
  Ξ: 'x',
  ξ: 'x',
  Ο: 'o',
  ο: 'o',
  Ό: 'o',
  ό: 'o',
  Π: 'p',
  π: 'p',
  Ρ: 'r',
  ρ: 'r',
  Σ: 's',
  σ: 's',
  ς: 's',
  Τ: 't',
  τ: 't',
  Υ: 'y',
  υ: 'y',
  Ύ: 'y',
  ύ: 'y',
  Ϋ: 'y',
  ϋ: 'y',
  Φ: 'f',
  φ: 'f',
  Χ: 'ch',
  χ: 'ch',
  Ψ: 'ps',
  ψ: 'ps',
  Ω: 'o',
  ω: 'o',
  Ώ: 'o',
  ώ: 'o',
};

function transliterateScript(name: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of name) {
    const mapped = table[ch];
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

function transliterateCyrillic(name: string): string {
  return transliterateScript(name, CYRILLIC_LATIN);
}

function transliterateGreek(name: string): string {
  return transliterateScript(name, GREEK_LATIN);
}

function normalize(name: string): string {
  if (typeof name !== 'string') return '';
  // Transliterate non-Latin scripts BEFORE NFD so the diacritic
  // strip does not nuke characters we just produced.
  let s = name;
  s = transliterateCyrillic(s);
  s = transliterateGreek(s);
  return s
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[''`\u2019\u2018]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Step 2: Arabic-to-Latin common variant table
//
// Ordered so that longer / more-specific patterns run before shorter
// ones, otherwise "uh" would fire before "ouh" and clobber it.
// ---------------------------------------------------------------------------

interface VariantRule {
  from: RegExp;
  to: string;
}

const ARABIC_LATIN_RULES: VariantRule[] = [
  // Mohammed family — the single most common UN/OFAC transliteration set
  { from: /\bmohammed\b/g, to: 'mohamed' },
  { from: /\bmohammad\b/g, to: 'mohamed' },
  { from: /\bmohamad\b/g, to: 'mohamed' },
  { from: /\bmuhammad\b/g, to: 'mohamed' },
  { from: /\bmuhamad\b/g, to: 'mohamed' },
  { from: /\bmohd\b/g, to: 'mohamed' },
  { from: /\bmhd\b/g, to: 'mohamed' },
  // Ahmed family
  { from: /\bahmad\b/g, to: 'ahmed' },
  { from: /\bahmet\b/g, to: 'ahmed' },
  { from: /\bahmet\b/g, to: 'ahmed' },
  // Osama / Usama family
  { from: /\busama\b/g, to: 'osama' },
  { from: /\bousama\b/g, to: 'osama' },
  // Hussein / Hussain family
  { from: /\bhussain\b/g, to: 'hussein' },
  { from: /\bhusain\b/g, to: 'hussein' },
  { from: /\bhusein\b/g, to: 'hussein' },
  { from: /\bhossein\b/g, to: 'hussein' },
  // Yousef family
  { from: /\byusuf\b/g, to: 'yousef' },
  { from: /\byousif\b/g, to: 'yousef' },
  { from: /\byousuf\b/g, to: 'yousef' },
  // Ibrahim family
  { from: /\bibraheem\b/g, to: 'ibrahim' },
  { from: /\bibraham\b/g, to: 'ibrahim' },
  // Abdul/Abdel family (common prefix)
  { from: /\babd al\b/g, to: 'abdul' },
  { from: /\babdel\b/g, to: 'abdul' },
  { from: /\babdal\b/g, to: 'abdul' },
  // Common letter-pair collapses
  { from: /ck/g, to: 'k' },
  { from: /ph/g, to: 'f' },
  { from: /th/g, to: 't' }, // conservative — only applies after other rules
];

function applyArabicLatinRules(name: string): string[] {
  const variants = new Set<string>([name]);
  for (const rule of ARABIC_LATIN_RULES) {
    for (const existing of Array.from(variants)) {
      const next = existing.replace(rule.from, rule.to);
      if (next !== existing) variants.add(next);
    }
  }
  return Array.from(variants);
}

// ---------------------------------------------------------------------------
// Step 3: double-consonant folding
// ---------------------------------------------------------------------------

function foldDoubleConsonants(name: string): string {
  // Replace any run of the same consonant with a single one.
  return name.replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1');
}

// ---------------------------------------------------------------------------
// Step 4: vowel-insertion folding
// ---------------------------------------------------------------------------

function stripVowels(name: string): string {
  // Keep leading vowel, strip trailing vowels, simplify interior.
  return name.replace(/([bcdfghjklmnpqrstvwxyz])[aeiou]+/g, '$1');
}

// ---------------------------------------------------------------------------
// Step 5: Metaphone-lite phonetic key
//
// A conservative subset. Full Metaphone/Double-Metaphone would
// generate too many false positives and drown the MLRO in alerts.
// We only apply the transformations that show up in real
// transliteration drift on UN/OFAC lists.
// ---------------------------------------------------------------------------

function phoneticKey(name: string): string {
  return name
    .replace(/^kn/, 'n') // knight → night
    .replace(/^wr/, 'r') // wrong → rong
    .replace(/^gn/, 'n') // gnome → nome
    .replace(/^ps/, 's') // psyche → syche
    .replace(/sch/g, 'sh') // Germanic Sch- → Sh-
    .replace(/q/g, 'k') // Qadir → Kadir
    .replace(/x/g, 'ks') // Xander → Ksander
    .replace(/z/g, 's') // Muazzam → Muassam
    .replace(/v/g, 'f'); // Vladimir → Fladimir (for CJK romanisations)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NameVariantSet {
  /** The normalised canonical form of the input. */
  canonical: string;
  /** Every variant produced, including the canonical. */
  variants: readonly string[];
  /** Single phonetic key suitable for bucket-matching. */
  phoneticKey: string;
}

const MAX_VARIANTS = 20;

/**
 * Produce a set of plausible name variants for the input. The
 * canonical form is always the normalised lowercase version; the
 * `variants` array additionally contains transliteration,
 * double-consonant, and vowel-insertion variants.
 *
 * Conservative: capped at 20 variants per input to prevent
 * downstream false-positive explosion.
 */
export function expandNameVariants(input: string): NameVariantSet {
  const canonical = normalize(input);
  if (canonical.length === 0) {
    return { canonical: '', variants: [], phoneticKey: '' };
  }

  const set = new Set<string>([canonical]);

  // Apply the Arabic → Latin table to every variant currently in
  // the set, then fold doubles + strip vowels on the RESULT.
  for (const v of applyArabicLatinRules(canonical)) set.add(v);
  for (const v of Array.from(set)) set.add(foldDoubleConsonants(v));
  for (const v of Array.from(set)) set.add(stripVowels(v));

  // Cap at MAX_VARIANTS, keeping canonical first.
  const ordered = [canonical, ...Array.from(set).filter((v) => v !== canonical)];
  const capped = ordered.slice(0, MAX_VARIANTS);

  return {
    canonical,
    variants: capped,
    phoneticKey: phoneticKey(canonical),
  };
}

/**
 * Convenience: returns true when `queryName` expands to a variant
 * that fuzzy-matches `targetName` under the provided similarity
 * function. The similarity function is injected so this module
 * doesn't depend on src/utils/fuzzyMatch.ts.
 */
export function matchesWithVariants(
  queryName: string,
  targetName: string,
  similarityFn: (a: string, b: string) => number,
  threshold = 0.85
): { matched: boolean; bestVariant: string; bestScore: number } {
  const query = expandNameVariants(queryName);
  const target = normalize(targetName);
  let bestScore = 0;
  let bestVariant = query.canonical;
  for (const v of query.variants) {
    const score = similarityFn(v, target);
    if (score > bestScore) {
      bestScore = score;
      bestVariant = v;
    }
    if (bestScore >= 1) break; // perfect match, stop early
  }
  return {
    matched: bestScore >= threshold,
    bestVariant,
    bestScore,
  };
}

// Exports for tests.
export const __test__ = {
  normalize,
  applyArabicLatinRules,
  foldDoubleConsonants,
  stripVowels,
  phoneticKey,
  transliterateCyrillic,
  transliterateGreek,
  MAX_VARIANTS,
};
