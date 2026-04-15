/**
 * Operational Trust II tests — Excel importer + backup/restore +
 * status page + regression harness.
 */
import { describe, it, expect } from 'vitest';

import {
  importTransactionSheet,
  __test__ as xlsxInternals,
} from '../src/services/excelTransactionImporter';

import {
  buildBackupManifest,
  verifyRestoreSet,
  __test__ as backupInternals,
} from '../src/services/backupRestoreService';

import { buildStatusPage } from '../src/services/statusPageBuilder';
import type { HealthReport } from '../src/services/brainHealthCheck';

import {
  runRegression,
  formatRegressionReport,
  type GoldenCase,
  type RegressionVerdictFn,
} from '../src/services/regressionHarness';

// ===========================================================================
// excelTransactionImporter
// ===========================================================================

describe('importTransactionSheet', () => {
  const tenantId = 'tenant-a';

  it('returns empty on empty input', () => {
    const r = importTransactionSheet('', { tenantId });
    expect(r.rows).toEqual([]);
  });

  it('accepts a minimal CSV row', () => {
    const csv =
      'txId,date,fromEntityRef,toEntityRef,amountAED,currency,channel\n' +
      't-1,2026-04-15,a,b,1000.50,AED,wire';
    const r = importTransactionSheet(csv, { tenantId });
    expect(r.totalAccepted).toBe(1);
    expect(r.rows[0]!.amountAED).toBe(1000.5);
    expect(r.rows[0]!.currency).toBe('AED');
    expect(r.rows[0]!.channel).toBe('wire');
  });

  it('detects tab delimiter', () => {
    const tsv =
      'txId\tdate\tfromEntityRef\ttoEntityRef\tamountAED\tcurrency\tchannel\n' +
      't-1\t2026-04-15\ta\tb\t500\tUSD\tcash';
    const r = importTransactionSheet(tsv, { tenantId });
    expect(r.delimiter).toBe('\t');
    expect(r.totalAccepted).toBe(1);
  });

  it('detects pipe delimiter', () => {
    const piped =
      'txId|date|fromEntityRef|toEntityRef|amountAED|currency|channel\n' +
      't-1|2026-04-15|a|b|500|EUR|card';
    const r = importTransactionSheet(piped, { tenantId });
    expect(r.delimiter).toBe('|');
  });

  it('rejects missing required columns', () => {
    const csv = 'txId,date,amountAED\nt-1,2026-04-15,1000';
    const r = importTransactionSheet(csv, { tenantId });
    expect(r.summary).toMatch(/Missing required/);
  });

  it('rejects bad amount + bad currency + bad date per row', () => {
    const csv = [
      'txId,date,fromEntityRef,toEntityRef,amountAED,currency,channel',
      't-1,not-a-date,a,b,100,AED,wire',
      't-2,2026-04-15,a,b,abc,AED,wire',
      't-3,2026-04-15,a,b,100,US,wire',
    ].join('\n');
    const r = importTransactionSheet(csv, { tenantId });
    expect(r.totalRejected).toBe(3);
  });

  it('parses amount with thousand separators', () => {
    expect(xlsxInternals.parseAmount('1,234,567.89')).toBeCloseTo(1234567.89);
    expect(xlsxInternals.parseAmount('1_000')).toBe(1000);
    expect(xlsxInternals.parseAmount('bogus')).toBeNull();
  });

  it('honours maxRows truncation', () => {
    const rows = ['txId,date,fromEntityRef,toEntityRef,amountAED,currency,channel'];
    for (let i = 0; i < 5; i++) {
      rows.push(`t-${i},2026-04-15,a,b,100,AED,wire`);
    }
    const r = importTransactionSheet(rows.join('\n'), { tenantId, maxRows: 3 });
    expect(r.totalAccepted).toBe(3);
    expect(r.warnings.some((w) => w.includes('Truncated'))).toBe(true);
  });
});

// ===========================================================================
// backupRestoreService
// ===========================================================================

