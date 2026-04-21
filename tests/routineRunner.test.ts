/**
 * Tests for src/services/routineRunner — the shared helper that every
 * one of the 33 cron wrappers introduced in PR #407 calls. A single
 * bug here cascades to every scheduled routine, so this suite drives
 * the four promised behaviours end-to-end against a fake Netlify
 * Blobs store and a stubbed Asana fetch layer:
 *
 *   1. Dated audit row written under the spec's auditStore
 *      (FDL No.(10)/2025 Art.24 — 10-yr retention).
 *   2. Asana project GID resolved via the 16-project catalog.
 *   3. Heartbeat/summary task posted when dispatch is on and the
 *      ASANA token + project GID are both present.
 *   4. Structured RoutineRunResult returned in every branch.
 *
 * Mocks the module boundaries at @netlify/blobs, asanaModuleProjects,
 * and fetchWithTimeout so the test stays hermetic — no network, no
 * actual blob store. FDL Art.24 audit integrity is verified by
 * reading back the payload we set against the fake store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeStore = {
  name: string;
  entries: Map<string, unknown>;
};

const stores = new Map<string, FakeStore>();

function getFakeStore(name: string): FakeStore {
  let s = stores.get(name);
  if (!s) {
    s = { name, entries: new Map() };
    stores.set(name, s);
  }
  return s;
}

vi.mock('@netlify/blobs', () => ({
  getStore: (opts: string | { name: string }) => {
    const name = typeof opts === 'string' ? opts : opts.name;
    const s = getFakeStore(name);
    return {
      async setJSON(key: string, value: unknown) {
        s.entries.set(key, value);
      },
      async get(key: string, _opts?: unknown) {
        return s.entries.get(key) ?? null;
      },
    };
  },
}));

const resolveAsanaProjectGidMock = vi.fn<(module: string) => string | null>();
vi.mock('../src/services/asanaModuleProjects', () => ({
  resolveAsanaProjectGid: (module: string) => resolveAsanaProjectGidMock(module),
}));

const fetchWithTimeoutMock = vi.fn();
vi.mock('../src/utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeoutMock(...args),
}));

beforeEach(() => {
  stores.clear();
  resolveAsanaProjectGidMock.mockReset();
  fetchWithTimeoutMock.mockReset();
  delete process.env.ASANA_TOKEN;
  delete process.env.ASANA_ACCESS_TOKEN;
  delete process.env.ASANA_API_TOKEN;
});

function specFor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'str-deadline-watch',
    title: 'STR Deadline Watch',
    module: 'str_cases' as const,
    cadenceHuman: 'every 15 min',
    regulatoryBasis: 'FDL No.10/2025 Art.26-27',
    auditStore: 'str-deadline-audit',
    description: 'Monitors pending STR deadlines.',
    ...overrides,
  } as Parameters<
    typeof import('../src/services/routineRunner').runRoutine
  >[0];
}

async function loadRunner() {
  return await import('../src/services/routineRunner');
}

describe('routineRunner.runRoutine', () => {
  describe('audit-trail writes (FDL Art.24)', () => {
    it('writes a dated audit row to the spec-declared store on every run', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000001');
      process.env.ASANA_TOKEN = 'asana-pat-stub';
      fetchWithTimeoutMock.mockResolvedValue({
        ok: true,
        status: 200,
        async json() {
          return { data: { gid: 'task-gid-0001' } };
        },
        async text() {
          return '';
        },
      });

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: true });

      expect(result.auditWritten).toBe(true);

      const store = stores.get('str-deadline-audit');
      expect(store, 'audit store must be created').toBeDefined();
      expect(store!.entries.size).toBe(1);

      const [key, payload] = [...store!.entries.entries()][0];
      // Key shape: "YYYY-MM-DD/<epoch-ms>.json"
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{13}\.json$/);
      expect(payload).toMatchObject({
        routineId: 'str-deadline-watch',
        module: 'str_cases',
        regulatoryBasis: 'FDL No.10/2025 Art.26-27',
        projectGid: '1200900000000001',
        dispatch: true,
        dryRun: false,
      });
      expect((payload as { recordedAt: string }).recordedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T/
      );
    });

    it('still writes the audit row when Asana dispatch is skipped (dryRun)', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000002');

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.auditWritten).toBe(true);
      expect(result.asanaGid).toBeUndefined();
      expect(fetchWithTimeoutMock).not.toHaveBeenCalled();

      const store = stores.get('str-deadline-audit');
      expect(store!.entries.size).toBe(1);
    });

    it('still writes the audit row when the project GID cannot be resolved', async () => {
      resolveAsanaProjectGidMock.mockReturnValue(null);
      process.env.ASANA_TOKEN = 'asana-pat-stub';

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: true });

      expect(result.ok).toBe(false);
      expect(result.projectGid).toBeNull();
      expect(result.auditWritten).toBe(true);
      expect(result.message).toContain('unresolved');
      expect(fetchWithTimeoutMock).not.toHaveBeenCalled();

      const store = stores.get('str-deadline-audit');
      expect(store!.entries.size).toBe(1);
    });

    it('reports auditWritten: false when the blob store throws', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000003');

      // Force the audit store's setJSON to throw.
      const spy = vi.spyOn(stores, 'get').mockImplementationOnce(() => {
        throw new Error('blob store unreachable');
      });

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dryRun: true });

      expect(result.auditWritten).toBe(false);
      expect(result.dryRun).toBe(true);
      spy.mockRestore();
    });
  });

  describe('Asana dispatch', () => {
    it('posts a heartbeat task with spec metadata when dispatch: true and token is present', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000004');
      process.env.ASANA_TOKEN = 'asana-pat-stub';
      fetchWithTimeoutMock.mockResolvedValue({
        ok: true,
        status: 200,
        async json() {
          return { data: { gid: 'task-gid-0042' } };
        },
        async text() {
          return '';
        },
      });

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(
        specFor({ id: 'goaml-submission-health' }),
        { dispatch: true, sampleNote: 'zero failures this run' }
      );

      expect(result.ok).toBe(true);
      expect(result.asanaGid).toBe('task-gid-0042');
      expect(result.projectGid).toBe('1200900000000004');

      // Single Asana call, with bearer + JSON body containing the
      // audit-trail metadata the MLRO expects to see on every task.
      expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchWithTimeoutMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://app.asana.com/api/1.0/tasks');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer asana-pat-stub'
      );
      const body = JSON.parse(init.body as string) as {
        data: { projects: string[]; name: string; notes: string };
      };
      expect(body.data.projects).toEqual(['1200900000000004']);
      expect(body.data.name).toContain('GOAML-SUBMISSION-HEALTH');
      expect(body.data.notes).toContain('Routine: goaml-submission-health');
      expect(body.data.notes).toContain('zero failures this run');
      expect(body.data.notes).toContain('FDL Art.24');
    });

    it('surfaces Asana HTTP errors without throwing', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000005');
      process.env.ASANA_TOKEN = 'asana-pat-stub';
      fetchWithTimeoutMock.mockResolvedValue({
        ok: false,
        status: 429,
        async json() {
          return {};
        },
        async text() {
          return 'rate limited';
        },
      });

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: true });

      expect(result.ok).toBe(false);
      expect(result.asanaError).toContain('Asana HTTP 429');
      expect(result.asanaError).toContain('rate limited');
      // Audit row must still be present — Art.24 retention does not
      // depend on Asana succeeding.
      expect(result.auditWritten).toBe(true);
    });

    it('treats network-layer failures (fetchWithTimeout reject) as dispatch failures, not crashes', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000006');
      process.env.ASANA_TOKEN = 'asana-pat-stub';
      fetchWithTimeoutMock.mockRejectedValue(new Error('ETIMEDOUT'));

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: true });

      expect(result.ok).toBe(false);
      expect(result.asanaError).toBe('ETIMEDOUT');
      expect(result.auditWritten).toBe(true);
    });

    it('skips dispatch when no Asana token is set', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000007');
      // No ASANA_* env var.

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: true });

      expect(result.ok).toBe(false);
      expect(result.asanaError).toBe('ASANA_TOKEN not configured');
      expect(result.auditWritten).toBe(true);
    });

    it('honours dispatch: false by returning the audit-only path', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000008');
      process.env.ASANA_TOKEN = 'asana-pat-stub';

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor(), { dispatch: false });

      expect(result.ok).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.auditWritten).toBe(true);
      expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
      expect(result.message).toContain('dispatch disabled');
    });

    it('reads the token from ASANA_ACCESS_TOKEN when ASANA_TOKEN is unset', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000009');
      process.env.ASANA_ACCESS_TOKEN = 'access-token-fallback';
      fetchWithTimeoutMock.mockResolvedValue({
        ok: true,
        status: 200,
        async json() {
          return { data: { gid: 'task-gid-0100' } };
        },
        async text() {
          return '';
        },
      });

      const { runRoutine } = await loadRunner();
      await runRoutine(specFor(), { dispatch: true });

      const [, init] = fetchWithTimeoutMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer access-token-fallback'
      );
    });

    it('reads the token from ASANA_API_TOKEN when both other aliases are unset', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000010');
      process.env.ASANA_API_TOKEN = 'api-token-final-fallback';
      fetchWithTimeoutMock.mockResolvedValue({
        ok: true,
        status: 200,
        async json() {
          return { data: { gid: 'task-gid-0200' } };
        },
        async text() {
          return '';
        },
      });

      const { runRoutine } = await loadRunner();
      await runRoutine(specFor(), { dispatch: true });

      const [, init] = fetchWithTimeoutMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer api-token-final-fallback'
      );
    });
  });

  describe('RoutineRunResult shape', () => {
    it('always returns routineId, ranAt, projectGid, and auditWritten', async () => {
      resolveAsanaProjectGidMock.mockReturnValue('1200900000000011');

      const { runRoutine } = await loadRunner();
      const result = await runRoutine(specFor({ id: 'pep-rescreen-by-tier' }), {
        dryRun: true,
      });

      expect(result.routineId).toBe('pep-rescreen-by-tier');
      expect(result.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(result.projectGid).toBe('1200900000000011');
      expect(result.auditWritten).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(typeof result.message).toBe('string');
    });
  });
});
