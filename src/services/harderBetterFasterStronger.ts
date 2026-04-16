/**
 * Harder / Better / Faster / Stronger — five native capabilities.
 *
 * Pure TypeScript, browser-safe, fully testable. These are the
 * capabilities teased on the oleg.talk carousel, re-implemented as
 * first-party modules on this repo so they sit alongside the
 * Weaponized Brain instead of behind an external skill marketplace.
 *
 *   1. generateApiDocFromExports()    Autofills API documentation
 *                                     from pre-parsed export metadata
 *                                     and flags endpoints that lack a
 *                                     regulatory citation per CLAUDE.md §8.
 *
 *   2. packageSubagent()              Packages a prompt + allowed tools
 *                                     + context budget + purpose into a
 *                                     structured SubagentDefinition the
 *                                     caller can hand to any runner.
 *
 *   3. prioritiseContextSnippets()    Deterministic scorer that ranks
 *                                     context snippets for retention
 *                                     vs drop under a total-bytes
 *                                     budget. CLAUDE.md §7 landmines
 *                                     (vendor/**, compliance-suite.js,
 *                                     node_modules/**, graphify-out/**)
 *                                     are pre-weighted to DROP.
 *
 *   4. createHookRegistry()           Deterministic event-driven hook
 *                                     table. Hooks fire in registered
 *                                     order, each under a per-hook
 *                                     timeout; failures are reported
 *                                     but do not abort subsequent hooks.
 *
 *   5. buildCheckpointManifest()      Builds a restorable snapshot
 *                                     manifest describing exactly what
 *                                     git state the caller should stash
 *                                     / tag / serialise to reconstruct
 *                                     this point-in-time later.
 */

// ---------------------------------------------------------------------------
// 1. API documentation autofill
// ---------------------------------------------------------------------------

export interface ExportedSymbol {
  /** Relative file path. */
  file: string;
  /** Exported symbol name. */
  name: string;
  /** TypeScript signature (string form). */
  signature: string;
  /** Raw JSDoc text (may be empty). */
  jsdoc: string;
  /** True when this symbol is an HTTP endpoint (e.g. a Netlify function). */
  isEndpoint?: boolean;
}

export interface ApiDocEntry {
  file: string;
  name: string;
  signature: string;
  /** First JSDoc sentence as a summary; falls back to the symbol name. */
  summary: string;
  /** Regulatory citations detected in the JSDoc. */
  citations: string[];
  /** True when the symbol is HTTP-exposed and lacks any regulatory citation. */
  citationMissing: boolean;
}

export interface ApiDocReport {
  entries: ApiDocEntry[];
  /** Symbols that require a citation per CLAUDE.md §8 but lack one. */
  missingCitationEndpoints: string[];
  narrative: string;
}

const CITATION_PATTERNS: ReadonlyArray<RegExp> = [
  /FDL\s+(No\.)?\s*10\/2025\s+Art\./i,
  /Cabinet\s+Res(olution)?\s+\d+\/\d+\s+Art\./i,
  /Cabinet\s+Decision\s+\d+\/\d+/i,
  /MoE\s+Circular\s+\d+\/AML\/\d+/i,
  /FATF\s+Rec(\.|ommendation)?\s*\d+/i,
  /LBMA\s+RGG(\s+v\d+)?/i,
  /EU\s+AI\s+Act\s+Art\.\s*\d+/i,
  /NIST\s+AI\s+RMF/i,
];

function extractCitations(text: string): string[] {
  const hits = new Set<string>();
  for (const p of CITATION_PATTERNS) {
    const m = text.match(p);
    if (m) hits.add(m[0]);
  }
  return Array.from(hits);
}

function firstSentence(text: string, fallback: string): string {
  const cleaned = text.replace(/\/\*\*|\*\/|^\s*\*/gm, '').trim();
  if (cleaned.length === 0) return fallback;
  const match = cleaned.match(/^[^.!?]+[.!?]/);
  return (match ? match[0] : (cleaned.split(/\n/)[0] ?? fallback)).trim();
}

