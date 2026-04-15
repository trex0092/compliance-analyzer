/**
 * Session Manager — active session registry with revoke, list, and
 * force-logout.
 *
 * Why this exists:
 *   Bearer tokens stay valid until expiry. When a laptop is lost,
 *   a staff member leaves, or a compromised password is rotated,
 *   we need to revoke every active session for that user
 *   immediately. This module is the pure session ledger.
 *
 *   Injectable store. No network, no cookie handling.
 *
 * Regulatory basis:
 *   ISO/IEC 27001 A.9.4 (secure authentication)
 *   FDL No.10/2025 Art.20-22 (CO operational security)
 *   NIST SP 800-63B (session management)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  createdAtIso: string;
  expiresAtIso: string;
  lastSeenAtIso: string;
  ipAddress: string;
  userAgent: string;
  revokedAtIso: string | null;
  revokedReason: string | null;
}

export interface SessionSnapshot {
  sessions: readonly Session[];
}

export function emptySessionSnapshot(): SessionSnapshot {
  return { sessions: [] };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  ipAddress: string;
  userAgent: string;
  /** TTL in seconds. */
  ttlSeconds: number;
  now?: () => Date;
}

export function createSession(
  snapshot: SessionSnapshot,
  input: CreateSessionInput
): { snapshot: SessionSnapshot; session: Session } {
  if (!input.userId) throw new Error('createSession: userId required');
  if (!input.tenantId) throw new Error('createSession: tenantId required');
  if (input.ttlSeconds <= 0) throw new Error('createSession: ttlSeconds must be positive');

  const now = (input.now ?? (() => new Date()))();
  const expires = new Date(now.getTime() + input.ttlSeconds * 1000);

  const session: Session = {
    id: `sess:${input.tenantId}:${input.userId}:${now.getTime()}`,
    userId: input.userId,
    tenantId: input.tenantId,
    createdAtIso: now.toISOString(),
    expiresAtIso: expires.toISOString(),
    lastSeenAtIso: now.toISOString(),
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    revokedAtIso: null,
    revokedReason: null,
  };
  return {
    snapshot: { sessions: [...snapshot.sessions, session] },
    session,
  };
}

export interface RevokeInput {
  sessionId: string;
  reason: string;
  now?: () => Date;
}

export function revokeSession(
  snapshot: SessionSnapshot,
  input: RevokeInput
): SessionSnapshot {
  if (!input.reason || input.reason.length < 5) {
    throw new Error('revokeSession: reason ≥5 chars required');
  }
  const now = (input.now ?? (() => new Date()))();
  return {
    sessions: snapshot.sessions.map((s) =>
      s.id === input.sessionId
        ? { ...s, revokedAtIso: now.toISOString(), revokedReason: input.reason }
        : s
    ),
  };
}

export function revokeAllForUser(
  snapshot: SessionSnapshot,
  userId: string,
  reason: string,
  now: () => Date = () => new Date()
): SessionSnapshot {
  if (!reason || reason.length < 5) {
    throw new Error('revokeAllForUser: reason ≥5 chars required');
  }
  const ts = now().toISOString();
  return {
    sessions: snapshot.sessions.map((s) =>
      s.userId === userId && s.revokedAtIso === null
        ? { ...s, revokedAtIso: ts, revokedReason: reason }
        : s
    ),
  };
}

export function listActiveSessions(
  snapshot: SessionSnapshot,
  filter: { userId?: string; tenantId?: string } = {},
  now: () => Date = () => new Date()
): readonly Session[] {
  const nowIso = now().toISOString();
  return snapshot.sessions.filter((s) => {
    if (s.revokedAtIso !== null) return false;
    if (s.expiresAtIso <= nowIso) return false;
    if (filter.userId && s.userId !== filter.userId) return false;
    if (filter.tenantId && s.tenantId !== filter.tenantId) return false;
    return true;
  });
}

export function touchSession(
  snapshot: SessionSnapshot,
  sessionId: string,
  now: () => Date = () => new Date()
): SessionSnapshot {
  return {
    sessions: snapshot.sessions.map((s) =>
      s.id === sessionId && s.revokedAtIso === null
        ? { ...s, lastSeenAtIso: now().toISOString() }
        : s
    ),
  };
}

export function isSessionValid(
  snapshot: SessionSnapshot,
  sessionId: string,
  now: () => Date = () => new Date()
): boolean {
  const s = snapshot.sessions.find((x) => x.id === sessionId);
  if (!s) return false;
  if (s.revokedAtIso !== null) return false;
  return s.expiresAtIso > now().toISOString();
}

/**
 * Purge sessions that have been expired or revoked for more than
 * `graceSeconds` seconds. Keeps the blob small.
 */
export function pruneSessions(
  snapshot: SessionSnapshot,
  graceSeconds: number,
  now: () => Date = () => new Date()
): SessionSnapshot {
  const cutoff = new Date(now().getTime() - graceSeconds * 1000).toISOString();
  return {
    sessions: snapshot.sessions.filter((s) => {
      if (s.revokedAtIso !== null && s.revokedAtIso < cutoff) return false;
      if (s.revokedAtIso === null && s.expiresAtIso < cutoff) return false;
      return true;
    }),
  };
}
