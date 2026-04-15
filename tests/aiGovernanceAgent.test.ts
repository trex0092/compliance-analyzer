/**
 * Tests for the AI Governance Agent.
 *
 * Covers:
 *   - Self-audit runs across all four frameworks
 *   - Customer audit with an empty evidence map
 *   - Framework subset selection
 *   - Control libraries have non-empty contents
 *   - Markdown summary renders the key sections
 *   - Critical failures appear in remediation
 */
import { describe, it, expect } from 'vitest';
import {
  runAiGovernanceAgent,
} from '@/agents/definitions/ai-governance-agent';
import {
  EU_AI_ACT_CONTROLS,
  NIST_AI_RMF_CONTROLS,
  ISO_42001_CONTROLS,
  UAE_AI_GOV_CONTROLS,
  SELF_AUDIT_EVIDENCE,
  runGovernanceAudit,
  extendSelfAudit,
} from '@/agents/aiGovernance';

describe('AI Governance Agent — control libraries', () => {
  it('EU AI Act has at least 15 controls', () => {
    expect(EU_AI_ACT_CONTROLS.length).toBeGreaterThanOrEqual(15);
    for (const c of EU_AI_ACT_CONTROLS) {
      expect(c.framework).toBe('eu_ai_act');
      expect(c.citation).toMatch(/^EU Reg 2024\/1689/);
    }
  });

  it('NIST AI RMF has at least 20 controls', () => {
    expect(NIST_AI_RMF_CONTROLS.length).toBeGreaterThanOrEqual(20);
    for (const c of NIST_AI_RMF_CONTROLS) {
      expect(c.framework).toBe('nist_ai_rmf');
      expect(['govern', 'map', 'measure', 'manage']).toContain(c.nistFunction);
    }
  });

  it('ISO/IEC 42001 has at least 15 controls', () => {
    expect(ISO_42001_CONTROLS.length).toBeGreaterThanOrEqual(15);
    for (const c of ISO_42001_CONTROLS) {
      expect(c.framework).toBe('iso_42001');
      expect(c.citation).toMatch(/^ISO\/IEC 42001/);
    }
  });

  it('UAE AI Governance has at least 5 controls', () => {
    expect(UAE_AI_GOV_CONTROLS.length).toBeGreaterThanOrEqual(5);
    for (const c of UAE_AI_GOV_CONTROLS) {
      expect(c.framework).toBe('uae_ai_gov');
    }
  });
});

describe('AI Governance Agent — self-audit', () => {
  it('self-audit runs all four frameworks', () => {
    const result = runAiGovernanceAgent({
      mode: 'self',
      target: 'compliance-analyzer',
      auditedBy: 'test-runner',
    });
    expect(result.audit.frameworks.length).toBe(4);
    expect(result.audit.auditTarget).toBe('compliance-analyzer');
    expect(result.audit.euAiActTier).toBe('high');
  });

  it('self-audit produces non-zero scores because many evidence keys are true', () => {
    const result = runAiGovernanceAgent({
      mode: 'self',
      target: 'compliance-analyzer',
      auditedBy: 'test-runner',
    });
    for (const fr of result.audit.frameworks) {
      expect(fr.score).toBeGreaterThan(0);
    }
    expect(result.audit.overallScore).toBeGreaterThan(0);
  });

  it('self-audit has ZERO failed assessments — every flag is legitimately true', () => {
    const result = runAiGovernanceAgent({
      mode: 'self',
      target: 'compliance-analyzer',
      auditedBy: 'test-runner',
    });
    // Every self-audit flag has a backing module:
    //   hasModelCards          → src/services/modelCardGenerator.ts
    //   hasBiasAssessment      → src/services/biasAuditor.ts + nameMatchingBiasAssessment.ts
    //   hasShadowAiScan        → src/services/shadowAiScanner.ts
    //   hasArabicSupport       → src/services/arabicI18n.ts
    //   hasTrainingDataLineage → src/services/trainingDataLineage.ts (satisfied_by_vacuity)
    // The tool is now fully compliant with its own self-audit.
    const failedAssessments = result.audit.frameworks
      .flatMap((f) => f.assessments)
      .filter((a) => a.status === 'fail');
    expect(failedAssessments.length).toBe(0);
  });

  it('markdown summary renders headings + table', () => {
    const result = runAiGovernanceAgent({
      mode: 'self',
      target: 'compliance-analyzer',
      auditedBy: 'test-runner',
    });
    expect(result.markdownSummary).toContain('# AI Governance Audit');
    expect(result.markdownSummary).toContain('Framework breakdown');
    expect(result.markdownSummary).toContain('EU AI Act');
    expect(result.markdownSummary).toContain('NIST AI');
    expect(result.markdownSummary).toContain('ISO/IEC 42001');
    expect(result.markdownSummary).toContain('UAE AI');
  });
});

