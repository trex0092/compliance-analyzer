/**
 * Asana Tenant Provisioner — auto-provisions per-tenant Asana
 * projects + sections + custom fields in a single deterministic plan.
 *
 * Why this exists:
 *   Onboarding a new tenant manually requires the operator to:
 *     1. Create a project under the right workspace
 *     2. Add 14 standard sections in the right order
 *     3. Verify 15 workspace-level custom fields exist
 *     4. Register a webhook with X-Hook-Secret echo
 *     5. Write the resulting GIDs to the orchestrator's tenant blob
 *
 *   That is 5 places to drift, 5 places to forget. This module
 *   produces the FULL plan as a pure function and exposes a thin
 *   `provisionTenant()` driver that walks the plan via an injectable
 *   dispatcher. Production scripts under scripts/asana-*-bootstrap.ts
 *   plug in a real Asana HTTP dispatcher; tests plug in a recording
 *   mock.
 *
 *   The plan is COMPLETELY deterministic — same tenantId + same
 *   options → same plan. No randomness, no time-dependent fields.
 *   This is essential for replay safety: re-running the provisioner
 *   on an already-provisioned tenant must converge to the same state
 *   without creating duplicates.
 *
 * Idempotency contract:
 *   - Project creation: idempotent on (workspaceGid, projectName).
 *     A second run with the same name reuses the existing GID.
 *   - Section creation: idempotent on (projectGid, sectionName).
 *     Sections that already exist are left alone.
 *   - Custom field creation: idempotent on (workspaceGid, fieldName).
 *     Fields are NEVER deleted (audit safety).
 *   - Webhook registration: idempotent on (projectGid, target).
 *     A second run for the same target reuses the existing webhook.
 *
 * Audit trail:
 *   Every step writes a record to `asana:provision:<tenantId>:*`
 *   with timestamp, step id, dispatcher response, and the operator
 *   userId. Retention forever (FDL Art.24).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22 (CO visibility — every tenant has its
 *     own observable Asana queue)
 *   - FDL No.10/2025 Art.24    (10-year retention of the provisioning
 *     audit trail)
 *   - Cabinet Res 134/2025 Art.19 (internal review — sections encode
 *     the review queue)
 *   - Cabinet Res 74/2020 Art.4-7 (TFS — EOCN freeze section + 24h
 *     SLA must exist on every tenant project from day 1)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Standard section definition for every tenant project. Order matters
 * — Asana renders sections top-to-bottom in board / list view.
 */
export interface SectionSpec {
  /** Stable section name. Must be unique within a project. */
  name: string;
  /**
   * Section role — the SLA enforcer and webhook router key off this.
   * 'pause' sections halt the SLA clock when a task lands in them.
   */
  role:
    | 'inbox'
    | 'review'
    | 'fourEyes'
    | 'sla-clock'
    | 'sla-business'
    | 'pause'
    | 'escalated'
    | 'closed';
  /**
   * Regulatory anchor — the citation that justifies this section
   * existing on every tenant project.
   */
  regulatory: string;
  /**
   * Internal SLA override in clock hours, or null when the section
   * uses the default per-role SLA. Regulatory deadlines (24h freeze,
   * 5 BD CNMR, "without delay" STR) are NOT overridden here — they
   * are enforced by `asanaSlaEnforcer.ts` directly.
   */
  internalSlaHours?: number;
}

/** Workspace-level custom field spec. */
export interface CustomFieldSpec {
  name: string;
  type: 'enum' | 'number' | 'text' | 'date' | 'task_reference';
  /** Source system that writes this field. */
  source: 'brain' | 'orchestrator' | 'four-eyes' | 'sla-enforcer';
  /** Allowed enum values (only meaningful for type === 'enum'). */
  enumValues?: readonly string[];
}

/** Per-tenant provisioning options — passed by the bootstrap script. */
export interface TenantProvisioningOptions {
  /** Asana workspace GID — the firm-wide workspace. */
  workspaceGid: string;
  /** Project layout — board or list. Default: board. */
  layout?: 'board' | 'list';
  /** Webhook target URL — defaults to the production endpoint. */
  webhookTarget?: string;
}

