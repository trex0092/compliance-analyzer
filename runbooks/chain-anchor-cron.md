# chain-anchor-cron

**Owner:** SRE on-call
**Endpoint:** `/.netlify/functions/chain-anchor-cron`
**Schedule:** hourly
**Regulatory anchor:** FDL Art.24; FATF Rec 11

## Purpose
Aggregates every fresh audit-sealed artifact (evidence bundles, zk
attestations, clamp suggestions) into a Merkle root and anchors the
root in a durable store. This gives auditors a single cryptographic
proof-of-existence covering the entire run.

## Expected healthy state
- Runs hourly, exits within 60 seconds
- Merkle root bytes written to `chain-anchor/<hour>.json`
- Root hash matches the recomputed hash on every replay

## Common failure modes

| Symptom | First check |
|---|---|
| Merkle build throws | Corrupted audit entry — find the offender via binary search |
| Chain break across hours | Previous anchor missing or mutated |
| Anchor store unreachable | Netlify Blob outage |

## Recovery steps
1. Check cron log for the last successful run
2. Verify `chain-anchor/*` blob entries exist and are readable
3. Re-run the anchor manually: `POST /api/chain-anchor-cron`
4. If a chain break is detected, investigate the missing hour's audit source
5. **Never** delete an old anchor entry — append only
