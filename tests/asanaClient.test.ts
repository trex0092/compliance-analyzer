/**
 * Tests for asanaClient — the server-side config path and the user
 * resolver used by the scheduled monitoring function.
 *
 * Browser-side behavior (window.ASANA_TOKEN, localStorage) is NOT
 * exercised here because vitest runs in a node environment; that path
 * is covered by manual testing in the tool's Settings panel.
 *
 * All fetch calls are stubbed with vi.stubGlobal to keep the suite
 * hermetic (no real API traffic).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listWorkspaceUsers,
  resolveAsanaUserByName,
  getAsanaServerConfig,
  isAsanaConfigured,
  type AsanaUser,
} from '@/services/asanaClient';

// ---------------------------------------------------------------------------
// Fetch mocking helper
// ---------------------------------------------------------------------------

/**
 * Build a fake global fetch that returns the given payload.
 * Records every call it receives so tests can assert on URL/headers.
 */
function mockFetch(payload: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok,
      status,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

// ---------------------------------------------------------------------------
// Environment variable helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Ensure a clean env slate for every test. We stub ONLY the Asana vars
  // so other env vars the tests might depend on are untouched.
  vi.stubEnv('ASANA_TOKEN', '');
  vi.stubEnv('ASANA_SCREENINGS_PROJECT_GID', '');
  vi.stubEnv('ASANA_WORKSPACE_GID', '');
  vi.stubEnv('ASANA_DEFAULT_ASSIGNEE_NAME', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Server-side config
// ---------------------------------------------------------------------------

describe('asanaClient — getAsanaServerConfig', () => {
  it('returns empty object when env vars are not set', () => {
    const cfg = getAsanaServerConfig();
    expect(cfg.workspaceGid).toBeFalsy();
    expect(cfg.assigneeName).toBeFalsy();
  });

  it('reads ASANA_WORKSPACE_GID from env', () => {
    vi.stubEnv('ASANA_WORKSPACE_GID', '1213645083721316');
    const cfg = getAsanaServerConfig();
    expect(cfg.workspaceGid).toBe('1213645083721316');
  });

  it('reads ASANA_DEFAULT_ASSIGNEE_NAME from env', () => {
    vi.stubEnv('ASANA_DEFAULT_ASSIGNEE_NAME', 'Luisa Fernanda');
    const cfg = getAsanaServerConfig();
    expect(cfg.assigneeName).toBe('Luisa Fernanda');
  });

  it('reads both env vars simultaneously', () => {
    vi.stubEnv('ASANA_WORKSPACE_GID', '1213645083721316');
    vi.stubEnv('ASANA_DEFAULT_ASSIGNEE_NAME', 'Luisa Fernanda');
    const cfg = getAsanaServerConfig();
    expect(cfg.workspaceGid).toBe('1213645083721316');
    expect(cfg.assigneeName).toBe('Luisa Fernanda');
  });
});

describe('asanaClient — isAsanaConfigured (server-side)', () => {
  it('returns false when no token is set', () => {
    expect(isAsanaConfigured()).toBe(false);
  });

  it('returns true when ASANA_TOKEN env var is set', () => {
    vi.stubEnv('ASANA_TOKEN', 'fake-asana-token-xyz');
    expect(isAsanaConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listWorkspaceUsers
// ---------------------------------------------------------------------------

describe('asanaClient — listWorkspaceUsers', () => {
  const luisa: AsanaUser = {
    gid: '1213645083721317',
    name: 'Luisa Fernanda Ramirez',
    email: 'luisa@example.com',
  };
  const bob: AsanaUser = { gid: '1213645083721318', name: 'Bob Smith' };
  const alice: AsanaUser = { gid: '1213645083721319', name: 'Alice Johnson' };

  beforeEach(() => {
    vi.stubEnv('ASANA_TOKEN', 'fake-token');
  });

  it('rejects empty workspace GID', async () => {
    const result = await listWorkspaceUsers('');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('workspaceGid is required');
  });

  it('returns users array on success', async () => {
    mockFetch({ data: [luisa, bob, alice] });
    const result = await listWorkspaceUsers('1213645083721316');
    expect(result.ok).toBe(true);
    expect(result.users).toHaveLength(3);
    expect(result.users?.[0].gid).toBe('1213645083721317');
    expect(result.users?.[0].name).toBe('Luisa Fernanda Ramirez');
  });

  it('URL-encodes the workspace GID', async () => {
    const fake = mockFetch({ data: [] });
    await listWorkspaceUsers('ws:with/special chars');
    expect(fake.calls[0].url).toContain('/workspaces/ws%3Awith%2Fspecial%20chars/users');
  });

  it('requests the correct opt_fields', async () => {
    const fake = mockFetch({ data: [] });
    await listWorkspaceUsers('1213645083721316');
    // Commas are valid in URL query strings — the client sends them
    // unencoded. Asana's API accepts both forms.
    expect(fake.calls[0].url).toContain('opt_fields=gid,name,email');
  });

  it('returns empty array when API returns no data field', async () => {
    mockFetch({});
    const result = await listWorkspaceUsers('1213645083721316');
    expect(result.ok).toBe(true);
    expect(result.users).toEqual([]);
  });

  // Longer timeout: asanaRequestWithRetry waits 2+4+8=14s between retries
  // on non-config errors. We test that the ORIGINAL status code (401)
  // propagates through the retry wrapper so ops can triage failures
  // (stale token vs rate limit vs outage).
  it(
    'returns error with original status code after exhausting retries',
    async () => {
      mockFetch({ errors: [{ message: 'Unauthorized' }] }, false, 401);
      const result = await listWorkspaceUsers('1213645083721316');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
      expect(result.error).toContain('failed after');
    },
    20000
  );
});

// ---------------------------------------------------------------------------
// resolveAsanaUserByName
// ---------------------------------------------------------------------------

describe('asanaClient — resolveAsanaUserByName', () => {
  const luisa: AsanaUser = {
    gid: '1213645083721317',
    name: 'Luisa Fernanda Ramirez',
    email: 'luisa@example.com',
  };
  const anotherLuisa: AsanaUser = {
    gid: '1213645083721320',
    name: 'Luisa Garcia',
  };
  const bob: AsanaUser = { gid: '1213645083721318', name: 'Bob Smith' };

  beforeEach(() => {
    vi.stubEnv('ASANA_TOKEN', 'fake-token');
  });

  it('rejects empty name', async () => {
    mockFetch({ data: [luisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', '');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('name is required');
  });

  it('rejects whitespace-only name', async () => {
    mockFetch({ data: [luisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', '   ');
    expect(result.ok).toBe(false);
  });

  it('finds a user by substring match (case-insensitive)', async () => {
    mockFetch({ data: [luisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', 'luisa fernanda');
    expect(result.ok).toBe(true);
    expect(result.user?.gid).toBe('1213645083721317');
  });

  it('matches uppercased needle to mixed-case name', async () => {
    mockFetch({ data: [luisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', 'LUISA FERNANDA');
    expect(result.ok).toBe(true);
    expect(result.user?.name).toBe('Luisa Fernanda Ramirez');
  });

  it('matches partial substring (first name only)', async () => {
    mockFetch({ data: [luisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', 'Luisa');
    expect(result.ok).toBe(true);
    expect(result.user?.gid).toBe('1213645083721317');
  });

  it('returns warning + first match when multiple users match', async () => {
    mockFetch({ data: [luisa, anotherLuisa, bob] });
    const result = await resolveAsanaUserByName('1213645083721316', 'Luisa');
    expect(result.ok).toBe(true);
    expect(result.user?.gid).toBe('1213645083721317'); // first match
    expect(result.warning).toContain('2 users matched');
    expect(result.warning).toContain('more specific name');
  });

  it('returns error when no user matches', async () => {
    mockFetch({ data: [bob] });
    const result = await resolveAsanaUserByName('1213645083721316', 'Luisa Fernanda');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No Asana user found');
    expect(result.error).toContain('Luisa Fernanda');
  });

  // Longer timeout for the retry-backoff path (14s of retry delays).
  // The original 404 status code now propagates through the retry
  // wrapper — the caller can distinguish "workspace doesn't exist"
  // from other failure modes.
  it(
    'propagates original status code from listWorkspaceUsers failure',
    async () => {
      mockFetch({ error: 'not found' }, false, 404);
      const result = await resolveAsanaUserByName('1213645083721316', 'Luisa');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('404');
    },
    20000
  );

  it('handles empty user list gracefully', async () => {
    mockFetch({ data: [] });
    const result = await resolveAsanaUserByName('1213645083721316', 'Luisa');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No Asana user found');
  });
});
