/**
 * Asana Orchestrator — unified façade over the 45+ scattered asana*.ts
 * modules in src/services/.
 *
 * BEFORE this commit, integrating with Asana required knowing which of
 * the 45 asana*.ts files held the function you needed:
 *   asanaClient.ts         — raw HTTP with retry / rate limit
 *   asanaBrainDispatcher   — brain verdict → Asana task
 *   asanaCommentSkillRouter — slash-command parser + skills catalogue
 *   asanaComplianceOrchestrator — event → task plan
 *   asanaFourEyesAsTasks    — four-eyes gate enforcement
 *   asanaHealthTelemetry    — queue depth + rate budget + last sync
 *   asanaBidirectionalSync  — inbound webhook reconciliation
 *   ... + 38 more
 *
 * The façade consolidates this into ONE import surface:
 *
 *     import { orchestrator } from 'src/services/asana/orchestrator';
 *     await orchestrator.dispatchBrainVerdict(decision);
 *     orchestrator.routeComment('/screen ACME');
 *     const health = await orchestrator.health();
 *
 * Non-goals:
 *   - This file does NOT delete or renumber any existing asana*.ts
 *     module. Every existing import still works. The façade is a
 *     pure addition.
 *   - This file does NOT introduce new business logic. Every method
 *     delegates to an existing implementation and exposes it behind
 *     a stable interface.
 *
 * Regulatory alignment is preserved by delegation: every function
 * this façade exposes inherits the regulatory citations documented
 * on the underlying implementation.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (MLRO duty of care)
 *   - FDL No.10/2025 Art.24 (record retention — audit mirror)
 *   - FDL No.10/2025 Art.29 (no tipping off — skill router)
 *   - Cabinet Res 134/2025 Art.19 (internal review — four-eyes gates)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze protocol — dispatch path)
 */

import {
  routeAsanaComment,
  buildStubExecution,
  SKILL_CATALOGUE,
  type SkillCategory,
  type SkillInvocation,
  type SkillRouteResult,
  type SkillCatalogueEntry,
  type StubExecutionResult,
} from '../asanaCommentSkillRouter';
import {
  defaultSkillRegistry,
  type SkillRunnerContext,
  type SkillRunnerRegistry,
  type SkillRunnerResult,
} from './skillRunnerRegistry';
import type { AsanaBrainTaskTemplate } from './asanaBrainTaskTemplate';

// ---------------------------------------------------------------------------
// Types surfaced at the façade level.
// ---------------------------------------------------------------------------

export interface AsanaOrchestratorDispatchResult {
  /** Deterministic idempotency key derived from the verdict. */
  idempotencyKey: string;
  /** True when the task was newly created, false when an existing
   *  task was reused (idempotent replay). */
  created: boolean;
  /** Present when the dispatch produced an Asana task gid. */
  taskGid?: string;
  /** Present when the dispatch was skipped (e.g. Asana not configured). */
  skippedReason?: string;
}

export interface AsanaOrchestratorHealth {
  asanaConfigured: boolean;
  skillCount: number;
  skillCatalogue: readonly SkillCatalogueEntry[];
  skillsByCategory: Record<SkillCategory, number>;
  idempotencyKeyCount: number;
  lastDispatchAt: string | null;
  lastDispatchResult: AsanaOrchestratorDispatchResult | null;
}

export interface BrainVerdictLike {
  /** Unique verdict id — drives idempotency. */
  id: string;
  tenantId: string;
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  confidence: number;
  recommendedAction: string;
  requiresHumanReview: boolean;
  at: string;
  entityId: string;
  entityName?: string;
  /** Citations to inject into the task description. */
  citations?: readonly string[];
}

// ---------------------------------------------------------------------------
// Idempotency store — in-memory by default, swap-in-able for Netlify
// Blobs when running server-side. The store lives behind an interface so
// tests can inject a fake.
// ---------------------------------------------------------------------------

export interface IdempotencyStore {
  has(key: string): Promise<boolean> | boolean;
  get(key: string): Promise<string | null> | string | null;
  set(key: string, taskGid: string): Promise<void> | void;
  size(): Promise<number> | number;
  clear(): Promise<void> | void;
}

class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, string>();
  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, taskGid: string): void {
    this.map.set(key, taskGid);
  }
  size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

/**
 * Derive a deterministic idempotency key from a verdict so retries of
 * the same verdict NEVER create a duplicate Asana task. The key shape
 * is `<tenantId>:<verdictId>` which is unique at the tenant level and
 * matches the stable id produced by runComplianceDecision().
 */
export function makeIdempotencyKey(v: BrainVerdictLike): string {
  return `${v.tenantId}:${v.id}`;
}