describe('buildBackupManifest + verifyRestoreSet', () => {
  const objects = [
    { key: 'brain:telemetry/tenant-a/2026-04-15.json', payload: { entries: [{ a: 1 }] } },
    { key: 'brain:case-replay/tenant-a/case-1.json', payload: { verdict: 'flag' } },
    { key: 'brain:evidence/tenant-a/case-1.json', payload: { hash: 'abc' } },
  ];

  it('builds a manifest with an entry per object + Merkle root', () => {
    const m = buildBackupManifest(objects, {
      tenantId: 'tenant-a',
      generatedBy: 'mlro-1',
      now: () => new Date('2026-04-15T12:00:00Z'),
    });
    expect(m.entries.length).toBe(3);
    expect(m.merkleRootHex.length).toBe(128); // sha3-512 hex
    expect(m.tenantId).toBe('tenant-a');
    expect(m.algorithm).toBe('sha3-512');
  });

  it('entries are sorted by key for determinism', () => {
    const m = buildBackupManifest([...objects].reverse(), {
      tenantId: 'tenant-a',
      generatedBy: 'mlro-1',
    });
    const keys = m.entries.map((e) => e.key);
    expect([...keys]).toEqual([...keys].sort());
  });

  it('verifyRestoreSet passes on an intact set', () => {
    const m = buildBackupManifest(objects, { tenantId: 'tenant-a', generatedBy: 'mlro-1' });
    const r = verifyRestoreSet(m, objects);
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it('detects a missing object', () => {
    const m = buildBackupManifest(objects, { tenantId: 'tenant-a', generatedBy: 'mlro-1' });
    const r = verifyRestoreSet(m, objects.slice(0, 2));
    expect(r.ok).toBe(false);
    expect(r.discrepancies.some((d) => d.kind === 'missing')).toBe(true);
  });

  it('detects an extra object', () => {
    const m = buildBackupManifest(objects, { tenantId: 'tenant-a', generatedBy: 'mlro-1' });
    const extra = [...objects, { key: 'brain:extra', payload: { x: 1 } }];
    const r = verifyRestoreSet(m, extra);
    expect(r.discrepancies.some((d) => d.kind === 'extra')).toBe(true);
  });

  it('detects a tampered payload via hash mismatch', () => {
    const m = buildBackupManifest(objects, { tenantId: 'tenant-a', generatedBy: 'mlro-1' });
    const tampered = [...objects];
    tampered[0] = { ...tampered[0]!, payload: { entries: [{ a: 999 }] } };
    const r = verifyRestoreSet(m, tampered);
    expect(r.discrepancies.some((d) => d.kind === 'hash_mismatch')).toBe(true);
  });

  it('hashObject is deterministic on the same payload', () => {
    const a = backupInternals.hashObject({ key: 'k', payload: { a: 1 } });
    const b = backupInternals.hashObject({ key: 'k', payload: { a: 1 } });
    expect(a.contentHashHex).toBe(b.contentHashHex);
  });
});

// ===========================================================================
// statusPageBuilder
// ===========================================================================

function makeHealth(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    schemaVersion: 1,
    checkedAtIso: '2026-04-15T12:00:00Z',
    overall: 'ok',
    envReport: {
      schemaVersion: 1,
      health: 'ok',
      totalVars: 16,
      requiredCount: 9,
      optionalCount: 7,
      missingRequired: [],
      invalidVars: [],
      statuses: [],
      summary: 'all good',
      regulatory: [],
    },
    dependencies: [
      { name: 'Netlify Blobs', state: 'ok', latencyMs: 42, detail: 'up', regulatory: 'FDL Art.20' },
      { name: 'Asana API', state: 'ok', latencyMs: 88, detail: 'up', regulatory: 'FDL Art.20' },
    ],
    crons: [
      { id: 'brain-clamp-cron', schedule: '0 * * * *', lastRunIso: '2026-04-15T11:00:00Z', lastResult: 'ok', lastError: null },
    ],
    tierCQueues: {
      clampSuggestionsPending: 0,
      outboundQueuePending: 0,
      breakGlassPendingApproval: 0,
      deadLetterDepth: 0,
    },
    regulatoryDrift: { clean: true, topSeverity: 'none', driftedKeyCount: 0 },
    testSuite: { passed: 3460, total: 3460, lastRunIso: '2026-04-15T10:00:00Z' },
    summary: 'All systems nominal',
    regulatory: ['FDL Art.20-22'],
    ...overrides,
  };
}

describe('buildStatusPage', () => {
  it('produces HTML + JSON for a healthy report', () => {
    const page = buildStatusPage(makeHealth());
    expect(page.overall).toBe('ok');
    expect(page.html).toContain('Operational');
    expect(page.json).toContain('"overall"');
    expect(page.badges.length).toBeGreaterThan(0);
  });

  it('degraded report produces degraded badges', () => {
    const page = buildStatusPage(
      makeHealth({
        overall: 'degraded',
        tierCQueues: {
          clampSuggestionsPending: 0,
          outboundQueuePending: 0,
          breakGlassPendingApproval: 0,
          deadLetterDepth: 25,
        },
      })
    );
    const dl = page.badges.find((b) => b.label === 'Dead-letter queue');
    expect(dl?.state).toBe('degraded');
  });

  it('broken dead-letter badge on depth > 50', () => {
    const page = buildStatusPage(
      makeHealth({
        tierCQueues: {
          clampSuggestionsPending: 0,
          outboundQueuePending: 0,
          breakGlassPendingApproval: 0,
          deadLetterDepth: 60,
        },
      })
    );
    const dl = page.badges.find((b) => b.label === 'Dead-letter queue');
    expect(dl?.state).toBe('broken');
  });

  it('HTML escapes dangerous strings', () => {
    const page = buildStatusPage(
      makeHealth({
        dependencies: [
          { name: '<script>', state: 'broken', latencyMs: null, detail: 'evil', regulatory: '' },
        ],
      })
    );
    expect(page.html).not.toContain('<script>');
    expect(page.html).toContain('&lt;script&gt;');
  });
});

// ===========================================================================
// regressionHarness
// ===========================================================================

describe('runRegression', () => {
  const goldens: GoldenCase[] = [
    {
      id: 'clean-retail',
      description: 'Clean retail pass',
      features: { txValue30dAED: 5000 },
      expectedVerdict: 'pass',
      regulatoryAnchor: 'FDL Art.20',
    },
    {
      id: 'over-threshold',
      description: 'Over CTR threshold',
      features: { txValue30dAED: 100000 },
      expectedVerdict: 'flag',
      regulatoryAnchor: 'MoE Circular 08/AML/2021',
    },
  ];

  const thresholdVerdict: RegressionVerdictFn = (f) => ({
    verdict: (f.txValue30dAED ?? 0) >= 55_000 ? 'flag' : 'pass',
    confidence: 0.8,
  });

  it('passes when every golden matches', async () => {
    const r = await runRegression(goldens, thresholdVerdict);
    expect(r.pass).toBe(true);
    expect(r.passedCases).toBe(2);
  });

  it('fails when a golden drifts', async () => {
    const wrong: RegressionVerdictFn = () => ({ verdict: 'freeze', confidence: 0.9 });
    const r = await runRegression(goldens, wrong);
    expect(r.pass).toBe(false);
    expect(r.failedCases).toBe(2);
  });

  it('captures exceptions without failing the run', async () => {
    const crash: RegressionVerdictFn = () => {
      throw new Error('boom');
    };
    const r = await runRegression(goldens, crash);
    expect(r.pass).toBe(false);
    expect(r.results[0]!.description).toMatch(/THREW/);
  });

  it('formatRegressionReport produces readable output', async () => {
    const r = await runRegression(goldens, thresholdVerdict);
    const text = formatRegressionReport(r);
    expect(text).toContain('PASS');
    expect(text).toContain('clean-retail');
  });

  it('confidence drift within tolerance counts as pass', async () => {
    const withConfidence: GoldenCase[] = [
      {
        id: 'conf-ok',
        description: 'x',
        features: {},
        expectedVerdict: 'pass',
        expectedConfidence: 0.78,
        confidenceTolerance: 0.05,
        regulatoryAnchor: 'x',
      },
    ];
    const r = await runRegression(withConfidence, () => ({ verdict: 'pass', confidence: 0.8 }));
    expect(r.pass).toBe(true);
  });

  it('confidence drift outside tolerance fails', async () => {
    const withConfidence: GoldenCase[] = [
      {
        id: 'conf-off',
        description: 'x',
        features: {},
        expectedVerdict: 'pass',
        expectedConfidence: 0.5,
        confidenceTolerance: 0.05,
        regulatoryAnchor: 'x',
      },
    ];
    const r = await runRegression(withConfidence, () => ({ verdict: 'pass', confidence: 0.8 }));
    expect(r.pass).toBe(false);
  });
});
