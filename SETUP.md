# Compliance Analyzer — Setup

Three commands. That's it.

## 1. Run the wizard

```bash
npm run setup
```

The wizard:
- Auto-generates every secret you don't need to type
- Asks you for **3 things only** (Asana token + workspace gid + governance project gid)
- Stubs every paid integration (you can swap them later)
- Writes `.env` at the repo root

## 2. Push to Netlify

```bash
npx netlify-cli login        # browser opens → click Authorize
npx netlify-cli link         # pick the hawkeye-sterling-v2 site
npx netlify-cli env:import .env
```

That third command pushes every variable in `.env` straight into Netlify.

## 3. Redeploy

```bash
git commit --allow-empty -m "redeploy with new env vars" && git push
```

## Verify it's alive

```bash
curl https://hawkeye-sterling-v2.netlify.app/.netlify/functions/asana-super-brain-autopilot-cron
```

Expected response: `{"ok":true,"dispatched":N,...}`

If it returns `{"ok":true,"skipped":"ASANA_API_TOKEN missing"}` then the env var didn't make it across — re-run step 2.

---

## What the wizard asks for

You'll be prompted for **three things** during `npm run setup`:

| # | Variable | Where to find it |
|---|---|---|
| 1 | `ASANA_TOKEN` | https://app.asana.com/0/my-apps → **Personal access tokens** → **Create new token** |
| 2 | `ASANA_WORKSPACE_GID` | Open any Asana page. The URL looks like `https://app.asana.com/0/<GID>/...`. The number after `/0/` is the workspace gid. |
| 3 | `ASANA_AI_GOVERNANCE_PROJECT_GID` | Create a new Asana project called "AI Governance Watchdog". Open it. The number in the URL is the project gid. |

Everything else is auto-generated or stubbed. Press Enter to accept defaults.

---

## What gets stubbed (and how to un-stub later)

These integrations need credentials you probably don't have yet. The wizard sets them to literal `STUB`, which makes the corresponding service return a `plan-only` status — it generates the plan but doesn't make a real API call.

| Variable | Provider | Replace when |
|---|---|---|
| `EOCN_FEED_URL` | UAE EOCN office | Your EOCN compliance contact gives you the feed URL |
| `GOAML_PORTAL_API_KEY` | UAE FIU goAML portal | You complete goAML registration |
| `BANKING_FREEZE_API_KEY` | Your bank's compliance API | Your bank tech ops provisions a key |
| `REUTERS_REFINITIV_API_KEY` | Refinitiv Data Platform | Paid contract is signed |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams channel | Teams → Channel → Connectors → Incoming Webhook |

When a real key arrives, replace `STUB` with the real value in `.env`, then re-run `npx netlify-cli env:import .env` and redeploy.

---

## Asana custom field GIDs (one-time setup)

After the basic env is wired, run this to create the compliance custom fields on your Asana workspace:

```bash
npx tsx scripts/asana-cf-bootstrap.ts
```

It prints all the GIDs. Paste them back into your `.env` under the `ASANA_CF_*` keys, then re-run `env:import`.

---

## Re-running setup is safe

`npm run setup` preserves any value you've already set. It only fills in keys that are missing. Run it as many times as you like.

---

## Smoke tests after deploy

| Cron | URL | Expected |
|---|---|---|
| Autopilot | `/.netlify/functions/asana-super-brain-autopilot-cron` | `{"ok":true,...}` |
| Retry queue | `/.netlify/functions/asana-retry-queue-cron` | `{"ok":true,...}` |
| Skill handler | `/.netlify/functions/asana-comment-skill-handler` | `{"ok":true,"drained":N}` |
| AI Governance | `/.netlify/functions/ai-governance-self-audit-cron` | `{"ok":true,"severity":"...","overallScore":N}` |
| Toast stream | `/api/asana-toast-stream` (with `Authorization: Bearer $HAWKEYE_BRAIN_TOKEN`) | `{"events":[...]}` |

If any returns `{"ok":true,"skipped":"..."}` then a required env var is missing — `cat .env` to check the value and re-run `env:import`.
