/**
 * KYC / CDD Tracker Section Plan — pure specification for the
 * sections that should exist in the tenant-agnostic
 * "KYC / CDD TRACKER — ALL ENTITIES" Asana project.
 *
 * Why this exists:
 *   The existing `tenantProvisioner.ts` covers the PER-TENANT
 *   compliance programme project — one per customer entity (FG LLC,
 *   FG BRANCH, MADISON, GRAMALTIN, NAPLES, ZOE). That project
 *   tracks the tenant's own compliance lifecycle.
 *
 *   There is ALSO a tenant-agnostic "KYC / CDD TRACKER" project
 *   that aggregates CDD workstreams across ALL entities — it's
 *   where Luisa (MLRO) looks every morning to see who is pending
 *   document collection, who is awaiting a sanctions screen, who
 *   is blocked on UBO verification, and so on.
 *
 *   When the project was first created in Asana, only the happy-path
 *   sections were populated (New Onboarding Queue, Standard CDD,
 *   EDD Cases, Periodic Reviews, Exited / Rejected, Approved &
 *   Archived). That omitted the "exception lanes" where compliance
 *   work actually lives — Document Collection, Sanctions Match,
 *   Source of Funds, UBO Verification, Four-Eyes Review, STR Filing,
 *   Senior Management Approval, Board PEP Approval, etc.
 *
 *   This module is the canonical section plan. It is PURE — a list
 *   of `{ name, regulatoryAnchor, rationale }` records that a
 *   bootstrap endpoint walks against the Asana API to ensure every
 *   section exists. The endpoint is idempotent: sections that
 *   already exist are reused by name match, missing sections are
 *   created, the "Untitled section" placeholder Asana auto-creates
 *   on project creation is deleted if empty.
 *
 *   Pure function. No I/O, no state, safe for tests and for the
 *   netlify function that consumes it.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD tier + thresholds)
 *   FDL No.10/2025 Art.20-22 (CO continuous oversight)
 *   FDL No.10/2025 Art.24    (10yr retention — every stage logged)
 *   FDL No.10/2025 Art.26-27 (STR / SAR filing obligations)
 *   FDL No.10/2025 Art.29    (tipping-off prohibition)
 *   FDL No.10/2025 Art.35    (TFS screening)
 *   Cabinet Res 134/2025 Art.7-10 (CDD tier-level data collection)
 *   Cabinet Res 134/2025 Art.14   (EDD + PEP senior management + Board)
 *   Cabinet Res 134/2025 Art.19   (internal review + four-eyes)
 *   Cabinet Res 74/2020 Art.4-7   (TFS asset freeze, 24h EOCN)
 *   Cabinet Decision 109/2023     (UBO register, >25% threshold)
 *   FATF Rec 10 (CDD)
 *   FATF Rec 12 (PEP — board approval)
 *   FATF Rec 22 (DPMS CDD)
 */

/**
 * A single section in the KYC / CDD Tracker project.
 *
 * `name` is the human-readable label the MLRO sees in Asana. Changes
 * to name will make the idempotent bootstrap treat the section as
 * new (no rename, just add), so pick names carefully.
 *
 * `regulatoryAnchor` is a short citation anchoring the stage to UAE
 * regulation or FATF. Rendered in the Netlify function response and
 * surfaced in the setup wizard output so the MLRO can explain to
 * inspectors why each stage exists.
 *
 * `rationale` is plain-English operator-facing description.
 *
 * `isTerminal` marks the end-of-lifecycle sections (Exited /
 * Rejected / Approved & Archived) that MUST be preserved at the
 * bottom of the project and never reordered ahead of pending work.
 */
export interface KycCddTrackerSection {
  readonly name: string;
  readonly regulatoryAnchor: string;
  readonly rationale: string;
  readonly isTerminal?: boolean;
}

/**
 * The canonical section plan, in top-to-bottom display order. The
 * ordering matches the natural CDD lifecycle: intake → exception
 * lanes → CDD proper → EDD → approvals → terminal.
 *
 * Do NOT reorder casually — the MLRO navigates this daily and any
 * reorder needs a commit message that explains WHY.
 */