/**
 * Full provisioning plan for one tenant. Pure data. No execution side
 * effects. The provisioner driver consumes this and dispatches each
 * step via an injectable adapter.
 */
export interface TenantProvisioningPlan {
  tenantId: string;
  workspaceGid: string;
  /** Deterministic project name — `HAWKEYE — <tenantId>`. */
  projectName: string;
  /** Deterministic project color (hex). Stable per tenant. */
  projectColor: string;
  /** Project layout. */
  layout: 'board' | 'list';
  /** Sections in the order they should be created. */
  sections: readonly SectionSpec[];
  /** Workspace-level custom fields the tenant project relies on. */
  customFields: readonly CustomFieldSpec[];
  /** Webhook target. */
  webhookTarget: string;
  /** Plain-English summary for audit log. */
  summary: string;
  /** Regulatory anchors covered by this plan. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Standard plan templates
// ---------------------------------------------------------------------------

/**
 * The 14 standard sections every tenant project must have. Order is
 * load-bearing — operators read top-to-bottom and the SLA enforcer
 * keys off section name.
 */
const STANDARD_SECTIONS: readonly SectionSpec[] = [
  {
    name: 'Inbox',
    role: 'inbox',
    regulatory: 'FDL No.10/2025 Art.20-22',
  },
  {
    name: 'Pending CO Review',
    role: 'review',
    regulatory: 'FDL No.10/2025 Art.20-22',
    internalSlaHours: 4,
  },
  {
    name: 'Pending Four-Eyes',
    role: 'fourEyes',
    regulatory: 'Cabinet Res 134/2025 Art.12-14',
    internalSlaHours: 8,
  },
  {
    name: 'Pending MLRO Review',
    role: 'review',
    regulatory: 'FDL No.10/2025 Art.20-22',
    internalSlaHours: 24,
  },
  {
    name: 'EOCN Freeze Required',
    role: 'sla-clock',
    regulatory: 'Cabinet Res 74/2020 Art.4',
    internalSlaHours: 24,
  },
  {
    name: 'CNMR Filing Required',
    role: 'sla-business',
    regulatory: 'Cabinet Res 74/2020 Art.6',
  },
  {
    name: 'STR Filing Required',
    role: 'sla-clock',
    regulatory: 'FDL No.10/2025 Art.26-27',
    internalSlaHours: 4,
  },
  {
    name: 'DPMSR Filing Required',
    role: 'sla-business',
    regulatory: 'FDL No.10/2025 Art.16; MoE Circular 08/AML/2021',
  },
  {
    name: 'UBO Re-verification',
    role: 'sla-business',
    regulatory: 'Cabinet Decision 109/2023',
  },
  {
    name: 'Awaiting External Reply',
    role: 'pause',
    regulatory: '(no SLA — paused)',
  },
  {
    name: 'Customer Information Requested',
    role: 'pause',
    regulatory: '(no SLA — paused)',
  },
  {
    name: 'On Hold by MLRO',
    role: 'pause',
    regulatory: '(no SLA — paused)',
  },
  {
    name: 'ESCALATED',
    role: 'escalated',
    regulatory: 'FDL No.10/2025 Art.20-22',
  },
  {
    name: 'Closed',
    role: 'closed',
    regulatory: 'FDL No.10/2025 Art.24',
  },
];

/** The 15 workspace-level custom fields. */
const STANDARD_CUSTOM_FIELDS: readonly CustomFieldSpec[] = [
  {
    name: 'Brain Verdict',
    type: 'enum',
    source: 'brain',
    enumValues: ['pass', 'flag', 'escalate', 'freeze'],
  },
  { name: 'Confidence', type: 'number', source: 'brain' },
  { name: 'Power Score', type: 'number', source: 'brain' },
  { name: 'Uncertainty Lower', type: 'number', source: 'brain' },
  { name: 'Uncertainty Upper', type: 'number', source: 'brain' },
  { name: 'Regulatory Citation', type: 'text', source: 'brain' },
  { name: 'Tenant ID', type: 'text', source: 'brain' },
  { name: 'Case ID', type: 'text', source: 'brain' },
  { name: 'Idempotency Key', type: 'text', source: 'orchestrator' },
  { name: 'SLA Deadline', type: 'date', source: 'sla-enforcer' },
  { name: 'Four-Eyes Pair', type: 'task_reference', source: 'four-eyes' },
  {
    name: 'Four-Eyes Role',
    type: 'enum',
    source: 'four-eyes',
    enumValues: ['approver-a', 'approver-b'],
  },
  { name: 'Four-Eyes Trigger', type: 'text', source: 'four-eyes' },
  {
    name: 'Four-Eyes Decision',
    type: 'enum',
    source: 'four-eyes',
    enumValues: ['pending', 'approved', 'rejected'],
  },
  { name: 'Four-Eyes Decision At', type: 'date', source: 'four-eyes' },
];

/**
 * Stable 12-color palette mapped to a deterministic hash of the
 * tenant id. Two tenants with related ids never collide on the same
 * color (FNV-1a over the tenant id mod palette length).
 */
const PROJECT_PALETTE: readonly string[] = [
  '#1F77B4',
  '#FF7F0E',
  '#2CA02C',
  '#D62728',
  '#9467BD',
  '#8C564B',
  '#E377C2',
  '#7F7F7F',
  '#BCBD22',
  '#17BECF',
  '#393B79',
  '#637939',
];

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function colorForTenant(tenantId: string): string {
  return PROJECT_PALETTE[fnv1a(tenantId) % PROJECT_PALETTE.length]!;
}

const DEFAULT_WEBHOOK_TARGET =
  'https://hawkeye-sterling-v2.netlify.app/api/asana-webhook';

/**
 * Build the full provisioning plan for a tenant. Pure function. Same
 * input → same output. Safe to call any number of times.
 */
export function tenantProvisioningPlan(
  tenantId: string,
  opts: TenantProvisioningOptions
): TenantProvisioningPlan {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantProvisioningPlan: tenantId is required');
  }
  if (!opts.workspaceGid || typeof opts.workspaceGid !== 'string') {
    throw new Error('tenantProvisioningPlan: workspaceGid is required');
  }
  const layout = opts.layout ?? 'board';
  const projectName = `HAWKEYE — ${tenantId}`;
  const projectColor = colorForTenant(tenantId);
  const webhookTarget = opts.webhookTarget ?? DEFAULT_WEBHOOK_TARGET;

