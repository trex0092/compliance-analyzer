/**
 * Notification Center — in-app inbox that buffers alerts, Tier C
 * events, SLA escalations, and brain insights for the operator.
 *
 * Why this exists:
 *   The alertDispatcher delivers alerts out-of-band (email, Slack,
 *   pager). But operators also want a visible inbox INSIDE the tool
 *   — a persistent list of every notification that happened today
 *   with read/unread state and click-through.
 *
 *   This module is the pure state machine. It manages:
 *     - add(notification)     — append to the inbox
 *     - markRead(id, userId)  — per-user read receipt
 *     - markAllRead(userId)
 *     - dismiss(id, userId)
 *     - unreadCount(userId)
 *     - list(filter)
 *
 *   The persistence layer is injectable. Production wires it to a
 *   Netlify Blob store keyed per tenant + user. Tests use the
 *   in-memory default.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   FDL No.10/2025 Art.24    (audit trail of delivered notifications)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   NIST AI RMF 1.0 MANAGE-3 (incident visibility)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationSeverity = 'info' | 'warning' | 'critical' | 'page';

export type NotificationCategory =
  | 'alert'
  | 'tier-c'
  | 'sla'
  | 'brain'
  | 'asana'
  | 'system';

export interface Notification {
  id: string;
  tsIso: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Optional click target (internal route). */
  linkAction?: string;
  linkArg?: string;
  tenantId: string;
  regulatory?: string;
}

export interface ReadReceipt {
  notificationId: string;
  userId: string;
  readAtIso: string;
}

export interface Dismissal {
  notificationId: string;
  userId: string;
  dismissedAtIso: string;
}

export interface NotificationFilter {
  tenantId?: string;
  userId?: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  includeRead?: boolean;
  includeDismissed?: boolean;
}

export interface InboxSnapshot {
  notifications: readonly Notification[];
  readReceipts: readonly ReadReceipt[];
  dismissals: readonly Dismissal[];
}

// ---------------------------------------------------------------------------
// Store interface (injected)
// ---------------------------------------------------------------------------

export interface NotificationStore {
  load(): Promise<InboxSnapshot>;
  save(snapshot: InboxSnapshot): Promise<void>;
}

export class InMemoryNotificationStore implements NotificationStore {
  private snapshot: InboxSnapshot = {
    notifications: [],
    readReceipts: [],
    dismissals: [],
  };
  async load(): Promise<InboxSnapshot> {
    return {
      notifications: [...this.snapshot.notifications],
      readReceipts: [...this.snapshot.readReceipts],
      dismissals: [...this.snapshot.dismissals],
    };
  }
  async save(snapshot: InboxSnapshot): Promise<void> {
    this.snapshot = {
      notifications: [...snapshot.notifications],
      readReceipts: [...snapshot.readReceipts],
      dismissals: [...snapshot.dismissals],
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class NotificationCenter {
  constructor(private readonly store: NotificationStore) {}

  async add(notification: Notification): Promise<void> {
    const snap = await this.store.load();
    // Dedupe by id.
    if (snap.notifications.some((n) => n.id === notification.id)) return;
    await this.store.save({
      ...snap,
      notifications: [...snap.notifications, notification],
    });
  }

  async markRead(notificationId: string, userId: string, now: () => Date = () => new Date()): Promise<void> {
    const snap = await this.store.load();
    if (snap.readReceipts.some((r) => r.notificationId === notificationId && r.userId === userId)) {
      return; // already read
    }
    await this.store.save({
      ...snap,
      readReceipts: [
        ...snap.readReceipts,
        {
          notificationId,
          userId,
          readAtIso: now().toISOString(),
        },
      ],
    });
  }

  async markAllRead(userId: string, now: () => Date = () => new Date()): Promise<void> {
    const snap = await this.store.load();
    const existing = new Set(
      snap.readReceipts.filter((r) => r.userId === userId).map((r) => r.notificationId)
    );
    const added: ReadReceipt[] = [];
    const ts = now().toISOString();
    for (const n of snap.notifications) {
      if (!existing.has(n.id)) added.push({ notificationId: n.id, userId, readAtIso: ts });
    }
    await this.store.save({
      ...snap,
      readReceipts: [...snap.readReceipts, ...added],
    });
  }

  async dismiss(notificationId: string, userId: string, now: () => Date = () => new Date()): Promise<void> {
    const snap = await this.store.load();
    if (snap.dismissals.some((d) => d.notificationId === notificationId && d.userId === userId)) {
      return;
    }
    await this.store.save({
      ...snap,
      dismissals: [
        ...snap.dismissals,
        {
          notificationId,
          userId,
          dismissedAtIso: now().toISOString(),
        },
      ],
    });
  }

  async unreadCount(userId: string, tenantId?: string): Promise<number> {
    const snap = await this.store.load();
    const readIds = new Set(
      snap.readReceipts.filter((r) => r.userId === userId).map((r) => r.notificationId)
    );
    const dismissedIds = new Set(
      snap.dismissals.filter((d) => d.userId === userId).map((d) => d.notificationId)
    );
    return snap.notifications.filter(
      (n) =>
        !readIds.has(n.id) &&
        !dismissedIds.has(n.id) &&
        (tenantId === undefined || n.tenantId === tenantId)
    ).length;
  }

  async list(filter: NotificationFilter = {}): Promise<readonly Notification[]> {
    const snap = await this.store.load();
    const readIds =
      filter.userId === undefined
        ? new Set<string>()
        : new Set(
            snap.readReceipts
              .filter((r) => r.userId === filter.userId)
              .map((r) => r.notificationId)
          );
    const dismissedIds =
      filter.userId === undefined
        ? new Set<string>()
        : new Set(
            snap.dismissals
              .filter((d) => d.userId === filter.userId)
              .map((d) => d.notificationId)
          );
    return snap.notifications
      .filter((n) => {
        if (filter.tenantId && n.tenantId !== filter.tenantId) return false;
        if (filter.category && n.category !== filter.category) return false;
        if (filter.severity && n.severity !== filter.severity) return false;
        if (!filter.includeRead && readIds.has(n.id)) return false;
        if (!filter.includeDismissed && dismissedIds.has(n.id)) return false;
        return true;
      })
      .sort((a, b) => (a.tsIso < b.tsIso ? 1 : -1));
  }
}

// ---------------------------------------------------------------------------
// Bridge: turn an AlertEvent into a Notification
// ---------------------------------------------------------------------------

export interface AlertEventLike {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  ruleId: string;
  regulatory: string;
  meta: Readonly<Record<string, unknown>>;
}

export function alertToNotification(
  alert: AlertEventLike,
  tenantId: string,
  tsIso: string
): Notification {
  return {
    id: alert.id,
    tsIso,
    category: 'alert',
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    linkAction: `alert.open`,
    linkArg: alert.ruleId,
    tenantId,
    regulatory: alert.regulatory,
  };
}
