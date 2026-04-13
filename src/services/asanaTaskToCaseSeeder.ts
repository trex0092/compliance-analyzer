/**
 * Asana Task → Local Case Seeder.
 *
 * When an Asana task is created directly (not via the SPA) in a
 * compliance project and carries a `compliance-case` tag or a
 * matching custom field, we want a local ComplianceCase to show
 * up on the Cases page so the MLRO doesn't have to context-switch
 * to Asana to see it.
 *
 * Pure seed builder + thin applier. The builder takes the Asana
 * task shape and returns a ComplianceCase stub; the applier hands
 * it to the local store. Tests exercise the builder shape.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO visibility into the
 *     full case inventory regardless of entry channel)
 *   - FDL No.10/2025 Art.24 (10-year retention — every case
 *     lands in the local retention chain)
 *   - FDL No.10/2025 Art.29 (no tipping off — seeded case uses
 *     the task gid as its entityId, never echoes a legal name
 *     from Asana task notes)
 */

import type { ComplianceCase, CaseType, RiskLevel } from '../domain/cases';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboundAsanaTask {
  gid: string;
  name: string;
  notes?: string;
  tags?: Array<{ gid: string; name?: string }>;
  /** Optional custom fields — used to detect a "compliance case" marker. */
  custom_fields?: Array<{
    gid?: string;
    name?: string;
    text_value?: string;
    enum_value?: { name?: string };
  }>;
  created_at?: string;
  projects?: Array<{ gid: string; name?: string }>;
}

export interface SeedOptions {
  /** Which local user id to record on the audit log. */
  seededBy?: string;
  /** Default case type if none can be inferred. */
  defaultCaseType?: CaseType;
  /** Default risk level if none can be inferred. */
  defaultRiskLevel?: RiskLevel;
}

// ---------------------------------------------------------------------------
// Tag / custom-field detection
// ---------------------------------------------------------------------------

const CASE_TAG_NAMES = [
  'compliance-case',
  'compliance_case',
  'compliance',
  'str-draft',
  'sar-draft',
];

/**
 * Does this Asana task carry a marker that says "seed a local
 * compliance case from me"? We match any of:
 *   - a tag in CASE_TAG_NAMES
 *   - a custom field whose name contains "compliance_case"
 *   - notes containing the string [SEED-LOCAL-CASE]
 */
export function isTaskSeedEligible(task: InboundAsanaTask): boolean {
  const tagHit = (task.tags ?? []).some((t) =>
    CASE_TAG_NAMES.includes((t.name ?? '').toLowerCase())
  );
  if (tagHit) return true;

  const customHit = (task.custom_fields ?? []).some((cf) =>
    (cf.name ?? '').toLowerCase().includes('compliance_case')
  );
  if (customHit) return true;

  if ((task.notes ?? '').includes('[SEED-LOCAL-CASE]')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Risk inference
// ---------------------------------------------------------------------------

function inferRiskLevel(task: InboundAsanaTask, fallback: RiskLevel): RiskLevel {
  const haystack = `${task.name} ${task.notes ?? ''}`.toLowerCase();
  if (haystack.includes('critical') || haystack.includes('freeze') || haystack.includes('sanction'))
    return 'critical';
  if (haystack.includes('high')) return 'high';
  if (haystack.includes('medium')) return 'medium';
  if (haystack.includes('low')) return 'low';
  return fallback;
}

function inferCaseType(task: InboundAsanaTask, fallback: CaseType): CaseType {
  const haystack = `${task.name} ${task.notes ?? ''}`.toLowerCase();
  if (haystack.includes('screening')) return 'screening-hit';
  if (haystack.includes('onboarding')) return 'onboarding';
  if (haystack.includes('str') || haystack.includes('sar')) return 'transaction-monitoring';
  if (haystack.includes('periodic')) return 'periodic-review';
  return fallback;
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

/**
 * Build a ComplianceCase stub from an inbound Asana task. Pure —
 * returns undefined when the task isn't seed-eligible.
 */
export function buildSeededCase(
  task: InboundAsanaTask,
  options: SeedOptions = {}
): ComplianceCase | undefined {
  if (!isTaskSeedEligible(task)) return undefined;

  const seededAt = task.created_at ?? new Date().toISOString();
  const riskLevel = inferRiskLevel(task, options.defaultRiskLevel ?? 'medium');
  const caseType = inferCaseType(task, options.defaultCaseType ?? 'onboarding');
  const seededBy = options.seededBy ?? 'asana-task-seeder';

  // CaseType → numeric default risk score for the local scoring
  // system. Callers re-run the risk engine after seeding.
  const riskScore =
    riskLevel === 'critical' ? 20 : riskLevel === 'high' ? 14 : riskLevel === 'medium' ? 8 : 3;

  return {
    id: `asana-${task.gid}`,
    // entityId intentionally uses the task gid, NEVER the task
    // name (which might echo an entity legal name from Asana).
    // FDL Art.29 — no tipping off.
    entityId: `asana-task-${task.gid}`,
    caseType,
    status: 'open',
    createdAt: seededAt,
    updatedAt: seededAt,
    createdBy: seededBy,
    sourceModule: 'manual',
    riskScore,
    riskLevel,
    redFlags: ['RF-SEEDED-FROM-ASANA'],
    findings: ['Seeded from inbound Asana task — review and enrich'],
    narrative: `This case was auto-seeded from Asana task ${task.gid} on ${seededAt}. Open the task in Asana for full context and enrich this case record before dispatching the super brain. FDL Art.29 — no tipping off.`,
    recommendation: 'continue',
    auditLog: [
      {
        id: `aud_seed_${task.gid}_${seededAt}`,
        at: seededAt,
        by: seededBy,
        action: 'created',
        note: `Case auto-seeded from Asana task ${task.gid}`,
      },
    ],
  };
}
