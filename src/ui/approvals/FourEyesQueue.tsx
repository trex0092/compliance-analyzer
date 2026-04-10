/**
 * Four-Eyes Approval Queue
 *
 * Displays pending brain-escalated events that require two independent
 * approvers before the underlying compliance action can proceed.
 *
 * Enforced invariants (the backend enforces these too — this is UI
 * hinting, not the security boundary):
 *   1. The current user cannot approve their own submission.
 *   2. An item is "approved" only after TWO DISTINCT actors approve it.
 *   3. One rejection blocks the item (rejection is final).
 *   4. All actions are auth'd via Bearer token.
 *
 * Backend: POST /api/approvals/{approve|reject}, GET /api/approvals.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Types (mirror the backend shape)
// ---------------------------------------------------------------------------

interface BrainEventView {
  kind: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  subject?: string;
  refId?: string;
  matchScore?: number;
  meta?: Record<string, unknown>;
}

interface BrainDecisionView {
  tool: string | null;
  purpose: string;
  autoActions: string[];
  escalate: boolean;
}

interface ApprovalRecord {
  eventId: string;
  approvals: Array<{ actor: string; at: string; note?: string }>;
  rejections: Array<{ actor: string; at: string; note?: string }>;
  status: 'pending' | 'approved' | 'rejected';
}

interface PendingItem {
  id: string;
  at: string;
  event: BrainEventView;
  decision: BrainDecisionView;
  approval: ApprovalRecord;
}

interface ApiListResponse {
  pending: PendingItem[];
  count: number;
  actor: string;
}

interface ApiActionResponse {
  ok: true;
  record: ApprovalRecord;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('auth.token');
  } catch {
    return null;
  }
}

function severityBadgeClass(sev: BrainEventView['severity']): string {
  switch (sev) {
    case 'critical': return 'badge badge-critical';
    case 'high':     return 'badge badge-high';
    case 'medium':   return 'badge badge-medium';
    case 'low':      return 'badge badge-low';
    default:         return 'badge badge-info';
  }
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: 'no_auth_token' };

  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json()) as T | { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        error: (body as { error?: string }).error ?? `http_${res.status}`,
      };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FourEyesQueue(): ReactElement {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [actor, setActor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<ApiListResponse>('/api/approvals');
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setItems(res.data.pending);
    setActor(res.data.actor);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (item: PendingItem, verdict: 'approve' | 'reject', note?: string) => {
      if (!actor) return;

      // Client-side self-approval guard (backend also enforces).
      const alreadyApproved = item.approval.approvals.some((a) => a.actor === actor);
      const alreadyRejected = item.approval.rejections.some((r) => r.actor === actor);
      if (verdict === 'approve' && alreadyApproved) return;
      if (verdict === 'reject' && alreadyRejected) return;

      setBusyIds((prev) => new Set(prev).add(item.id));
      try {
        const res = await apiFetch<ApiActionResponse>(`/api/approvals/${verdict}`, {
          method: 'POST',
          body: JSON.stringify({ eventId: item.id, note }),
        });
        if (!res.ok) {
          setError(`${verdict} failed: ${res.error}`);
          return;
        }
        // Refresh the list so terminal items drop off.
        await load();
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [actor, load],
  );

  return (
    <div className="four-eyes-queue">
      <header className="four-eyes-header">
        <h2>Four-Eyes Approval Queue</h2>
        <p className="subtle">
          Every high / critical / sanctions decision requires two independent
          approvers. You are signed in as <code>{actor ?? '—'}</code>.
        </p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="empty">
          No pending approvals. All brain-escalated events are cleared.
        </p>
      )}

      <ul className="queue-list">
        {items.map((item) => {
          const selfApproved = actor
            ? item.approval.approvals.some((a) => a.actor === actor)
            : false;
          const approversNeeded = Math.max(0, 2 - item.approval.approvals.length);
          const busy = busyIds.has(item.id);

          return (
            <li key={item.id} className={`queue-item sev-${item.event.severity}`}>
              <div className="row">
                <span className={severityBadgeClass(item.event.severity)}>
                  {item.event.severity.toUpperCase()}
                </span>
                <span className="kind">{item.event.kind}</span>
                <time className="at" dateTime={item.at}>
                  {new Date(item.at).toISOString().slice(0, 16).replace('T', ' ')}
                </time>
              </div>

              <p className="summary">{item.event.summary}</p>

              {item.event.subject && (
                <p className="field">
                  <strong>Subject:</strong> {item.event.subject}
                </p>
              )}
              {item.event.refId && (
                <p className="field">
                  <strong>Ref:</strong> <code>{item.event.refId}</code>
                </p>
              )}
              {typeof item.event.matchScore === 'number' && (
                <p className="field">
                  <strong>Match score:</strong> {item.event.matchScore.toFixed(2)}
                </p>
              )}

              <div className="decision">
                <strong>Brain decision:</strong> routed to{' '}
                <code>{item.decision.tool ?? 'none'}</code>
                <div className="purpose">{item.decision.purpose}</div>
                {item.decision.autoActions.length > 0 && (
                  <ul className="auto-actions">
                    {item.decision.autoActions.map((a) => (
                      <li key={a}>
                        <code>{a}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="approvals">
                <strong>Approvals ({item.approval.approvals.length} / 2):</strong>{' '}
                {item.approval.approvals.length === 0 ? (
                  <em>none yet</em>
                ) : (
                  item.approval.approvals.map((a) => (
                    <span key={a.actor} className="approver">
                      {a.actor}
                    </span>
                  ))
                )}
                {approversNeeded > 0 && (
                  <span className="needed">
                    &nbsp;— {approversNeeded} more needed
                  </span>
                )}
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="approve"
                  disabled={busy || selfApproved}
                  aria-disabled={busy || selfApproved}
                  onClick={() => void act(item, 'approve')}
                  title={
                    selfApproved
                      ? 'You have already approved this item'
                      : 'Approve this item'
                  }
                >
                  {selfApproved ? 'Approved by you' : busy ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="reject"
                  disabled={busy}
                  onClick={() => {
                    const note = window.prompt(
                      'Reason for rejection (audit log):',
                    );
                    if (note !== null) void act(item, 'reject', note || undefined);
                  }}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default FourEyesQueue;
