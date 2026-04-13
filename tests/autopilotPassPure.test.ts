/**
 * Bundled tests for the remaining pure autopilot services:
 *   strAutoAttachmentPipeline (buildGoamlXmlStub)
 *   crossProjectMirrorEngine   (buildMirrorPlan)
 *   policyDslBridge            (buildPolicyFacts, applyPolicyBridge)
 *   asanaTaskToCaseSeeder      (isTaskSeedEligible, buildSeededCase)
 *   notificationBridge         (payload builders)
 *   megaBrainAdapter           (buildStrFeatures, buildMegaBrainRequest)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildGoamlXmlStub } from '@/services/strAutoAttachmentPipeline';
import { buildMirrorPlan } from '@/services/crossProjectMirrorEngine';
import { buildPolicyFacts, applyPolicyBridge } from '@/services/policyDslBridge';
import { parsePolicy } from '@/services/policyDsl';
import {
  isTaskSeedEligible,
  buildSeededCase,
} from '@/services/asanaTaskToCaseSeeder';
import {
  buildBrowserNotificationPayload,
  buildTeamsCardPayload,
  buildEmailPayload,
} from '@/services/notificationBridge';
import {
  buildStrFeatures,
  buildMegaBrainRequest,
} from '@/services/megaBrainAdapter';
import type { ComplianceCase } from '@/domain/cases';

beforeEach(() => {
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  } as unknown as Storage;
});

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
    riskScore: 10,
    riskLevel: 'medium',
    redFlags: ['RF1', 'RF2'],
    findings: ['f1'],
    narrative: 'test',
    recommendation: 'continue',
    auditLog: [],
    ...overrides,
  };
}

describe('buildGoamlXmlStub', () => {
  it('emits a schema-shaped XML with the case id in the subject', () => {
    const xml = buildGoamlXmlStub(mkCase({ id: 'case-42' }));
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<subject_id>case-case-42</subject_id>');
    expect(xml).toContain('FDL No.10/2025 Art.24');
    expect(xml).toContain('Art.29');
  });

  it('never echoes the entity legal name', () => {
    const xml = buildGoamlXmlStub(mkCase({ entityId: 'MADISON JEWELLERY' }));
    expect(xml).not.toContain('MADISON');
  });

  it('escapes XML metacharacters in narrative', () => {
    const xml = buildGoamlXmlStub(mkCase({ narrative: 'foo & <bar>' }));
    expect(xml).toContain('foo &amp; &lt;bar&gt;');
  });
});

describe('buildMirrorPlan', () => {
  it('creates one payload per new blockage event', () => {
    const plan = buildMirrorPlan(
      [
        {
          sourceTaskGid: 't1',
          sourceProjectGid: 'p-source',
          summary: 'Blocked KYC',
          blockedAtIso: '2026-04-13T12:00:00.000Z',
        },
      ],
      'p-mlro',
      { dedupe: false }
    );
    expect(plan.payloads).toHaveLength(1);
    expect(plan.payloads[0].name).toContain('t1');
    expect(plan.payloads[0].projects).toEqual(['p-mlro']);
  });

  it('dedupes repeated events within the dedup state', () => {
    const state = new Map<string, number>();
    const events = [
      {
        sourceTaskGid: 't1',
        sourceProjectGid: 'p-source',
        summary: 'Blocked',
        blockedAtIso: '2026-04-13T12:00:00.000Z',
      },
    ];
    buildMirrorPlan(events, 'p-mlro', { dedupState: state });
    const second = buildMirrorPlan(events, 'p-mlro', { dedupState: state });
    expect(second.payloads).toHaveLength(0);
    expect(second.skipped).toContain('t1');
  });
});

describe('policyDslBridge', () => {
  it('buildPolicyFacts pulls case + customer fields', () => {
    const facts = buildPolicyFacts({
      case: mkCase({ riskScore: 15 }),
      customer: {
        id: 'c1',
        legalName: 'ACME',
        type: 'customer',
        countryOfRegistration: 'AE',
        riskRating: 'high',
        pepStatus: 'match',
        sanctionsStatus: 'clear',
        sourceOfFundsStatus: 'verified',
        sourceOfWealthStatus: 'verified',
        beneficialOwners: [],
        reviewHistory: [],
      },
    });
    expect(facts.risk_score).toBe(15);
    expect(facts.pep_status).toBe('match');
    expect(facts.customer_country).toBe('AE');
  });

  it('hardens up but never down', () => {
    const policy = parsePolicy(`IF risk_level == "high" THEN escalate`);
    const resultUp = applyPolicyBridge(
      { case: mkCase({ riskLevel: 'high' }), policy },
      'flag'
    );
    expect(resultUp.finalVerdict).toBe('escalate');
    expect(resultUp.hardenedUp).toBe(true);

    const resultNoDowngrade = applyPolicyBridge(
      { case: mkCase({ riskLevel: 'low' }), policy },
      'freeze'
    );
    // Policy evaluates to pass (no rule matched) but brain says
    // freeze — brain wins and the final verdict stays freeze.
    expect(resultNoDowngrade.finalVerdict).toBe('freeze');
    expect(resultNoDowngrade.hardenedUp).toBe(false);
  });

  it('returns brain verdict when no policy is configured', () => {
    const result = applyPolicyBridge({ case: mkCase(), policy: null }, 'flag');
    expect(result.finalVerdict).toBe('flag');
  });
});

describe('asanaTaskToCaseSeeder', () => {
  it('detects seed-eligible task via tag', () => {
    expect(
      isTaskSeedEligible({
        gid: 't1',
        name: 'incoming',
        tags: [{ gid: 'tg1', name: 'compliance-case' }],
      })
    ).toBe(true);
  });

  it('detects seed-eligible task via notes marker', () => {
    expect(
      isTaskSeedEligible({ gid: 't1', name: 'x', notes: 'body [SEED-LOCAL-CASE] more' })
    ).toBe(true);
  });

  it('rejects tasks without any marker', () => {
    expect(isTaskSeedEligible({ gid: 't1', name: 'nope' })).toBe(false);
  });

  it('builds a ComplianceCase stub with entityId derived from task gid', () => {
    const seed = buildSeededCase({
      gid: 't-42',
      name: 'seeded',
      tags: [{ gid: 'tg1', name: 'compliance-case' }],
      created_at: '2026-04-13T12:00:00.000Z',
    });
    expect(seed).toBeDefined();
    expect(seed?.id).toBe('asana-t-42');
    expect(seed?.entityId).toBe('asana-task-t-42');
    expect(seed?.entityId).not.toContain('seeded');
  });

  it('inferred risk level reflects notes keywords', () => {
    const critical = buildSeededCase({
      gid: 't-1',
      name: 'CRITICAL alert',
      tags: [{ gid: 'tg1', name: 'compliance-case' }],
    });
    expect(critical?.riskLevel).toBe('critical');
  });
});

describe('notificationBridge builders', () => {
  const base = {
    caseId: 'case-9',
    verdict: 'freeze' as const,
    headline: 'Sanctions match',
    recommendedAction: 'Freeze and file CNMR',
  };

  it('browser payload severity matches verdict', () => {
    const p = buildBrowserNotificationPayload(base);
    expect(p.severity).toBe('critical');
    expect(p.title).toContain('FREEZE');
  });

  it('teams card payload includes the case id in the facts', () => {
    const p = buildTeamsCardPayload(base);
    expect(p.channel).toBe('teams');
    const card = p.teamsCard as { sections?: Array<{ facts?: Array<{ name: string; value: string }> }> };
    const facts = card.sections?.[0]?.facts ?? [];
    expect(facts.some((f) => f.value === 'case-9')).toBe(true);
  });

  it('email payload uses subject with severity tag and cites Art.29', () => {
    const p = buildEmailPayload(base);
    expect(p.emailSubject).toContain('CRITICAL');
    expect(p.emailBody).toContain('Art.29');
  });
});

describe('megaBrainAdapter pure builders', () => {
  it('buildStrFeatures reflects customer PEP + sanctions posture', () => {
    const features = buildStrFeatures({
      case: mkCase(),
      customer: {
        id: 'c1',
        legalName: 'ACME',
        type: 'customer',
        riskRating: 'high',
        pepStatus: 'match',
        sanctionsStatus: 'potential-match',
        sourceOfFundsStatus: 'verified',
        sourceOfWealthStatus: 'verified',
        beneficialOwners: [],
        reviewHistory: [],
      },
      priorCases: [mkCase({ id: 'prior-1' })],
    });
    expect(features.isPep).toBe(true);
    expect(features.sanctionsMatchScore).toBe(0.5);
    expect(features.priorAlerts90d).toBe(1);
  });

  it('buildMegaBrainRequest uses case id as entity.name (Art.29)', () => {
    const request = buildMegaBrainRequest({
      case: mkCase({ id: 'case-77', entityId: 'MADISON' }),
    });
    expect(request.entity.name).toBe('case-77');
    expect(request.entity.name).not.toContain('MADISON');
  });
});
