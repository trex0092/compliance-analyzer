/**
 * Self-Healing Webhook Reconciler — detects orphan tasks + missing
 * webhook handshakes + dropped deliveries and produces a self-heal
 * plan that the orchestrator can execute.
 *
 * Why this exists:
 *   Asana webhooks drop silently. The X-Hook-Secret echo is a
 *   one-shot — if the receiver returns non-200 even once, Asana
 *   drops the webhook registration and no further deliveries come
 *   in. The SLA enforcer goes silent and the team only notices
 *   when breaches start piling up.
 *
 *   This module is the pure detector. It takes:
 *     - The current webhook registrations (by project)
 *     - The current set of tenant projects
 *     - The delivery log (or "last seen" timestamps)
 *
 *   And returns a reconciliation plan with one entry per
 *   discrepancy:
 *     - Missing registration (tenant project has no webhook)
 *     - Stale webhook (no delivery in N hours)
 *     - Orphan webhook (registration points to a project that no
 *       longer exists)
 *     - Handshake failure (registration exists but last attempt failed)
 *
 *   Pure function. The orchestrator executes the plan via its own
 *   dispatcher; this module only produces it.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational continuity)
 *   Cabinet Res 74/2020 Art.4 (SLA enforcement depends on webhooks)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response)
 *   ISO/IEC 27001 A.17       (business continuity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookRegistration {
  webhookGid: string;
  projectGid: string;
  targetUrl: string;
  lastDeliveryIso: string | null;
  lastHandshakeOk: boolean;
}

export interface TenantProject {
  tenantId: string;
  projectGid: string;
  expectedTargetUrl: string;
}

export interface ReconciliationAction {
  kind:
    | 'register_webhook'
    | 'replace_stale_webhook'
    | 'delete_orphan_webhook'
    | 'reattempt_handshake';
  projectGid?: string;
  webhookGid?: string;
  reason: string;
  regulatory: string;
}

export interface ReconciliationReport {
  schemaVersion: 1;
  checkedAtIso: string;
  totalRegistrations: number;
  totalTenantProjects: number;
  healthy: number;
  missing: number;
  stale: number;
  orphans: number;
  handshakeFailed: number;
  actions: readonly ReconciliationAction[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_HOURS = 24;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReconcileOptions {
  staleThresholdHours?: number;
  now?: () => Date;
}

export function reconcileWebhooks(
  registrations: readonly WebhookRegistration[],
  tenantProjects: readonly TenantProject[],
  opts: ReconcileOptions = {}
): ReconciliationReport {
  const now = (opts.now ?? (() => new Date()))();
  const staleThreshold = opts.staleThresholdHours ?? STALE_THRESHOLD_HOURS;
  const staleCutoffMs = now.getTime() - staleThreshold * 3_600_000;

  const actions: ReconciliationAction[] = [];

  const regsByProject = new Map<string, WebhookRegistration>();
  for (const r of registrations) regsByProject.set(r.projectGid, r);

  const projectsByGid = new Map<string, TenantProject>();
  for (const p of tenantProjects) projectsByGid.set(p.projectGid, p);

  let healthy = 0;
  let missing = 0;
  let stale = 0;
  let orphans = 0;
  let handshakeFailed = 0;

  // Pass 1: every tenant project should have a healthy registration.
  for (const project of tenantProjects) {
    const reg = regsByProject.get(project.projectGid);
    if (!reg) {
      missing += 1;
      actions.push({
        kind: 'register_webhook',
        projectGid: project.projectGid,
        reason: `No webhook registered for tenant project ${project.projectGid}`,
        regulatory: 'Cabinet Res 134/2025 Art.19',
      });
      continue;
    }
    if (!reg.lastHandshakeOk) {
      handshakeFailed += 1;
      actions.push({
        kind: 'reattempt_handshake',
        projectGid: project.projectGid,
        webhookGid: reg.webhookGid,
        reason: `Webhook ${reg.webhookGid} never successfully handshook`,
        regulatory: 'Cabinet Res 134/2025 Art.19',
      });
      continue;
    }
    if (reg.targetUrl !== project.expectedTargetUrl) {
      stale += 1;
      actions.push({
        kind: 'replace_stale_webhook',
        projectGid: project.projectGid,
        webhookGid: reg.webhookGid,
        reason: `Webhook target "${reg.targetUrl}" does not match expected "${project.expectedTargetUrl}"`,
        regulatory: 'FDL Art.20-22',
      });
      continue;
    }
    if (reg.lastDeliveryIso !== null && Date.parse(reg.lastDeliveryIso) < staleCutoffMs) {
      stale += 1;
      actions.push({
        kind: 'replace_stale_webhook',
        projectGid: project.projectGid,
        webhookGid: reg.webhookGid,
        reason: `No delivery in ${staleThreshold} hour(s) — webhook presumed dropped`,
        regulatory: 'Cabinet Res 74/2020 Art.4',
      });
      continue;
    }
    healthy += 1;
  }

  // Pass 2: orphan webhooks (registered but no matching tenant project).
  for (const reg of registrations) {
    if (!projectsByGid.has(reg.projectGid)) {
      orphans += 1;
      actions.push({
        kind: 'delete_orphan_webhook',
        webhookGid: reg.webhookGid,
        reason: `Webhook ${reg.webhookGid} points to project ${reg.projectGid} which is not a known tenant`,
        regulatory: 'ISO/IEC 27001 A.12',
      });
    }
  }

  return {
    schemaVersion: 1,
    checkedAtIso: now.toISOString(),
    totalRegistrations: registrations.length,
    totalTenantProjects: tenantProjects.length,
    healthy,
    missing,
    stale,
    orphans,
    handshakeFailed,
    actions,
    summary:
      actions.length === 0
        ? `Webhook estate healthy — ${healthy} registrations across ${tenantProjects.length} tenant project(s).`
        : `Reconciliation required — ${actions.length} action(s): ` +
          `${missing} missing, ${stale} stale, ${orphans} orphan(s), ${handshakeFailed} handshake failure(s).`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 74/2020 Art.4',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MANAGE-3',
      'ISO/IEC 27001 A.17',
    ],
  };
}

// Exports for tests.
export const __test__ = { STALE_THRESHOLD_HOURS };
