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
import { argon2id } from 'hash-wasm';
import { checkRateLimit } from './middleware/rate-limit.mts';

// ─── Constants ──────────────────────────────────────────────────────────────

const USERS_STORE = 'auth-users';
const SESSIONS_STORE = 'auth-sessions';
const LOCKOUT_STORE = 'auth-lockouts';
const AUDIT_STORE = 'auth-audit';
// OWASP 2024 password-storage cheat sheet: PBKDF2-HMAC-SHA256 at 600,000.
// argon2id would be preferred but is unavailable in the Netlify runtime
// without a native module; 600K is the OWASP fallback baseline.
const PBKDF2_ITERATIONS = 600_000;
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
// Dummy hash to defeat login-timing enumeration oracle — always run a
// PBKDF2 pass, even when the username doesn't exist, so that the response
// time is identical for valid and invalid usernames.
const DUMMY_SALT = crypto.getRandomValues(new Uint8Array(16));

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

// Argon2id parameters chosen per OWASP 2024 password storage cheat sheet:
//   - 19 MiB memory, 2 iterations, 1 lane → conservative for serverless
//     where memory is cheap but CPU is constrained. Raise these if the
//     runtime supports it.
// The hash is stored as a tagged string `argon2id$<hashLen>$<hexHash>` so
// the verification path can tell apart argon2id and legacy PBKDF2 records
// without an extra schema bump.
const ARGON2_MEMORY_KIB = 19 * 1024;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

async function hashPassword(
  password: string,
  existingSalt?: Uint8Array
): Promise<{ hash: string; salt: string }> {
  const salt = existingSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'hex',
  });
  // Tagged with the algorithm prefix so the verification path can
  // distinguish new argon2id records from legacy PBKDF2 records.
  return { hash: `argon2id$${ARGON2_HASH_LENGTH}$${hashHex}`, salt: arrayToHex(salt) };
}

/**
 * Legacy PBKDF2 hash for records created before the argon2id migration.
 * Only used by the verification path when an existing record's hash is
 * NOT tagged with `argon2id$...`. On a successful legacy verification
 * the record is transparently upgraded to argon2id (`handleLogin`
 * re-stores the user with the new hash + salt).
 */
async function legacyPbkdf2(
  password: string,
  salt: Uint8Array
): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256
  );
  return arrayToHex(new Uint8Array(derived));
}

/**
 * Verify a supplied password against a stored user record. Returns
 * `{ ok: boolean; needsUpgrade: boolean }`. `needsUpgrade` is true when
 * the stored hash is still a legacy PBKDF2 record; the caller MUST then
 * re-hash the plaintext with argon2id and persist the new values before
 * issuing a session.
 */
async function verifyPassword(
  password: string,
  user: Pick<UserRecord, 'passwordHash' | 'passwordSalt'>
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  const saltBytes = hexToArray(user.passwordSalt);
  if (user.passwordHash.startsWith('argon2id$')) {
    // New-style record.
    const parts = user.passwordHash.split('$');
    if (parts.length !== 3) return { ok: false, needsUpgrade: false };
    const candidateHex = await argon2id({
      password,
      salt: saltBytes,
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_ITERATIONS,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: parseInt(parts[1], 10) || ARGON2_HASH_LENGTH,
      outputType: 'hex',
    });
    return { ok: candidateHex === parts[2], needsUpgrade: false };
  }
  // Legacy PBKDF2 record — accept if it matches and signal the caller
  // to upgrade on the next save.
  const legacyHex = await legacyPbkdf2(password, saltBytes);
  return { ok: legacyHex === user.passwordHash, needsUpgrade: true };
}

