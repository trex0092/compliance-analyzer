/**
 * Sanctions Diff Analysis
 * Compares current sanctions lists against previous snapshots to identify
 * new designations, removals, and impacted counterparties.
 * Conforms to: Cabinet Res 74/2020 Art.4-7, FDL No.10/2025 Art.35
 */
import { load, save } from '../../scripts/lib/store.mjs';

/**
 * Generate a diff of sanctions list changes and cross-reference against portfolio.
 * @returns {{ added: number, removed: number, modified: number, impacted: number, details: object[] }}
 */
export async function generateDiff() {
  const currentSnapshot = await load('sanctions-snapshot-current', { entries: [] });
  const previousSnapshot = await load('sanctions-snapshot-previous', { entries: [] });
  const portfolio = await load('counterparty-portfolio', []);

  const prevMap = new Map(previousSnapshot.entries.map(e => [e.id, e]));
  const currMap = new Map(currentSnapshot.entries.map(e => [e.id, e]));

  const added = [];
  const removed = [];
  const modified = [];

  // Detect additions and modifications
  for (const [id, entry] of currMap) {
    if (!prevMap.has(id)) {
      added.push(entry);
    } else {
      const prev = prevMap.get(id);
      if (JSON.stringify(prev) !== JSON.stringify(entry)) {
        modified.push({ previous: prev, current: entry });
      }
    }
  }

  // Detect removals
  for (const [id, entry] of prevMap) {
    if (!currMap.has(id)) {
      removed.push(entry);
    }
  }

  // Cross-reference new designations against portfolio
  const impactedEntities = [];
  for (const designation of added) {
    for (const entity of portfolio) {
      const nameMatch = fuzzyMatch(entity.name, designation.name);
      if (nameMatch >= 0.8) {
        impactedEntities.push({
          entity: entity.name,
          entityId: entity.id,
          designation: designation.name,
          designationId: designation.id,
          confidence: nameMatch,
          list: designation.list,
        });
      }
    }
  }

  const result = {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    impacted: impactedEntities.length,
    details: impactedEntities,
    generatedAt: new Date().toISOString(),
  };

  // Archive the diff
  await save(`sanctions-diff-${new Date().toISOString().split('T')[0]}`, result);

  // Rotate snapshots
  if (currentSnapshot.entries.length > 0) {
    await save('sanctions-snapshot-previous', currentSnapshot);
  }

  return result;
}

/**
 * Fuzzy name matching with NFKD normalisation, Latin transliteration
 * fallback, and a token-set Jaro-Winkler score.
 *
 * Previous implementation stripped all non [a-z0-9] characters, which
 * deleted Arabic / Cyrillic / Chinese script entirely — a sanctioned
 * entity written in its source script would silently score 0. This
 * version:
 *
 *   1. NFKD-normalises both inputs, folding accents/diacritics.
 *   2. Applies a deterministic Latin transliteration map for the most
 *      common Arabic and Cyrillic letters. Real deployments should swap
 *      this for ICU (`Intl.Transliterator`) or the `transliteration`
 *      package.
 *   3. Tokenises on whitespace and compares via a Jaro-Winkler-weighted
 *      token-set ratio — robust to different name orderings and to
 *      missing middle / family names.
 *
 * Returns a score in [0, 1] rounded to 2 decimals.
 */
function fuzzyMatch(a, b) {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;

  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;

  // Jaccard on the raw token sets
  const intersect = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = intersect / union;

  // Average Jaro-Winkler across the cartesian product — captures typos
  // and transliteration drift on individual tokens.
  let jwSum = 0;
  let jwCount = 0;
  for (const x of ta) {
    for (const y of tb) {
      jwSum += jaroWinkler(x, y);
      jwCount++;
    }
  }
  const jw = jwCount ? jwSum / jwCount : 0;

  // Weighted blend — set overlap dominates, string similarity is the
  // tie-breaker for single-token drift.
  const score = 0.65 * jaccard + 0.35 * jw;
  return Math.round(score * 100) / 100;
}

// Minimal Arabic and Cyrillic → Latin transliteration. Not a substitute
// for ICU, but prevents the previous "delete everything non-Latin"
// behaviour.
const TRANSLIT_MAP = {
  // Arabic
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
  'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
  'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ء': '',
  // Cyrillic
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

function transliterate(s) {
  let out = '';
  for (const ch of s) {
    out += TRANSLIT_MAP[ch] != null ? TRANSLIT_MAP[ch] : ch;
  }
  return out;
}

function normalize(s) {
  if (!s) return '';
  let out = String(s).normalize('NFKD');
  // Drop combining marks (accents)
  out = out.replace(/[\u0300-\u036f]/g, '');
  out = transliterate(out.toLowerCase());
  // After transliteration we should only have Latin letters + digits;
  // anything else (punctuation, left-over script) becomes whitespace.
  out = out.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

// Jaro-Winkler similarity — standard algorithm.
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const m = Math.max(s1.length, s2.length);
  if (m === 0) return 0;
  const range = Math.max(0, Math.floor(m / 2) - 1);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - range);
    const end = Math.min(i + range + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;
  // Winkler prefix boost
  let l = 0;
  while (l < 4 && s1[l] && s1[l] === s2[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}
