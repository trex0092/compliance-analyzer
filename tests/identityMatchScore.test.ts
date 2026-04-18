/**
 * Tests for scoreHitAgainstProfile — the composite identity-match
 * scorer that disambiguates daily screening hits against the MLRO's
 * pinned ResolvedIdentity.
 *
 * Coverage:
 *   - Exact match across all four components yields an alert.
 *   - Partial matches land in the possible band.
 *   - Name-only coincidences suppress (below 0.50).
 *   - Alias bonus lifts but does not replace name score.
 *   - listEntryRef pin substitutes for ID number when set.
 *   - Unresolved identity is clamped to at most 'possible'.
 *   - Year-only DoB is a half-weight signal.
 *   - Different persons sharing the same name suppress.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreHitAgainstProfile,
  IDENTITY_MATCH_THRESHOLDS,
  IDENTITY_MATCH_WEIGHTS,
} from '../src/services/identityMatchScore';
import type { ResolvedIdentity } from '../src/services/screeningWatchlist';

const SUBJECT = 'Mohamed Ahmed';

const FULL_IDENTITY: ResolvedIdentity = {
  dob: '12/03/1982',
  nationality: 'AE',
  idType: 'emirates_id',
  idNumber: '784-1982-1234567-1',
  aliases: ['Mohammed A. Al-Marri'],
  resolvedAtIso: '2026-04-10T08:00:00Z',
  resolvedBy: 'MLRO',
};

describe('scoreHitAgainstProfile', () => {
  it('awards a full alert when name + DoB + nationality + ID all match', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '12/03/1982',
        listEntryNationality: 'AE',
        listEntryIdNumber: '784198212345671',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    expect(result.composite).toBeGreaterThanOrEqual(IDENTITY_MATCH_THRESHOLDS.alert);
    expect(result.classification).toBe('alert');
    expect(result.breakdown.name).toBeGreaterThan(0.9);
    expect(result.breakdown.dob).toBe(1);
    expect(result.breakdown.nationality).toBe(1);
    expect(result.breakdown.id).toBe(1);
    expect(result.hasResolvedIdentity).toBe(true);
  });

  it('alerts when name + DoB + nationality match even without ID', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '12/03/1982',
        listEntryNationality: 'AE',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    // Name ~1.0 * 0.3 + DoB 1 * 0.3 + Nat 1 * 0.2 = 0.80
    expect(result.composite).toBeGreaterThanOrEqual(IDENTITY_MATCH_THRESHOLDS.alert);
    expect(result.classification).toBe('alert');
  });

  it('returns possible when only name + nationality match', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryNationality: 'AE',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    // Name ~1.0 * 0.3 + Nat 1 * 0.2 = 0.50
    expect(result.composite).toBeGreaterThanOrEqual(IDENTITY_MATCH_THRESHOLDS.possible);
    expect(result.composite).toBeLessThan(IDENTITY_MATCH_THRESHOLDS.alert);
    expect(result.classification).toBe('possible');
    expect(result.breakdown.dob).toBe(0);
    expect(result.breakdown.id).toBe(0);
  });

  it('suppresses name-only hits that carry no identity corroboration', () => {
    const result = scoreHitAgainstProfile(
      { listEntryName: 'Mohamed Ahmed' },
      SUBJECT,
      FULL_IDENTITY
    );
    // Name only: ~1.0 * 0.3 = 0.30 → below 0.50 possible threshold.
    expect(result.composite).toBeLessThan(IDENTITY_MATCH_THRESHOLDS.possible);
    expect(result.classification).toBe('suppress');
  });

  it('awards the alias bonus when the hit name matches a recorded alias', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohammed A. Al-Marri',
        listEntryDob: '12/03/1982',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    // Name score lifted by alias match (~1.0) and DoB 1.0 corroborates.
    expect(result.breakdown.alias).toBe(IDENTITY_MATCH_WEIGHTS.aliasBonus);
    expect(result.classification).not.toBe('suppress');
  });

  it('does not award the alias bonus when the subject name is a better match than any alias', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '12/03/1982',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    expect(result.breakdown.alias).toBe(0);
  });

  it('treats a matching listEntryRef pin as a full ID match', () => {
    const pinnedIdentity: ResolvedIdentity = {
      ...FULL_IDENTITY,
      idNumber: undefined,
      listEntryRef: { list: 'UN-1267', reference: 'QDi.123' },
    };
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryRef: { list: 'un-1267', reference: 'QDi.123' },
      },
      SUBJECT,
      pinnedIdentity
    );
    expect(result.breakdown.id).toBe(1);
    // Name ~1.0 * 0.3 + ID 1 * 0.2 = 0.50 → possible
    expect(result.classification).toBe('possible');
  });

  it('halves the DoB weight when only the year matches', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '1982',
        listEntryNationality: 'AE',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    expect(result.breakdown.dob).toBe(0.5);
    // Name 0.3 + DoB 0.15 + Nat 0.2 = 0.65 → possible
    expect(result.classification).toBe('possible');
  });

  it('marks unresolved subjects with hasResolvedIdentity=false and never alerts', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '12/03/1982',
        listEntryNationality: 'AE',
        listEntryIdNumber: '784-1982-1234567-1',
      },
      SUBJECT,
      undefined
    );
    // Without a resolved identity, no corroboration weights fire —
    // only the name score contributes. So the composite cannot reach
    // the 'alert' band regardless of how rich the hit is, which is
    // exactly what FATF Rec 10 requires: no actionable alert until
    // the MLRO has positively identified the subject.
    expect(result.hasResolvedIdentity).toBe(false);
    expect(result.classification).not.toBe('alert');
    expect(result.breakdown.dob).toBe(0);
    expect(result.breakdown.nationality).toBe(0);
    expect(result.breakdown.id).toBe(0);
  });

  it('suppresses a different Mohamed with a different DoB and ID', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryDob: '05/07/1975',
        listEntryNationality: 'PK',
        listEntryIdNumber: '35202-9999999-9',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    // Name ~1.0 * 0.3 = 0.30 → suppress (everything else is a miss).
    expect(result.composite).toBeLessThan(IDENTITY_MATCH_THRESHOLDS.possible);
    expect(result.classification).toBe('suppress');
  });

  it('normalises ID number formatting differences (spaces, hyphens, case)', () => {
    const result = scoreHitAgainstProfile(
      {
        listEntryName: 'Mohamed Ahmed',
        listEntryIdNumber: '784 1982 1234567 1',
      },
      SUBJECT,
      FULL_IDENTITY
    );
    expect(result.breakdown.id).toBe(1);
  });

  it('normalises nationality casing', () => {
    const result = scoreHitAgainstProfile(
      { listEntryName: 'Mohamed Ahmed', listEntryNationality: 'ae' },
      SUBJECT,
      FULL_IDENTITY
    );
    expect(result.breakdown.nationality).toBe(1);
  });

  it('tolerates missing optional fields on the resolved identity', () => {
    const minimal: ResolvedIdentity = { dob: '12/03/1982' };
    const result = scoreHitAgainstProfile(
      { listEntryName: 'Mohamed Ahmed', listEntryDob: '12/03/1982' },
      SUBJECT,
      minimal
    );
    expect(result.breakdown.dob).toBe(1);
    expect(result.breakdown.nationality).toBe(0);
    expect(result.breakdown.id).toBe(0);
    expect(result.hasResolvedIdentity).toBe(true);
  });
});