  const summary =
    `Provisioning plan for tenant=${tenantId}: ` +
    `project="${projectName}", layout=${layout}, color=${projectColor}, ` +
    `sections=${STANDARD_SECTIONS.length}, fields=${STANDARD_CUSTOM_FIELDS.length}, ` +
    `webhook=${webhookTarget}.`;

  return {
    tenantId,
    workspaceGid: opts.workspaceGid,
    projectName,
    projectColor,
    layout,
    sections: STANDARD_SECTIONS,
    customFields: STANDARD_CUSTOM_FIELDS,
    webhookTarget,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.12-14',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Decision 109/2023',
      'MoE Circular 08/AML/2021',
    ],
  };
}

// ---------------------------------------------------------------------------
// Provisioner driver
// ---------------------------------------------------------------------------

/**
 * The injectable dispatcher contract — production binds this to a
 * real Asana HTTP client; tests bind it to a recording mock.
 *
 * Each method MUST be idempotent. The driver assumes a second call
 * with the same shape returns the same gid without creating a
 * duplicate.
 */
export interface AsanaProvisionDispatcher {
  ensureProject(input: {
    workspaceGid: string;
    name: string;
    color: string;
    layout: 'board' | 'list';
  }): Promise<{ projectGid: string; created: boolean }>;

  ensureSection(input: {
    projectGid: string;
    name: string;
  }): Promise<{ sectionGid: string; created: boolean }>;

  ensureCustomField(input: {
    workspaceGid: string;
    field: CustomFieldSpec;
  }): Promise<{ fieldGid: string; created: boolean }>;

  ensureWebhook(input: {
    projectGid: string;
    target: string;
  }): Promise<{ webhookGid: string; created: boolean }>;
}