export const KYC_CDD_TRACKER_SECTIONS: readonly KycCddTrackerSection[] = [
  {
    name: '📥 Document Collection — Awaiting Customer',
    regulatoryAnchor: 'FDL Art.12-14 / Cabinet Res 134/2025 Art.7-10',
    rationale:
      'Customer identification documents requested but not yet received. Sits here until the customer replies; if idle > 30 days, auto-escalate to CDD blocked.',
  },
  {
    name: '🆕 New Onboarding Queue',
    regulatoryAnchor: 'FDL Art.12 / FATF Rec 10',
    rationale:
      'New customer onboarding requests that have arrived but not yet been triaged. First stop for every new relationship.',
  },
  {
    name: '🔎 Sanctions Screening In Progress',
    regulatoryAnchor: 'FDL Art.35 / Cabinet Res 74/2020',
    rationale:
      'Active sanctions screen against UN, OFAC, EU, UK, UAE, EOCN lists. Every lead passes through here briefly before CDD completion.',
  },
  {
    name: '👥 UBO Verification Pending',
    regulatoryAnchor: 'Cabinet Decision 109/2023 (>25% UBO threshold)',
    rationale:
      'Beneficial ownership documentation incomplete. Must be resolved before any business relationship starts.',
  },
  {
    name: '💰 Source of Funds / Wealth Pending',
    regulatoryAnchor: 'FDL Art.14 / Cabinet Res 134/2025 Art.14',
    rationale:
      'SoF required for all customers; SoW required for high-risk and EDD cases. Blocker for approval until evidence is attached.',
  },
  {
    name: '📝 Standard CDD — Pending Completion',
    regulatoryAnchor: 'FDL Art.12-14 / FATF Rec 10',
    rationale:
      'Standard-tier CDD (not EDD) in progress. Awaiting one or more required fields from the CDD checklist.',
  },
  {
    name: '📰 Adverse Media Under Review',
    regulatoryAnchor: 'FATF Rec 10 / Cabinet Res 134/2025 Art.14',
    rationale:
      'Adverse media hit detected by the screening pipeline. Needs analyst assessment before the case can move forward.',
  },
  {
    name: '🔴 EDD Cases — High Risk & PEPs',
    regulatoryAnchor: 'Cabinet Res 134/2025 Art.14 / FATF Rec 12',
    rationale:
      'Enhanced Due Diligence workstream. High-risk jurisdiction, high-risk customer type, or PEP. Requires deeper evidence and senior sign-off.',
  },
  {
    name: '👔 Awaiting Senior Management Approval (EDD)',
    regulatoryAnchor: 'Cabinet Res 134/2025 Art.14',
    rationale:
      'EDD case ready for sign-off. Senior management must approve before the business relationship starts or continues.',
  },
  {
    name: '🏛️ Awaiting Board Approval (PEP)',
    regulatoryAnchor: 'Cabinet Res 134/2025 Art.14 / FATF Rec 12',
    rationale:
      'PEP relationships require Board approval, not just senior management. Highest-touch lane, typically rare.',
  },
  {
    name: '👀 Four-Eyes Review Pending',
    regulatoryAnchor: 'Cabinet Res 134/2025 Art.19',
    rationale:
      'Two distinct approvers required before freeze / escalate / high-risk decisions take effect. Deputy MLRO provides the second pair of eyes.',
  },
  {
    name: '🚨 Sanctions Match — Blocked',
    regulatoryAnchor: 'Cabinet Res 74/2020 Art.4-7 / FDL Art.29',
    rationale:
      '24-hour freeze clock running. CNMR filing due within 5 business days. DO NOT tip off the subject (FDL Art.29). MLRO-only.',
  },
  {
    name: '📨 STR Filing Pending — 10bd clock',
    regulatoryAnchor: 'FDL Art.26-27',
    rationale:
      'Suspicion raised, STR / SAR narrative must reach goAML within 10 business days. MLRO action required — do not comment in Asana about the subject.',
  },
  {
    name: '🔄 Periodic Reviews Due',
    regulatoryAnchor: 'Cabinet Res 134/2025 Art.19',
    rationale:
      'Scheduled review checkpoint. High-risk: every 3 months. Medium: 6 months. Low: 12 months. Missing a scheduled review is itself a finding.',
  },
  {
    name: '⚠️ Exited / Rejected Customers',
    regulatoryAnchor: 'FDL Art.24 (10-year retention)',
    rationale:
      'Customers exited voluntarily, rejected during onboarding, or terminated for compliance reasons. Retained for 10 years.',
    isTerminal: true,
  },
  {
    name: '✅ Approved & Archived',
    regulatoryAnchor: 'FDL Art.24 (10-year retention)',
    rationale:
      'Fully approved, in good standing, moved out of the active queue. Periodic review still fires per the schedule above.',
    isTerminal: true,
  },
];