/**
 * Produce an API doc report from pre-parsed export metadata. Caller
 * owns the parser — this keeps the module browser-safe and
 * framework-agnostic. HTTP-endpoint symbols without any regulatory
 * citation are surfaced so the MLRO can fix them before shipping.
 *
 * Regulatory basis: CLAUDE.md §8 (citation discipline), FDL Art.24.
 */
export function generateApiDocFromExports(input: {
  readonly symbols: ReadonlyArray<ExportedSymbol>;
}): ApiDocReport {
  const entries: ApiDocEntry[] = [];
  const missing: string[] = [];
  for (const s of input.symbols) {
    const citations = extractCitations(s.jsdoc);
    const citationMissing = !!s.isEndpoint && citations.length === 0;
    entries.push({
      file: s.file,
      name: s.name,
      signature: s.signature,
      summary: firstSentence(s.jsdoc, s.name),
      citations,
      citationMissing,
    });
    if (citationMissing) missing.push(`${s.file}#${s.name}`);
  }
  return {
    entries,
    missingCitationEndpoints: missing,
    narrative:
      `API doc: ${entries.length} symbol(s) documented; ` +
      (missing.length === 0
        ? 'all endpoints carry a regulatory citation.'
        : `${missing.length} HTTP endpoint(s) missing a citation — blocking per CLAUDE.md §8.`),
  };
}

// ---------------------------------------------------------------------------
// 2. Subagent packaging
// ---------------------------------------------------------------------------

export type SubagentTool =
  | 'Read'
  | 'Edit'
  | 'Write'
  | 'Glob'
  | 'Grep'
  | 'Bash'
  | 'WebFetch'
  | 'WebSearch';

export interface SubagentDefinition {
  /** Stable identifier for cache / replay. */
  id: string;
  /** Short human-readable purpose. */
  purpose: string;
  /** Full task prompt. */
  prompt: string;
  /** Allowed tools — others must be blocked by the runner. */
  allowedTools: SubagentTool[];
  /** Approximate context budget in input tokens. */
  contextBudgetTokens: number;
  /** True when the agent may mutate files. */
  writeMode: boolean;
  /** Regulatory citations that apply if the agent runs on this repo. */
  regulatoryGate: string[];
}

/**
 * Package a prompt + tools + budget into a SubagentDefinition. Fails
 * fast on obvious mis-configurations (writeMode without Edit/Write,
 * empty prompt, impossibly small budget).
 */
export function packageSubagent(input: {
  readonly id: string;
  readonly purpose: string;
  readonly prompt: string;
  readonly allowedTools: ReadonlyArray<SubagentTool>;
  readonly contextBudgetTokens: number;
  readonly writeMode?: boolean;
  readonly regulatoryGate?: ReadonlyArray<string>;
}): SubagentDefinition {
  if (input.prompt.trim().length === 0) {
    throw new Error('SubagentDefinition prompt must not be empty.');
  }
  if (input.contextBudgetTokens < 1_000) {
    throw new Error('SubagentDefinition budget must be >= 1000 tokens.');
  }
  const writeMode = input.writeMode ?? false;
  if (writeMode) {
    const canWrite = input.allowedTools.includes('Edit') || input.allowedTools.includes('Write');
    if (!canWrite) {
      throw new Error('writeMode subagents must include Edit or Write in allowedTools.');
    }
  }
  return {
    id: input.id,
    purpose: input.purpose,
    prompt: input.prompt,
    allowedTools: [...input.allowedTools],
    contextBudgetTokens: input.contextBudgetTokens,
    writeMode,
    regulatoryGate:
      input.regulatoryGate && input.regulatoryGate.length > 0
        ? [...input.regulatoryGate]
        : ['CLAUDE.md §10 (read-only vs write-mode subagent discipline)'],
  };
}

// ---------------------------------------------------------------------------
// 3. Context-budget prioritiser
// ---------------------------------------------------------------------------

export type SnippetKind =
  | 'source-code'
  | 'test'
  | 'doc'
  | 'vendor'
  | 'generated'
  | 'node-modules'
  | 'compliance-suite'
  | 'other';

