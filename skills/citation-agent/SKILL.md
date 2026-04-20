# /citation-agent — Regulatory citation resolver for every compliance claim

Specialist supporting agent that resolves every claim in an Asana
task body, MLRO rationale, or STR narrative to the exact FDL
Article / Cabinet Resolution / FATF Recommendation / LBMA Step that
authorises it. Flags uncited claims and proposes the missing
citation.

## Usage

```
/citation-agent <textBlock> [--jurisdiction=UAE|DIFC|ADGM|EU|UK|US]
```

## Inputs
- `textBlock` · `jurisdiction`

## Outputs
- `annotatedText` (inline citation links)
- `citationGraph` (claim → regulation mapping)
- `uncitedClaims` (highlighted for MLRO to fix)

## Asana target
`governance_and_retention` board.

## Guards
- Citations must resolve to the local regulatory text version pinned
  in `src/domain/constants.ts`.
- Any claim citing a deprecated version raises a regulatory-drift
  Asana task.
- Every uncited compliance claim blocks the containing artefact from
  being stamped "final".

## Regulatory basis
- FDL No.10/2025 Art.20-21 — CO must cite every decision
- Cabinet Res 71/2024 — penalties for uncited compliance action
- FATF Rec 10 · 22 · 23

## Related agents + skills
- `/str-drafter` — every narrative run through this agent before
  submission.
- `/traceability` — maps regulations → code + test + evidence (this
  agent does the inverse — text → regulation).
- `/audit-pack` — includes the citation graph for inspectors.
