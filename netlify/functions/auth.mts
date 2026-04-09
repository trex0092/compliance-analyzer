/**
 * Server-Side Authentication — Netlify Function
 *
 * Replaces client-side-only auth (localStorage) with server-validated
 * authentication. User records stored in Netlify Blobs (not client-side).
 * Sessions are HMAC-signed tokens validated server-side.
 *
 * Endpoints:
 *   POST /api/auth/login    — Authenticate and receive session token
 *   POST /api/auth/register — Create first admin (setup wizard only)
 *   POST /api/auth/validate — Validate a session token
 *   POST /api/auth/logout   — Invalidate a session token
 *   POST /api/auth/change-password — Change own password
 *
 * Security:
 *   - PBKDF2 password hashing (100K iterations, SHA-256)
 *   - HMAC-SHA256 session tokens (signed with server secret)
 *   - Brute-force protection (5 attempts / 15 min lockout)
 *   - Session expiry (2 hours)
 *   - Audit logging
 */

import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';

// ─── Constants ──────────────────────────────────────────────────────────────

const USERS_STORE = 'auth-users';
const SESSIONS_STORE = 'auth-sessions';
const AUDIT_STORE = 'auth-audit';
const PBKDF2_ITERATIONS = 100_000;
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const VALID_ROLES = ['admin', 'compliance-officer', 'analyst', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

// ─── Types ──────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string; // hex
  passwordSalt: string; // hex
  role: Role;
  active: boolean;
  createdAt: string;
  passwordChangedAt?: string;
  mustChangePassword: boolean;
}

interface SessionRecord {
  token: string;
  userId: string;
  username: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
}

interface LockoutRecord {
  count: number;
  lockedUntil?: number;
}

// ─── Crypto Helpers ─────────────────────────────────────────────────────────

function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function hashPassword(
  password: string,
  existingSalt?: Uint8Array
): Promise<{ hash: string; salt: string }> {
  const salt = existingSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256
  );
  return { hash: arrayToHex(new Uint8Array(derived)), salt: arrayToHex(salt) };
}

function getSigningSecret(): string {
  const secret = Netlify.env.get('AUTH_SIGNING_SECRET');
  if (!secret || secret.length < 32) {
    // Fall back to a derived secret from available env vars
    // In production, AUTH_SIGNING_SECRET MUST be set as a Netlify env var
    const fallback = Netlify.env.get('ANTHROPIC_API_KEY') || Netlify.env.get('ASANA_TOKEN') || '';
    if (!fallback) {
      throw new Error('AUTH_SIGNING_SECRET env var is required for server-side auth');
    }
    return fallback;
  }
  return secret;
}

async function signToken(payload: string): Promise<string> {
  const secret = getSigningSecret();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return arrayToHex(new Uint8Array(signature));
}

