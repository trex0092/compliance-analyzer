/**
 * Tests for src/utils/normalizeBrainUrl.ts — the defensive URL
 * sanitizer that protects against the operator typo classes
 * observed when setting HAWKEYE_BRAIN_URL / PUBLIC_BASE_URL via
 * the Netlify and GitHub web dashboards on mobile.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BRAIN_URL,
  LEGACY_BRAIN_HOST,
  containsLegacyBrainHost,
  normalizeBrainUrl,
} from '../src/utils/normalizeBrainUrl';

describe('normalizeBrainUrl', () => {
  it('returns canonical URL when input is undefined', () => {
    expect(normalizeBrainUrl(undefined)).toBe(CANONICAL_BRAIN_URL);
  });

  it('returns canonical URL when input is null', () => {
    expect(normalizeBrainUrl(null)).toBe(CANONICAL_BRAIN_URL);
  });

  it('returns canonical URL when input is empty string', () => {
    expect(normalizeBrainUrl('')).toBe(CANONICAL_BRAIN_URL);
  });

  it('returns canonical URL when input is whitespace only', () => {
    expect(normalizeBrainUrl('   ')).toBe(CANONICAL_BRAIN_URL);
  });

  it('passes through a clean canonical URL unchanged', () => {
    expect(normalizeBrainUrl('https://hawkeye-sterling-v2.netlify.app')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('strips a single trailing slash (the most common mobile typo)', () => {
    expect(normalizeBrainUrl('https://hawkeye-sterling-v2.netlify.app/')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeBrainUrl('https://hawkeye-sterling-v2.netlify.app///')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('strips a trailing dot (FQDN marker)', () => {
    expect(normalizeBrainUrl('https://hawkeye-sterling-v2.netlify.app.')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('strips mixed trailing slash + dot (the exact mobile typo observed)', () => {
    expect(normalizeBrainUrl('https://hawkeye-sterling-v2.netlify.app./')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('strips leading and trailing whitespace', () => {
    expect(normalizeBrainUrl('  https://hawkeye-sterling-v2.netlify.app  ')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeBrainUrl('hawkeye-sterling-v2.netlify.app')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('prepends https:// to a bare host with trailing slash', () => {
    expect(normalizeBrainUrl('hawkeye-sterling-v2.netlify.app/')).toBe(
      'https://hawkeye-sterling-v2.netlify.app'
    );
  });

  it('preserves http:// explicitly (HTTPS validation lives elsewhere)', () => {
    expect(normalizeBrainUrl('http://localhost:8888')).toBe('http://localhost:8888');
  });

  it('falls back to canonical when normalization strips everything', () => {
    expect(normalizeBrainUrl('https://')).toBe(CANONICAL_BRAIN_URL);
    expect(normalizeBrainUrl('https:/')).toBe(CANONICAL_BRAIN_URL);
  });

  it('never throws on pathological input', () => {
    expect(() => normalizeBrainUrl('///....///')).not.toThrow();
    expect(() => normalizeBrainUrl('.')).not.toThrow();
    expect(() => normalizeBrainUrl('/')).not.toThrow();
  });

  it('handles custom Netlify domains unchanged', () => {
    expect(normalizeBrainUrl('https://brain.example.com')).toBe('https://brain.example.com');
  });
});

describe('containsLegacyBrainHost', () => {
  it('returns false for undefined', () => {
    expect(containsLegacyBrainHost(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(containsLegacyBrainHost(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsLegacyBrainHost('')).toBe(false);
  });

  it('detects the legacy host in a full URL', () => {
    expect(containsLegacyBrainHost('https://compliance-analyzer.netlify.app')).toBe(true);
  });

  it('detects the legacy host with a path suffix', () => {
    expect(containsLegacyBrainHost('https://compliance-analyzer.netlify.app/api/brain')).toBe(true);
  });

  it('detects the legacy host case-insensitively', () => {
    expect(containsLegacyBrainHost('https://COMPLIANCE-ANALYZER.netlify.app')).toBe(true);
    expect(containsLegacyBrainHost('https://Compliance-Analyzer.Netlify.App')).toBe(true);
  });

  it('does not flag the canonical URL', () => {
    expect(containsLegacyBrainHost(CANONICAL_BRAIN_URL)).toBe(false);
    expect(containsLegacyBrainHost('https://hawkeye-sterling-v2.netlify.app')).toBe(false);
  });

  it('does not flag the GitHub repo URL (also contains compliance-analyzer)', () => {
    expect(containsLegacyBrainHost('https://github.com/trex0092/compliance-analyzer')).toBe(false);
  });

  it('exposes the legacy host constant', () => {
    expect(LEGACY_BRAIN_HOST).toBe('compliance-analyzer.netlify.app');
  });
});
