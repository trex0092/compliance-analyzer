# HAWKEYE STERLING V2 — Regulatory Matrix

Every regulation, article, and circular cited in the codebase mapped to
the source file(s) that implement it and the test(s) that prove it.
This is the audit-time lookup table.

---

## UAE Federal Decree-Law No.10/2025 (FDL)

| Article | Topic | Implementation | Test |
|---|---|---|---|
| Art.12-14 | CDD tiers (SDD/CDD/EDD) | `src/services/cddTier.ts`, `src/services/onboardingDecision.ts` | `tests/cdd.test.ts` |
| Art.15-16 | Transaction thresholds | `src/domain/constants.ts` (`DPMS_CASH_THRESHOLD_AED`) | `tests/constants.test.ts` |
| Art.17 | Cross-border declaration | `src/domain/constants.ts` (`CROSS_BORDER_CASH_THRESHOLD_AED`) | `tests/constants.test.ts` |
| Art.19-21 | Compliance Officer duties | `src/services/complianceDecisionEngine.ts`, `src/services/weaponizedBrain.ts` | `tests/decisions.test.ts` |
| Art.22 | Regulatory drift watchdog | `src/services/regulatoryDriftWatchdog.ts` | `tests/regulatoryDrift.test.ts` |
| Art.24 | 10-year record retention | `src/services/zkComplianceAttestation.ts`, `src/services/quantumResistantSeal.ts`, `src/services/brainTelemetryStore.ts` | `tests/retention.test.ts` |
| Art.26-27 | STR / SAR filing | `src/services/predictiveStr.ts`, `goaml-export.js` | `tests/str.test.ts`, `tests/goaml.test.ts` |
| Art.29 | No tipping-off | `src/services/tippingOffLinter.ts`, `src/services/deferredOutboundQueue.ts` | `tests/tippingOff.test.ts` |
| Art.35 | Targeted Financial Sanctions | `src/services/sanctionsScreening.ts`, `src/services/sanctionsNameVariantExpander.ts` | `tests/sanctions.test.ts` |

## Cabinet Resolution 134/2025 (Implementing Regulations)

| Article | Topic | Implementation | Test |
|---|---|---|---|
| Art.5 | Risk appetite framework | `src/services/riskAppetite.ts` | `tests/riskAppetite.test.ts` |
| Art.7-10 | CDD tier requirements | `src/services/cddTier.ts` | `tests/cdd.test.ts` |
| Art.12-14 | PEP / EDD / four-eyes | `src/services/fourEyes.ts`, `src/services/breakGlassOverride.ts` | `tests/fourEyes.test.ts` |
| Art.16 | Cross-border cash | `src/domain/constants.ts` | `tests/constants.test.ts` |
| Art.18 | Compliance Officer change | `src/services/coChangeNotification.ts` | `tests/coChange.test.ts` |
| Art.19 | Internal review | `src/services/asana/orchestrator.ts`, `src/services/asanaSectionWriteBack.ts` | `tests/asana.test.ts` |

## Cabinet Resolution 74/2020 (TFS / Asset Freeze)

| Article | Topic | Implementation | Test |
|---|---|---|---|
| Art.4 | 24-hour freeze | `src/services/autoRemediationExecutor.ts`, `src/services/asanaSlaAutoEscalation.ts` | `tests/freeze.test.ts` |
| Art.5 | EOCN notification | `src/services/eocnFreezeOrchestrator.ts` | `tests/eocn.test.ts` |
| Art.6 | CNMR within 5 BD | `src/utils/businessDays.ts`, `src/services/asanaSlaEnforcer.ts` | `tests/businessDays.test.ts`, `tests/cnmr.test.ts` |
| Art.7 | Freeze sustainment | `src/services/freezeSustainment.ts` | `tests/freezeSustainment.test.ts` |

## Cabinet Resolution 156/2025 (PF & Dual-Use)

| Topic | Implementation | Test |
|---|---|---|
| PF risk assessment | `src/services/pfRiskAssessment.ts` | `tests/pfRisk.test.ts` |
| Strategic goods screening | `src/services/strategicGoodsScreening.ts`, `src/domain/constants.ts` (`DUAL_USE_KEYWORDS`) | `tests/strategicGoods.test.ts` |
| PF jurisdictions | `src/domain/constants.ts` (`PF_HIGH_RISK_JURISDICTIONS`) | `tests/constants.test.ts` |

## Cabinet Decision 109/2023 (UBO Register)

| Topic | Implementation | Test |
|---|---|---|
| 25% UBO threshold | `src/domain/constants.ts` (`UBO_OWNERSHIP_THRESHOLD_PCT`) | `tests/constants.test.ts` |
| 15-WD re-verification | `src/utils/businessDays.ts`, `src/services/uboReverification.ts` | `tests/ubo.test.ts` |
| Layering detection | `src/services/uboLayering.ts` | `tests/uboLayering.test.ts` |

## Cabinet Resolution 71/2024 (Administrative Penalties)

| Topic | Implementation | Test |
|---|---|---|
| AED 10K-100M penalty range | `src/services/penaltyCalculator.ts` | `tests/penalty.test.ts` |

