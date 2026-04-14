# HAWKEYE STERLING V2 — Brain Inventory

Every subsystem with one-line description + source file + regulatory anchor.

---

## Core (MegaBrain)

| Subsystem | File | Anchor |
|---|---|---|
| Risk scorer | `src/services/weaponizedBrain.ts` | FATF Rec 1; Cabinet Res 134/2025 Art.5 |
| Verdict ladder + clamps | `src/services/weaponizedBrain.ts` | FDL Art.20-21 |
| STR feature builder | `src/services/predictiveStr.ts` | FDL Art.26-27 |
| War-room event emitter | `src/services/warRoomFeed.ts` | FDL Art.20 |
| Compliance decision engine | `src/services/complianceDecisionEngine.ts` | FDL Art.19-21 |
| Reasoning chain | `src/services/reasoningChain.ts` | NIST AI RMF MANAGE-2 |
| zk-Compliance attestation | `src/services/zkComplianceAttestation.ts` | FDL Art.24 |
| Quantum-resistant seal (SHA3-512) | `src/services/quantumResistantSeal.ts` | FDL Art.24 |
| Self-audit score | `src/services/selfAuditScore.ts` | NIST AI RMF MEASURE-4 |
| Tipping-off linter | `src/services/tippingOffLinter.ts` | FDL Art.29 |
| Risk appetite | `src/services/riskAppetite.ts` | Cabinet Res 134/2025 Art.5 |
| Four-eyes enforcer | `src/services/fourEyes.ts` | Cabinet Res 134/2025 Art.12-14 |
| Decision cache | `src/services/decisionCache.ts` | (perf, no anchor) |

## Phase Extensions

| Subsystem | File | Anchor |
|---|---|---|
| Adverse media ranker | `src/services/adverseMediaRanker.ts` | FATF Rec 10 |
| UBO layering detector | `src/services/uboLayering.ts` | Cabinet Decision 109/2023 |
| Shell company detector | `src/services/shellCompany.ts` | FATF Rec 10 |
| VASP wallet screener | `src/services/vaspWallets.ts` | FATF Rec 15 |
| Transaction anomaly | `src/services/anomalyExplainer.ts` | FATF Rec 20 |
| Explainable scoring (SHAP-lite) | `src/services/explainableScoring.ts` | EU AI Act Art.13 |
| Velocity detector | `src/services/behaviouralVelocityDetector.ts` | FATF Rec 20 |
| Cross-case correlator | `src/services/crossCasePatternCorrelator.ts` | FDL Art.20-22 |
| FATF DPMS typology matcher | `src/services/fatfTypologyMatcher.ts` | FATF DPMS guidance |
| Brain memory digest (cosine) | `src/services/brainMemoryDigest.ts` | FDL Art.24 |
| Reasoning chain augmenter | `src/services/reasoningChainAugmenter.ts` | NIST AI RMF MANAGE-2 |
| Consensus ensemble | `src/services/brainConsensusEnsemble.ts` | FATF Rec 20 |
| Decision fingerprint cache | `src/services/decisionFingerprintCache.ts` | (perf) |
| Regulatory drift watchdog | `src/services/regulatoryDriftWatchdog.ts` | FDL Art.22 |
| Predictive STR scorer | `src/services/predictiveStr.ts` | FDL Art.26-27 |
| Bayesian belief updater | `src/services/bayesianBelief.ts` | NIST AI RMF MEASURE-2 |
| Causal engine | `src/services/causalEngine.ts` | NIST AI RMF MANAGE-2 |
| Debate arbiter | `src/services/debateArbiter.ts` | NIST AI RMF GOVERN-3 |
| Peer anomaly | `src/services/peerAnomaly.ts` | FATF Rec 20 |
| Goal planner | `src/services/goalPlanner.ts` | NIST AI RMF MANAGE-2 |
| Reflection critic | `src/services/reflectionCritic.ts` | NIST AI RMF MEASURE-4 |
| Rule induction | `src/services/ruleInduction.ts` | NIST AI RMF GOVERN-4 |
| Teacher-student | `src/services/teacherStudent.ts` | NIST AI RMF MANAGE-2 |
| Feedback learner | `src/services/feedbackLearner.ts` | NIST AI RMF MANAGE-2 |
| Cross-entity scorer | `src/services/crossEntity.ts` | FATF Rec 20 |
| Temporal compliance | `src/services/temporalCompliance.ts` | FDL Art.24 |
| Compliance backtest | `src/services/complianceBacktest.ts` | NIST AI RMF MEASURE-4 |
| Decision replay | `src/services/decisionReplay.ts` | FDL Art.20 |
| Multi-model screening | `src/services/multiModelScreening.ts` | FATF Rec 6 |
| Anomaly explainer | `src/services/anomalyExplainer.ts` | EU AI Act Art.13 |
| Subsystem scoring | `src/services/subsystemScoring.ts` | NIST AI RMF MEASURE-2 |

## Tier A (audit-defensible)

