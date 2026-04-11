/**
 * Tests for Asana Phase 4 Ultra — decision archaeology, compliance
 * calendar, inspector pack, webhook signature verifier, mass rescreen.
 */
import { describe, it, expect } from 'vitest';

import {
  excavateEntityHistory,
  buildComplianceCalendar,
  buildInspectorPack,
  computeHmacSha256Hex,
  verifyAsanaWebhookSignature,
  planMassRescreen,
} from '@/services/asanaPhase4Ultra';

// ---------------------------------------------------------------------------
// R1 decisionArchaeology
// ---------------------------------------------------------------------------

describe('decisionArchaeology', () => {
  it('produces chronological timeline with counts', () => {
    const report = excavateEntityHistory({
      entityId: 'E1',
      entityName: 'Acme Gold',
      events: [
        { at: '2026-03-15T00:00:00Z', source: 'case', actor: 'system', summary: 'Case opened', refId: 'C1' },
        { at: '2026-01-10T00:00:00Z', source: 'filing', actor: 'mlro', summary: 'STR filed', refId: 'F1' },
        { at: '2026-02-20T00:00:00Z', source: 'asana_task', actor: 'analyst', summary: 'Review', refId: 'T1' },
      ],
    });
    expect(report.timeline.length).toBe(3);
    expect(report.timeline[0].source).toBe('filing');
    expect(report.countsBySource.case).toBe(1);
    expect(report.countsBySource.filing).toBe(1);
    expect(report.countsBySource.asana_task).toBe(1);
  });

  it('handles empty event list', () => {
    const report = excavateEntityHistory({
      entityId: 'E1',
      entityName: 'Empty',
      events: [],
    });
    expect(report.timeline.length).toBe(0);
    expect(report.narrative).toContain('no events');
  });
});

// ---------------------------------------------------------------------------
// R2 complianceCalendar
// ---------------------------------------------------------------------------

describe('complianceCalendar', () => {
  const entries = [
    { date: '2026-01-15', kind: 'STR' as const, title: 'STR A', citation: 'FDL Art.26', priority: 'high' as const },
    { date: '2026-04-01', kind: 'DPMSR' as const, title: 'Q1 DPMSR', citation: 'MoE 08/AML/2021', priority: 'high' as const },
    { date: '2027-01-01', kind: 'KPI_REPORT' as const, title: '2026 KPI', citation: 'MoE', priority: 'medium' as const },
  ];

  it('filters by year', () => {
    const cal = buildComplianceCalendar(entries, 2026);
    expect(cal.entries.length).toBe(2);
  });

  it('groups by month', () => {
    const cal = buildComplianceCalendar(entries, 2026);
    expect(cal.byMonth.length).toBe(12);
    expect(cal.byMonth[0].entries.length).toBe(1); // Jan
    expect(cal.byMonth[3].entries.length).toBe(1); // April
    expect(cal.byMonth[5].entries.length).toBe(0); // June
  });

  it('sorts entries chronologically', () => {
    const cal = buildComplianceCalendar(
      [entries[1], entries[0]],
      2026
    );
    expect(cal.entries[0].date).toBe('2026-01-15');
  });
});

// ---------------------------------------------------------------------------
// R3 inspectorPackBuilder
// ---------------------------------------------------------------------------

