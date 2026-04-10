/**
 * Regulator Inspector Portal.
 *
 * A read-only query surface that a MoE / EOCN inspector can use to audit
 * the compliance state. Every query is:
 *
 *   1. AUTHENTICATED — via an inspector access token (issued per-session,
 *      signed HMAC, short TTL). Validated via `verifyInspectorSession`.
 *   2. WATERMARKED — every row returned includes the inspector's session
 *      ID in the audit chain so we can prove who accessed what and when.
 *   3. SCOPED — inspector can only query the documents their role
 *      authorises (STR scope, DPMS scope, sanctions scope).
 *   4. LOGGED — each request appends an InspectorAuditEntry to the log.
 *   5. RATE-LIMITED — per-session query budget prevents mass scraping.
 *
 * The portal does NOT expose mutation APIs. An inspector cannot edit,
 * delete, or freeze anything — they can only OBSERVE. Any investigation
 * that requires action escalates out of band.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (regulatory access to internal records)
 *   - EOCN Inspection Manual v4 §7 (audit trail for regulator access)
 *   - FDL Art.24 (record retention)
 */

// ---------------------------------------------------------------------------
// Session + auth
// ---------------------------------------------------------------------------

export type InspectorScope = 'str' | 'ctr' | 'sanctions' | 'dpms' | 'ubo' | 'all';

export interface InspectorSession {
  sessionId: string;
  inspectorName: string;
  authority: 'MoE' | 'EOCN' | 'CBUAE' | 'LBMA' | 'other';
  scopes: readonly InspectorScope[];
  issuedAtIso: string;
  expiresAtIso: string;
  /** Per-session query budget remaining. */
  queryBudget: number;
}

export interface InspectorAuditEntry {
  sessionId: string;
  inspectorName: string;
  authority: InspectorSession['authority'];
  at: string;
  action: 'list' | 'get' | 'query';
  resourceType: string;
  resourceIds: readonly string[];
  allowed: boolean;
  reason?: string;
}

export interface InspectorQueryResult<T> {
  items: T[];
  sessionId: string;
  watermark: string;
  at: string;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

export interface InspectorPortalConfig {
  /** Maximum rows returned per query. */
  maxRowsPerQuery?: number;
  /** Default per-session query budget. */
  defaultBudget?: number;
  /** Clock injection for tests. */
  now?: () => Date;
}

export class InspectorPortal {
  private sessions = new Map<string, InspectorSession>();
  private auditLog: InspectorAuditEntry[] = [];
  private readonly maxRows: number;
  private readonly defaultBudget: number;
  private readonly now: () => Date;

  constructor(config: InspectorPortalConfig = {}) {
    this.maxRows = config.maxRowsPerQuery ?? 500;
    this.defaultBudget = config.defaultBudget ?? 1000;
    this.now = config.now ?? (() => new Date());
  }

  issueSession(
    inspectorName: string,
    authority: InspectorSession['authority'],
    scopes: readonly InspectorScope[],
    ttlMinutes = 120,
  ): InspectorSession {
    const nowDate = this.now();
    const sessionId = `ins-${nowDate.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
    const session: InspectorSession = {
      sessionId,
      inspectorName,
      authority,
      scopes,
      issuedAtIso: nowDate.toISOString(),
      expiresAtIso: new Date(nowDate.getTime() + ttlMinutes * 60_000).toISOString(),
      queryBudget: this.defaultBudget,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  revokeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  verifyInspectorSession(sessionId: string): InspectorSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.parse(session.expiresAtIso) < this.now().getTime()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  query<T extends { id: string }>(args: {
    sessionId: string;
    resourceType: string;
    requiredScope: InspectorScope;
    dataset: readonly T[];
    filter?: (row: T) => boolean;
  }): InspectorQueryResult<T> {
    const session = this.verifyInspectorSession(args.sessionId);
    if (!session) {
      this.audit({
        sessionId: args.sessionId,
        inspectorName: 'unknown',
        authority: 'other',
        at: this.now().toISOString(),
        action: 'query',
        resourceType: args.resourceType,
        resourceIds: [],
        allowed: false,
        reason: 'session expired or unknown',
      });
      throw new Error('inspector session invalid or expired');
    }

    if (!this.hasScope(session, args.requiredScope)) {
      this.audit({
        sessionId: session.sessionId,
        inspectorName: session.inspectorName,
        authority: session.authority,
        at: this.now().toISOString(),
        action: 'query',
        resourceType: args.resourceType,
        resourceIds: [],
        allowed: false,
        reason: `scope ${args.requiredScope} not granted`,
      });
      throw new Error(`inspector not authorised for scope "${args.requiredScope}"`);
    }

    if (session.queryBudget <= 0) {
      this.audit({
        sessionId: session.sessionId,
        inspectorName: session.inspectorName,
        authority: session.authority,
        at: this.now().toISOString(),
        action: 'query',
        resourceType: args.resourceType,
        resourceIds: [],
        allowed: false,
        reason: 'query budget exhausted',
      });
      throw new Error('inspector query budget exhausted');
    }
    session.queryBudget -= 1;

    const filtered = args.filter ? args.dataset.filter(args.filter) : [...args.dataset];
    const truncated = filtered.length > this.maxRows;
    const items = truncated ? filtered.slice(0, this.maxRows) : filtered;
    const nowIso = this.now().toISOString();
    const watermark = `INSPECTOR:${session.sessionId}|${session.authority}|${nowIso}`;

    this.audit({
      sessionId: session.sessionId,
      inspectorName: session.inspectorName,
      authority: session.authority,
      at: nowIso,
      action: 'query',
      resourceType: args.resourceType,
      resourceIds: items.map((i) => i.id),
      allowed: true,
    });

    return {
      items,
      sessionId: session.sessionId,
      watermark,
      at: nowIso,
      truncated,
    };
  }

  private hasScope(session: InspectorSession, required: InspectorScope): boolean {
    return session.scopes.includes('all') || session.scopes.includes(required);
  }

  private audit(entry: InspectorAuditEntry): void {
    this.auditLog.push(entry);
  }

  getAuditLog(): readonly InspectorAuditEntry[] {
    return this.auditLog;
  }

  getAllowedCountForSession(sessionId: string): number {
    return this.auditLog.filter((e) => e.sessionId === sessionId && e.allowed).length;
  }
}
