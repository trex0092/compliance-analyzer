/**
 * Asana Comment Mirror — webhook event → SPA toast bridge.
 *
 * When Asana emits a comment or @mention event on a task the
 * compliance-analyzer cares about, we want the MLRO to see it
 * inside the SPA without leaving the compliance context. This
 * module:
 *
 *   1. Parses the Asana webhook event envelope (pure function)
 *   2. Filters to comment + mention events only
 *   3. Maps them to a canonical SpaToastEvent
 *   4. Persists a rolling buffer in localStorage so the toast
 *      surface can drain it on mount
 *
 * Pure parser + thin localStorage wrapper. The HTTP webhook
 * receiver lives in webhook-receiver.js and forwards raw events
 * here via enqueueCommentToast().
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (operational visibility)
 *   - FDL No.10/2025 Art.29 (no tipping off — we NEVER surface
 *     the subject entity name in a comment notification, only
 *     the case id)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw Asana webhook event as shipped to /netlify/functions/asana-webhook.
 * Only the fields we use are typed — Asana sends a much fatter envelope.
 */
export interface AsanaWebhookEvent {
  action?: 'added' | 'changed' | 'removed' | 'deleted' | 'undeleted';
  resource?: {
    gid?: string;
    resource_type?: 'task' | 'story' | 'project' | 'section' | string;
    resource_subtype?: string;
  };
  parent?: {
    gid?: string;
    resource_type?: string;
  };
  user?: {
    gid?: string;
    name?: string;
  };
  created_at?: string;
  change?: {
    field?: string;
    action?: string;
    new_value?: unknown;
  };
}

export type SpaToastSeverity = 'info' | 'warning' | 'critical';

export interface SpaToastEvent {
  id: string;
  kind: 'asana_comment' | 'asana_mention' | 'asana_assignment';
  severity: SpaToastSeverity;
  title: string;
  body: string;
  /** Asana task GID the toast links back to. */
  taskGid?: string;
  /** Local case id if we can resolve it from asanaTaskLinks. */
  caseId?: string;
  /** Author of the comment / mention. */
  authorName?: string;
  /** ISO timestamp of the Asana event. */
  atIso: string;
}

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

/**
 * Parse a single Asana webhook event into a SpaToastEvent.
 * Returns `undefined` for events we don't care about (non-comment,
 * non-mention, non-assignment).
 *
 * Never echoes the subject entity name into the title or body —
 * the title uses the task GID (or the local case id when available)
 * so FDL Art.29 no-tipping-off is preserved even if the toast
 * accidentally leaks to a user outside the MLRO team.
 */
export function parseAsanaWebhookEvent(
  event: AsanaWebhookEvent,
  resolveCaseId?: (taskGid: string) => string | undefined
): SpaToastEvent | undefined {
  if (!event.action || event.action === 'deleted' || event.action === 'removed') {
    return undefined;
  }

  const resourceType = event.resource?.resource_type;
  const subtype = event.resource?.resource_subtype ?? '';
  const parentGid = event.parent?.gid;
  const authorName = event.user?.name;
  const atIso = event.created_at ?? new Date().toISOString();

  // Comment (story with comment_added subtype)
  if (resourceType === 'story' && subtype === 'comment_added') {
    const caseId = parentGid ? resolveCaseId?.(parentGid) : undefined;
    return {
      id: `comment_${event.resource?.gid ?? cryptoRand()}`,
      kind: 'asana_comment',
      severity: 'info',
      title: `New comment on ${caseId ?? parentGid ?? 'Asana task'}`,
      body: authorName ? `${authorName} added a comment.` : 'A user added a comment.',
      taskGid: parentGid,
      caseId,
      authorName,
      atIso,
    };
  }

  // @mention — Asana ships this as a story with the `mentioned`
  // subtype, or as a change event on a task where the change field
  // is `followers`. We handle the story path here.
  if (resourceType === 'story' && subtype === 'mentioned') {
    const caseId = parentGid ? resolveCaseId?.(parentGid) : undefined;
    return {
      id: `mention_${event.resource?.gid ?? cryptoRand()}`,
      kind: 'asana_mention',
      severity: 'warning',
      title: `You were mentioned on ${caseId ?? parentGid ?? 'an Asana task'}`,
      body: authorName ? `${authorName} mentioned you.` : 'You were mentioned.',
      taskGid: parentGid,
      caseId,
      authorName,
      atIso,
    };
  }

  // Assignment change
  if (resourceType === 'task' && event.change?.field === 'assignee' && event.action === 'changed') {
    const caseId = event.resource?.gid ? resolveCaseId?.(event.resource.gid) : undefined;
    return {
      id: `assign_${event.resource?.gid ?? cryptoRand()}`,
      kind: 'asana_assignment',
      severity: 'info',
      title: `Assignment changed on ${caseId ?? event.resource?.gid ?? 'Asana task'}`,
      body: authorName ? `${authorName} reassigned the task.` : 'Task was reassigned.',
      taskGid: event.resource?.gid,
      caseId,
      authorName,
      atIso,
    };
  }

  return undefined;
}

/**
 * Parse a batch envelope (Asana sends { events: [...] } per webhook POST).
 */
export function parseAsanaWebhookBatch(
  payload: { events?: AsanaWebhookEvent[] } | undefined | null,
  resolveCaseId?: (taskGid: string) => string | undefined
): SpaToastEvent[] {
  if (!payload?.events || !Array.isArray(payload.events)) return [];
  const out: SpaToastEvent[] = [];
  for (const event of payload.events) {
    const toast = parseAsanaWebhookEvent(event, resolveCaseId);
    if (toast) out.push(toast);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Browser buffer (localStorage)
// ---------------------------------------------------------------------------

const BUFFER_KEY = 'asana_toast_buffer';
const MAX_BUFFER = 50;

export function enqueueCommentToast(toast: SpaToastEvent): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(BUFFER_KEY);
    const existing: SpaToastEvent[] = raw ? JSON.parse(raw) : [];
    // Dedupe by id so replayed webhooks don't spam the toast tray.
    if (existing.some((t) => t.id === toast.id)) return;
    existing.unshift(toast);
    localStorage.setItem(BUFFER_KEY, JSON.stringify(existing.slice(0, MAX_BUFFER)));
  } catch {
    /* storage quota — degrade silently, toasts are non-critical UX */
  }
}

export function drainToastBuffer(): SpaToastEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BUFFER_KEY);
    if (!raw) return [];
    const parsed: SpaToastEvent[] = JSON.parse(raw);
    localStorage.removeItem(BUFFER_KEY);
    return parsed;
  } catch {
    return [];
  }
}

export function peekToastBuffer(): SpaToastEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as SpaToastEvent[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function cryptoRand(): string {
  // Safe on both browser (crypto.getRandomValues) and node (crypto).
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint32Array(2);
    globalThis.crypto.getRandomValues(arr);
    return `${arr[0].toString(16)}${arr[1].toString(16)}`;
  }
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
}
