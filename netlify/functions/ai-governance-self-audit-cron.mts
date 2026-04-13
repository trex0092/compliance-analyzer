/**
 * AI Governance Self-Audit Cron — Tier E4.
 *
 * Runs every 24h. Executes the AI governance self-audit, runs
 * the watchdog decision, and when the decision says to open a
 * task, posts a governance task into the configured Asana
 * project.
 *
 * Regulatory basis:
 *   - NIST AI RMF 1.0 GOVERN-1 + MANAGE-4
 *   - ISO/IEC 42001:2023 Clause 9.1
 *   - EU Reg 2024/1689 Art.17
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const AUDIT_STORE = 'ai-governance-audit';

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* audit store failures are non-fatal */
  }
}

export default async (): Promise<Response> => {
  const startedAtIso = new Date().toISOString();
  const projectGid = process.env.ASANA_AI_GOVERNANCE_PROJECT_GID;
  if (!projectGid) {
    await writeAudit({
      event: 'ai_gov_cron_skipped',
      reason: 'ASANA_AI_GOVERNANCE_PROJECT_GID not set',
    });
    return Response.json({ ok: true, skipped: 'no project gid' });
  }

  try {
    const agentModule = await import('../../src/agents/definitions/ai-governance-agent');
    const watchdogModule = await import('../../src/services/aiGovernanceSelfAuditWatchdog');

    const result = agentModule.runAiGovernanceAgent({
      mode: 'self',
      target: 'compliance-analyzer',
      auditedBy: 'ai-governance-cron',
      euAiActTier: 'high',
    });

    const decision = watchdogModule.decideSelfAuditAction({
      audit: result.audit,
      scoreFloor: 80,
      warnFloor: 85,
      watchFloor: 90,
    });

    await writeAudit({
      event: 'ai_gov_cron_run',
      startedAtIso,
      overallScore: decision.overallScore,
      severity: decision.severity,
      shouldOpenTask: decision.shouldOpenTask,
      hasCriticalFailure: decision.hasCriticalFailure,
    });

    // Only open the task when the watchdog says so.
    if (decision.shouldOpenTask) {
      const payload = watchdogModule.buildGovernanceTaskPayload({
        decision,
        audit: result.audit,
        projectGid,
      });
      const asanaClient = await import('../../src/services/asanaClient');
      const created = await asanaClient.createAsanaTask(payload);
      await writeAudit({
        event: 'ai_gov_task_created',
        ok: created.ok,
        gid: created.gid,
        error: created.error,
      });
      return Response.json({
        ok: true,
        severity: decision.severity,
        overallScore: decision.overallScore,
        taskCreated: created.ok,
        taskGid: created.gid,
      });
    }

    return Response.json({
      ok: true,
      severity: decision.severity,
      overallScore: decision.overallScore,
      taskCreated: false,
      reason: 'score above threshold',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'ai_gov_cron_failed', error: message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
};

export const config: Config = {
  // Daily at 02:00 UTC — after the Asana autopilot cron, before the
  // business day starts.
  schedule: '0 2 * * *',
};
