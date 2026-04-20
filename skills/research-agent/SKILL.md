# /research-agent — Iterative adverse-media + counterparty research

Specialist supporting agent that runs the research loop:
**search → reason → extract → cite → loop** across 13K+ vetted media
sources in 24 languages. Produces a curated evidence dossier with
full source preservation + per-claim confidence.

## Usage

```
/research-agent <subject name or customer code> [--depth=surface|deep]
```

## Inputs
- `subjectName` / `customerCode` / `aliases` / `context`

## Outputs
- Evidence dossier (markdown)
- Citations (RFC 7231 URLs + timestamps)
- Confidence score per claim (0.0 - 1.0)
- List of queries actually issued (audit)

## Asana target
`screening_and_watchlist` board.

## Guards (non-negotiable)
- No subject data in cleartext to third-party search APIs without
  allow-list check.
- Every external query logged to `research-agent-audit` (FDL Art.24).
- Rate-limited to the adverse-media-hot-sweep cadence when batched.
- Queries never include phrasing that would tip off the subject
  (FDL Art.29).

## Regulatory basis
- FATF Rec 10 — ongoing CDD across language barriers
- FDL No.10/2025 Art.29 — no tipping off on the queries themselves
- Cabinet Res 134/2025 Art.14 — EDD adverse-media obligation
- UAE PDPL Art.6(1)(c) — legal-obligation basis for processing

## Related agents + skills
- `/document-agent` — extracts fields from documents the research
  agent surfaces.
- `/translation-agent` — translates non-English hits before scoring.
- `/life-story-agent` — consumes this agent's dossier when assembling
  the 8-section life-story report.
- `/screen` — triggers this agent automatically on first-screening
  event types.
