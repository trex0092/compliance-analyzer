# /timeline-agent — Cross-module chronological trail per customer

Specialist supporting agent that reconstructs the chronological
compliance trail for a single customer across every module
(screening, TM, STR, CDD, UBO, supply chain, incidents, approvals).

## Usage

```
/timeline-agent <subjectCode> [--window=365]
```

## Inputs
- `subjectCode` · `windowDays` (default 365)

## Outputs
- `timelineEvents` (sorted by timestamp, one row per compliance action)
- `gapReport` (periods with no activity that should have activity)
- `anomalyMarkers` (out-of-order events, missing counter-signatures)

## Asana target
`audit_inspection` board.

## Guards
- Cross-tenant data access forbidden.
- Gaps >30 days open an Asana task (retention-integrity warn).
- Timestamps normalised to UTC.
- Timeline is read-only — does not mutate audit artefacts.

## Regulatory basis
- FDL No.10/2025 Art.24 — audit record must be contiguous
- Cabinet Res 134/2025 Art.19 — internal review cadence
- Cabinet Res 71/2024 — inspection evidence

## Related agents
- `/evidence-assembler` — consumes the timeline to order the zip
  manifest chronologically.
- `/audit-pack` — embeds the timeline in the inspection pack.
- `/moe-readiness` — uses gap report for readiness score.
