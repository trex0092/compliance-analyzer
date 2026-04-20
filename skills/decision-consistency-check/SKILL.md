# /decision-consistency-check — Deterministic re-run + diff for every brain verdict

Run the weaponized brain twice on the same input and assert the two
outputs are identical. Any divergence is a correctness defect and
forbids the MLRO from recording a disposition until the cause is
understood. This is the operational counterpart to `/explainability-audit`:
it proves the decision was not only explainable but also REPRODUCIBLE.

## Why this skill exists

An AI-touching compliance decision that is not reproducible is not
admissible. Auditors (MoE, LBMA, internal) expect that re-running the
same run with the same inputs produces the same output bit-for-bit
(or within a documented tolerance for stochastic layers). Our brain
has 19 subsystems + an Opus advisor — the more surface area, the more
opportunities for non-determinism (timezone drift, LLM sampling,
cache-hit differences, feed race conditions). This skill catches
divergence at run time and before any disposition is stamped.

## Usage

```
/decision-consistency-check <runId>
/decision-consistency-check --cohort=<customer-code-list>
```

## Instructions

### Step 1 · Re-screen the run
1. Load the original payload from the screening run (`runId` → request
   body + response body).
2. Re-execute `/api/screening/run` with IDENTICAL inputs + a
   `consistencyReplay: true` flag (so the backend bypasses Asana
   dispatch on the replay side).
3. Receive the replay response.

### Step 2 · Normalise + diff
Compare original vs replay at three levels:

**A · Deterministic layer** — must match bit-for-bit
- `sanctions.perList[*].hits` (candidate names, scores, breakdown)
- `sanctions.topScore`, `sanctions.topClassification`
- `sanctions.listsChecked`, `sanctions.listErrors`
- `risk.score`, `risk.topFactors`

**B · Brain layer** — must match within tolerance 0.01 on posteriors
- `weaponized.finalVerdict`, `weaponized.megaVerdict`
- `weaponized.confidence` (tolerance ±0.01)
- `weaponized.clampReasons` (set equality)
- `deepBrain.topHypothesis`, `deepBrain.posterior` (±0.01)

**C · Advisory layer** — semantic equivalence required
- `weaponized.advisor.text` (LLM output; accept if verdict + top-3
  recommendations match; reject if different verdict)

### Step 3 · Emit the consistency report
```
DECISION CONSISTENCY CHECK — runId abc123

Deterministic layer . PASS  (sanctions + risk identical)
Brain layer         . PASS  (confidence 0.832 → 0.832, Δ 0.000)
Advisory layer      . PASS  (advisor verdict unchanged, 12/12 top recs)

Overall             . PASS · decision reproducible
Evidence fingerprint: 3f2a9c7d · reconcilable against row verdict-history
```

### Step 4 · Block on failure
Any FAIL:
- Opens a CRITICAL Asana task (`[CONSISTENCY FAIL] runId abc123`).
- Locks the subject's disposition UI (disposition cannot be recorded
  until a CO signs a consistency-waiver with written rationale).
- Emits a `consistency-audit` record with both runs' full payloads
  attached so the post-mortem is possible.
- Escalates to the `brain-clamp` cron so the next N runs on the same
  subject trigger automatic 4-eyes review.

## Regulatory basis

- EU AI Act Art.15 — accuracy, robustness, and cybersecurity
- NIST AI RMF MEASURE-2.3 — system components monitored for AI risk
- ISO/IEC 42001 §8.2 — operational planning and control
- FDL No.10/2025 Art.20-21 — CO situational awareness
- FDL No.10/2025 Art.24 — audit record of every decision layer

## Related surfaces

- Paired with `/explainability-audit` (explanation quality) and
  `/redteam-brain` (adversarial robustness); together the three form
  the triad for AI assurance of compliance decisions.
- Feeds the `decision-consistency-audit` cron proposal for routine
  nightly sweeps of the prior-day run population.
- Outputs surface on the Reasoning Console as row-9 of the
  Correctness Assurance panel once the paired cron lands.
