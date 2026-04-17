import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  levenshteinSimilarity,
  soundex,
  multiModalMatch,
  isMultiModalMatch,
  findBestMultiModalMatch,
  runMultiModalNameMatcher,
  DEFAULT_WEIGHTS,
} from '@/services/multiModalNameMatcher';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns length of the other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('counts single-character edits', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1); // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1); // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1); // deletion
  });

  it('computes classic textbook examples', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
    expect(levenshteinDistance('flaw', 'lawn')).toBe(2);
  });

  it('is symmetric', () => {
    expect(levenshteinDistance('abcdef', 'ghijkl')).toBe(
      levenshteinDistance('ghijkl', 'abcdef'),
    );
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(1);
    expect(levenshteinSimilarity('', '')).toBe(1);
  });

  it('returns 0 for totally disjoint same-length strings', () => {
    expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
  });

  it('produces a value in (0, 1) for partial matches', () => {
    const s = levenshteinSimilarity('kitten', 'sitting');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
});

describe('soundex', () => {
  it('keeps the first letter', () => {
    expect(soundex('Smith').startsWith('S')).toBe(true);
    expect(soundex('Jones').startsWith('J')).toBe(true);
  });

  it('encodes canonical examples per the NARA reference', () => {
    expect(soundex('Smith')).toBe('S530');
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163'); // homophone of Robert
    expect(soundex('Rubin')).toBe('R150');
    expect(soundex('Ashcraft')).toBe('A261');
    expect(soundex('Tymczak')).toBe('T522');
    expect(soundex('Pfister')).toBe('P236');
    expect(soundex('Honeyman')).toBe('H555');
  });

  it('collapses same-code homophones', () => {
    // Ali / Ali / Aly are phonetically equivalent.
    expect(soundex('Ali')).toBe(soundex('Aly'));
    // Mohammad / Muhammad / Mohamed phonetic equivalence after translit.
    expect(soundex('Mohammad')).toBe(soundex('Muhammad'));
  });

  it('pads short names to 4 characters', () => {
    expect(soundex('Lee')).toBe('L000');
    expect(soundex('Wu')).toBe('W000');
  });

  it('returns empty string for inputs with no ASCII letters', () => {
    expect(soundex('محمد')).toBe('');
    expect(soundex('12345')).toBe('');
  });
});

