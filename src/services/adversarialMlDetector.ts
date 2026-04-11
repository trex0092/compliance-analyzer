/**
 * Adversarial ML Detector — subsystem #98 (Phase 9).
 *
 * Detects inputs (entity names, transaction descriptions, narrative
 * text) that look crafted to evade ML-based sanctions matching.
 * Adversarial examples typically exhibit:
 *
 *   - Invisible Unicode (zero-width joiners, bidi overrides)
 *   - Homoglyph substitution (Latin 'a' → Cyrillic 'а', 'o' → 'о',
 *     'e' → 'е') — visually identical, different codepoints
 *   - Extreme character repetition
 *   - Excessive diacritic stacking
 *   - Statistical anomalies vs expected language distributions
 *   - Mixed-script words (a name in Latin suddenly containing one
 *     Cyrillic letter)
 *
 * Deterministic, pure-function. Runs in <1ms per input. Sits on the
 * input boundary before the name matcher + adverse media search +
 * any LLM-facing code path.
 *
 * Regulatory basis:
 *   - NIST AI RMF GV-1.6, MS-1.1 (security + adversarial testing)
 *   - EU AI Act Art.15 (robustness + cybersecurity)
 *   - FATF Rec 6 (sanctions screening accuracy)
 *   - FDL No.10/2025 Art.35 (TFS — must not be bypassed via encoding)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdversarialFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  matchedText?: string;
}

export interface AdversarialReport {
  clean: boolean;
  findings: AdversarialFinding[];
  topSeverity: 'critical' | 'high' | 'medium' | 'none';
  sanitised: string;
  /** Stats useful for logging. */
  stats: {
    zeroWidthCount: number;
    homoglyphCount: number;
    mixedScriptWords: number;
    repeatedCharStreaks: number;
  };
  narrative: string;
}

// ---------------------------------------------------------------------------
// Homoglyph map — the most common Latin ↔ Cyrillic lookalikes.
// ---------------------------------------------------------------------------

const CYRILLIC_TO_LATIN_HOMOGLYPH: Readonly<Record<string, string>> = {
  а: 'a', // U+0430
  е: 'e', // U+0435
  о: 'o', // U+043E
  р: 'p', // U+0440
  с: 'c', // U+0441
  у: 'y', // U+0443
  х: 'x', // U+0445
  А: 'A', // U+0410
  В: 'B', // U+0412
  Е: 'E', // U+0415
  К: 'K', // U+041A
  М: 'M', // U+041C
  Н: 'H', // U+041D
  О: 'O', // U+041E
  Р: 'P', // U+0420
  С: 'C', // U+0421
  Т: 'T', // U+0422
  Х: 'X', // U+0425
};

const ZERO_WIDTH_REGEX = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectAdversarial(input: string): AdversarialReport {
  const findings: AdversarialFinding[] = [];
  const stats = {
    zeroWidthCount: 0,
    homoglyphCount: 0,
    mixedScriptWords: 0,
    repeatedCharStreaks: 0,
  };

  // 1. Zero-width / bidi unicode
  const zwMatches = input.match(ZERO_WIDTH_REGEX);
  if (zwMatches) {
    stats.zeroWidthCount = zwMatches.length;
    findings.push({
      id: 'ADV-01',
      severity: 'critical',
      description: `${zwMatches.length} invisible unicode codepoint(s) — hidden insertion`,
    });
  }

  // 2. Homoglyph scan
  let homoMatch = '';
  for (const ch of input) {
    if (ch in CYRILLIC_TO_LATIN_HOMOGLYPH) {
      stats.homoglyphCount += 1;
      homoMatch = homoMatch + ch;
    }
  }
  if (stats.homoglyphCount > 0) {
    findings.push({
      id: 'ADV-02',
      severity: 'high',
      description: `${stats.homoglyphCount} Cyrillic-Latin homoglyph(s) — visually identical substitution`,
      matchedText: homoMatch,
    });
  }

  // 3. Mixed-script words (token containing both Latin and Cyrillic)
  const words = input.split(/\s+/);
  for (const word of words) {
    const hasLatin = /[a-zA-Z]/.test(word);
    const hasCyrillic = /[\u0400-\u04ff]/.test(word);
    if (hasLatin && hasCyrillic) stats.mixedScriptWords += 1;
  }
  if (stats.mixedScriptWords > 0) {
    findings.push({
      id: 'ADV-03',
      severity: 'high',
      description: `${stats.mixedScriptWords} word(s) mixing Latin and Cyrillic scripts`,
    });
  }

  // 4. Extreme repetition (50+ of the same character)
  const repeatMatches = input.match(/(.)\1{49,}/g);
  if (repeatMatches) {
    stats.repeatedCharStreaks = repeatMatches.length;
    findings.push({
      id: 'ADV-04',
      severity: 'medium',
      description: `${repeatMatches.length} run(s) of 50+ repeated characters`,
    });
  }

  // 5. Excessive diacritic stacking (combining marks)
  const combiningMatches = input.match(/[\u0300-\u036f]{4,}/g);
  if (combiningMatches) {
    findings.push({
      id: 'ADV-05',
      severity: 'medium',
      description: `${combiningMatches.length} run(s) of 4+ stacked diacritics`,
    });
  }

  const topSeverity: AdversarialReport['topSeverity'] = findings.some(
    (f) => f.severity === 'critical'
  )
    ? 'critical'
    : findings.some((f) => f.severity === 'high')
      ? 'high'
      : findings.some((f) => f.severity === 'medium')
        ? 'medium'
        : 'none';

  // Sanitise: strip invisible unicode, replace homoglyphs with Latin.
  let sanitised = input.replace(ZERO_WIDTH_REGEX, '');
  for (const [cyr, latin] of Object.entries(CYRILLIC_TO_LATIN_HOMOGLYPH)) {
    sanitised = sanitised.split(cyr).join(latin);
  }
  // Collapse mega-repetition runs to 3 characters.
  sanitised = sanitised.replace(/(.)\1{20,}/g, '$1$1$1');

  const clean = findings.length === 0;
  const narrative = clean
    ? 'Adversarial ML detector: clean input — no evasion artefacts.'
    : `Adversarial ML detector: ${findings.length} finding(s), top severity ${topSeverity}. ` +
      `Sanitised version available for downstream matching.`;

  return { clean, findings, topSeverity, sanitised, stats, narrative };
}