export interface ContextSnippet {
  id: string;
  kind: SnippetKind;
  sizeBytes: number;
  /** Content priority signal from the caller in [0,1]. */
  callerPriority: number;
  /** ISO-8601 last-modified date; older content is lightly down-weighted. */
  lastModifiedIso?: string;
}

export interface PrioritisedContext {
  retained: ContextSnippet[];
  dropped: ContextSnippet[];
  /** Total bytes retained. */
  retainedBytes: number;
  /** Budget used for the pass. */
  budgetBytes: number;
  narrative: string;
}

// CLAUDE.md §7 landmines — things to DROP aggressively.
const LANDMINE_PENALTY: Record<SnippetKind, number> = {
  'source-code': 0,
  test: -0.05,
  doc: -0.1,
  vendor: -0.5,
  generated: -0.5,
  'node-modules': -0.9,
  'compliance-suite': -0.2, // 4300+ lines — drop large unscoped reads
  other: 0,
};

/**
 * Rank snippets by (callerPriority + landmine penalty) and admit them
 * to the retained set until the byte budget is exhausted. Deterministic
 * and dependency-free.
 *
 * Regulatory basis: CLAUDE.md §7 (context budget rules).
 */
export function prioritiseContextSnippets(input: {
  readonly snippets: ReadonlyArray<ContextSnippet>;
  readonly budgetBytes: number;
}): PrioritisedContext {
  const scored = input.snippets.map((s) => {
    // Hard-drop classes: node_modules and generated artefacts never
    // contribute regardless of callerPriority (CLAUDE.md §7).
    if (s.kind === 'node-modules' || s.kind === 'generated') {
      return { snippet: s, score: 0 };
    }
    const base = Math.max(0, Math.min(1, s.callerPriority));
    const penalty = LANDMINE_PENALTY[s.kind] ?? 0;
    // Compliance-suite mega-reads get extra penalty above 5 KB.
    const sizePenalty = s.kind === 'compliance-suite' && s.sizeBytes > 5_000 ? -0.3 : 0;
    const score = Math.max(0, base + penalty + sizePenalty);
    return { snippet: s, score };
  });
  scored.sort((a, b) => b.score - a.score || a.snippet.sizeBytes - b.snippet.sizeBytes);

  const retained: ContextSnippet[] = [];
  const dropped: ContextSnippet[] = [];
  let used = 0;
  for (const row of scored) {
    if (row.score === 0) {
      dropped.push(row.snippet);
      continue;
    }
    if (used + row.snippet.sizeBytes <= input.budgetBytes) {
      retained.push(row.snippet);
      used += row.snippet.sizeBytes;
    } else {
      dropped.push(row.snippet);
    }
  }
  return {
    retained,
    dropped,
    retainedBytes: used,
    budgetBytes: input.budgetBytes,
    narrative:
      `Context prioritisation: kept ${retained.length}/${input.snippets.length} snippet(s) ` +
      `(${used}/${input.budgetBytes} bytes). Dropped ${dropped.length} per CLAUDE.md §7.`,
  };
}

// ---------------------------------------------------------------------------
// 4. Event-driven hook registry
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'sanctions-match'
  | 'str-filed'
  | 'freeze-executed'
  | 'four-eyes-approved'
  | 'four-eyes-rejected'
  | 'cdd-review-due'
  | 'policy-updated'
  | 'audit-entry';

export type HookHandler = (payload: Readonly<Record<string, unknown>>) => Promise<void>;

export interface RegisteredHook {
  name: string;
  event: HookEvent;
  handler: HookHandler;
  timeoutMs: number;
}