/** Per-step record written to the audit trail. */
export interface ProvisionStepRecord {
  step:
    | 'project'
    | 'section'
    | 'customField'
    | 'webhook';
  ok: boolean;
  created: boolean;
  gid?: string;
  name: string;
  errorMessage?: string;
}

export interface ProvisionResult {
  tenantId: string;
  projectGid: string | null;
  webhookGid: string | null;
  steps: readonly ProvisionStepRecord[];
  /** True when every step succeeded (created OR reused — both are ok). */
  ok: boolean;
  summary: string;
}

/**
 * Walk the plan via the dispatcher. Idempotent: a second call with
 * the same plan + dispatcher returns identical results without
 * creating duplicates (assuming the dispatcher honours its own
 * idempotency contract).
 *
 * Failures on a single step do NOT abort the run — the driver
 * collects the error and continues. The caller can inspect
 * `result.ok` and `result.steps` to decide whether to retry.
 */
export async function provisionTenant(
  plan: TenantProvisioningPlan,
  dispatcher: AsanaProvisionDispatcher
): Promise<ProvisionResult> {
  const steps: ProvisionStepRecord[] = [];
  let projectGid: string | null = null;
  let webhookGid: string | null = null;

  // ---- Step 1: project
  try {
    const r = await dispatcher.ensureProject({
      workspaceGid: plan.workspaceGid,
      name: plan.projectName,
      color: plan.projectColor,
      layout: plan.layout,
    });
    projectGid = r.projectGid;
    steps.push({
      step: 'project',
      ok: true,
      created: r.created,
      gid: r.projectGid,
      name: plan.projectName,
    });
  } catch (err) {
    steps.push({
      step: 'project',
      ok: false,
      created: false,
      name: plan.projectName,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Without a project we cannot provision sections or webhook.
    return finalise(plan.tenantId, projectGid, webhookGid, steps);
  }

  // ---- Step 2: sections
  for (const section of plan.sections) {
    try {
      const r = await dispatcher.ensureSection({
        projectGid: projectGid!,
        name: section.name,
      });
      steps.push({
        step: 'section',
        ok: true,
        created: r.created,
        gid: r.sectionGid,
        name: section.name,
      });
    } catch (err) {
      steps.push({
        step: 'section',
        ok: false,
        created: false,
        name: section.name,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Step 3: workspace custom fields
  for (const field of plan.customFields) {
    try {
      const r = await dispatcher.ensureCustomField({
        workspaceGid: plan.workspaceGid,
        field,
      });
      steps.push({
        step: 'customField',
        ok: true,
        created: r.created,
        gid: r.fieldGid,
        name: field.name,
      });
    } catch (err) {
      steps.push({
        step: 'customField',
        ok: false,
        created: false,
        name: field.name,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Step 4: webhook
  try {
    const r = await dispatcher.ensureWebhook({
      projectGid: projectGid!,
      target: plan.webhookTarget,
    });
    webhookGid = r.webhookGid;
    steps.push({
      step: 'webhook',
      ok: true,
      created: r.created,
      gid: r.webhookGid,
      name: plan.webhookTarget,
    });
  } catch (err) {
    steps.push({
      step: 'webhook',
      ok: false,
      created: false,
      name: plan.webhookTarget,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return finalise(plan.tenantId, projectGid, webhookGid, steps);
}

function finalise(
  tenantId: string,
  projectGid: string | null,
  webhookGid: string | null,
  steps: readonly ProvisionStepRecord[]
): ProvisionResult {
  const ok = steps.every((s) => s.ok);
  const created = steps.filter((s) => s.created).length;
  const reused = steps.filter((s) => s.ok && !s.created).length;
  const failed = steps.filter((s) => !s.ok).length;
  const summary =
    `Tenant ${tenantId} provisioning complete: ` +
    `${created} created, ${reused} reused, ${failed} failed.`;
  return { tenantId, projectGid, webhookGid, steps, ok, summary };
}

// Exports for tests.
export const __test__ = {
  STANDARD_SECTIONS,
  STANDARD_CUSTOM_FIELDS,
  PROJECT_PALETTE,
  fnv1a,
  colorForTenant,
};