// ---------------------------------------------------------------------------
// Dispatch adapter — pluggable. The default no-op adapter lets the
// façade run in unit tests + offline environments without touching
// network. A real adapter wires asanaClient.createAsanaTask into this
// hook from a separate module.
// ---------------------------------------------------------------------------

export type DispatchAdapter = (verdict: BrainVerdictLike) => Promise<{
  taskGid?: string;
  skipped?: string;
}>;

/**
 * Richer adapter signature used by dispatchWithTemplate. Receives the
 * full template (title + notes + project env key + tags) alongside
 * the verdict so the adapter has everything it needs to call
 * asanaClient.createAsanaTask without any extra context.
 */
export interface AsanaTaskDispatchInput {
  verdict: BrainVerdictLike;
  template: AsanaBrainTaskTemplate;
}

export type TemplateDispatchAdapter = (
  input: AsanaTaskDispatchInput
) => Promise<{ taskGid?: string; skipped?: string }>;

const DEFAULT_DISPATCH_ADAPTER: DispatchAdapter = async () => ({
  skipped: 'no_adapter_configured',
});

const DEFAULT_TEMPLATE_DISPATCH_ADAPTER: TemplateDispatchAdapter = async () => ({
  skipped: 'no_template_adapter_configured',
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class AsanaOrchestrator {
  private readonly store: IdempotencyStore;
  private dispatch: DispatchAdapter;
  private templateDispatch: TemplateDispatchAdapter;
  private readonly skillRegistry: SkillRunnerRegistry;
  private lastDispatchAt: string | null = null;
  private lastDispatchResult: AsanaOrchestratorDispatchResult | null = null;

  constructor(
    opts: {
      idempotencyStore?: IdempotencyStore;
      dispatchAdapter?: DispatchAdapter;
      templateDispatchAdapter?: TemplateDispatchAdapter;
      skillRegistry?: SkillRunnerRegistry;
    } = {}
  ) {
    this.store = opts.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.dispatch = opts.dispatchAdapter ?? DEFAULT_DISPATCH_ADAPTER;
    this.templateDispatch = opts.templateDispatchAdapter ?? DEFAULT_TEMPLATE_DISPATCH_ADAPTER;
    this.skillRegistry = opts.skillRegistry ?? defaultSkillRegistry;
  }

  /**
   * Swap the dispatch adapter at runtime. Used by the Netlify function
   * entrypoint to inject an asanaClient-backed adapter without making
   * this module import the HTTP client directly.
   */
  setDispatchAdapter(adapter: DispatchAdapter): void {
    this.dispatch = adapter;
  }

  /**
   * Swap the template-aware dispatch adapter at runtime. Used by
   * brain-analyze.mts to wire the production asanaClient-backed
   * adapter without forcing this module to import the HTTP client.
   */
  setTemplateDispatchAdapter(adapter: TemplateDispatchAdapter): void {
    this.templateDispatch = adapter;
  }

  /**
   * Dispatch a brain verdict to Asana with idempotency. Calling this
   * function twice with the same verdict id returns the SAME task gid
   * without creating a duplicate task.
   */
  async dispatchBrainVerdict(verdict: BrainVerdictLike): Promise<AsanaOrchestratorDispatchResult> {
    const key = makeIdempotencyKey(verdict);

    // Idempotent replay — return the existing task gid.
    if (await this.store.has(key)) {
      const taskGid = (await this.store.get(key)) ?? undefined;
      const result: AsanaOrchestratorDispatchResult = {
        idempotencyKey: key,
        created: false,
        taskGid,
      };
      this.lastDispatchAt = new Date().toISOString();
      this.lastDispatchResult = result;
      return result;
    }

    // New dispatch — call the adapter.
    const adapterResult = await this.dispatch(verdict);
    if (adapterResult.skipped) {
      const result: AsanaOrchestratorDispatchResult = {
        idempotencyKey: key,
        created: false,
        skippedReason: adapterResult.skipped,
      };
      this.lastDispatchAt = new Date().toISOString();
      this.lastDispatchResult = result;
      return result;
    }

    if (adapterResult.taskGid) {
      await this.store.set(key, adapterResult.taskGid);
    }
    const result: AsanaOrchestratorDispatchResult = {
      idempotencyKey: key,
      created: true,
      taskGid: adapterResult.taskGid,
    };
    this.lastDispatchAt = new Date().toISOString();
    this.lastDispatchResult = result;
    return result;
  }

  /**
   * Dispatch a brain verdict to Asana using a pre-built template.
   * Shares the same idempotency store as dispatchBrainVerdict so a
   * caller can use either method and replays NEVER create a
   * duplicate task. The richer input lets the production adapter
   * build a fully-populated task body without needing a second
   * trip through the super runner.
   */
  async dispatchWithTemplate(
    verdict: BrainVerdictLike,
    template: AsanaBrainTaskTemplate
  ): Promise<AsanaOrchestratorDispatchResult> {
    const key = makeIdempotencyKey(verdict);

    // Idempotent replay path — same store as dispatchBrainVerdict.
    if (await this.store.has(key)) {
      const taskGid = (await this.store.get(key)) ?? undefined;
      const result: AsanaOrchestratorDispatchResult = {
        idempotencyKey: key,
        created: false,
        taskGid,
      };
      this.lastDispatchAt = new Date().toISOString();
      this.lastDispatchResult = result;
      return result;
    }

    const adapterResult = await this.templateDispatch({ verdict, template });
    if (adapterResult.skipped) {
      const result: AsanaOrchestratorDispatchResult = {
        idempotencyKey: key,
        created: false,
        skippedReason: adapterResult.skipped,
      };
      this.lastDispatchAt = new Date().toISOString();
      this.lastDispatchResult = result;
      return result;
    }

    if (adapterResult.taskGid) {
      await this.store.set(key, adapterResult.taskGid);
    }
    const result: AsanaOrchestratorDispatchResult = {
      idempotencyKey: key,
      created: true,
      taskGid: adapterResult.taskGid,
    };
    this.lastDispatchAt = new Date().toISOString();
    this.lastDispatchResult = result;
    return result;
  }

  /**
   * Route an inbound Asana comment through the slash-command parser.
   * Pure pass-through to asanaCommentSkillRouter — exposed here so
   * callers don't need to remember the module name.
   */
  routeComment(rawComment: string | undefined | null): SkillRouteResult {
    return routeAsanaComment(rawComment);
  }

  /**
   * Build a stub reply for a parsed invocation. Used by the webhook
   * handler when the skill does not have a real runner wired yet.
   */
  executeSkillStub(invocation: SkillInvocation): StubExecutionResult {
    return buildStubExecution(invocation);
  }

  /**
   * Execute a parsed skill invocation through the runner registry.
   * Unknown skills fall back to the stub automatically.
   * FDL Art.29 tipping-off guard runs inside the registry.
   */
  async executeSkill(
    invocation: SkillInvocation,
    ctx: SkillRunnerContext
  ): Promise<SkillRunnerResult> {
    return this.skillRegistry.execute(invocation, ctx);
  }

  /**
   * Return the skill runner registry so callers can register custom
   * runners at boot without touching the façade.
   */
  getSkillRegistry(): SkillRunnerRegistry {
    return this.skillRegistry;
  }

  /**
   * Return the full skill catalogue. The façade exposes this so
   * consumers (SPA Brain Console, webhook handler) don't need to
   * know which file holds the catalogue.
   */
  listSkills(): readonly SkillCatalogueEntry[] {
    return SKILL_CATALOGUE;
  }

  /**
   * Look up a specific skill by name. Returns null when unknown so
   * callers can render a "known skills" list on their own.
   */
  findSkill(name: string): SkillCatalogueEntry | null {
    return SKILL_CATALOGUE.find((s) => s.name === name.toLowerCase()) ?? null;
  }

  /**
   * Health snapshot for the Brain Console — shows queue depth +
   * catalogue size + last dispatch so the MLRO can see at a glance
   * whether the Asana brain is alive.
   */
  async health(): Promise<AsanaOrchestratorHealth> {
    const skillsByCategory: Record<SkillCategory, number> = {
      screening: 0,
      onboarding: 0,
      incident: 0,
      filing: 0,
      audit: 0,
      review: 0,
      reporting: 0,
      governance: 0,
    };
    for (const s of SKILL_CATALOGUE) {
      skillsByCategory[s.category] += 1;
    }
    return {
      asanaConfigured: typeof process !== 'undefined' ? Boolean(process.env?.ASANA_TOKEN) : false,
      skillCount: SKILL_CATALOGUE.length,
      skillCatalogue: SKILL_CATALOGUE,
      skillsByCategory,
      idempotencyKeyCount: await this.store.size(),
      lastDispatchAt: this.lastDispatchAt,
      lastDispatchResult: this.lastDispatchResult,
    };
  }

  /** Test-only: clear the idempotency store. */
  async clearIdempotencyForTests(): Promise<void> {
    await this.store.clear();
    this.lastDispatchAt = null;
    this.lastDispatchResult = null;
  }
}

// Default shared instance — tests use `new AsanaOrchestrator()`.
export const orchestrator = new AsanaOrchestrator();
