# brain-zk-cross-tenant (Tier C)

**Owner:** MLRO + SRE
**Endpoint:** `POST /api/brain/zk-cross-tenant`
**Schedule:** synchronous (commit) + cron (aggregate + salt rotation)
**Regulatory anchor:** FDL Art.14; Cabinet Res 74/2020 Art.5; EU GDPR Art.25

## Purpose
Commit-only cross-tenant sanctions collision attestation. Each
tenant commits a salted hash; the aggregator reveals collisions
above the k-anonymity threshold (default k=3, minimum k=2).

## Expected healthy state
- `commit` succeeds on every tenant with the current `saltVersion`
- `aggregate` returns collisions only at or above k=3
- Salt version rotates quarterly via `crossTenantSaltRotator`

## Common failure modes

| Symptom | First check |
|---|---|
| `HAWKEYE_CROSS_TENANT_SALT env var missing` | Env var not set — set and redeploy |
| Salt version mismatch | Tenants using different FIU circular versions — standardise |
| k=2 collisions revealed | NOT POSSIBLE — aggregator clamps to MIN_K_ANONYMITY (=2) minimum |
| Zero collisions ever | Cohorts legitimately don't overlap OR salt version drift |

## Recovery steps
1. Confirm `HAWKEYE_CROSS_TENANT_SALT` is set and ≥16 chars
2. Confirm every participating tenant uses the same `saltVersion`
3. Run `decideSaltRotation()` to check if rotation is overdue
4. For aggregation queries, always pass `kAnonymity: 3` or higher
5. **Never** pass `kAnonymity: 1` — the aggregator rejects it explicitly
6. Audit log at `tierC:zk-cross-tenant:*` shows every commit + aggregate
