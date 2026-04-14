# /caveman — Terse Compliance Output

Compress a brain verdict or case summary into an ultra-terse, bandwidth-
efficient form suitable for SMS alerts, exec dashboards, pager messages,
and MLRO watch-list tickers where every byte counts.

Named after and inspired by the `JuliusBrussee/caveman` Claude Code skill,
which documents three intensity levels (Lite / Full / Ultra) for terse
output. This in-repo skill borrows the intensity-level concept **ONLY**
and reuses zero caveman code. Caveman itself is a Python-based Claude
Code plugin; this skill is a pure TypeScript runner in
`src/services/asana/skillRunnerRegistry.ts`.

## Usage

```
/caveman <entity> [intensity]
```

- `<entity>` — the entity id or case reference the MLRO is asking about
- `[intensity]` — `lite` | `full` | `ultra` (default: `full`)

## Intensity levels

| Level | Length | Use case |
|---|---|---|
| `lite` | ~280 chars | SMS alert / pager |
| `full` | ~600 chars | Slack / Asana comment ticker |
| `ultra` | ~120 chars | Dashboard badge / one-line terminal |

## Output shape

The runner produces a single-line verdict string plus a compact factor
list. No emojis (deliberate — many pager gateways drop them). No
entity legal names (FDL Art.29 tipping-off safe by construction — the
runner only accepts opaque entity refs from the caller context).

Examples (synthesized for documentation — not live output):

```
LITE:  FREEZE ent1 conf=0.95 | 24h protocol | CR74/2020 Art.4
FULL:  FREEZE ent1 conf=0.95 brain=88/weaponized | 2 clamps | SANCTIONS-002 | 24h EOCN + 5bd CNMR | FDL Art.20-21
ULTRA: FRZ ent1 0.95 SANC-002
```

## Regulatory alignment

- Terse output must **never** leak anything that would tip off the
  subject (FDL No.10/2025 Art.29). The runner runs every line through
  `lintForTippingOff` before return; a single fired pattern causes the
  skill to return a suppressed placeholder.
- Every output line is deterministic — same input → same output — so
  the audit trail can reproduce exactly what the MLRO saw on their
  pager.
- The runner never fabricates a recommendation; it strictly compresses
  the fields already on the `ComplianceDecision`.

## Implementation

- Registered as `caveman` in the skill catalogue
  (`src/services/asanaCommentSkillRouter.ts`).
- Runner implementation: `runCaveman` in
  `src/services/asana/skillRunnerRegistry.ts`.
- Tests: `tests/skillRunnerRegistry.test.ts` (intensity level +
  tipping-off suppression + length cap per level).

## Regulatory basis

- FDL No.10/2025 Art.20-21 (CO reasoned decision — the terse form is
  still a reasoned decision, just compressed)
- FDL No.10/2025 Art.29 (no tipping off — linter runs on every output)
- Cabinet Res 134/2025 Art.19 (internal review — terse output must
  round-trip to the full case record)