describe('inspectorPackBuilder', () => {
  it('builds a manifest with regulatory index', () => {
    const pack = buildInspectorPack({
      entityId: 'E1',
      entityName: 'Acme',
      inspector: 'MoE Officer',
      inspectionDate: '2026-04-11',
      artefacts: [
        {
          name: 'str-report.html',
          mimeType: 'text/html',
          content: '<html>STR</html>',
          citation: 'FDL No.10/2025 Art.26-27',
        },
        {
          name: 'goaml.xml',
          mimeType: 'application/xml',
          content: '<?xml version="1.0"?><str/>',
          citation: 'MoE Circular 08/AML/2021',
        },
      ],
    });
    expect(pack.artefactCount).toBe(2);
    expect(pack.regulatoryIndex.length).toBe(2);
    expect(pack.coverNarrative).toContain('11/04/2026');
    expect(pack.coverNarrative).toContain('FDL No.10/2025 Art.29');
  });

  it('groups artefacts by citation', () => {
    const pack = buildInspectorPack({
      entityId: 'E1',
      entityName: 'Acme',
      inspector: 'Officer',
      inspectionDate: '2026-04-11',
      artefacts: [
        { name: 'a', mimeType: 'text/plain', content: 'a', citation: 'X' },
        { name: 'b', mimeType: 'text/plain', content: 'b', citation: 'X' },
      ],
    });
    expect(pack.regulatoryIndex[0].artefacts.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// R4 asanaWebhookSignatureVerifier
// ---------------------------------------------------------------------------

describe('asanaWebhookSignatureVerifier', () => {
  it('verifies a known HMAC-SHA-256 signature', async () => {
    // Known test vector: HMAC-SHA-256("key", "The quick brown fox jumps over the lazy dog")
    // = f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
    const sig = await computeHmacSha256Hex(
      'key',
      'The quick brown fox jumps over the lazy dog'
    );
    expect(sig).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('valid signature passes verification', async () => {
    const body = '{"events":[{"action":"changed"}]}';
    const secret = 'webhook-secret';
    const sig = await computeHmacSha256Hex(secret, body);
    const result = await verifyAsanaWebhookSignature({
      secret,
      rawBody: body,
      headerSignature: sig,
    });
    expect(result.valid).toBe(true);
  });

  it('tampered body fails verification', async () => {
    const secret = 'webhook-secret';
    const sig = await computeHmacSha256Hex(secret, 'original');
    const result = await verifyAsanaWebhookSignature({
      secret,
      rawBody: 'tampered',
      headerSignature: sig,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('missing secret fails fast', async () => {
    const result = await verifyAsanaWebhookSignature({
      secret: '',
      rawBody: 'x',
      headerSignature: 'x',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('secret');
  });

  it('missing header fails fast', async () => {
    const result = await verifyAsanaWebhookSignature({
      secret: 'x',
      rawBody: 'x',
      headerSignature: '',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('header');
  });
});

// ---------------------------------------------------------------------------
// R5 massRescreenTrigger
// ---------------------------------------------------------------------------

describe('massRescreenTrigger', () => {
  it('plans batches respecting concurrency', () => {
    const plan = planMassRescreen(
      {
        customerIds: Array.from({ length: 25 }, (_, i) => `C${i}`),
        triggerReason: 'new UN list',
        rpm: 60,
        concurrency: 10,
      },
      new Date('2026-04-11T00:00:00Z')
    );
    expect(plan.total).toBe(25);
    expect(plan.batches.length).toBe(3); // 10 + 10 + 5
    expect(plan.batches[0].customerIds.length).toBe(10);
    expect(plan.batches[2].customerIds.length).toBe(5);
  });

  it('batches are spaced apart in time', () => {
    const plan = planMassRescreen(
      {
        customerIds: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
        triggerReason: 'test',
        rpm: 60,
        concurrency: 2,
      },
      new Date('2026-04-11T00:00:00Z')
    );
    const t0 = Date.parse(plan.batches[0].scheduledAt);
    const t1 = Date.parse(plan.batches[1].scheduledAt);
    expect(t1).toBeGreaterThan(t0);
  });

  it('citation includes Cabinet Res 74/2020 + FATF Rec 10', () => {
    const plan = planMassRescreen({
      customerIds: ['C1'],
      triggerReason: 'new SDN',
    });
    expect(plan.citation).toContain('Cabinet Res 74/2020');
    expect(plan.citation).toContain('FATF Rec 10');
    expect(plan.citation).toContain('new SDN');
  });

  it('estimated duration scales with customer count', () => {
    const plan = planMassRescreen({
      customerIds: Array.from({ length: 600 }, (_, i) => `C${i}`),
      triggerReason: 'test',
      rpm: 60,
    });
    expect(plan.estimatedDurationMinutes).toBe(10);
  });
});
