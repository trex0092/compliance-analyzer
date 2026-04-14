/**
 * Asana brain task template tests.
 *
 * Covers:
 *   - Routing: freeze → MLRO, escalate → KYC, flag → Audit Log,
 *     unstable → Audit Log, critical drift → AI Governance
 *   - Title severity prefix + 256-char truncation
 *   - Body contains every section when the data is present
 *   - Body omits empty sections (clean case → just decision block)
 *   - Tags reflect every fired signal
 *   - FDL Art.29 tipping-off footer always present
 */
import { describe, it, expect } from "vitest";
import {
  buildAsanaTaskFromBrainResponse,
  routeToProject,
  __test__,
} from "../src/services/asana/asanaBrainTaskTemplate";
import type { ComplianceDecision } from "../src/services/complianceDecisionEngine";
import type { TypologyReport } from "../src/services/fatfTypologyMatcher";
import type { CorrelationReport } from "../src/services/crossCasePatternCorrelator";
import type { BrainPowerScore } from "../src/services/brainSuperRunner";
import type { EnsembleReport } from "../src/services/brainConsensusEnsemble";
import type { VelocityReport } from "../src/services/behaviouralVelocityDetector";

const {
  severityPrefix,
  truncate,
  buildTitle,
  buildBody,
  buildTags,
  hasSanctionsTypology,
  hasStagedFiling,
} = __test__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function decision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  return {
    id: "t1:ent1:100",
    tenantId: "t1",
    verdict: "flag",
    confidence: 0.8,
    recommendedAction: "Monitor",
    requiresHumanReview: false,
    strPrediction: {
      probability: 0.1,
      band: "low",
      recommendation: "monitor",
      factors: [],
      logit: 0,
      intercept: 0,
    },
    warRoomEvent: {
      id: "w1",
      at: "2026-04-14T12:00:00.000Z",
      kind: "screening",
      severity: "medium",
      title: "T",
      entityId: "ent1",
    },
    at: "2026-04-14T12:00:00.000Z",
    auditNarrative: "clean run",
    raw: {} as unknown as ComplianceDecision["raw"],
    ...overrides,
  } as ComplianceDecision;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("severityPrefix", () => {
  it("maps every verdict to its badge", () => {
    expect(severityPrefix("freeze")).toMatch(/FREEZE/);
    expect(severityPrefix("escalate")).toMatch(/ESCALATE/);
    expect(severityPrefix("flag")).toMatch(/FLAG/);
    expect(severityPrefix("pass")).toMatch(/PASS/);
  });
});

