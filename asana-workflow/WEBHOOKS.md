# ASANA WORKFLOW — Webhooks + Comment Skill Router

Asana sends webhooks when tasks change. The webhook router routes
each event to a handler; comments get an extra round trip through
the comment skill router so MLROs can fire skills by typing
`/<skill>` in a comment.

---

## Endpoint

`POST /api/asana-webhook`

Configured in Asana via:

```bash
curl -X POST https://app.asana.com/api/1.0/webhooks \
  -H "Authorization: Bearer $ASANA_ACCESS_TOKEN" \
  -F "resource=$ASANA_WORKSPACE_GID" \
  -F "target=https://hawkeye-sterling-v2.netlify.app/api/asana-webhook"
```

---

## X-Hook-Secret handshake (mandatory)

On the very first request, Asana sends an `X-Hook-Secret` header. The
endpoint MUST echo the same header in its response within 10 seconds.
If you miss this, Asana drops the webhook permanently and you will
not find out until the SLA enforcer goes silent.

```typescript
const secret = req.headers.get('X-Hook-Secret');
if (secret) {
  // First delivery — echo the secret
  return new Response(null, {
    status: 200,
    headers: { 'X-Hook-Secret': secret },
  });
}
```

The secret is stored under `asana:webhook-secret:<workspace>` for
later signature verification on subsequent deliveries.

---

## Signature verification (subsequent deliveries)

Every later delivery includes `X-Hook-Signature: sha256=<hex>`. The
router verifies:

```typescript
const expected = crypto
  .createHmac('sha256', storedSecret)
  .update(rawBody)
  .digest('hex');

if (timingSafeEqual(expected, providedSignature)) {
  // process
} else {
  return new Response(null, { status: 401 });
}
```

A signature failure logs the event, increments
`asana.webhook.signature_fail`, and returns 401. Never process an
unverified webhook.

---

## Event routing

Inbound events arrive as `events: [{action, resource, parent, user, change}]`.
The router dispatches each event:

| Event (action / resource type) | Handler |
|---|---|
| `added` / `task` | `taskAddedHandler` — log + check assignment |
| `changed` / `task` (section) | `sectionChangedHandler` — SLA enforcer start/stop |
| `changed` / `task` (custom field) | `customFieldChangedHandler` — sync to brain state |
| `added` / `story` (comment) | `commentAddedHandler` → comment skill router |
| `removed` / `task` | `taskRemovedHandler` — close case in brain |
| `changed` / `task` (completed) | `taskCompletedHandler` — case lifecycle hook |
| (anything else) | `unhandledEventLogger` — log + drop |

Unhandled events are intentional. Asana sends a lot of noise; we
only care about the events that drive compliance state.

---

## Comment skill router

When a comment lands on a brain task, the router scans for skill
invocations:

```
Pattern: ^/(\w[\w-]*)\s*(.*)$
```

Examples that match:
- `/screen subject-name`
- `/incident sanctions-match`
- `/goaml str case-1`
- `/audit-pack tenant-a`

Examples that do NOT match (intentional):
- `not /a skill` — must be at start of line
- `/123-bad` — skill name must start with a letter
- `// just a comment` — double slash is treated as URL prefix

Matched skills are looked up in `skillRunnerRegistry.ts`. If the
skill exists, the runner fires asynchronously and posts the result
as a reply story on the same task. If the skill does not exist, the
router posts a "skill not found" reply with the list of available
skills.

### Reply format

```
🤖 /<skill> result

<one-line summary>

Details:
<bullet list>

[View full output: <link>]
```

The link points to the Brain Console UI page for the case so MLROs
can drill into the full result without leaving Asana.

---

## Skill execution context

Every skill runner receives:

```typescript
interface SkillContext {
  taskGid: string;          // Asana task ID
  caseId: string;           // brain case ID (from custom field)
  tenantId: string;         // brain tenant ID
  authorGid: string;        // Asana user who posted the comment
  args: string;             // everything after the skill name
}
```

Runners must:

- Validate args
- Check the author has permission for the skill (e.g., `/break-glass`
  requires CO role)
- Log execution to `audit:skill:*`
- Post the reply via the orchestrator (NOT directly via Asana API)

---

## Idempotency for webhooks

Asana retries failed webhook deliveries up to 5 times over 24 hours.
Each delivery includes a unique `X-Hook-Delivery-Id`. The router
deduplicates by delivery ID:

```
asana:webhook-delivered:<delivery-id>  → 1 (TTL 7 days)
```

A second delivery with the same ID is logged and dropped. This
makes webhook handling safe under Asana's retry behaviour.

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Webhook never delivers | X-Hook-Secret echo missed | Re-create webhook in Asana |
| Webhook delivers but no handler fires | Event mapping mismatch | Add row to event router table |
| Comment skill never replies | Skill runner threw silently | Check `audit:skill:*` log |
| Same comment fires skill twice | Delivery dedup TTL expired | TTL is 7 days — should be safe |
| Unverified events processed | Signature check disabled | NEVER disable signature check |

---

## Configuration

Required env vars:

| Variable | Purpose |
|---|---|
| `ASANA_ACCESS_TOKEN` | PAT for posting reply comments |
| `ASANA_WEBHOOK_SECRET` | (deprecated — secrets are per-webhook now) |
| `HAWKEYE_BRAIN_TOKEN` | For internal calls back to brain endpoints |

---

## Testing

Tests live in `tests/asana/webhook.test.ts`:

- X-Hook-Secret echo on first delivery
- Signature verification on subsequent deliveries
- Signature failure → 401 + counter increment
- Each event type → correct handler
- Comment skill router pattern matching
- Skill not found → friendly reply
- Delivery dedup → second delivery dropped
- Concurrent comments on same task — both processed, no race