export interface HookFireResult {
  hookName: string;
  event: HookEvent;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface HookRegistry {
  register(hook: Omit<RegisteredHook, 'timeoutMs'> & { timeoutMs?: number }): void;
  unregister(name: string): boolean;
  fire(event: HookEvent, payload: Readonly<Record<string, unknown>>): Promise<HookFireResult[]>;
  list(event?: HookEvent): RegisteredHook[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`hook timeout ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Create an in-memory event-driven hook registry. Deterministic fire
 * order (registration order), per-hook timeout, failures isolated to
 * the individual hook. No global state — caller owns the registry
 * lifetime.
 */
export function createHookRegistry(defaults?: { timeoutMs?: number }): HookRegistry {
  const defaultTimeout = defaults?.timeoutMs ?? 2_000;
  const hooks: RegisteredHook[] = [];

  return {
    register(hook) {
      if (hooks.some((h) => h.name === hook.name)) {
        throw new Error(`hook name already registered: ${hook.name}`);
      }
      hooks.push({
        name: hook.name,
        event: hook.event,
        handler: hook.handler,
        timeoutMs: hook.timeoutMs ?? defaultTimeout,
      });
    },

    unregister(name) {
      const idx = hooks.findIndex((h) => h.name === name);
      if (idx < 0) return false;
      hooks.splice(idx, 1);
      return true;
    },

    async fire(event, payload) {
      const subject = hooks.filter((h) => h.event === event);
      const results: HookFireResult[] = [];
      for (const h of subject) {
        const started = Date.now();
        try {
          await withTimeout(h.handler(payload), h.timeoutMs);
          results.push({
            hookName: h.name,
            event,
            ok: true,
            durationMs: Date.now() - started,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            hookName: h.name,
            event,
            ok: false,
            durationMs: Date.now() - started,
            error: message,
          });
        }
      }
      return results;
    },

    list(event) {
      return (event ? hooks.filter((h) => h.event === event) : hooks.slice()).map((h) => ({
        ...h,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Checkpoint manifest builder
// ---------------------------------------------------------------------------

export interface GitSnapshotInput {
  /** Current branch name. */
  branch: string;
  /** Current HEAD commit SHA. */
  headSha: string;
  /** Files with unstaged edits (absolute or repo-relative paths). */
  modified: readonly string[];
  /** Files currently staged but not yet committed. */
  staged: readonly string[];
  /** Files untracked by git. */
  untracked: readonly string[];
  /** Free-form label for the checkpoint. */
  label: string;
}

export interface CheckpointManifest {
  /** Stable id derived from label + head SHA. */
  id: string;
  /** ISO-8601 timestamp at manifest build time. */
  builtAtIso: string;
  /** Original input preserved verbatim for restore. */
  snapshot: GitSnapshotInput;
  /** Deterministic restore instructions in execution order. */
  restoreSteps: string[];
  /** True when the manifest captures no local state (clean tree). */
  cleanTree: boolean;
}

/**
 * Build a restorable checkpoint manifest from a git snapshot. Pure
 * function — the caller owns the git I/O; this module only formats
 * the manifest.
 */
export function buildCheckpointManifest(input: {
  readonly snapshot: GitSnapshotInput;
  readonly asOf?: Date;
}): CheckpointManifest {
  const now = input.asOf ?? new Date();
  const s = input.snapshot;
  const cleanTree = s.modified.length === 0 && s.staged.length === 0 && s.untracked.length === 0;
  const idBase = `${s.label}::${s.branch}::${s.headSha.slice(0, 8)}`;
  const id = idBase.replace(/\s+/g, '_');

  const restoreSteps: string[] = [];
  restoreSteps.push(`git fetch origin`);
  restoreSteps.push(`git checkout ${s.headSha}`);
  if (!cleanTree) {
    restoreSteps.push(
      `git stash push -u -m "${id}" -- ${[...s.modified, ...s.staged, ...s.untracked].join(' ')}`
    );
    restoreSteps.push(`git stash pop`); // caller re-applies on restore
  }
  restoreSteps.push(
    `git switch -c restore/${id} || git switch restore/${id}` // idempotent branch hop
  );

  return {
    id,
    builtAtIso: now.toISOString(),
    snapshot: {
      branch: s.branch,
      headSha: s.headSha,
      modified: [...s.modified],
      staged: [...s.staged],
      untracked: [...s.untracked],
      label: s.label,
    },
    restoreSteps,
    cleanTree,
  };
}
