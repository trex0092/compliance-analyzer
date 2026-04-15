# HAWKEYE STERLING V2 — Endpoints Reference

All endpoints share:
- POST + OPTIONS preflight only
- Bearer token via `Authorization: Bearer $HAWKEYE_BRAIN_TOKEN`
- Rate limit 100 / 15min / IP (break-glass: 10 / 15min / IP)
- CORS origin via `HAWKEYE_ALLOWED_ORIGIN`
- Strict input validation (each endpoint exports `__test__.validate`)

Base URL: `https://hawkeye-sterling-v2.netlify.app`

---

## 1. POST /api/brain/analyze

Full brain pipeline. Returns a SuperDecision with verdict, confidence,
power score, uncertainty interval, debate, ensemble, typologies,
cross-case correlations, regulatory drift.

```bash
curl -X POST $BASE/api/brain/analyze \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-a",
    "topic": "DPMS gold purchase 65K AED cash",
    "entity": {
      "id": "ent-1",
      "name": "Customer Inc",
      "features": {
        "priorAlerts90d": 0,
        "txValue30dAED": 65000,
        "nearThresholdCount30d": 0,
        "crossBorderRatio30d": 0.1,
        "isPep": false,
        "highRiskJurisdiction": false,
        "hasAdverseMedia": false,
        "daysSinceOnboarding": 365,
        "sanctionsMatchScore": 0,
        "cashRatio30d": 0.8
      }
    }
  }'
```

Response carries:
`decision`, `powerScore`, `asanaDispatch`, `crossCase`, `typologies`,
`velocity`, `ensemble`, `uncertainty`, `debate`, `precedents`,
`regulatoryDrift`.

---

## 2. POST /api/brain/telemetry

Time-series aggregate over a date range.

```bash
curl -X POST $BASE/api/brain/telemetry \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "tenant-a", "startIso": "2026-04-01", "endIso": "2026-04-14" }'
```

Returns `aggregate` with `byVerdict`, `avgConfidence`, `avgPowerScore`,
`ensembleUnstableCount`, `humanReviewCount`, `topTypologies`,
`driftDecisionCount`. Max range 365 days.

---

## 3. POST /api/brain/replay

Re-validate a historical case against the CURRENT regulatory baseline.

```bash
curl -X POST $BASE/api/brain/replay \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "tenant-a", "caseId": "case-uuid-1" }'
```

Returns `report` with `conclusion` in
`{ stable, review_recommended, verdict_may_change, not_found }`,
`drift`, `thresholdImpacts`, `summary`.

---

## 4. POST /api/brain/evidence-bundle

Single-call audit artifact with SHA3-512 integrity hash.

```bash
curl -X POST $BASE/api/brain/evidence-bundle \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "tenant-a", "caseId": "case-uuid-1" }'
```

Returns `bundle` with `replay`, `telemetry`, `drift`, `citations`,
`conclusion`, `summary`, `integrity { algorithm, hashHex, preimagePrefix }`.

Auditors verify by calling `verifyEvidenceBundleIntegrity(bundle)`.

---

## 5. POST /api/brain/clamp-suggestion (Tier C)

MLRO-reviewed clamp threshold tuning.

```bash
# propose
curl -X POST $BASE/api/brain/clamp-suggestion \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "propose",
    "clampKey": "sanctionsMatchMin",
    "currentValue": 0.5,
    "minValue": 0.1,
    "maxValue": 0.95,
    "step": 0.05,
    "regulatory": "FDL Art.35",
    "evidence": { "totalCases": 100, "falsePositive": 30, "falseNegative": 2, "truePositive": 60 }
  }'

# decide
curl -X POST $BASE/api/brain/clamp-suggestion \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "decide", "id": "suggestion:sanctionsMatchMin:1234", "status": "accepted" }'

# list
curl -X POST $BASE/api/brain/clamp-suggestion \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "list", "statusFilter": "pending_mlro_review" }'
```

---

## 6. POST /api/brain/outbound-queue (Tier C)

Tipping-off-safe customer message dispatch.

```bash
# enqueue (linted)
curl -X POST $BASE/api/brain/outbound-queue \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "enqueue",
    "tenantId": "tenant-a",
    "recipientRef": "cust-1",
    "channel": "email",
    "subject": "Your invoice",
    "body": "Please find your invoice attached."
  }'

# release | cancel | pending
curl -X POST $BASE/api/brain/outbound-queue \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "release", "tenantId": "tenant-a", "id": "outbound:..." }'
```

---

## 7. POST /api/brain/break-glass (Tier C)

Two-person approval override of a brain verdict.

```bash
# request
curl -X POST $BASE/api/brain/break-glass \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "request",
    "tenantId": "tenant-a",
    "caseId": "case-1",
    "fromVerdict": "freeze",
    "toVerdict": "escalate",
    "justification": "Manual review established false-positive on legitimate high-value customer.",
    "regulatoryCitation": "FDL Art.20",
    "requestedBy": "mlro-1"
  }'

# approve  (must be different user — self-approval rejected)
curl -X POST $BASE/api/brain/break-glass \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve",
    "tenantId": "tenant-a",
    "id": "breakglass:tenant-a:case-1:1234",
    "approverId": "mlro-2"
  }'
```

On successful approval the endpoint fire-and-forgets a dispatch to
the Asana orchestrator so the execution task lands on the CO queue.

---

## 8. POST /api/brain/zk-cross-tenant (Tier C)

Commit-only cross-tenant sanctions collision attestation.

Requires `HAWKEYE_CROSS_TENANT_SALT` env var (≥16 chars, published
by FIU circular per version).

```bash
# commit
curl -X POST $BASE/api/brain/zk-cross-tenant \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "commit",
    "tenantId": "tenant-a",
    "saltVersion": "v1",
    "observation": {
      "subjectKey": "sha3-of-internal-id",
      "tsDay": "2026-04-14",
      "listName": "UN"
    }
  }'

# aggregate
curl -X POST $BASE/api/brain/zk-cross-tenant \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "aggregate", "saltVersion": "v1" }'
```

---

## 9. Other endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/brain/correlate` | POST | Cross-case pattern correlator (manual trigger) |
| `/api/brain/diagnostics` | POST | Point-in-time brain health snapshot |
| `/api/brain/hydrate` | POST | Force-hydrate the per-tenant memory cache |
| `/api/brain/clamp-cron` | scheduled | Hourly clamp suggestion generator from telemetry |
| `/api/asana-dispatch` | POST | Direct Asana task creation (orchestrator-bypass) |
| `/api/asana-comment-skill-handler` | webhook | Asana comment → skill router |

---

## Error responses

All endpoints use standard HTTP codes:
- `400` — input validation failed (response `{ error: "..." }`)
- `401` — missing or invalid Bearer token
- `405` — method not allowed
- `429` — rate limited (response `{ error: "...", retryAfter }`)
- `503` — blob store / env var unavailable

Never `500` — every handler catches its own errors and degrades.
