# /redteam-agent — Adversarial probe of the weaponized brain

Specialist supporting agent that runs reproducible adversarial
scenarios against the brain. Probes edge cases (ambiguous names,
near-threshold amounts, PEP-by-association, alias chains). Emits
pass/fail with the exact payload that broke the pipeline.

## Usage

```
/redteam-agent [--scenarios=all|subset] [--seed=<int>]
```

## Inputs
- `scenarioSet` (default all) · `seed`

## Outputs
- `scenarioResults` (pass/fail per scenario)
- `failurePayloads` (reproducible bug reports)
- `regressionCandidates` (for the test suite)

## Asana target
`governance_and_retention` board.

## Guards
- Only run against staging; any production run requires MLRO +
  InfoSec approval (CLAUDE.md §10).
- Failure payloads scrubbed of real subject data before archiving.
- Every run appends to the `red-team-audit` cron blob.
- Cannot run concurrently with the production adverse-media hot
  sweep to avoid cross-traffic.

## Regulatory basis
- EU AI Act Art.15 — accuracy + robustness
- NIST AI RMF MEASURE-2.3 — red-teaming
- ISO/IEC 42001 §8.2

## Related agents + skills
- `/drift-detector` — pairs with red-team to distinguish "brain got
  worse" from "world got weirder".
- `/decision-consistency-check` — red-team probes inform the
  consistency check's failure thresholds.
- `red-team` cron routine — daily scheduled execution.
