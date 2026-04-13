/**
 * Asana Webhook Router — routes inbound Asana webhook events into
 * the super-brain, the local case store, and the toast buffer.
 *
 * The existing webhook receiver (`netlify/functions/asana-webhook.mts`)
 * parses Asana envelopes and forwards them as raw events. This
 * module is the pure router that decides what to do with each
 * event:
 *
 *   1. comment_added on a task we own → emit a SPA toast +
 *      (future) run brain on the referenced case
 *   2. mentioned → critical toast + auto-reply hook
 *   3. task added (resource_type = 'task', action = 'added') →
 *      auto-seed a local ComplianceCase placeholder (when tagged)
 *   4. task completed (change.field = 'completed') → mark the
 *      linked local case as 'closed' (bidirectional resolution)
 *   5. section membership changed → update the Kanban cache
 *
 * Pure function over a list of events. The caller decides what to
 * do with the RouterActions it returns. Tests cover every branch
 * through this function.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (audit trail on both sides)
 *   - FDL No.10/2025 Art.29 (no tipping off — toasts use case id
 *     only)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { AsanaWebhookEvent, SpaToastEvent } from './asanaCommentMirror';
import { parseAsanaWebhookBatch } from './asanaCommentMirror';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterActions {
  /** Toast events to push into the SPA buffer. */
  toasts: SpaToastEvent[];
  /** Task GIDs to mark resolved in the local case store. */
  resolveTaskGids: string[];
  /** Task GIDs that need a new local case seeded. */
  seedTaskGids: string[];
  /** Task GIDs whose section membership changed — kanban cache invalidation. */
  kanbanInvalidationTaskGids: string[];
  /** Task GIDs that should run the super-brain on next tick. */
  brainRunTaskGids: string[];
}

// ---------------------------------------------------------------------------
// Pure router
// ---------------------------------------------------------------------------

function empty(): RouterActions {
  return {
    toasts: [],
    resolveTaskGids: [],
    seedTaskGids: [],
    kanbanInvalidationTaskGids: [],
    brainRunTaskGids: [],
  };
}

/**
 * Route a batch of Asana webhook events into router actions. The
 * caller applies the actions in order: toasts first (always
 * safe), then kanban cache invalidation (cheap), then case seed
 * (idempotent), then resolve + brain run (may mutate local state).
 */
export function routeAsanaWebhookEvents(
  payload: { events?: AsanaWebhookEvent[] } | undefined | null,
  resolveCaseId?: (taskGid: string) => string | undefined
): RouterActions {
  if (!payload?.events || !Array.isArray(payload.events)) return empty();

  const actions = empty();

  // Toasts come from the existing comment-mirror parser.
  actions.toasts.push(...parseAsanaWebhookBatch(payload, resolveCaseId));

  // Per-event routing for the rest.
  for (const event of payload.events) {
    const resourceType = event.resource?.resource_type;
    const subtype = event.resource?.resource_subtype ?? '';
    const taskGid = event.resource?.gid;
    const parentGid = event.parent?.gid;

    if (!resourceType) continue;

    // Task created — auto-seed a local case placeholder.
    if (resourceType === 'task' && event.action === 'added' && taskGid) {
      actions.seedTaskGids.push(taskGid);
    }

    // Task completed — bidirectional resolution sync.
    if (
      resourceType === 'task' &&
      event.action === 'changed' &&
      event.change?.field === 'completed' &&
      taskGid
    ) {
      actions.resolveTaskGids.push(taskGid);
    }

    // Section membership changed — invalidate kanban cache.
    if (resourceType === 'task' && event.change?.field === 'section' && taskGid) {
      actions.kanbanInvalidationTaskGids.push(taskGid);
    }

    // @mention story — trigger a brain run on the parent task's
    // linked case so the MLRO gets an automated verdict reply.
    if (resourceType === 'story' && subtype === 'mentioned' && parentGid) {
      actions.brainRunTaskGids.push(parentGid);
    }
  }

  return dedupeActions(actions);
}

function dedupeActions(a: RouterActions): RouterActions {
  return {
    toasts: a.toasts,
    resolveTaskGids: unique(a.resolveTaskGids),
    seedTaskGids: unique(a.seedTaskGids),
    kanbanInvalidationTaskGids: unique(a.kanbanInvalidationTaskGids),
    brainRunTaskGids: unique(a.brainRunTaskGids),
  };
}

function unique<T>(xs: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
