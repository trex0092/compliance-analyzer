# /drift-detector — Statistical drift monitor on risk-model outputs

Specialist supporting agent that runs KS / PSI / JS-divergence on
risk-model outputs against a 30-day rolling baseline. Alerts when
the verdict distribution shifts > 2-sigma without a code deploy
that would explain it.

## Usage

```
/drift-detector <modelId> [--baseline=30] [--current=7]
```

## Inputs
- `modelId` · `baselineWindowDays` · `currentWindowDays`

## Outputs
- `driftMetric` (PSI / KS / JS divergence values)
- `topShiftedFactors` (which signal moved the most)
- `recommendation` (retune / investigate / ignore)

## Asana target
`governance_and_retention` board.

## Guards
- Drift alerts paginated to avoid alert storms.
- Auto-opens a Governance Asana task when PSI > 0.2.
- Drift that correlates with a code deploy is flagged "expected"
  and does not page.
- Baseline re-computed monthly; recomputes during an active alert
  are forbidden (would hide the drift).

## Regulatory basis
- EU AI Act Art.15 — accuracy + robustness monitoring
- NIST AI RMF MEASURE-2.4 — continuous monitoring
- ISO/IEC 42001 §8.2

## Related agents + skills
- `/redteam-agent` — confirms whether drift comes from adversarial
  inputs or natural shift.
- `/explainability-audit` — when drift lands on a specific factor,
  the explainability audit drills into why that factor shifted.
- `advisor-budget-tracker` routine — drift on Opus vs Sonnet ratios
  is its own metric.
