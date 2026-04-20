# /life-story-agent — 8-section Life-Story deep-dive synthesiser

Specialist supporting agent that assembles the Life-Story markdown
report for first-time customer screenings (onboarding + periodic
review). Merges sanctions, PEP, adverse media, UBO, transaction risk,
and regulatory anchor into one dense briefing.

## Usage

```
/life-story-agent <subjectCode> [--depth=surface|deep] [--runId=<id>]
```

## Inputs
- `subjectCode` · `runId` · `depth`

## Outputs
- 8-section life-story markdown:
  1. VERDICT
  2. SANCTIONS (name-variant fan-out)
  3. PEP
  4. ADVERSE MEDIA (FATF Rec 10)
  5. UBO & NETWORK
  6. TRANSACTION-RISK SIGNALS
  7. MLRO ACTIONS
  8. AUDIT TRAIL (FDL Art.24)

## Asana target
`screening_and_watchlist` board (The Screenings section).

## Guards
- Report flagged CONFIDENTIAL (FDL Art.29 no tipping off).
- External queries go through the Research Agent guards.
- Retention 10 years from `run_at` timestamp.

## Regulatory basis
- Cabinet Res 134/2025 Art.7-10 — CDD depth
- FATF Rec 10 — ongoing CDD
- FDL No.10/2025 Art.24 — 10-yr retention

## Related agents
- `/research-agent` — feeds Section 4 (adverse media)
- `/ubo-graph-agent` — feeds Section 5 (UBO & network)
- `/document-agent` — feeds identity verification lines
- `/screen` — auto-triggers this agent on first screening