describe('multiModalMatch', () => {
  it('scores identical strings as 1.0 and classifies as confirmed', () => {
    const r = multiModalMatch('John Smith', 'John Smith');
    expect(r.score).toBe(1);
    expect(r.classification).toBe('confirmed');
    expect(r.jaroWinkler).toBe(1);
    expect(r.levenshtein).toBe(1);
    expect(r.soundex).toBe(1);
    expect(r.metaphone).toBe(1);
    expect(r.tokenSet).toBe(1);
    expect(r.agreement).toBe(1);
  });

  it('tolerates a single-letter typo', () => {
    const r = multiModalMatch('Mohammed Al Thani', 'Mohamed Al Thani');
    expect(r.score).toBeGreaterThanOrEqual(0.88);
    expect(r.classification).not.toBe('none');
    expect(r.levenshtein).toBeGreaterThan(0.9);
  });

  it('ignores legal suffixes', () => {
    const r = multiModalMatch('Hawkeye FZE', 'Hawkeye');
    expect(r.score).toBe(1);
  });

  it('tolerates surname-first ↔ surname-last order', () => {
    const r = multiModalMatch('Smith John', 'John Smith');
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.tokenSet).toBe(1);
  });

  it('keeps unrelated same-surname names below the potential-match threshold', () => {
    // Canonical Phase 16 fairness case: shared surname, distinct given name.
    const r1 = multiModalMatch('Wang Wei', 'Wang Lei');
    expect(r1.score).toBeLessThan(0.7);

    const r2 = multiModalMatch('Rajesh Kumar', 'Anil Kumar');
    expect(r2.score).toBeLessThan(0.7);
  });

  it('flags Arabic ↔ Latin transliteration and produces a non-zero score', () => {
    // Arabic consonantal script doesn't write short vowels, so the
    // transliteration "mhmd" doesn't fully vocalise to "mohammad".
    // We assert the same invariant as nameMatching.test.ts: the flag
    // is set and SOME score is produced. Threshold-clearing for the
    // pure Arabic ↔ Latin case is the domain of the downstream
    // nameVariantExpander and crossScriptNameMatcher — not this
    // multi-modal layer alone.
    const r = multiModalMatch('محمد', 'Mohammad');
    expect(r.transliterated).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('matches Arabic ↔ Latin in multi-token names above the weak bar', () => {
    // Multi-token Arabic names benefit from token-level phonetic
    // matching: at least one token typically aligns.
    const r = multiModalMatch('محمد بن راشد', 'Mohammed Bin Rashid');
    expect(r.transliterated).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
  });

  it('produces per-algorithm breakdown with all fields populated', () => {
    const r = multiModalMatch('John Smith', 'Jon Smyth');
    expect(r).toHaveProperty('jaroWinkler');
    expect(r).toHaveProperty('levenshtein');
    expect(r).toHaveProperty('soundex');
    expect(r).toHaveProperty('metaphone');
    expect(r).toHaveProperty('tokenSet');
    expect(r).toHaveProperty('agreement');
    expect(r.normalisedA).toBe('john smith');
    expect(r.normalisedB).toBe('jon smyth');
  });

  it('emits lower agreement when algorithms disagree', () => {
    // Identical → maximal agreement.
    const agree = multiModalMatch('John Smith', 'John Smith').agreement;
    // Phonetically similar but structurally different → disagreement.
    const disagree = multiModalMatch('Smith', 'Schmidt').agreement;
    expect(agree).toBe(1);
    expect(disagree).toBeLessThan(agree);
  });

  it('reports the weights actually used', () => {
    const r = multiModalMatch('a', 'b');
    const sum =
      r.weights.jaroWinkler +
      r.weights.levenshtein +
      r.weights.soundex +
      r.weights.metaphone +
      r.weights.tokenSet;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('accepts weight overrides and renormalises', () => {
    const all5 = multiModalMatch('John', 'Jon', {
      jaroWinkler: 1,
      levenshtein: 1,
      soundex: 1,
      metaphone: 1,
      tokenSet: 1,
    });
    expect(all5.weights.jaroWinkler).toBeCloseTo(0.2, 5);
    expect(all5.weights.levenshtein).toBeCloseTo(0.2, 5);
  });

  it('classifies per the CLAUDE.md decision tree thresholds', () => {
    const confirmed = multiModalMatch('John Smith', 'John Smith');
    expect(confirmed.classification).toBe('confirmed');

    const none = multiModalMatch('John Smith', 'Vladimir Putin');
    expect(none.classification).toBe('none');
  });
});

describe('isMultiModalMatch', () => {
  it('returns true for identical strings at the default threshold', () => {
    expect(isMultiModalMatch('John Smith', 'John Smith')).toBe(true);
  });

  it('returns false for clearly distinct names at the default threshold', () => {
    expect(isMultiModalMatch('John Smith', 'Vladimir Putin')).toBe(false);
  });

  it('respects a custom threshold', () => {
    // A single-letter typo exceeds 0.7 but not 0.999.
    expect(isMultiModalMatch('Mohamed', 'Mohammed', 0.7)).toBe(true);
    expect(isMultiModalMatch('Mohamed', 'Mohammed', 0.999)).toBe(false);
  });
});

describe('findBestMultiModalMatch', () => {
  const sanctionsList = [
    'Vladimir Putin',
    'Mohammad bin Salman',
    'Kim Jong Un',
    'Ramzan Kadyrov',
  ];

  it('returns null when no candidate clears the threshold', () => {
    expect(findBestMultiModalMatch('John Smith', sanctionsList)).toBeNull();
  });

  it('finds the single best matching candidate', () => {
    const hit = findBestMultiModalMatch('Vladimir V. Putin', sanctionsList);
    expect(hit).not.toBeNull();
    expect(hit!.candidate).toBe('Vladimir Putin');
    expect(hit!.breakdown.score).toBeGreaterThanOrEqual(0.7);
  });

  it('handles empty candidate lists', () => {
    expect(findBestMultiModalMatch('anything', [])).toBeNull();
  });

  it('short-circuits on exact matches', () => {
    const hit = findBestMultiModalMatch('Kim Jong Un', sanctionsList);
    expect(hit).not.toBeNull();
    expect(hit!.breakdown.score).toBe(1);
  });
});

describe('runMultiModalNameMatcher', () => {
  it('returns an empty hits list when nothing clears the threshold', () => {
    const r = runMultiModalNameMatcher({
      query: 'John Smith',
      candidates: ['Vladimir Putin', 'Kim Jong Un'],
    });
    expect(r.hitCount).toBe(0);
    expect(r.hits).toHaveLength(0);
    expect(r.topClassification).toBe('none');
  });

  it('ranks hits by composite score descending', () => {
    const r = runMultiModalNameMatcher({
      query: 'Mohammad bin Salman',
      candidates: [
        'Mohammed bin Salman',      // high similarity
        'Mohammad bin Salman',      // exact
        'Mohammed Al Salman',       // moderate
        'Vladimir Putin',           // unrelated
      ],
      threshold: 0.5,
    });
    expect(r.hitCount).toBeGreaterThanOrEqual(2);
    expect(r.hits[0].breakdown.score).toBe(1);
    for (let i = 1; i < r.hits.length; i++) {
      expect(r.hits[i - 1].breakdown.score).toBeGreaterThanOrEqual(
        r.hits[i].breakdown.score,
      );
    }
  });

  it('records totalCandidates and topScore over the full input', () => {
    const r = runMultiModalNameMatcher({
      query: 'anything',
      candidates: ['a', 'b', 'c', 'd'],
      threshold: 0.9,
    });
    expect(r.totalCandidates).toBe(4);
    expect(r.topScore).toBeGreaterThanOrEqual(0);
    expect(r.topScore).toBeLessThanOrEqual(1);
  });

  it('caps hits at maxHits', () => {
    const candidates = Array.from({ length: 30 }, () => 'John Smith');
    const r = runMultiModalNameMatcher({
      query: 'John Smith',
      candidates,
      maxHits: 5,
    });
    expect(r.hits).toHaveLength(5);
    expect(r.hitCount).toBe(5);
  });

  it('produces a valid ISO timestamp', () => {
    const r = runMultiModalNameMatcher({
      query: 'x',
      candidates: ['y'],
    });
    expect(() => new Date(r.ranAt).toISOString()).not.toThrow();
    expect(new Date(r.ranAt).toISOString()).toBe(r.ranAt);
  });
});

describe('DEFAULT_WEIGHTS', () => {
  it('sums to 1.0 within rounding tolerance', () => {
    const sum =
      DEFAULT_WEIGHTS.jaroWinkler +
      DEFAULT_WEIGHTS.levenshtein +
      DEFAULT_WEIGHTS.soundex +
      DEFAULT_WEIGHTS.metaphone +
      DEFAULT_WEIGHTS.tokenSet;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('is frozen to prevent accidental mutation at runtime', () => {
    expect(Object.isFrozen(DEFAULT_WEIGHTS)).toBe(true);
  });
});