| Subsystem | File | Anchor |
|---|---|---|
| Brain telemetry store | `src/services/brainTelemetryStore.ts` | FDL Art.20-24 |
| Sanctions name-variant expander | `src/services/sanctionsNameVariantExpander.ts` | FDL Art.35; FATF Rec 6 |
| Case replay store | `src/services/caseReplayStore.ts` | FDL Art.20-24 |
| Evidence bundle exporter | `src/services/evidenceBundleExporter.ts` | FDL Art.24; FATF Rec 11 |
| Uncertainty intervals | `src/services/uncertaintyInterval.ts` | NIST AI RMF MEASURE-2 |
| Conformal prediction | `src/services/conformalPrediction.ts` | EU AI Act Art.15 |

## Tier B (decision quality)

| Subsystem | File | Anchor |
|---|---|---|
| Adversarial debate | `src/services/brainAdversarialDebate.ts` | NIST AI RMF GOVERN-3 |
| Auto-remediation executor | `src/services/autoRemediationExecutor.ts` | Cabinet Res 74/2020 Art.4-7 |
| Transaction graph embedding | `src/services/transactionGraphEmbedding.ts` | FATF Rec 11 |

## Tier C (safe equivalents)

| Subsystem | File | Anchor |
|---|---|---|
| Clamp suggestion log | `src/services/clampSuggestionLog.ts` | NIST AI RMF GOVERN-4 |
| Clamp suggestion generator | `src/services/clampSuggestionGenerator.ts` | NIST AI RMF MEASURE-2 |
| Deferred outbound queue | `src/services/deferredOutboundQueue.ts` | FDL Art.29 |
| Break-glass override | `src/services/breakGlassOverride.ts` | Cabinet Res 134/2025 Art.12-14 |
| zk Cross-tenant attestation | `src/services/zkCrossTenantAttestation.ts` | FDL Art.14; EU GDPR Art.25 |
| Tier C blob stores | `src/services/tierCBlobStores.ts` | FDL Art.24 |

## Persistence

| Subsystem | File | Anchor |
|---|---|---|
| Blob brain memory store | `src/services/brainMemoryBlobStore.ts` | FDL Art.24 |
| Brain memory digest blob store | `src/services/brainMemoryDigestBlobStore.ts` | FDL Art.24 |
| In-memory brain memory store | `src/services/brainMemoryStore.ts` | (test fallback) |

## Asana orchestration

| Subsystem | File | Anchor |
|---|---|---|
| Orchestrator façade | `src/services/asana/orchestrator.ts` | Cabinet Res 134/2025 Art.19 |
| Brain task template | `src/services/asana/asanaBrainTaskTemplate.ts` | FDL Art.20-22 |
| Production dispatch adapter | `src/services/asana/productionDispatchAdapter.ts` | FDL Art.20-22 |
| Tier C dispatch adapter | `src/services/asana/tierCAsanaDispatch.ts` | Cabinet Res 134/2025 Art.12-14 |
| Skill runner registry | `src/services/asana/skillRunnerRegistry.ts` | (47 skills) |
| Idempotency store | `src/services/asana/orchestrator.ts` | (no duplicates) |
| Custom field router | `src/services/asanaCustomFieldRouter.ts` | Cabinet Res 134/2025 Art.19 |
| Section write-back | `src/services/asanaSectionWriteBack.ts` | FDL Art.20 |
| Comment mirror | `src/services/asanaCommentMirror.ts` | FDL Art.20 |
| SLA enforcer | `src/services/asanaSlaEnforcer.ts` | Cabinet Res 74/2020 Art.6 |
| SLA auto-escalation | `src/services/asanaSlaAutoEscalation.ts` | Cabinet Res 74/2020 Art.4 |
| Health telemetry | `src/services/asanaHealthTelemetry.ts` | NIST AI RMF MANAGE-2 |
| Bulk operations | `src/services/asanaBulkOperations.ts` | (perf) |
| Schema migrator | `src/services/asanaSchemaMigrator.ts` | (versioning) |
| Webhook router | `src/services/asanaWebhookRouter.ts` | (event handling) |
| Workflow automation extensions | `src/services/asanaWorkflowAutomationExtensions.ts` | Cabinet Res 134/2025 Art.19 |
| Phase 4 ultra | `src/services/asanaPhase4Ultra.ts` | (orchestration) |
| Four-eyes as Asana tasks | `src/services/asanaFourEyesAsTasks.ts` | Cabinet Res 134/2025 Art.12-14 |
| Retry queue | `src/services/asanaQueue.ts` | (resilience) |
| CDD push | `src/services/cddAsanaCustomFieldPush.ts` | Cabinet Res 134/2025 Art.7-10 |

## Total

- **MegaBrain core:** 13
- **Phase extensions:** 30+
- **Tier A:** 6
- **Tier B:** 3
- **Tier C:** 6
- **Persistence:** 3
- **Asana orchestration:** 19+

**Grand total: 80+ subsystems** all on `main` and tested.
