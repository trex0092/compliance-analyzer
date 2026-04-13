/**
 * Bundled tests for Tier A services:
 *   - skillExecutor
 *   - goamlGeneratorReal
 *
 * enhancedBrainDispatcher is exercised indirectly via its
 * fallback-to-derivation path (which uses the existing
 * super-brain dispatcher surface already covered by
 * superBrainBatchDispatcher.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeSkill,
  registerSkillRunner,
  registerBuiltInRunners,
  __resetSkillRunnersForTests,
  hasSkillRunner,
} from '@/services/skillExecutor';
import { routeAsanaComment } from '@/services/asanaCommentSkillRouter';
import { generateGoamlXml, validateGoamlPayload } from '@/services/goamlGeneratorReal';
import type { ComplianceCase } from '@/domain/cases';

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-x',
    entityId: 'ACME LLC',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 14,
    riskLevel: 'high',
    redFlags: ['RF1', 'RF2'],
    findings: ['unusual wire pattern'],
    narrative: 'suspicious transaction activity detected',
    recommendation: 'edd',
    auditLog: [],
    ...overrides,
  };
}

describe('skillExecutor', () => {
  beforeEach(() => {
    __resetSkillRunnersForTests();
  });

  it('falls back to stub when no runner is registered', async () => {
    const parsed = routeAsanaComment('/screen ACME');
    if (!parsed.ok || !parsed.invocation) throw new Error('expected ok');
    const outcome = await executeSkill(parsed.invocation, {
      invokedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.data?.stub).toBe(true);
    expect(outcome.reply).toContain('/screen');
  });

  it('invokes the registered runner when available', async () => {
    const runner = vi.fn(async () => ({ ok: true, reply: 'real output' }));
    registerSkillRunner('screen', runner);
    const parsed = routeAsanaComment('/screen ACME');
    if (!parsed.ok || !parsed.invocation) throw new Error('expected ok');
    const outcome = await executeSkill(parsed.invocation, {
      invokedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(outcome.reply).toBe('real output');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('returns timeout outcome when runner exceeds timeoutMs', async () => {
    const runner = vi.fn(async () => {
      return new Promise<{ ok: boolean; reply: string }>(() => {
        /* never resolves */
      });
    });
    registerSkillRunner('screen', runner);
    const parsed = routeAsanaComment('/screen ACME');
    if (!parsed.ok || !parsed.invocation) throw new Error('expected ok');
    const outcome = await executeSkill(
      parsed.invocation,
      { invokedAtIso: '2026-04-13T12:00:00.000Z' },
      { timeoutMs: 50 }
    );
    expect(outcome.timedOut).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.reply).toContain('timed out');
  });

  it('surfaces runner exceptions as ok=false', async () => {
    registerSkillRunner('screen', async () => {
      throw new Error('runner boom');
    });
    const parsed = routeAsanaComment('/screen ACME');
    if (!parsed.ok || !parsed.invocation) throw new Error('expected ok');
    const outcome = await executeSkill(parsed.invocation, {
      invokedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('runner boom');
  });

  it('registerBuiltInRunners registers the known skills', () => {
    __resetSkillRunnersForTests();
    registerBuiltInRunners();
    expect(hasSkillRunner('screen')).toBe(true);
    expect(hasSkillRunner('audit')).toBe(true);
    expect(hasSkillRunner('deploy-check')).toBe(true);
  });
});

describe('goamlGeneratorReal — validation', () => {
  it('rejects payloads missing reporting entity id', () => {
    const result = validateGoamlPayload({
      reportingEntityId: '',
      reportCode: 'STR',
      case: mkCase(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('reportingEntityId is required');
  });

  it('warns when STR has no red flags', () => {
    const result = validateGoamlPayload({
      reportingEntityId: 'ENT-1',
      reportCode: 'STR',
      case: mkCase({ redFlags: [] }),
    });
    expect(result.warnings.some((w) => w.includes('no red flags'))).toBe(true);
  });

  it('requires a non-zero transaction total for CTR', () => {
    const result = validateGoamlPayload({
      reportingEntityId: 'ENT-1',
      reportCode: 'CTR',
      case: mkCase(),
      transactions: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('CTR requires'))).toBe(true);
  });

  it('warns when CTR total is below AED 55K', () => {
    const result = validateGoamlPayload({
      reportingEntityId: 'ENT-1',
      reportCode: 'CTR',
      case: mkCase(),
      transactions: [
        { id: 't1', dateIso: '2026-04-13', amountAed: 10_000, direction: 'incoming' },
      ],
    });
    expect(result.warnings.some((w) => w.includes('55,000'))).toBe(true);
  });
});

describe('goamlGeneratorReal — XML output', () => {
  it('produces well-formed XML with case id in subject', () => {
    const result = generateGoamlXml({
      reportingEntityId: 'ENT-1',
      reportCode: 'STR',
      case: mkCase({ id: 'case-42' }),
      generatedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    expect(result.xml).toContain('<?xml version="1.0"');
    expect(result.xml).toContain('<subject_id>case-case-42</subject_id>');
  });

  it('never echoes entity legal name (FDL Art.29)', () => {
    const result = generateGoamlXml({
      reportingEntityId: 'ENT-1',
      reportCode: 'STR',
      case: mkCase({ entityId: 'MADISON JEWELLERY LLC' }),
    });
    expect(result.xml).not.toContain('MADISON');
  });

  it('escapes XML metacharacters in narrative', () => {
    const result = generateGoamlXml({
      reportingEntityId: 'ENT-1',
      reportCode: 'STR',
      case: mkCase({ narrative: 'Contains <bad> & "risky" chars' }),
    });
    expect(result.xml).toContain('&lt;bad&gt;');
    expect(result.xml).toContain('&amp;');
    expect(result.xml).toContain('&quot;');
  });

  it('includes a transactions block when transactions are supplied', () => {
    const result = generateGoamlXml({
      reportingEntityId: 'ENT-1',
      reportCode: 'CTR',
      case: mkCase(),
      transactions: [
        {
          id: 't1',
          dateIso: '2026-04-13',
          amountAed: 75_000,
          direction: 'incoming',
          counterparty: 'GOLD SUPPLIER',
        },
      ],
    });
    expect(result.xml).toContain('<transactions>');
    expect(result.xml).toContain('<amount_aed>75000.00</amount_aed>');
    expect(result.xml).toContain('GOLD SUPPLIER');
  });

  it('returns ok=false when validation fails', () => {
    const result = generateGoamlXml({
      reportingEntityId: '',
      reportCode: 'STR',
      case: mkCase(),
    });
    expect(result.ok).toBe(false);
    expect(result.xml).toBeUndefined();
  });

  it('always includes the 10-year retention tag', () => {
    const result = generateGoamlXml({
      reportingEntityId: 'ENT-1',
      reportCode: 'STR',
      case: mkCase(),
    });
    expect(result.xml).toContain('<retention years="10">FDL No.10/2025 Art.24</retention>');
  });
});
