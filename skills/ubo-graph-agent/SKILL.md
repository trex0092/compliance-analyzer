# /ubo-graph-agent — Ownership-chain tracing + shell-company detection

Specialist supporting agent that traces the full ownership chain
beyond the 25% UBO threshold, surfaces shell-company indicators,
detects layering patterns, and emits a multi-hop ownership graph
(xyflow-compatible).

## Usage

```
/ubo-graph-agent <legalEntityId> [--depth=5] [--blacklist=jurisdiction-list]
```

## Inputs
- `legalEntityId` · `depth` (default 5 hops) · `jurisdictionBlacklist`

## Outputs
- `ownershipGraph` (nodes + edges, xyflow-ready JSON)
- `shellCompanyFlags` (per-node confidence)
- `layeringIndicators` (circular ownership, nominee chains, SPV
  concentration)

## Asana target
`cdd_ubo_pep` board.

## Guards
- Cross-jurisdiction queries require MLRO explicit approval when
  any hop sits in a secrecy jurisdiction (Tax Justice Network FSI
  + EU tax-haven list + OECD CRS non-participating).
- 15-working-day re-verification trigger on any detected ownership
  change (Cabinet Decision 109/2023).
- Graph rendered via xyflow in the NORAD war-room view.

## Regulatory basis
- Cabinet Decision 109/2023 — UBO register ≥25% threshold
- FATF Rec 24-25 — beneficial ownership transparency
- FDL No.10/2025 Art.14 — EDD on opaque ownership

## Related agents
- `/research-agent` — feeds adverse media on every entity in the chain.
- `/four-eyes-arbitrator` — gates any freeze driven by UBO findings.
- `/str-drafter` — consumes the graph when the STR narrative depends
  on layering evidence.