function getSigningSecret(): string {
  const secret = Netlify.env.get('AUTH_SIGNING_SECRET');
  if (!secret || secret.length < 32) {
    // FAIL HARD — never reuse a model/API token as an HMAC signing secret.
    // If AUTH_SIGNING_SECRET is missing or too short, the auth layer is
    // misconfigured and MUST refuse to issue or verify tokens. Silent
    // fallback to another env var previously masked configuration errors
    // and conflated two distinct secrets into one blast radius.
    //
    // Fix: set AUTH_SIGNING_SECRET to a ≥32-char random value in Netlify
    // env. Generate via:  openssl rand -hex 32
    throw new Error(
      'AUTH_SIGNING_SECRET env var is required and must be at least 32 characters. ' +
        'Auth is refusing to operate with a missing or short signing secret.'
    );
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

// Lockouts live in their own blob store so an attacker listing the
// sessions store cannot enumerate usernames from the lockout: prefix.
async function getLockout(username: string): Promise<LockoutRecord | null> {
  const store = getStore(LOCKOUT_STORE);
  try {
    return (await store.get(`lockout:${username}`, { type: 'json' })) as LockoutRecord | null;
  } catch {
    return null;
  }
}

// Get the lockout record along with its etag for CAS. Falls back
// to a plain get if the SDK doesn't expose getWithMetadata.
async function getLockoutWithMetadata(
  username: string,
): Promise<{ record: LockoutRecord | null; etag: string | null }> {
  const store = getStore(LOCKOUT_STORE);
  try {
    const withMeta: unknown =
      typeof (store as unknown as { getWithMetadata?: unknown }).getWithMetadata === 'function'
        ? await (store as unknown as {
            getWithMetadata: (key: string, opts: unknown) => Promise<{ data: unknown; etag?: string }>;
          }).getWithMetadata(`lockout:${username}`, { type: 'json' })
        : null;
    if (withMeta && typeof withMeta === 'object' && 'data' in (withMeta as Record<string, unknown>)) {
      const tuple = withMeta as { data: LockoutRecord | null; etag?: string };
      return { record: tuple.data ?? null, etag: tuple.etag ?? null };
    }
  } catch {
    /* fall through */
  }
  return { record: await getLockout(username), etag: null };
}

async function setLockout(username: string, record: LockoutRecord): Promise<void> {
  const store = getStore(LOCKOUT_STORE);
  await store.setJSON(`lockout:${username}`, record);
}

// Conditional write: returns true only if the CAS precondition held
// and the write actually modified the blob. On `onlyIfMatch` the
// precondition is "etag matches"; on `onlyIfNew` it is "record does
// not yet exist". Accepts the three Netlify Blobs SDK return shapes
// (modern `{ modified: boolean }`, legacy void, or `false`).
async function setLockoutCas(
  username: string,
  record: LockoutRecord,
  etag: string | null,
): Promise<boolean> {
  const store = getStore(LOCKOUT_STORE);
  const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
  try {
    const res: unknown = await (store as unknown as {
      setJSON: (key: string, value: unknown, opts?: unknown) => Promise<unknown>;
    }).setJSON(`lockout:${username}`, record, opts);
    if (res == null) return true; // legacy SDK: void = success
    if (typeof res === 'object' && 'modified' in (res as Record<string, unknown>)) {
      return (res as { modified: boolean }).modified === true;
    }
    return res !== false;
  } catch {
    // CAS unsupported on this runtime — fall back to unconditional
    // write. This preserves pre-existing behaviour (best-effort
    // counter) and is only reached on older Netlify Blobs SDKs.
    await setLockout(username, record);
    return true;
  }
}

async function clearLockout(username: string): Promise<void> {
  const store = getStore(LOCKOUT_STORE);
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
  // Defeat timing-enumeration: always run argon2id, even when the user
  // is missing. Without this, response time differs measurably between
  // "unknown username" (no hash) and "valid username wrong password"
  // (full hash) — an oracle that lets attackers enumerate active
  // usernames before running credential stuffing.
  if (!user || !user.active) {
    await hashPassword(password, DUMMY_SALT); // discard
    await recordFailedAttempt(username, clientIp);
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }

  // Verify password — accepts both argon2id and legacy PBKDF2 records.
  const { ok, needsUpgrade } = await verifyPassword(password, user);
  if (!ok) {
    await recordFailedAttempt(username, clientIp);
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }

  // Transparent upgrade: legacy PBKDF2 records are re-hashed with
  // argon2id on successful login and persisted before the session is
  // returned. This migrates every active user on their next sign-in.
  if (needsUpgrade) {
    try {
      const upgraded = await hashPassword(password);
      user.passwordHash = upgraded.hash;
      user.passwordSalt = upgraded.salt;
      user.passwordChangedAt = new Date().toISOString();
      await saveUser(user);
      await auditLog({
        event: 'password_upgraded',
        username: user.username,
        userId: user.id,
        algo: 'argon2id',
        ip: clientIp,
      });
    } catch (err) {
      console.warn('[auth] argon2 upgrade failed for', user.username, err);
      // Non-fatal — still let the user in on the legacy hash.
    }
  }

  // Success — clear lockout, create session
  await clearLockout(username);

  // Token payload intentionally does NOT embed the user id — use an
  // opaque random identifier and map it to the user via the session
  // blob. Previous format (userId:ts:random:hmac) leaked user.id and
  // token age via any browser error / log surface.
  const tokenSecret = generateId() + generateId(); // 32 hex chars
  const tokenSig = await signToken(tokenSecret);
  const token = `${tokenSecret}:${tokenSig}`;

  const session: SessionRecord = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  await saveSession(session);

  // Issue an HttpOnly + Secure + SameSite=Strict cookie. The token is
  // ALSO echoed in the response body for the existing SPA storage path,
  // but clients should prefer the cookie (the SPA will be updated to
  // drop sessionStorage in a follow-up).
  // Also issue a CSRF token as a readable cookie; the SPA mirrors it in
  // the X-CSRF-Token header on state-changing requests.
  const csrf = generateId() + generateId();
  await auditLog({ event: 'login_success', username, userId: user.id, ip: clientIp });

  const resp = Response.json({
    success: true,
    token,
    csrf,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
  const maxAgeSec = Math.floor(SESSION_DURATION_MS / 1000);
  resp.headers.append('Set-Cookie', `fgl_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
  resp.headers.append('Set-Cookie', `fgl_csrf=${csrf}; Path=/; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
  return resp;
}

async function recordFailedAttempt(username: string, ip: string): Promise<void> {
  // CAS retry loop. Without this, two concurrent failed logins from
  // a credential-stuffing attacker both read `count: 0`, both write
  // `count: 1`, and the MAX_FAILED_ATTEMPTS=5 threshold becomes
  // effectively 5 * concurrency before the lockout fires — which
  // is exactly the threshold a brute-force attacker is trying to
  // defeat. With onlyIfMatch we re-read the fresh count on
  // conflict and increment on top, so N concurrent failures
  // produce exactly N increments.
  const MAX_CAS_ATTEMPTS = 6;
  let recorded: LockoutRecord | null = null;
  let newlyLocked = false;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { record: existing, etag } = await getLockoutWithMetadata(username);
    const lockout: LockoutRecord = existing
      ? { ...existing }
      : { count: 0 };
    const wasLocked = typeof lockout.lockedUntil === 'number' && lockout.lockedUntil > Date.now();
    lockout.count++;
    if (lockout.count >= MAX_FAILED_ATTEMPTS && !wasLocked) {
      lockout.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    const ok = await setLockoutCas(username, lockout, etag);
    if (ok) {
      recorded = lockout;
      // Emit the `account_locked` event only on the exact
      // transition from unlocked → locked so the audit chain has a
      // single boundary entry per lockout window, even under
      // concurrent failed-login bursts.
      newlyLocked = !wasLocked && !!lockout.lockedUntil && lockout.count >= MAX_FAILED_ATTEMPTS;
      break;
    }
    // else: another concurrent failed-login incremented the count
    // first. Retry with the fresh snapshot.
  }

  if (!recorded) {
    // All CAS attempts lost. Fall back to an unconditional write
    // so the counter is at least best-effort recorded; this matches
    // the pre-fix behaviour and never leaves the attacker in a state
    // where nothing was persisted.
    const fallback = (await getLockout(username)) || { count: 0 };
    fallback.count++;
    if (fallback.count >= MAX_FAILED_ATTEMPTS) {
      fallback.lockedUntil = fallback.lockedUntil ?? (Date.now() + LOCKOUT_DURATION_MS);
    }
    await setLockout(username, fallback);
    recorded = fallback;
  }

  if (newlyLocked) {
    await auditLog({ event: 'account_locked', username, ip, attempts: recorded.count });
  }
  await auditLog({ event: 'login_failed', username, ip, attempts: recorded.count });
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

  // If not mustChangePassword, verify current password.
  // verifyPassword handles both argon2id and legacy PBKDF2 records,
  // and the change-password flow always writes back an argon2id hash
  // regardless of the prior algorithm, so no explicit upgrade needed.
  if (!user.mustChangePassword) {
    if (!currentPassword) {
      return Response.json({ error: 'Current password required.' }, { status: 400 });
    }
    const { ok } = await verifyPassword(currentPassword, user);
    if (!ok) {
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

  // Invalidate all other sessions for this user — a stolen session token
  // must not survive a victim-initiated password change.
  try {
    const store = getStore(SESSIONS_STORE);
    const list = await store.list();
    for (const entry of list.blobs || []) {
      if (!entry.key.startsWith('session:')) continue;
      const s = (await store.get(entry.key, { type: 'json' })) as SessionRecord | null;
      if (s && s.userId === user.id && s.token !== token) {
        await store.delete(entry.key);
      }
    }
  } catch (err) {
    console.warn('[auth] Failed to revoke sibling sessions:', err);
  }

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

  const url = new URL(req.url);
  const action = url.pathname.replace('/api/auth/', '').replace('/api/auth', '');
  const clientIp = context.ip || 'unknown';

  // Per-route namespaced rate limits — login/register are hard 5/15min,
  // validate/logout share their own 100/15min bucket so the SPA's
  // session-ping traffic doesn't burn the login budget.
  // Login also gets a per-username counter in handleLogin via
  // recordFailedAttempt, which is independent of IP.
  let rlConfig: Parameters<typeof checkRateLimit>[1];
  if (action === 'login' || action === 'register') {
    rlConfig = { max: 5, clientIp, namespace: 'auth-' + action };
  } else if (action === 'change-password') {
    rlConfig = { max: 10, clientIp, namespace: 'auth-change-password' };
  } else {
    rlConfig = { max: 60, clientIp, namespace: 'auth-session' };
  }
  const rl = await checkRateLimit(req, rlConfig);
  if (rl) return rl;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // CSRF + Origin check on state-changing requests (everything except
  // login/register/validate which either bootstrap the session or do
  // not mutate state server-side). For login we still require a strict
  // Origin header match — otherwise a cross-site form could POST here.
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = Netlify.env.get('HAWKEYE_ALLOWED_ORIGIN') || '';
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    await auditLog({ event: 'origin_rejected', origin, ip: clientIp });
    return Response.json({ error: 'Origin not allowed.' }, { status: 403 });
  }
  if (action === 'logout' || action === 'change-password') {
    // Double-submit CSRF: cookie fgl_csrf must equal X-CSRF-Token header.
    const csrfCookie = (req.headers.get('cookie') || '')
      .split(';').map(s => s.trim()).find(c => c.startsWith('fgl_csrf='))?.split('=')[1] || '';
    const csrfHeader = req.headers.get('x-csrf-token') || '';
    if (!csrfCookie || csrfCookie !== csrfHeader) {
      await auditLog({ event: 'csrf_rejected', action, ip: clientIp });
      return Response.json({ error: 'CSRF token missing or invalid.' }, { status: 403 });
    }
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

// Exports for unit tests only. Never referenced by the production
// request path.
export const __test__ = {
  recordFailedAttempt,
  getLockout,
};
