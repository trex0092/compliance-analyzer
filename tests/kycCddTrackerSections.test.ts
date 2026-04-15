/**
 * Tests for src/services/asana/kycCddTrackerSections.ts — the pure
 * diff/spec module that drives the /api/setup/kyc-cdd-tracker-sections
 * endpoint.
 */
import { describe, expect, it } from 'vitest';
import {
  KYC_CDD_TRACKER_SECTIONS,
  KYC_CDD_TRACKER_SECTION_COUNT,
  diffSections,
  type ExistingSection,
} from '../src/services/asana/kycCddTrackerSections';

describe('KYC_CDD_TRACKER_SECTIONS canonical plan', () => {
  it('has exactly 16 sections', () => {
    expect(KYC_CDD_TRACKER_SECTION_COUNT).toBe(16);
    expect(KYC_CDD_TRACKER_SECTIONS).toHaveLength(16);
  });

  it('every section has a non-empty name and regulatory anchor', () => {
    for (const s of KYC_CDD_TRACKER_SECTIONS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.regulatoryAnchor.length).toBeGreaterThan(0);
      expect(s.rationale.length).toBeGreaterThan(0);
    }
  });

  it('exactly 2 terminal sections (Exited + Approved)', () => {
    const terminal = KYC_CDD_TRACKER_SECTIONS.filter((s) => s.isTerminal);
    expect(terminal).toHaveLength(2);
    expect(terminal.map((s) => s.name)).toEqual([
      '⚠️ Exited / Rejected Customers',
      '✅ Approved & Archived',
    ]);
  });

  it('terminal sections are the last 2 entries in display order', () => {
    const last = KYC_CDD_TRACKER_SECTIONS.slice(-2);
    expect(last.every((s) => s.isTerminal)).toBe(true);
  });

  it('no duplicate section names', () => {
    const names = KYC_CDD_TRACKER_SECTIONS.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every regulatory anchor cites at least one UAE law, Cabinet resolution, or FATF recommendation', () => {
    const re = /FDL|Cabinet (Res|Decision)|FATF|UNSCR/;
    for (const s of KYC_CDD_TRACKER_SECTIONS) {
      expect(re.test(s.regulatoryAnchor)).toBe(true);
    }
  });
});

describe('diffSections — brand new project (nothing exists)', () => {
  it('creates every canonical section and deletes nothing', () => {
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, []);
    expect(result.toCreate).toHaveLength(16);
    expect(result.toKeep).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
    expect(result.orphans).toHaveLength(0);
  });
});

describe('diffSections — fully provisioned project (idempotent re-run)', () => {
  it('keeps every canonical section and creates nothing', () => {
    const existing: ExistingSection[] = KYC_CDD_TRACKER_SECTIONS.map((s, i) => ({
      gid: `gid-${i}`,
      name: s.name,
    }));
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toCreate).toHaveLength(0);
    expect(result.toKeep).toHaveLength(16);
    expect(result.toDelete).toHaveLength(0);
    expect(result.orphans).toHaveLength(0);
  });
});

describe('diffSections — partially provisioned (real-world screenshot state)', () => {
  it('creates only the missing sections', () => {
    // Exactly the state of the user's project from the screenshots:
    // 7 existing sections (including the default Untitled section).
    const existing: ExistingSection[] = [
      { gid: 'g0', name: 'Untitled section', taskCount: 0 },
      { gid: 'g1', name: '🆕 New Onboarding Queue', taskCount: 2 },
      { gid: 'g2', name: '📝 Standard CDD — Pending Completion', taskCount: 4 },
      { gid: 'g3', name: '🔴 EDD Cases — High Risk & PEPs', taskCount: 3 },
      { gid: 'g4', name: '🔄 Periodic Reviews Due', taskCount: 4 },
      { gid: 'g5', name: '⚠️ Exited / Rejected Customers', taskCount: 1 },
      { gid: 'g6', name: '✅ Approved & Archived', taskCount: 1 },
    ];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);

    // Keeps the 6 canonical sections already present.
    expect(result.toKeep).toHaveLength(6);

    // Creates the 10 exception-lane sections that were missing.
    expect(result.toCreate).toHaveLength(10);
    expect(result.toCreate.map((s) => s.name)).toEqual([
      '📥 Document Collection — Awaiting Customer',
      '🔎 Sanctions Screening In Progress',
      '👥 UBO Verification Pending',
      '💰 Source of Funds / Wealth Pending',
      '📰 Adverse Media Under Review',
      '👔 Awaiting Senior Management Approval (EDD)',
      '🏛️ Awaiting Board Approval (PEP)',
      '👀 Four-Eyes Review Pending',
      '🚨 Sanctions Match — Blocked',
      '📨 STR Filing Pending — 10bd clock',
    ]);

    // Deletes the empty Untitled section placeholder.
    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0]!.name).toBe('Untitled section');
    expect(result.toDelete[0]!.gid).toBe('g0');

    // No orphans.
    expect(result.orphans).toHaveLength(0);
  });
});

describe('diffSections — Untitled section protection rule', () => {
  it('deletes empty Untitled section (the Asana placeholder)', () => {
    const existing: ExistingSection[] = [{ gid: 'gX', name: 'Untitled section', taskCount: 0 }];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0]!.reason).toMatch(/placeholder/i);
  });

  it('treats Untitled section with undefined taskCount as empty (safe to delete)', () => {
    const existing: ExistingSection[] = [{ gid: 'gX', name: 'Untitled section' }];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toDelete).toHaveLength(1);
  });

  it('does NOT delete Untitled section if it has tasks — reports as orphan instead', () => {
    const existing: ExistingSection[] = [{ gid: 'gX', name: 'Untitled section', taskCount: 3 }];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toDelete).toHaveLength(0);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]!.name).toBe('Untitled section');
    expect(result.orphans[0]!.taskCount).toBe(3);
  });
});

describe('diffSections — operator custom sections (orphan handling)', () => {
  it('never auto-deletes a custom section the operator added', () => {
    const existing: ExistingSection[] = [
      { gid: 'gC', name: '🌟 Luisa Special Workflow', taskCount: 5 },
      { gid: 'gA', name: '🆕 New Onboarding Queue', taskCount: 2 },
    ];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toDelete).toHaveLength(0);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]!.name).toBe('🌟 Luisa Special Workflow');
    expect(result.orphans[0]!.taskCount).toBe(5);
  });

  it('reports an empty custom section as orphan (still not deleted)', () => {
    const existing: ExistingSection[] = [
      { gid: 'gC', name: '📋 Custom Review Lane', taskCount: 0 },
    ];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    expect(result.toDelete).toHaveLength(0);
    expect(result.orphans).toHaveLength(1);
  });
});

describe('diffSections — exact-match name rules', () => {
  it('treats case-sensitive name differences as distinct', () => {
    const existing: ExistingSection[] = [{ gid: 'g1', name: 'new onboarding queue', taskCount: 0 }];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    // Lowercase version doesn't match the canonical 🆕 emoji version.
    expect(result.toCreate).toHaveLength(16);
    expect(result.orphans).toHaveLength(1);
  });

  it('treats emoji-missing name as distinct', () => {
    const existing: ExistingSection[] = [{ gid: 'g1', name: 'New Onboarding Queue', taskCount: 0 }];
    const result = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
    // Without the 🆕 emoji, doesn't match the canonical plan entry.
    expect(result.toCreate).toHaveLength(16);
    expect(result.orphans).toHaveLength(1);
  });
});