describe('AI Governance Agent — customer audit', () => {
  it('empty evidence map produces zero scores across frameworks', () => {
    const result = runAiGovernanceAgent({
      mode: 'customer',
      target: 'Acme Corp',
      auditedBy: 'test-runner',
      evidence: {},
    });
    // Empty evidence → all controls unknown → score 0 (unknowns excluded
    // from the denom).
    for (const fr of result.audit.frameworks) {
      expect(fr.score).toBe(0);
    }
  });

  it('evidence with critical failures surfaces in remediation', () => {
    const result = runAiGovernanceAgent({
      mode: 'customer',
      target: 'Acme Corp',
      auditedBy: 'test-runner',
      evidence: {
        // Explicitly FALSE on all critical fields
        hasHumanOversight: false,
        hasKillSwitch: false,
        hasFourEyesApproval: false,
        hasAuditTrail: false,
        hasDecisionLogging: false,
        hasRiskAssessment: false,
        hasImpactAssessment: false,
        hasIncidentReporting: false,
      },
    });
    expect(result.audit.remediation.length).toBeGreaterThan(0);
    const criticalItems = result.audit.remediation.filter(
      (r) => r.severity === 'critical'
    );
    expect(criticalItems.length).toBeGreaterThan(0);
  });

  it('framework subset restricts the audit', () => {
    const result = runAiGovernanceAgent({
      mode: 'customer',
      target: 'Acme Corp',
      auditedBy: 'test-runner',
      evidence: SELF_AUDIT_EVIDENCE,
      frameworks: ['eu_ai_act'],
    });
    expect(result.audit.frameworks.length).toBe(1);
    expect(result.audit.frameworks[0].framework).toBe('eu_ai_act');
  });

  it('EU AI Act tier can be overridden', () => {
    const result = runAiGovernanceAgent({
      mode: 'customer',
      target: 'Acme Corp',
      auditedBy: 'test-runner',
      evidence: {},
      euAiActTier: 'limited',
    });
    expect(result.audit.euAiActTier).toBe('limited');
  });
});

describe('AI Governance Agent — assessor behaviour', () => {
  it('pure runGovernanceAudit with extended self-audit patches specific fields', () => {
    const extended = extendSelfAudit({ hasArabicSupport: true });
    const audit = runGovernanceAudit({
      target: 'patched',
      auditedBy: 'test',
      evidence: extended,
    });
    // UAE-AIG-05 requires hasArabicSupport — with the patch it should
    // now pass. Find it in the UAE framework.
    const uae = audit.frameworks.find((f) => f.framework === 'uae_ai_gov');
    const arabicControl = uae?.assessments.find((a) => a.controlId === 'UAE-AIG-05');
    expect(arabicControl?.status).toBe('pass');
  });

  it('unknown status means evidence absent, not fail', () => {
    const audit = runGovernanceAudit({
      target: 'test',
      auditedBy: 'test',
      evidence: {}, // no evidence at all
    });
    const totalUnknown = audit.frameworks.reduce(
      (acc, f) => acc + f.summary.unknown,
      0
    );
    const totalFail = audit.frameworks.reduce(
      (acc, f) => acc + f.summary.fail,
      0
    );
    // Most should be unknown, very few should be fail.
    expect(totalUnknown).toBeGreaterThan(totalFail);
  });

  it('not_applicable controls are excluded from the score', () => {
    const audit = runGovernanceAudit({
      target: 'test',
      auditedBy: 'test',
      evidence: SELF_AUDIT_EVIDENCE,
    });
    // EU-AIA-15 (prohibited practices) is an n/a marker — should be
    // present in assessments but status=not_applicable.
    const eu = audit.frameworks.find((f) => f.framework === 'eu_ai_act');
    const naControl = eu?.assessments.find((a) => a.controlId === 'EU-AIA-15');
    expect(naControl?.status).toBe('not_applicable');
  });
});