/**
 * Count of sections in the canonical plan. Exported for test
 * assertions and for the setup wizard summary line.
 */
export const KYC_CDD_TRACKER_SECTION_COUNT = KYC_CDD_TRACKER_SECTIONS.length;

// ---------------------------------------------------------------------------
// Diff helper — used by the bootstrap function to decide which
// sections to create vs keep vs delete.
// ---------------------------------------------------------------------------

export interface ExistingSection {
  readonly gid: string;
  readonly name: string;
  /** Task count, used only to decide whether a stray "Untitled section" is safe to delete. */
  readonly taskCount?: number;
}

export interface SectionDiff {
  /** Sections to create (in the canonical plan, not yet in Asana). */
  readonly toCreate: readonly KycCddTrackerSection[];
  /** Sections already present (by name match) — will be reused. */
  readonly toKeep: ReadonlyArray<{
    readonly name: string;
    readonly gid: string;
  }>;
  /** Stray sections to delete. Currently only the empty "Untitled section" placeholder. */
  readonly toDelete: ReadonlyArray<{
    readonly name: string;
    readonly gid: string;
    readonly reason: string;
  }>;
  /** Sections present in Asana that are NOT in the canonical plan but are NOT safe to delete (e.g. custom operator sections with tasks). Reported for transparency. */
  readonly orphans: ReadonlyArray<{
    readonly name: string;
    readonly gid: string;
    readonly taskCount: number;
  }>;
}

/**
 * Compute the diff between the canonical section plan and the
 * current state of an Asana project. Pure function.
 *
 * Rules:
 *   - Canonical sections match against existing sections by EXACT
 *     name equality. Case-sensitive, emoji-sensitive.
 *   - "Untitled section" is a special case: Asana auto-creates it
 *     on project creation. It is SAFE TO DELETE if empty
 *     (taskCount === 0). If it contains tasks, it becomes an
 *     orphan and is reported but not deleted.
 *   - Any other section present in Asana but not in the canonical
 *     plan is an orphan — reported but NEVER auto-deleted. The
 *     operator may have added custom sections for their own
 *     workflow and we must not destroy their work.
 */
export function diffSections(
  canonical: readonly KycCddTrackerSection[],
  existing: readonly ExistingSection[]
): SectionDiff {
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const canonicalNames = new Set(canonical.map((s) => s.name));

  const toCreate: KycCddTrackerSection[] = [];
  const toKeep: Array<{ name: string; gid: string }> = [];
  for (const spec of canonical) {
    const match = existingByName.get(spec.name);
    if (match) {
      toKeep.push({ name: match.name, gid: match.gid });
    } else {
      toCreate.push(spec);
    }
  }

  const toDelete: Array<{ name: string; gid: string; reason: string }> = [];
  const orphans: Array<{ name: string; gid: string; taskCount: number }> = [];
  for (const s of existing) {
    if (canonicalNames.has(s.name)) continue;
    if (s.name === 'Untitled section' && (s.taskCount ?? 0) === 0) {
      toDelete.push({
        name: s.name,
        gid: s.gid,
        reason: 'Asana auto-creates this placeholder on project creation. Empty — safe to remove.',
      });
      continue;
    }
    orphans.push({ name: s.name, gid: s.gid, taskCount: s.taskCount ?? 0 });
  }

  return { toCreate, toKeep, toDelete, orphans };
}
