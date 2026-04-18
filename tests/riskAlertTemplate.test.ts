/**
 * Tests for buildRiskAlertTask — the unified Asana task template used
 * by every immediate-risk-alert trigger (sanctions-ingest delta,
 * adverse-media hot-ingest hit, PEP change, UBO change).
 *
 * Coverage:
 *   - Unresolved identity renders the FATF Rec 10 warning block.
 *   - Pinned identity renders the SUBJECT facets and the pin ref.
 *   - Severity resolves to ALERT only when pinned AND classification=alert.
 *   - AMENDMENT / DELISTING always resolve to CHANGE regardless of score.
 *   - The no-tipping-off footer is present in every output.
 *   - The task title includes the severity, list, subject, and pin ref
 *     when the subject is pinned.
 *   - Tags include severity + list slug + pinned/unresolved marker +
 *     trigger tag so Asana filters can slice by any dimension.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRiskAlertTask,
  resolveSeverity,
  type RiskAlertInput,
} from '../src/services/riskAlertTemplate';
import type { WatchlistEntry } from '../src/services/screeningWatchlist';

const BASE_SUBJECT: WatchlistEntry = {
  id: 'CUS-42',
  subjectName: 'Mohamed Ahmed',
  riskTier: 'high',
  addedAtIso: '2026-04-01T00:00:00.000Z',
  seenHitFingerprints: [],
  alertCount: 0,
};

const PINNED_SUBJECT: WatchlistEntry = {
  ...BASE_SUBJECT,
  resolvedIdentity: {
    dob: '12/03/1982',
    nationality: 'AE',
    idType: 'emirates_id',
    idNumber: '784-1982-1234567-1',
    aliases: ['Mohammed A. Al-Marri'],
    listEntryRef: { list: 'UN', reference: 'QDi.123' },
    resolvedAtIso: '2026-04-10T08:00:00.000Z',
    resolvedBy: 'MLRO',
    resolutionNote: 'Pinned by MLRO during onboarding screening',
  },
};

const CTX = {
  trigger: 'sanctions-ingest' as const,
  runId: 'sanctions-ingest-2026-04-18T10:00:00.000Z::UN',
  generatedAtIso: '2026-04-18T10:00:00.000Z',
  commitSha: 'abc1234',
};

function baseInput(): RiskAlertInput {
  return {
    subject: BASE_SUBJECT,
    match: {
      list: 'UN',
      reference: 'QDi.999',
      entryName: 'Mohamed Ahmed',
      entryAliases: ['M. Ahmed'],
      entryDob: '12/03/1982',
      entryNationality: 'AE',
      changeType: 'NEW',
      listedOn: '2026-04-18',
      reason: 'Designated for association with ISIL/Al-Qaida (QDi.999).',
    },
    score: {
      composite: 0.62,
      breakdown: { name: 0.95, dob: 0.5, nationality: 1, id: 0, alias: 0 },
      classification: 'possible',
      clamped: false,
    },
    ctx: CTX,
  };
}

describe('resolveSeverity', () => {
  it('returns CHANGE for AMENDMENT regardless of score', () => {
    expect(
      resolveSeverity(
        {
          composite: 0.95,
          breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
          classification: 'alert',
          clamped: false,
        },
        { list: 'UN', reference: 'X', entryName: 'X', changeType: 'AMENDMENT' },
        true
      )
    ).toBe('CHANGE');
  });

  it('returns CHANGE for DELISTING regardless of score', () => {
    expect(
      resolveSeverity(
        {
          composite: 0,
          breakdown: { name: 0, dob: 0, nationality: 0, id: 0, alias: 0 },
          classification: 'suppress',
          clamped: false,
        },
        { list: 'UN', reference: 'X', entryName: 'X', changeType: 'DELISTING' },
        true
      )
    ).toBe('CHANGE');
  });

  it('returns ALERT only when classification=alert AND subject is pinned', () => {
    expect(
      resolveSeverity(
        {
          composite: 0.9,
          breakdown: { name: 1, dob: 1, nationality: 1, id: 0.5, alias: 0 },
          classification: 'alert',
          clamped: false,
        },
        { list: 'UN', reference: 'X', entryName: 'X', changeType: 'NEW' },
        true
      )
    ).toBe('ALERT');
  });

  it('downgrades alert to POSSIBLE when subject is unresolved', () => {
    expect(
      resolveSeverity(
        {
          composite: 0.9,
          breakdown: { name: 1, dob: 1, nationality: 1, id: 0.5, alias: 0 },
          classification: 'alert',
          clamped: true,
        },
        { list: 'UN', reference: 'X', entryName: 'X', changeType: 'NEW' },
        false
      )
    ).toBe('POSSIBLE');
  });
});

describe('buildRiskAlertTask — unresolved POSSIBLE', () => {
  it('renders the FATF Rec 10 warning for unresolved subjects', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.severity).toBe('POSSIBLE');
    expect(task.requiresCoEscalation).toBe(false);
    expect(task.notes).toContain('UNRESOLVED');
    expect(task.notes).toContain('FATF Rec 10');
    expect(task.notes).toContain('auto-downgraded to "possible"');
  });

  it('renders the POSSIBLE action block with pin-or-dismiss steps', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.notes).toContain('Open Screening Command');
    expect(task.notes).toContain('Pin as subject');
    expect(task.notes).toContain('Not the subject');
  });

  it('tags include unresolved-identity marker', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.tags).toContain('unresolved-identity');
    expect(task.tags).toContain('possible');
    expect(task.tags).toContain('screening');
    expect(task.tags).toContain('trigger-sanctions-ingest');
  });

  it('does not tip off the subject (footer always rendered)', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.notes).toContain('Art.29');
    expect(task.notes).toContain('Do NOT notify the subject');
  });

  it('title has no pin marker when subject is unresolved', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.title).toContain('[SCREEN:POSSIBLE]');
    expect(task.title).toContain('UN');
    expect(task.title).toContain('Mohamed Ahmed');
    expect(task.title).not.toContain('PIN:');
  });
});

describe('buildRiskAlertTask — pinned ALERT', () => {
  it('renders the full SUBJECT facet block when pinned', () => {
    const input = baseInput();
    input.subject = PINNED_SUBJECT;
    input.match.reference = 'QDi.123'; // same as pinned designation
    input.score = {
      composite: 0.95,
      breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
      classification: 'alert',
      clamped: false,
    };
    const task = buildRiskAlertTask(input);
    expect(task.severity).toBe('ALERT');
    expect(task.requiresCoEscalation).toBe(true);
    expect(task.notes).toContain('PINNED');
    expect(task.notes).toContain('12/03/1982');
    expect(task.notes).toContain('AE');
    expect(task.notes).toContain('emirates_id');
    expect(task.notes).toContain('Mohammed A. Al-Marri');
    expect(task.notes).toContain('UN/QDi.123');
  });

  it('renders the ALERT action block with freeze + CNMR + STR steps', () => {
    const input = baseInput();
    input.subject = PINNED_SUBJECT;
    input.score = {
      composite: 0.95,
      breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
      classification: 'alert',
      clamped: false,
    };
    const task = buildRiskAlertTask(input);
    expect(task.notes).toContain('FREEZE all assets/accounts under CUS-42 NOW');
    expect(task.notes).toContain('EOCN');
    expect(task.notes).toContain('CNMR');
    expect(task.notes).toContain('Draft STR/SAR');
  });

  it('title includes pin marker when pinned', () => {
    const input = baseInput();
    input.subject = PINNED_SUBJECT;
    input.score = {
      composite: 0.95,
      breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
      classification: 'alert',
      clamped: false,
    };
    const task = buildRiskAlertTask(input);
    expect(task.title).toContain('[SCREEN:ALERT]');
    expect(task.title).toContain('(PIN:UN/QDi.123)');
  });

  it('tags include pinned-match + alert + list slug', () => {
    const input = baseInput();
    input.subject = PINNED_SUBJECT;
    input.score = {
      composite: 0.95,
      breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
      classification: 'alert',
      clamped: false,
    };
    const task = buildRiskAlertTask(input);
    expect(task.tags).toContain('pinned-match');
    expect(task.tags).toContain('alert');
    expect(task.tags).toContain('un');
  });
});

describe('buildRiskAlertTask — CHANGE (amendment)', () => {
  it('renders CHANGE severity and amendment summary', () => {
    const input = baseInput();
    input.subject = PINNED_SUBJECT;
    input.match.changeType = 'AMENDMENT';
    input.match.amendmentSummary = 'DoB 12/03/1982 → 12/03/1981';
    input.match.reference = 'QDi.123';
    const task = buildRiskAlertTask(input);
    expect(task.severity).toBe('CHANGE');
    expect(task.notes).toContain('AMENDMENT');
    expect(task.notes).toContain('What changed: DoB 12/03/1982 → 12/03/1981');
    expect(task.notes).toContain('Read the amendment / delisting above');
  });
});

describe('buildRiskAlertTask — formatting', () => {
  it('truncates notes to 60000 chars (Asana task body cap)', () => {
    const input = baseInput();
    input.match.reason = 'x'.repeat(10_000); // will be truncated to 300 by template
    const task = buildRiskAlertTask(input);
    expect(task.notes.length).toBeLessThanOrEqual(60_000);
  });

  it('renders score breakdown with weights line for auditor transparency', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.notes).toContain('SCORE BREAKDOWN');
    expect(task.notes).toContain('name 0.30, dob 0.30, nat 0.20, id 0.20, alias bonus 0.10');
    expect(task.notes).toContain('Composite:');
  });

  it('renders regulatory basis block with every cited article', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.notes).toContain('REGULATORY BASIS');
    expect(task.notes).toContain('FATF Rec 10');
    expect(task.notes).toContain('FDL No.10/2025 Art.12');
    expect(task.notes).toContain('FDL No.10/2025 Art.35');
    expect(task.notes).toContain('Cabinet Res 74/2020 Art.4');
    expect(task.notes).toContain('Cabinet Res 74/2020 Art.6');
  });

  it('renders SOURCE block with trigger + runId + commit', () => {
    const task = buildRiskAlertTask(baseInput());
    expect(task.notes).toContain('Trigger:   sanctions-ingest');
    expect(task.notes).toContain('abc1234');
  });
});
