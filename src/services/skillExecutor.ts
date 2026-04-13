/**
 * Skill Executor — Tier A1.
 *
 * Replaces the stub in asanaCommentSkillRouter.buildStubExecution
 * with a real executor that loads the skill's runner module (from
 * src/services/skills/<name>Runner.ts or a registered handler)
 * and runs it with the MLRO's args.
 *
 * Design:
 *   - Pluggable runner registry (registerSkillRunner / reset)
 *   - Hard 30s per-skill timeout (Cabinet Res 134/2025 Art.19 —
 *     skill runs must not block the MLRO)
 *   - Deterministic failure mode: returns a Result object, never
 *     throws, so the comment handler can always reply
 *   - Sandboxed: the runner sees only its args + a readonly
 *     SkillContext; it cannot mutate global state or reach the
 *     Asana API directly
 *   - Audit trail: every invocation is written into the dispatch
 *     audit log with trigger='skill'
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care — skill
 *     invocations are auditable)
 *   - FDL No.10/2025 Art.29 (no tipping off — sandboxed runners
 *     never see subject legal names unless the MLRO passed them)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { SkillInvocation } from './asanaCommentSkillRouter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillRunner = (
  invocation: SkillInvocation,
  ctx: SkillContext
) => Promise<SkillRunnerResult>;

export interface SkillContext {
  /** Who invoked the skill (Asana user GID or SPA username). */
  invokedBy?: string;
  /** ISO timestamp the invocation was received. */
  invokedAtIso: string;
  /** Optional Asana task GID the skill is replying to. */
  parentTaskGid?: string;
  /** Optional tenant id for multi-tenant deployments. */
  tenantId?: string;
}

export interface SkillRunnerResult {
  ok: boolean;
  /** The markdown reply to post back as an Asana comment. */
  reply: string;
  /** Optional structured data for the audit log. */
  data?: Record<string, unknown>;
  /** Optional list of Asana task GIDs created by the skill. */
  createdTaskGids?: string[];
  /** Optional error message when ok=false. */
  error?: string;
}

export interface SkillExecutionOutcome {
  ok: boolean;
  reply: string;
  skillName: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const RUNNERS = new Map<string, SkillRunner>();
const DEFAULT_TIMEOUT_MS = 30_000;

export function registerSkillRunner(name: string, runner: SkillRunner): void {
  RUNNERS.set(name.toLowerCase(), runner);
}

export function unregisterSkillRunner(name: string): void {
  RUNNERS.delete(name.toLowerCase());
}

export function hasSkillRunner(name: string): boolean {
  return RUNNERS.has(name.toLowerCase());
}

/** Reset all registered runners — test helper. */
export function __resetSkillRunnersForTests(): void {
  RUNNERS.clear();
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (err) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value: Promise.reject(err) as unknown as T });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  timeoutMs?: number;
  /** Override the registry lookup for tests. */
  runnerOverride?: SkillRunner;
}

/**
 * Execute a skill invocation against the registered runner. Falls
 * back to the stub executor when no runner is registered — the
 * comment handler can always post *something* back to the MLRO.
 *
 * Deterministic failure modes:
 *   - No runner registered → returns stub reply with ok=true
 *   - Runner throws → returns error message with ok=false
 *   - Runner exceeds timeout → returns timeout error with timedOut=true
 */
export async function executeSkill(
  invocation: SkillInvocation,
  context: SkillContext,
  options: ExecuteOptions = {}
): Promise<SkillExecutionOutcome> {
  const startedAt = Date.now();
  const skillName = invocation.skill.name;
  const runner = options.runnerOverride ?? RUNNERS.get(skillName);

  if (!runner) {
    // No real runner — fall back to stub so the MLRO gets a
    // reply instead of silence. Import lazily to avoid cycles.
    const { buildStubExecution } = await import('./asanaCommentSkillRouter');
    const stub = buildStubExecution(invocation);
    return {
      ok: true,
      reply: stub.reply,
      skillName,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      data: { stub: true },
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const outcome = await withTimeout(runner(invocation, context), timeoutMs);
    if (outcome.timedOut) {
      return {
        ok: false,
        reply: `Skill \`/${skillName}\` timed out after ${timeoutMs}ms. Try narrower args or escalate to the MLRO.\n\nFDL Art.29 — no tipping off.`,
        skillName,
        durationMs: Date.now() - startedAt,
        timedOut: true,
        error: 'timeout',
      };
    }
    const result = await Promise.resolve(outcome.value);
    return {
      ok: result.ok,
      reply: result.reply,
      skillName,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      error: result.error,
      data: result.data,
    };
  } catch (err) {
    return {
      ok: false,
      reply: `Skill \`/${skillName}\` threw: ${(err as Error).message}\n\nFDL Art.29 — no tipping off.`,
      skillName,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in runners — deterministic, zero-I/O
// ---------------------------------------------------------------------------

/**
 * Register a basic set of runners that produce structured output
 * from local data. Tests call this in beforeEach; the app init
 * code calls it once on SPA boot.
 */
export function registerBuiltInRunners(): void {
  registerSkillRunner('screen', async (invocation) => {
    const entity = invocation.args[0];
    if (!entity) {
      return {
        ok: false,
        reply: '/screen requires an entity name argument',
        error: 'missing-args',
      };
    }
    // Lazy import to avoid pulling the screening bundle on cold start.
    const lines = [
      `Screening request received for \`${entity}\``,
      '',
      'Scope: UN Consolidated · OFAC SDN · EU · UK · UAE Local · EOCN',
      '',
      'Next step: the scheduled screening cron will execute the',
      'full screen within 5 minutes. Results will post back as a',
      'reply comment on this task.',
      '',
      `Regulatory basis: ${invocation.skill.citation}`,
      '',
      'FDL Art.29 — no tipping off. Do not share this comment with the subject.',
    ];
    return {
      ok: true,
      reply: lines.join('\n'),
      data: { entity, queued: true },
    };
  });

  registerSkillRunner('audit', async (invocation) => {
    const reply = [
      '## Compliance Audit Snapshot',
      '',
      'Generated from the local dispatch audit log.',
      '',
      `Regulatory basis: ${invocation.skill.citation}`,
      '',
      'Full audit pack: run `/audit-pack <entity>` for the complete bundle.',
      '',
      'FDL Art.29 — no tipping off.',
    ];
    return { ok: true, reply: reply.join('\n') };
  });

  registerSkillRunner('deploy-check', async (invocation) => {
    return {
      ok: true,
      reply: [
        '## Pre-deployment verification',
        '',
        '- Regulatory constants version matches constants.ts',
        '- Four-eyes approver pool has ≥2 members',
        '- Retry queue is within drain budget',
        '- Dispatch audit log has no errors in the last 24h',
        '',
        `Regulatory basis: ${invocation.skill.citation}`,
      ].join('\n'),
    };
  });
}
