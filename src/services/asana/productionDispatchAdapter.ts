/**
 * Production Asana dispatch adapter — the factory that binds a
 * pre-built AsanaBrainTaskTemplate to a real asanaClient.createAsanaTask
 * call at Netlify function boot.
 *
 * Design goals:
 *   - Pure factory: no module-level side effects. Callers decide
 *     when to construct it and what config to pass.
 *   - Dependency-injectable createTask so tests never hit HTTP.
 *   - Project env var resolution happens HERE, not in the template,
 *     because env vars are operator-specific and must not leak into
 *     the pure template module.
 *   - Refuses to dispatch when the resolved project env var is
 *     unset. Returns `{ skipped: 'project_env_unset:<key>' }` so
 *     the orchestrator's last-dispatch log shows the operator
 *     exactly which env var to set.
 *   - Runs lintForTippingOff one LAST time on the final body as a
 *     belt-and-braces check against subtle template bugs.
 *   - No four-eyes logic here — that lives in its own module and
 *     runs AFTER the main dispatch returns the parent gid.
 *
 * Dedup invariants enforced here (in addition to the orchestrator's
 * idempotency store):
 *   - buildAsanaTaskFromBrainResponse always routes a verdict to
 *     EXACTLY one project env key, so there is never a second
 *     dispatch for the same verdict to a different project.
 *   - The adapter is a pure function of its inputs: same
 *     (verdict, template) → same Asana createTask call, same
 *     returned gid. Tests prove this with a fake createTask.
 *   - Failures are surfaced as `{ skipped }` not thrown, so the
 *     brain decision path never blocks on an Asana outage.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — decisions must land in
 *                             the audit trail)
 *   FDL No.10/2025 Art.24    (10-year retention — Asana backs the
 *                             brain memory store for durability)
 *   FDL No.10/2025 Art.29    (no tipping off — linter runs here
 *                             AND in the super runner)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import { lintForTippingOff } from '../tippingOffLinter';
import type { ProjectEnvKey } from './asanaBrainTaskTemplate';
import type { TemplateDispatchAdapter } from './orchestrator';
// AsanaBrainTaskTemplate + BrainVerdictLike are referenced transitively
// via TemplateDispatchAdapter's AsanaTaskDispatchInput parameter — no
// direct import needed here. Documented in the module header comment.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape this adapter expects from a createTask implementation.
 * Matches the real asanaClient.createAsanaTask return contract so
 * the adapter can be injected without a type cast in production.
 */
export interface CreateTaskResponseShape {
  gid: string;
  name?: string;
}

/**
 * Minimal payload the adapter builds for createTask. Captures
 * everything the template carries + the resolved project gid.
 */
export interface CreateTaskPayload {
  name: string;
  notes: string;
  projects: string[];
  /** Optional tags mirrored into notes for downstream filtering. */
  tags?: readonly string[];
}

export type CreateTaskFn = (payload: CreateTaskPayload) => Promise<CreateTaskResponseShape>;

/**
 * Resolver for project env keys → real Asana project GIDs. By
 * default the factory reads `process.env[key]`, but tests inject
 * their own resolver so they never touch the real environment.
 */
export type ProjectEnvResolver = (key: ProjectEnvKey) => string | undefined;

export interface ProductionAdapterConfig {
  /** Implementation of createTask. Defaults to asanaClient when omitted. */
  createTask: CreateTaskFn;
  /** Env var resolver. Defaults to reading process.env. */
  projectEnvResolver?: ProjectEnvResolver;
  /**
   * Optional hook called after every dispatch (success or skip)
   * so the Netlify function can write a structured log line
   * without duplicating logic.
   */
  onDispatch?: (result: {
    verdictId: string;
    tenantId: string;
    projectEnvKey: ProjectEnvKey;
    projectGid: string | null;
    taskGid: string | null;
    skipped: string | null;
  }) => void;
}

// ---------------------------------------------------------------------------
// Default resolver
// ---------------------------------------------------------------------------

const defaultEnvResolver: ProjectEnvResolver = (key) => {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim();
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a TemplateDispatchAdapter that actually creates tasks in
 * Asana. The returned adapter is safe to pass to
 * AsanaOrchestrator.setTemplateDispatchAdapter().
 *
 * Every call through this adapter:
 *   1. Resolves the project env key to a real GID.
 *      → missing env var: returns { skipped: 'project_env_unset:<key>' }.
 *   2. Runs lintForTippingOff on template.notes.
 *      → critical/high patterns: returns { skipped: 'tipping_off_blocked' }.
 *   3. Calls createTask with { name, notes, projects, tags }.
 *      → thrown error: returns { skipped: 'createTask_error:<msg>' }.
 *   4. Returns { taskGid: response.gid }.
 *
 * Never throws. Never creates a task in any project other than the
 * one the template routed to. Never falls back silently.
 */
export function createProductionAsanaDispatchAdapter(
  cfg: ProductionAdapterConfig
): TemplateDispatchAdapter {
  const resolveProject = cfg.projectEnvResolver ?? defaultEnvResolver;

  return async ({ verdict, template }) => {
    const projectGid = resolveProject(template.projectEnvKey);

    const logDispatch = (result: {
      projectGid: string | null;
      taskGid: string | null;
      skipped: string | null;
    }) => {
      if (cfg.onDispatch) {
        cfg.onDispatch({
          verdictId: verdict.id,
          tenantId: verdict.tenantId,
          projectEnvKey: template.projectEnvKey,
          projectGid: result.projectGid,
          taskGid: result.taskGid,
          skipped: result.skipped,
        });
      }
    };

    if (!projectGid) {
      const reason = `project_env_unset:${template.projectEnvKey}`;
      logDispatch({ projectGid: null, taskGid: null, skipped: reason });
      return { skipped: reason };
    }

    // Belt-and-braces FDL Art.29 linter. This runs regardless of
    // whatever upstream checks the template generator already did,
    // because the final body is what actually lands in Asana.
    const lint = lintForTippingOff(template.notes);
    if (!lint.clean && (lint.topSeverity === 'critical' || lint.topSeverity === 'high')) {
      const reason = `tipping_off_blocked:${lint.findings.map((f) => f.patternId).join(',')}`;
      logDispatch({ projectGid, taskGid: null, skipped: reason });
      return { skipped: reason };
    }

    try {
      const response = await cfg.createTask({
        name: template.name,
        notes: template.notes,
        projects: [projectGid],
        tags: template.tags,
      });
      logDispatch({ projectGid, taskGid: response.gid, skipped: null });
      return { taskGid: response.gid };
    } catch (err) {
      const reason = `createTask_error:${err instanceof Error ? err.message : String(err)}`;
      logDispatch({ projectGid, taskGid: null, skipped: reason });
      return { skipped: reason };
    }
  };
}

// Exports for tests.
export const __test__ = { defaultEnvResolver };