async function verifyToken(payload: string, signature: string): Promise<boolean> {
  const expected = await signToken(payload);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

function generateId(): string {
  return arrayToHex(crypto.getRandomValues(new Uint8Array(16)));
}

// ─── Store Helpers ──────────────────────────────────────────────────────────

async function getUser(username: string): Promise<UserRecord | null> {
  const store = getStore(USERS_STORE);
  try {
    const data = await store.get(`user:${username.toLowerCase()}`, { type: 'json' });
    return data as UserRecord | null;
  } catch {
    return null;
  }
}

async function saveUser(user: UserRecord): Promise<void> {
  const store = getStore(USERS_STORE);
  await store.setJSON(`user:${user.username.toLowerCase()}`, user);
}

async function getUserCount(): Promise<number> {
  const store = getStore(USERS_STORE);
  const { blobs } = await store.list({ prefix: 'user:' });
  return blobs.length;
}

async function saveSession(session: SessionRecord): Promise<void> {
  const store = getStore(SESSIONS_STORE);
  await store.setJSON(`session:${session.token}`, session, {
    metadata: { expiresAt: String(session.expiresAt) },
  });
}

async function getSession(token: string): Promise<SessionRecord | null> {
  const store = getStore(SESSIONS_STORE);
  try {
    const data = await store.get(`session:${token}`, { type: 'json' });
    if (!data) return null;
    const session = data as SessionRecord;
    if (Date.now() > session.expiresAt) {
      await store.delete(`session:${token}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function deleteSession(token: string): Promise<void> {
  const store = getStore(SESSIONS_STORE);
  await store.delete(`session:${token}`);
}

async function getLockout(username: string): Promise<LockoutRecord | null> {
  const store = getStore(SESSIONS_STORE);
  try {
    return (await store.get(`lockout:${username}`, { type: 'json' })) as LockoutRecord | null;
  } catch {
    return null;
  }
}

async function setLockout(username: string, record: LockoutRecord): Promise<void> {
  const store = getStore(SESSIONS_STORE);
  await store.setJSON(`lockout:${username}`, record);
}

async function clearLockout(username: string): Promise<void> {
  const store = getStore(SESSIONS_STORE);
  await store.delete(`lockout:${username}`);
}

async function auditLog(entry: Record<string, unknown>): Promise<void> {
  const store = getStore(AUDIT_STORE);
  const id = `${Date.now()}-${generateId().slice(0, 8)}`;
  await store.setJSON(`log:${id}`, { ...entry, timestamp: new Date().toISOString() });
}

// ─── Password Policy ────────────────────────────────────────────────────────

function validatePasswordPolicy(password: string): string | null {
  if (!password || password.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character.';
  return null;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleLogin(body: Record<string, unknown>, clientIp: string): Promise<Response> {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!username || !password) {
    return Response.json({ error: 'Username and password required.' }, { status: 400 });
  }

  // Check lockout
  const lockout = await getLockout(username);
  if (lockout?.lockedUntil && Date.now() < lockout.lockedUntil) {
    const minutesLeft = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
    await auditLog({ event: 'login_blocked_lockout', username, ip: clientIp });
    return Response.json(
      { error: `Account locked. Try again in ${minutesLeft} minute(s).` },
      { status: 429 }
    );
  }

  const user = await getUser(username);
  if (!user || !user.active) {
    await recordFailedAttempt(username, clientIp);
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }

  // Verify password
  const saltBytes = hexToArray(user.passwordSalt);
  const { hash } = await hashPassword(password, saltBytes);
  if (hash !== user.passwordHash) {
    await recordFailedAttempt(username, clientIp);
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }

  // Success — clear lockout, create session
  await clearLockout(username);

  const tokenPayload = `${user.id}:${Date.now()}:${generateId()}`;
  const tokenSig = await signToken(tokenPayload);
  const token = `${tokenPayload}:${tokenSig}`;

  const session: SessionRecord = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  await saveSession(session);

  await auditLog({ event: 'login_success', username, userId: user.id, ip: clientIp });

  return Response.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
}

async function recordFailedAttempt(username: string, ip: string): Promise<void> {
  const lockout = (await getLockout(username)) || { count: 0 };
  lockout.count++;
  if (lockout.count >= MAX_FAILED_ATTEMPTS) {
    lockout.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    await auditLog({ event: 'account_locked', username, ip, attempts: lockout.count });
  }
  await setLockout(username, lockout);
  await auditLog({ event: 'login_failed', username, ip, attempts: lockout.count });
}

async function handleRegister(body: Record<string, unknown>, clientIp: string): Promise<Response> {
  // Only allow registration if no users exist (setup wizard)
  const count = await getUserCount();
  if (count > 0) {
    return Response.json(
      { error: 'Registration closed. Contact an admin to create accounts.' },
      { status: 403 }
    );
  }

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.displayName || '').trim();

  if (!username || username.length < 3 || !/^[a-z0-9_]+$/.test(username)) {
    return Response.json(
      { error: 'Username must be 3+ chars, lowercase letters/numbers/underscore.' },
      { status: 400 }
    );
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return Response.json({ error: policyError }, { status: 400 });
  }

  if (!displayName) {
    return Response.json({ error: 'Display name required.' }, { status: 400 });
  }

  const { hash, salt } = await hashPassword(password);
  const user: UserRecord = {
    id: generateId(),
    username,
    displayName,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString(),
    passwordChangedAt: new Date().toISOString(),
    mustChangePassword: false,
  };

  await saveUser(user);
  await auditLog({ event: 'user_registered', username, role: 'admin', ip: clientIp });

  return Response.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
}

async function handleValidate(body: Record<string, unknown>): Promise<Response> {
  const token = String(body.token || '');
  if (!token) {
    return Response.json({ valid: false, error: 'Token required.' }, { status: 400 });
  }

  // Verify HMAC signature
  const parts = token.split(':');
  if (parts.length < 4) {
    return Response.json({ valid: false }, { status: 401 });
  }
  const sig = parts.pop()!;
  const payload = parts.join(':');
  const validSig = await verifyToken(payload, sig);
  if (!validSig) {
    return Response.json({ valid: false, error: 'Invalid token signature.' }, { status: 401 });
  }

  // Check session exists and hasn't expired
  const session = await getSession(token);
  if (!session) {
    return Response.json({ valid: false, error: 'Session expired or not found.' }, { status: 401 });
  }

  return Response.json({
    valid: true,
    user: {
      id: session.userId,
      username: session.username,
      role: session.role,
    },
  });
}

async function handleLogout(body: Record<string, unknown>, clientIp: string): Promise<Response> {
  const token = String(body.token || '');
  if (token) {
    const session = await getSession(token);
    if (session) {
      await auditLog({
        event: 'logout',
        username: session.username,
        userId: session.userId,
        ip: clientIp,
      });
    }
    await deleteSession(token);
  }
  return Response.json({ success: true });
}

async function handleChangePassword(
  body: Record<string, unknown>,
  clientIp: string
): Promise<Response> {
  const token = String(body.token || '');
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  if (!token || !newPassword) {
    return Response.json({ error: 'Token and new password required.' }, { status: 400 });
  }

  const session = await getSession(token);
  if (!session) {
    return Response.json({ error: 'Invalid session.' }, { status: 401 });
  }

  const user = await getUser(session.username);
  if (!user) {
    return Response.json({ error: 'User not found.' }, { status: 404 });
  }

  // If not mustChangePassword, verify current password
  if (!user.mustChangePassword) {
    if (!currentPassword) {
      return Response.json({ error: 'Current password required.' }, { status: 400 });
    }
    const saltBytes = hexToArray(user.passwordSalt);
    const { hash } = await hashPassword(currentPassword, saltBytes);
    if (hash !== user.passwordHash) {
      return Response.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }
  }

  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return Response.json({ error: policyError }, { status: 400 });
  }

  const { hash, salt } = await hashPassword(newPassword);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date().toISOString();
  await saveUser(user);

  await auditLog({
    event: 'password_changed',
    username: user.username,
    userId: user.id,
    ip: clientIp,
  });

  return Response.json({ success: true });
}

// ─── Router ─────────────────────────────────────────────────────────────────

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit: 5 requests per IP per 15 min for auth endpoints
  const rl = checkRateLimit(req, { max: 5, clientIp: context.ip });
  if (rl) return rl;

  const url = new URL(req.url);
  const action = url.pathname.replace('/api/auth/', '').replace('/api/auth', '');
  const clientIp = context.ip || 'unknown';

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  switch (action) {
    case 'login':
      return handleLogin(body, clientIp);
    case 'register':
      return handleRegister(body, clientIp);
    case 'validate':
      return handleValidate(body);
    case 'logout':
      return handleLogout(body, clientIp);
    case 'change-password':
      return handleChangePassword(body, clientIp);
    default:
      return Response.json({ error: `Unknown auth action: ${action}` }, { status: 404 });
  }
};

export const config: Config = {
  path: '/api/auth/*',
  method: ['POST', 'OPTIONS'],
};
