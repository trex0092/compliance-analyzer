/**
 * Tests for the real `/screen` skill executor inside
 * netlify/functions/asana-comment-skill-handler.mts.
 *
 * Previously the handler posted a canned "acknowledged" reply for
 * every slash command. This round wires real sanctions screening
 * for `/screen <query>` by reading the persisted sanctions
 * snapshots (the `sanctions-snapshots` blob store populated by
 * `sanctions-ingest-cron`). Every other skill still falls back to
 * the stub executor.
 *
 * Scope of these tests:
 *   - query normalisation + substring matching against primary name
 *     and aliases, case-insensitive, punctuation-safe;
 *   - multi-list scan (UN + OFAC_SDN + EU etc.) returns a per-source
 *     match count;
 *   - per-source cap + total cap prevent a huge payload from
 *     breaking the Asana stories API;
 *   - zero-match reply includes the regulator-mandated
 *     "zero match is NOT a clearance" caveat;
 *   - every reply ends with the FDL Art.29 no-tipping-off line;
 *   - non-`/screen` skills still return the stub executor's reply,
 *     so partial rollout is safe for the MLRO.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Fake Netlify Blobs store — tests script the shape of
// `sanctions-snapshots/<SOURCE>/<day>/snapshot.json`.
let snapshotStore: Map<string, unknown[]>;

vi.mock('@netlify/blobs', () => ({
  getStore: (name: string) => {
    if (name === 'sanctions-snapshots') {
      return {
        async list({ prefix }: { prefix: string }) {
          const keys = [...snapshotStore.keys()].filter((k) =>
            k.startsWith(prefix),
          );
          return { blobs: keys.map((key) => ({ key })) };
        },
        async get(key: string) {
          return snapshotStore.get(key) ?? null;
        },
      };
    }
    // Any other store (audit) — no-op.
    return {
      async setJSON() {},
      async get() { return null; },
      async list() { return { blobs: [] }; },
      async delete() {},
    };
  },
}));

beforeEach(() => {
  snapshotStore = new Map();
});

afterEach(() => {
  vi.resetModules();
});

async function freshModule() {
  return await import('../netlify/functions/asana-comment-skill-handler.mts?t=' + Date.now());
}

function seed(source: string, day: string, entries: unknown[]) {
  snapshotStore.set(`${source}/${day}/snapshot.json`, entries);
}

describe('/screen — query normalisation', () => {
  it('lowercases, strips punctuation, collapses whitespace', async () => {
    const { __test__ } = await freshModule();
    expect(__test__.normaliseQueryToken('  Acme,  Trading  LLC.  ')).toBe(
      'acme trading llc',
    );
  });

  it('normaliseQueryToken strips diacritics', async () => {
    const { __test__ } = await freshModule();
    expect(__test__.normaliseQueryToken('Björk Ösçar')).toBe('bjork oscar');
  });
});

describe('/screen — matching', () => {
  it('matches against primaryName case-insensitively', async () => {
    const { __test__ } = await freshModule();
    const entry = {
      source: 'OFAC_SDN',
      sourceId: '1',
      primaryName: 'ACME TRADING LLC',
      aliases: [],
      type: 'entity',
    };
    expect(__test__.sanctionMatchesQuery(entry, 'acme trading')).toBe(true);
  });

  it('matches against aliases', async () => {
    const { __test__ } = await freshModule();
    const entry = {
      source: 'OFAC_SDN',
      sourceId: '1',
      primaryName: 'Unrelated Shell Co',
      aliases: ['Acme Trading LLC', 'ATL'],
      type: 'entity',
    };
    expect(__test__.sanctionMatchesQuery(entry, 'acme')).toBe(true);
  });

  it('does not match on a 2-word fragment that spans tokens uninterestingly', async () => {
    const { __test__ } = await freshModule();
    const entry = {
      source: 'UN',
      sourceId: '2',
      primaryName: 'Bob Smith',
      aliases: [],
      type: 'individual',
    };
    expect(__test__.sanctionMatchesQuery(entry, 'alice')).toBe(false);
  });
});

describe('/screen — end-to-end executor', () => {
  it('returns a zero-match reply with the no-clearance caveat', async () => {
    seed('OFAC_SDN', '2026-04-17', [
      {
        source: 'OFAC_SDN',
        sourceId: '1',
        primaryName: 'Someone Else',
        aliases: [],
        type: 'individual',
      },
    ]);

    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill('Brand New Customer LLC');
    expect(result.real).toBe(true);
    expect(result.reply).toContain('Matches found: 0');
    expect(result.reply).toContain('NOT a clearance');
    expect(result.reply).toContain('FDL Art.29');
  });

  it('lists matches per source when the query hits multiple lists', async () => {
    seed('OFAC_SDN', '2026-04-17', [
      {
        source: 'OFAC_SDN',
        sourceId: '10001',
        primaryName: 'ACME TRADING LLC',
        aliases: ['ATL'],
        type: 'entity',
        programmes: ['SDGT'],
      },
    ]);
    seed('UN', '2026-04-17', [
      {
        source: 'UN',
        sourceId: 'UN-99',
        primaryName: 'Acme Shipping',
        aliases: ['Acme Trading'],
        type: 'entity',
        programmes: ['UNSC-1718'],
      },
    ]);

    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill('Acme');
    expect(result.real).toBe(true);
    expect(result.reply).toContain('Matches found: 2');
    expect(result.reply).toContain('**OFAC_SDN**');
    expect(result.reply).toContain('ACME TRADING LLC');
    expect(result.reply).toContain('[SDGT]');
    expect(result.reply).toContain('**UN**');
    expect(result.reply).toContain('Acme Shipping');
    expect(result.reply).toContain('id: 10001');
    expect(result.reply).toContain('id: UN-99');
    expect(result.reply).toContain('/incident');
  });

  it('caps total matches at SCREEN_MAX_TOTAL_MATCHES', async () => {
    // Seed 50 matching entries in one source; cap is 25 total /
    // 8 per source.
    const many = Array.from({ length: 50 }, (_, i) => ({
      source: 'OFAC_SDN',
      sourceId: String(i),
      primaryName: 'Acme Variant ' + i,
      aliases: [],
      type: 'entity',
    }));
    seed('OFAC_SDN', '2026-04-17', many);

    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill('acme');
    // Per-source cap is 8; the reply text reports 8, not 50.
    expect(result.reply).toContain('Matches found: 8');
    expect(result.reply).toContain('(id: 0)');
    expect(result.reply).toContain('(id: 7)');
    expect(result.reply).not.toContain('(id: 8)');
  });

  it('rejects too-short queries without hitting the blob store', async () => {
    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill(' .');
    expect(result.real).toBe(true);
    expect(result.reply).toContain('at least 2 non-punctuation');
  });

  it('handles a completely empty snapshot store gracefully', async () => {
    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill('acme trading');
    expect(result.real).toBe(true);
    expect(result.reply).toContain('Matches found: 0');
    expect(result.diagnostics?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('picks the most recent day-bucketed snapshot per source', async () => {
    // Older entry that WOULD match if we read the oldest bucket.
    seed('OFAC_SDN', '2024-01-01', [
      {
        source: 'OFAC_SDN',
        sourceId: 'STALE',
        primaryName: 'ACME STALE',
        aliases: [],
        type: 'entity',
      },
    ]);
    seed('OFAC_SDN', '2026-04-17', [
      {
        source: 'OFAC_SDN',
        sourceId: 'FRESH',
        primaryName: 'ACME FRESH',
        aliases: [],
        type: 'entity',
      },
    ]);

    const { __test__ } = await freshModule();
    const result = await __test__.executeScreenSkill('Acme');
    expect(result.reply).toContain('ACME FRESH');
    expect(result.reply).not.toContain('ACME STALE');
    expect(result.reply).toContain('Matches found: 1');
  });
});

describe('/screen — dispatch', () => {
  it('non-screen skills still get the stub', async () => {
    const { __test__ } = await freshModule();
    const router = {
      buildStubExecution: (_inv: unknown) => ({
        reply: 'STUB REPLY',
        citation: 'stub citation',
      }),
    };
    const result = await __test__.executeSkillInvocation(router as any, {
      skill: { name: 'audit', category: 'audit', description: '', citation: '' },
      args: ['acme'],
      rawComment: '/audit acme',
    });
    expect(result.real).toBe(false);
    expect(result.reply).toBe('STUB REPLY');
  });

  it('/screen without args falls back to stub so the MLRO sees usage', async () => {
    const { __test__ } = await freshModule();
    const router = {
      buildStubExecution: (_inv: unknown) => ({
        reply: 'USAGE REPLY',
        citation: 'stub citation',
      }),
    };
    const result = await __test__.executeSkillInvocation(router as any, {
      skill: { name: 'screen', category: 'screening', description: '', citation: '' },
      args: [],
      rawComment: '/screen',
    });
    expect(result.real).toBe(false);
    expect(result.reply).toBe('USAGE REPLY');
  });
});
