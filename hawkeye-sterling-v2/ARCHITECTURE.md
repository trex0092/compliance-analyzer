# HAWKEYE STERLING V2 — Architecture

## Topology

```
┌─────────────────────── SPA shell ───────────────────────┐
│  index.html (~10k lines) + brain-console.js + app-*.js  │
│  ↓ click LAUNCH ANALYZER → soft fade hero → tab nav     │
└────────┬────────────────────────────────────────────────┘
         │
         ↓ POST /api/brain/analyze   { tenantId, topic, entity }
         │
┌────────▼─────────────── Netlify Functions ──────────────┐
│                                                          │
│  brain-analyze.mts ── runSuperDecision(input, opts)     │
│  brain-telemetry.mts                                    │
│  brain-replay.mts                                       │
│  brain-evidence-bundle.mts                              │
│  brain-clamp-suggestion.mts    (Tier C)                 │
│  brain-outbound-queue.mts      (Tier C)                 │
│  brain-break-glass.mts         (Tier C)                 │
│  brain-zk-cross-tenant.mts     (Tier C)                 │
│  brain-clamp-cron.mts          (scheduled, hourly)      │
│  brain-correlate.mts                                    │
│  brain-diagnostics.mts                                  │
│  brain-hydrate.mts                                      │
│                                                          │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓ runSuperDecision()
         │
┌────────▼────────── src/services/brainSuperRunner.ts ────┐
│                                                          │
│   1. computeFingerprint() → cache check                 │
│   2. shouldInvokeAdvisor() → Anthropic advisor (if hit) │
│   3. runComplianceDecision() → MegaBrain pipeline       │
│   4. computeBrainPowerScore()                           │
│   5. matchFatfTypologies()                              │
│   6. runBrainEnsemble()                                 │
│   7. updateDigest() + retrievePrecedents()              │
│   8. augmentChainWithPrecedents()                       │
│   9. recordAndCorrelate() → cross-case correlator       │
│  10. analyseBehaviouralVelocity()                       │
│  11. deriveUncertaintyInterval()                        │
│  12. shouldDebate() → runAdversarialDebate() (if hit)   │
│  13. asana.dispatchBrainVerdict() (if not pass)         │
│  14. Returns SuperDecision tuple                        │
│                                                          │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓ on response, fire-and-forget writes
         │
┌────────▼──────── Netlify Blob Store (brain-memory) ─────┐
│                                                          │
│   snapshots/<tenant>/<case>.json   (eviction-managed)   │
│   index/<tenant>.json              (case index)         │
│   digest/<tenant>.json             (precedent memory)   │
│   telemetry/<tenant>/<day>.jsonl   (time-series)        │
│   replay/<tenant>/<case>.json      (regulatory baseline) │
│   tierc/clamp-suggestions.jsonl    (global)             │
│   tierc/outbound/<tenant>.jsonl    (per-tenant)         │
│   tierc/breakglass/<tenant>.jsonl  (per-tenant)         │
│   tierc/cross-tenant/<salt>.jsonl  (per salt version)   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Brain Layers

### Layer 0 — MegaBrain (13 core)

Lives in `src/services/weaponizedBrain.ts`. Runs every input
through 13 deterministic scoring subsystems with safety clamps.

### Layer 1 — Phase extensions (30+)

- Adverse media ranker
- UBO layering detector
- Shell company detector
- VASP wallet screener
- Transaction anomaly detector
- Explainable scoring (SHAP-lite)
- zk-Compliance attestation seal
- Velocity detector
- Cross-case pattern correlator (7 detectors)
- FATF DPMS typology matcher (25 typologies)
- Brain memory digest (cosine similarity precedent retrieval)
- Reasoning chain augmenter
- Consensus ensemble (perturbation-based stability)
- Decision fingerprint cache (SHA-256 TTL)
- Regulatory drift watchdog (9 tracked constants)
- Four-eyes enforcer
- FDL Art.29 tipping-off linter
- ... (see `BRAIN_INVENTORY.md` for the full list)

### Layer 2 — Tier A (audit-defensible)

- Brain telemetry store (`brainTelemetryStore.ts`)
- Sanctions name-variant expander (Arabic + Cyrillic + Greek)
- Case replay store + endpoint (per-case regulatory baseline)
- Evidence bundle exporter (SHA3-512 sealed)
- Uncertainty intervals (variance + perturbation-derived)

### Layer 3 — Tier B (decision quality)

- Brain-to-brain adversarial debate (cost-gated)
- Auto-remediation executor (safety-gated, dry-run default)
- Transaction graph embedding (8-dim structural features)

### Layer 4 — Tier C (safe equivalents)

- Clamp suggestion log (MLRO-reviewed, never auto-apply)
- Deferred outbound queue (tipping-off linted, MLRO release only)
- Break-glass override (two-person, lint-gated)
- zk Cross-tenant attestation (commit-only, k-anonymity)

### Layer 5 — Calibration (advanced)

- Conformal prediction wrapper (`conformalPrediction.ts`) — split
  conformal interval with finite-sample correction. Distribution-
  free coverage guarantee under exchangeability.

---

## Asana Orchestrator (façade)

`src/services/asana/orchestrator.ts` — single entrypoint
`dispatchBrainVerdict(verdict)` that:

1. Computes idempotency key `<tenantId>:<verdictId>`.
2. Checks IdempotencyStore (in-memory or blob-backed).
3. Builds task payload via TemplateDispatchAdapter.
4. Calls injected DispatchAdapter (real Asana client in prod,
   no-op in tests).
5. Writes audit entry to `dispatchAuditLog`.
6. Returns `AsanaOrchestratorDispatchResult`.

Dispatchers wired:
- Compliance brain verdicts (default)
- Tier C break-glass approvals (`tierCAsanaDispatch.ts`)
- Tier C clamp suggestions (`tierCAsanaDispatch.ts`)

---

## Frontend layers

```
index.html (shell)
   ├── app-core.js       (tab switching + storage helpers + SPA glue)
   ├── app-events.js     (data-action click delegate)
   ├── app-boot.js       (hero fade + scroll wrap + tab renderers)
   └── brain-console.js  (Brain Console tab + uncertainty/debate/case-tools cards)
```

The hero card with `LAUNCH ANALYZER` is wrapped in `#heroIntro`
and fades out (with sessionStorage persistence) on first switchTab.

---

## Test pyramid

- **Unit:** vitest, ~3150 tests on `main` (services, validators, helpers).
- **Endpoint validators:** every Netlify function exports
  `__test__.validate` and is unit-tested without the runtime.
- **No e2e** — frontend is verified by node `--check` syntax pass +
  manual smoke after deploy.
- **No flaky tests.** `asanaClient.test.ts` is intentionally slow
  (~30s) to exercise the real backoff logic.

---

## Deployment

- **Netlify** with submodules.
- **Blob store:** `brain-memory` (single store, multiple key prefixes).
- **Schedule:** `brain-clamp-cron.mts` runs hourly via Netlify
  scheduled functions.
- **Env vars:** see `DEPLOY_CHECKLIST.md`.