## MoE Circular 08/AML/2021 (DPMS Sector)

| Topic | Implementation | Test |
|---|---|---|
| goAML registration | `goaml-export.js`, `src/utils/goamlValidator.ts` | `tests/goaml.test.ts` |
| Quarterly DPMSR | `src/services/quarterlyDpmsr.ts`, `netlify/functions/scheduled-quarterly.mts` | `tests/dpmsr.test.ts` |
| AED 55K threshold | `src/domain/constants.ts` (`DPMS_CASH_THRESHOLD_AED`) | `tests/constants.test.ts` |

## LBMA RGG v9 (Responsible Gold Guidance)

| Topic | Implementation | Test |
|---|---|---|
| 5-step framework | `src/services/lbmaFiveStep.ts` | `tests/lbma.test.ts` |
| CAHRA due diligence | `src/services/cahraDueDiligence.ts` | `tests/cahra.test.ts` |
| Annual audit | `src/services/lbmaAnnualAudit.ts` | `tests/lbmaAudit.test.ts` |

## FATF Recommendations

| Rec | Topic | Implementation | Test |
|---|---|---|---|
| Rec 1 | Risk-based approach | `src/services/weaponizedBrain.ts` | `tests/scoring.test.ts` |
| Rec 2 | National cooperation | `src/services/eocnFreezeOrchestrator.ts` | `tests/eocn.test.ts` |
| Rec 6 | Targeted sanctions | `src/services/sanctionsScreening.ts`, `src/services/multiModelScreening.ts` | `tests/sanctions.test.ts` |
| Rec 10 | CDD | `src/services/cddTier.ts`, `src/services/adverseMediaRanker.ts` | `tests/cdd.test.ts` |
| Rec 11 | Record-keeping | `src/services/evidenceBundleExporter.ts`, `src/services/transactionGraphEmbedding.ts` | `tests/evidence.test.ts` |
| Rec 15 | VASPs | `src/services/vaspWallets.ts` | `tests/vasp.test.ts` |
| Rec 19 | Higher-risk countries | `src/services/jurisdictionRisk.ts` | `tests/jurisdiction.test.ts` |
| Rec 20 | STR | `src/services/predictiveStr.ts`, `src/services/anomalyExplainer.ts`, `src/services/peerAnomaly.ts` | `tests/str.test.ts` |
| Rec 22 | DPMS CDD | `src/services/cddTier.ts` | `tests/cdd.test.ts` |
| Rec 23 | DPMS reporting | `goaml-export.js` | `tests/goaml.test.ts` |

## NIST AI Risk Management Framework 1.0

| Function | Implementation | Test |
|---|---|---|
| GOVERN-3 | `src/services/brainAdversarialDebate.ts`, `src/services/debateArbiter.ts` | `tests/debate.test.ts` |
| GOVERN-4 | `src/services/clampSuggestionLog.ts`, `src/services/ruleInduction.ts` | `tests/clampSuggestion.test.ts` |
| MEASURE-2 | `src/services/uncertaintyInterval.ts`, `src/services/conformalPrediction.ts`, `src/services/bayesianBelief.ts` | `tests/uncertainty.test.ts`, `tests/conformal.test.ts` |
| MEASURE-4 | `src/services/selfAuditScore.ts`, `src/services/reflectionCritic.ts`, `src/services/complianceBacktest.ts` | `tests/selfAudit.test.ts` |
| MANAGE-2 | `src/services/reasoningChain.ts`, `src/services/causalEngine.ts`, `src/services/feedbackLearner.ts` | `tests/reasoning.test.ts` |
| MANAGE-3 | `src/services/breakGlassOverride.ts` | `tests/breakGlass.test.ts` |

## EU AI Act

| Article | Topic | Implementation | Test |
|---|---|---|---|
| Art.13 | Transparency | `src/services/explainableScoring.ts`, `src/services/anomalyExplainer.ts` | `tests/explainable.test.ts` |
| Art.14 | Human oversight | `src/services/fourEyes.ts`, `src/services/breakGlassOverride.ts` | `tests/fourEyes.test.ts` |
| Art.15 | Accuracy + robustness | `src/services/conformalPrediction.ts`, `src/services/uncertaintyInterval.ts` | `tests/conformal.test.ts` |

## EU GDPR

| Article | Topic | Implementation | Test |
|---|---|---|---|
| Art.25 | Data minimisation by design | `src/services/zkCrossTenantAttestation.ts`, `src/services/deferredOutboundQueue.ts` | `tests/zkCrossTenant.test.ts` |

---

## How to use this matrix at audit

1. Auditor cites Article X.
2. Look up the Article in this file → get source file + test.
3. Run `git log --follow <source-file>` to show every change with its
   citation (per CLAUDE.md §8 commit discipline).
4. Run `npx vitest run <test-file>` → green = compliant.
5. Run `/traceability` skill for the full impact trace if needed.

Coverage target: **every regulatory anchor in the codebase appears in
this file**. If you add a new regulation citation in source, add a row
here in the same commit.