describe("truncate", () => {
  it("returns the input unchanged when under the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("cuts and appends an ellipsis when over the limit", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("buildTitle", () => {
  it("carries severity + entity ref + recommended action", () => {
    const t = buildTitle(decision({ verdict: "freeze", recommendedAction: "Freeze now" }));
    expect(t).toMatch(/FREEZE/);
    expect(t).toMatch(/ent1/);
    expect(t).toMatch(/Freeze now/);
  });
  it("truncates long titles to 256 chars", () => {
    const t = buildTitle(
      decision({ recommendedAction: "x".repeat(500) })
    );
    expect(t.length).toBeLessThanOrEqual(256);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("routeToProject", () => {
  it("freeze → MLRO Central", () => {
    const r = routeToProject({ decision: decision({ verdict: "freeze" }) });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_MLRO_CENTRAL");
    expect(r.routingReason).toMatch(/MLRO Central/);
  });

  it("freeze beats critical drift (safety wins)", () => {
    const r = routeToProject({
      decision: decision({ verdict: "freeze" }),
      regulatoryDrift: {
        clean: false,
        versionDrifted: true,
        topSeverity: "critical",
      },
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_MLRO_CENTRAL");
  });

  it("critical drift (non-freeze verdict) → AI Governance Watchdog", () => {
    const r = routeToProject({
      decision: decision({ verdict: "flag" }),
      regulatoryDrift: {
        clean: false,
        versionDrifted: true,
        topSeverity: "critical",
      },
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_AI_GOVERNANCE_WATCHDOG");
  });

  it("escalate (no filing) → KYC/CDD Tracker", () => {
    const r = routeToProject({ decision: decision({ verdict: "escalate" }) });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_KYC_CDD_TRACKER");
  });

  it("escalate + STR filing staged → goAML / Regulatory Reporting", () => {
    const r = routeToProject({
      decision: decision({
        verdict: "escalate",
        fourEyes: {
          decisionId: "d",
          decisionType: "str_filing",
          status: "pending",
          meetsRequirements: false,
          approvedRoles: [],
          missingRoles: [],
          approvalCount: 0,
          requiredCount: 2,
          isExpired: false,
          hoursRemaining: 240,
          violations: [],
          auditTrail: [],
          regulatoryRef: "FDL Art.26-27",
        },
      }),
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_GOAML_REGULATORY_REPORTING");
    expect(r.routingReason).toMatch(/goAML/);
  });

  it("flag + SANCTIONS-* typology match → TFS Daily Log", () => {
    const r = routeToProject({
      decision: decision({ verdict: "flag" }),
      typologies: {
        topSeverity: "critical",
        summary: "",
        matches: [
          {
            typology: {
              id: "SANCTIONS-001",
              name: "Sanctions proximity",
              description: "",
              signals: [],
              threshold: 0.35,
              severity: "critical",
              regulatory: "FDL Art.35",
              recommendedAction: "escalate",
            },
            score: 0.8,
            firedSignals: [],
            missedSignals: [],
          },
        ],
      } as unknown as TypologyReport,
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_SCREENINGS_TFS_DAILY_LOG");
    expect(r.routingReason).toMatch(/SANCTIONS/);
  });

  it("flag without sanctions typology → Compliance Audit Log", () => {
    const r = routeToProject({
      decision: decision({ verdict: "flag" }),
      typologies: {
        topSeverity: "medium",
        summary: "",
        matches: [
          {
            typology: {
              id: "DPMS-001",
              name: "Cash gold",
              description: "",
              signals: [],
              threshold: 0.35,
              severity: "medium",
              regulatory: "MoE 08/AML/2021",
              recommendedAction: "EDD",
            },
            score: 0.6,
            firedSignals: [],
            missedSignals: [],
          },
        ],
      } as unknown as TypologyReport,
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_COMPLIANCE_AUDIT_LOG");
  });

  it("flag → Compliance Audit Log", () => {
    const r = routeToProject({ decision: decision({ verdict: "flag" }) });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_COMPLIANCE_AUDIT_LOG");
  });

  it("ensemble UNSTABLE flag → Compliance Audit Log with unstable reason", () => {
    const r = routeToProject({
      decision: decision({ verdict: "flag" }),
      ensemble: {
        runs: 5,
        meanMatchCount: 1,
        majorityTypologyId: "X",
        majorityVoteCount: 3,
        agreement: 0.6,
        unstable: true,
        majoritySeverity: "medium",
        votes: [],
        summary: "",
        regulatory: "",
      } as unknown as EnsembleReport,
    });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_COMPLIANCE_AUDIT_LOG");
    expect(r.routingReason).toMatch(/UNSTABLE/);
  });

  it("pass → Compliance Audit Log (retention)", () => {
    const r = routeToProject({ decision: decision({ verdict: "pass" }) });
    expect(r.projectEnvKey).toBe("ASANA_PROJECT_COMPLIANCE_AUDIT_LOG");
  });
});

// ---------------------------------------------------------------------------
// Body content
// ---------------------------------------------------------------------------

describe("buildBody", () => {
  it("always carries verdict + confidence + id + FDL Art.29 footer", () => {
    const body = buildBody({ decision: decision() });
    expect(body).toMatch(/Verdict:\*\* flag/);
    expect(body).toMatch(/Confidence:\*\* 80%/);
    expect(body).toMatch(/t1:ent1:100/);
    expect(body).toMatch(/Art\.?29/);
  });

  it("renders the Power Score section when present", () => {
    const power: BrainPowerScore = {
      score: 85,
      verdict: "weaponized",
      subsystemsInvoked: 10,
      subsystemsFailed: 0,
      advisorInvoked: true,
      attestationSealed: true,
      clampsFired: 2,
      components: [],
    };
    const body = buildBody({ decision: decision(), powerScore: power });
    expect(body).toMatch(/Brain Power Score/);
    expect(body).toMatch(/85\/100/);
    expect(body).toMatch(/advisor escalation fired/);
    expect(body).toMatch(/zk-attestation sealed/);
    expect(body).toMatch(/2 safety clamp/);
  });

  it("renders the Ensemble section with stability state", () => {
    const ensemble = {
      runs: 5,
      meanMatchCount: 1.2,
      majorityTypologyId: "SANCTIONS-001",
      majorityVoteCount: 5,
      agreement: 1,
      unstable: false,
      majoritySeverity: "critical",
      votes: [],
      summary: "",
      regulatory: "",
    } as unknown as EnsembleReport;
    const body = buildBody({ decision: decision(), ensemble });
    expect(body).toMatch(/Consensus Ensemble/);
    expect(body).toMatch(/5\/5 runs agree/);
    expect(body).toMatch(/SANCTIONS-001/);
  });

  it("renders FATF typology matches", () => {
    const typologies = {
      topSeverity: "high",
      summary: "",
      matches: [
        {
          typology: {
            id: "DPMS-001",
            name: "High-Value Cash Gold",
            description: "",
            regulatory: "FATF 2022",
            severity: "high",
            recommendedAction: "EDD",
            signals: [],
            threshold: 0.5,
          },
          score: 0.9,
          firedSignals: ["cash >= 70%"],
          missedSignals: [],
        },
      ],
    } as unknown as TypologyReport;
    const body = buildBody({ decision: decision(), typologies });
    expect(body).toMatch(/FATF Typology Matches/);
    expect(body).toMatch(/DPMS-001/);
    expect(body).toMatch(/High-Value Cash Gold/);
    expect(body).toMatch(/EDD/);
  });

  it("renders cross-case findings", () => {
    const crossCase = {
      tenantId: "t1",
      caseCount: 3,
      topSeverity: "critical",
      correlations: [
        {
          kind: "wallet-reuse",
          id: "wr-1",
          caseIds: ["c1", "c2"],
          confidence: 0.8,
          severity: "critical",
          description: "two cases share wallet",
          regulatory: "FATF Rec 15",
        },
      ],
    } as unknown as CorrelationReport;
    const body = buildBody({ decision: decision(), crossCase });
    expect(body).toMatch(/Cross-Case Findings/);
    expect(body).toMatch(/wallet-reuse/);
  });

  it("renders Behavioural Velocity section only when above info", () => {
    const velocity: VelocityReport = {
      tenantId: "t1",
      caseCount: 4,
      compositeScore: 0.7,
      severity: "high",
      burst: { score: 0.7, description: "fast", data: {} },
      offHours: { score: 0.1, description: "ok", data: {} },
      weekend: { score: 0.1, description: "ok", data: {} },
      summary: "fast",
      regulatory: "FATF Rec 20",
    };
    const body = buildBody({ decision: decision(), velocity });
    expect(body).toMatch(/Behavioural Velocity/);
    expect(body).toMatch(/HIGH/);
  });

  it("omits velocity section when severity is info", () => {
    const velocity: VelocityReport = {
      tenantId: "t1",
      caseCount: 1,
      compositeScore: 0,
      severity: "info",
      burst: { score: 0, description: "", data: {} },
      offHours: { score: 0, description: "", data: {} },
      weekend: { score: 0, description: "", data: {} },
      summary: "",
      regulatory: "",
    };
    const body = buildBody({ decision: decision(), velocity });
    expect(body).not.toMatch(/Behavioural Velocity/);
  });

  it("renders regulatory drift section when not clean", () => {
    const body = buildBody({
      decision: decision(),
      regulatoryDrift: {
        clean: false,
        versionDrifted: true,
        topSeverity: "critical",
        findings: [
          { key: "DPMS_CASH_THRESHOLD_AED", severity: "critical" },
        ],
      },
    });
    expect(body).toMatch(/Regulatory Drift/);
    expect(body).toMatch(/DPMS_CASH_THRESHOLD_AED/);
  });

  it("renders four-eyes when present on the decision", () => {
    const body = buildBody({
      decision: decision({
        fourEyes: {
          decisionId: "d",
          decisionType: "str_filing",
          status: "pending",
          meetsRequirements: false,
          approvedRoles: [],
          missingRoles: ["compliance_officer", "mlro"],
          approvalCount: 0,
          requiredCount: 2,
          isExpired: false,
          hoursRemaining: 48,
          violations: [],
          auditTrail: [],
          regulatoryRef: "FDL Art.26-27",
        },
      }),
    });
    expect(body).toMatch(/Four-Eyes Gate/);
    expect(body).toMatch(/str_filing/);
    expect(body).toMatch(/0\/2/);
  });

  it("renders attestation commitment when sealed", () => {
    const body = buildBody({
      decision: decision({
        attestation: {
          commitHash: "a".repeat(128),
          attestationPublishedAtIso: "2026-04-14T12:00:00.000Z",
          listName: "OFAC",
          screenedAtIso: "2026-04-14T12:00:00.000Z",
        },
      }),
    });
    expect(body).toMatch(/zk-Compliance Attestation/);
    expect(body).toMatch(/OFAC/);
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe("hasSanctionsTypology / hasStagedFiling", () => {
  it("hasSanctionsTypology true when a SANCTIONS-* match exists", () => {
    expect(
      hasSanctionsTypology({
        decision: decision(),
        typologies: {
          topSeverity: "critical",
          summary: "",
          matches: [
            {
              typology: {
                id: "SANCTIONS-002",
                name: "",
                description: "",
                signals: [],
                threshold: 0,
                severity: "critical",
                regulatory: "",
                recommendedAction: "",
              },
              score: 1,
              firedSignals: [],
              missedSignals: [],
            },
          ],
        } as unknown as TypologyReport,
      })
    ).toBe(true);
  });

  it("hasSanctionsTypology false for non-sanctions matches", () => {
    expect(
      hasSanctionsTypology({
        decision: decision(),
        typologies: {
          topSeverity: "medium",
          summary: "",
          matches: [
            {
              typology: {
                id: "DPMS-001",
                name: "",
                description: "",
                signals: [],
                threshold: 0,
                severity: "medium",
                regulatory: "",
                recommendedAction: "",
              },
              score: 1,
              firedSignals: [],
              missedSignals: [],
            },
          ],
        } as unknown as TypologyReport,
      })
    ).toBe(false);
  });

  it("hasStagedFiling true for str_filing decisionType", () => {
    expect(
      hasStagedFiling({
        decision: decision({
          fourEyes: {
            decisionId: "d",
            decisionType: "str_filing",
            status: "pending",
            meetsRequirements: false,
            approvedRoles: [],
            missingRoles: [],
            approvalCount: 0,
            requiredCount: 2,
            isExpired: false,
            hoursRemaining: 240,
            violations: [],
            auditTrail: [],
            regulatoryRef: "",
          },
        }),
      })
    ).toBe(true);
  });

  it("hasStagedFiling false for pep_approval decisionType", () => {
    expect(
      hasStagedFiling({
        decision: decision({
          fourEyes: {
            decisionId: "d",
            decisionType: "pep_approval",
            status: "pending",
            meetsRequirements: false,
            approvedRoles: [],
            missingRoles: [],
            approvalCount: 0,
            requiredCount: 2,
            isExpired: false,
            hoursRemaining: 72,
            violations: [],
            auditTrail: [],
            regulatoryRef: "",
          },
        }),
      })
    ).toBe(false);
  });

  it("hasStagedFiling false when fourEyes is absent", () => {
    expect(hasStagedFiling({ decision: decision() })).toBe(false);
  });
});

describe("buildTags", () => {
  it("always includes verdict tag", () => {
    expect(buildTags({ decision: decision({ verdict: "flag" }) })).toContain(
      "brain/verdict/flag"
    );
  });
  it("includes human-review when required", () => {
    expect(
      buildTags({ decision: decision({ requiresHumanReview: true }) })
    ).toContain("brain/human-review");
  });
  it("includes every fired signal as a tag", () => {
    const tags = buildTags({
      decision: decision({ verdict: "freeze", requiresHumanReview: true }),
      powerScore: {
        score: 90,
        verdict: "weaponized",
        subsystemsInvoked: 10,
        subsystemsFailed: 0,
        advisorInvoked: true,
        attestationSealed: true,
        clampsFired: 1,
        components: [],
      },
      ensemble: {
        runs: 5,
        meanMatchCount: 1,
        majorityTypologyId: "X",
        majorityVoteCount: 3,
        agreement: 0.6,
        unstable: true,
        majoritySeverity: "high",
        votes: [],
        summary: "",
        regulatory: "",
      } as unknown as EnsembleReport,
    });
    expect(tags).toContain("brain/verdict/freeze");
    expect(tags).toContain("brain/human-review");
    expect(tags).toContain("brain/power/weaponized");
    expect(tags).toContain("brain/ensemble/unstable");
  });
});

// ---------------------------------------------------------------------------
// buildAsanaTaskFromBrainResponse — integration
// ---------------------------------------------------------------------------

describe("buildAsanaTaskFromBrainResponse — integration", () => {
  it("returns a fully-formed template for a freeze verdict", () => {
    const tpl = buildAsanaTaskFromBrainResponse({
      decision: decision({ verdict: "freeze", requiresHumanReview: true }),
    });
    expect(tpl.name).toMatch(/FREEZE/);
    expect(tpl.projectEnvKey).toBe("ASANA_PROJECT_MLRO_CENTRAL");
    expect(tpl.notes).toMatch(/Art\.?29/);
    expect(tpl.tags).toContain("brain/verdict/freeze");
    expect(tpl.tags).toContain("brain/human-review");
    expect(tpl.routingReason).toBeDefined();
  });
});
