# Phase 19 — Execution paths complete (17/04/2026 session)

This snapshot records the second autonomous session that carried
Phase 19 from pure-compute modules into live execution paths.
Together with the 16/04 closeout
(`docs/session-closeout-2026-04-16.md`) it gives the MLRO a
single-page view of every PR in both sessions and the current
production state.

---

## 1. State after this session

Every Phase 19 workstream has both a pure-compute module AND an
execution-path wiring merged. W-E is live in production by default;
W-A, W-B, W-C, W-D are live but each carries a well-documented
escape-hatch env flag.

| Workstream | Pure compute | Read endpoint | Execution path | Default |
|---|---|---|---|---|
| W-A rate limit | ✅ #186 | — | ✅ #200 (`asanaQueue`) | ENABLED |
| W-B project resolver | ✅ #185 | ✅ #197 | ✅ #201 (`asanaSync`) | ENABLED |
| W-C reconciler | ✅ #188 | ✅ #199 | ✅ #202 (cron) + ✅ #204 (live reads, opt-in) | Cron ENABLED, live reads OPT-IN |
| W-D bootstrap state machine | ✅ #187 | ✅ #198 | ✅ #203 (`setup-asana-bootstrap`) | ENABLED |
| W-E citation enricher | ✅ #184 | — | ✅ #195 (`asanaSync` builders) | ENABLED |

## 2. Escape-hatch flags (all documented in `.env.example`)

| Flag | Default | Effect when set to `1` |
|---|---|---|
| `ASANA_CITATION_BLOCK_DISABLED` | unset (ENABLED) | Skip W-E citation block append |
| `ASANA_RATE_LIMIT_DISABLED` | unset (ENABLED) | Bypass W-A per-tenant bucket |
| `ASANA_WB_RESOLVER_DISABLED` | unset (ENABLED) | Revert to direct COMPANY_REGISTRY lookup |
| `ASANA_RECONCILE_CRON_DISABLED` | unset (ENABLED) | Cron becomes a no-op entirely |
| `ASANA_RECONCILE_LIVE_READS_ENABLED` | unset (OPT-IN) | Enables live brain+Asana snapshot reads |
| `ASANA_WD_STATE_RECORDING_DISABLED` | unset (ENABLED) | Skip bootstrap state-machine writes |

## 3. PRs merged this session

- #197 W-B read endpoint
- #198 W-D read endpoint
- #199 W-C read endpoint
- #200 W-A execution path (rate limit → asanaQueue)
- #201 W-B execution path (resolver → asanaSync)
- #202 W-C cron scaffold
- #203 W-D execution path (state recording in bootstrap)
- #204 W-C live snapshot reads (opt-in)
- (this PR) Documents all new env flags + this snapshot

Together with the 19 PRs from the 16/04 session, the repo now
carries every piece of Phase 19 the spec (#182) called for.

## 4. What still needs the MLRO

1. Turn on `ASANA_RECONCILE_LIVE_READS_ENABLED=1` on a test tenant
   and watch the first audit cycles'
   `plansForTenant` / `asanaTasksMatched` numbers. Promote
   workspace-wide only after the match quality looks right on the
   test tenant.
2. Complete the Backup MLRO appointment signatures from #177
   before leaving `ASANA_RATE_LIMIT_DISABLED` unset and the cron
   enabled over an unattended weekend.
3. Phase 1 through 4 and Phase 7 from the original 7-phase plan
   still require live-system access (HAWKEYE UI smoke test,
   Netlify wizard, env vars, MFA, user onboarding, tabletop
   drill). These cannot be moved on by the agent.

## 5. Retention

Internal-review artefact under Cabinet Resolution 134/2025 Article
19. Ten-year retention per FDL No. 10 of 2025 Article 24.
