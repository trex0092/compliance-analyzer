# Handling "Stream idle timeout - partial response received" in Claude Code

This is the playbook for when the Claude Code CLI prints:

```
API Error: Stream idle timeout - partial response received
```

It is the same root cause as the issue we fixed server-side for our own
web app in PR #151 (`netlify/functions/ai-proxy.mts`), but it can still
fire when you are using the Claude Code CLI itself, because the failing
hop is somewhere between your terminal and `api.anthropic.com`, not in
our proxy.

References used for this guide:
- Streaming Messages: https://platform.claude.com/docs/en/build-with-claude/streaming
- API errors: https://platform.claude.com/docs/en/api/errors
- Message Batches results: https://platform.claude.com/docs/en/api/messages/batches/results

## What the error actually means

Claude Code uses Server-Sent Events (SSE) to stream the assistant's
reply token by token. The HTTP response already returned `200 OK` and
some bytes have arrived, but then the connection sat idle longer than
some intermediate hop allows, and that hop closed the socket. The CLI
treats the truncation as a fatal stream error and surfaces the partial
response with this message.

Per the Anthropic errors doc: "When receiving a streaming response via
SSE, it is possible that an error can occur after returning a 200
response, in which case error handling does not follow [the standard]
mechanisms." That is exactly this case.

Common upstream silences that trigger the idle gap:
- Extended thinking before the next content block.
- Tool-use planning between subagent calls.
- Large file reads or grep results being processed before the next
  delta is emitted.
- Long `max_tokens` jobs where Anthropic legitimately pauses between
  blocks.

The bytes were real. The model did not crash. A middlebox just got
impatient.

## Immediate recovery (do this first)

1. **Re-run the prompt.** Most idle-timeout drops are transient. Press
   up-arrow and resend. You typically get through on the retry.
2. **Ask Claude to continue.** The partial assistant output is still in
   your transcript. A short follow-up like "continue from where you
   stopped" usually picks up cleanly because the prior context is
   already in the conversation.
3. **Shrink the in-flight turn.** If the same turn fails twice, the
   request is too big for the current network path. Narrow it: fewer
   files, smaller `Read` ranges, fewer parallel tool calls, one task
   per turn instead of three.

## Reduce recurrence (do this if it keeps happening)

- Run `/compact` to compress the conversation. Long histories make
  every turn slower and increase the idle window between deltas.
- Run `/clear` and restart the session if the conversation has drifted
  far from the current task.
- Switch to a faster model for bulk work (`claude-haiku-4-5-20251001`
  or `claude-sonnet-4-6`). Opus is more likely to pause for thinking,
  which is exactly what trips idle timers. See CLAUDE.md section 1
  ("Model Routing: Worker + Advisor") for when each tier is right.
- Plan first (CLAUDE.md section 4). A planned change tends to run as
  several small turns instead of one giant one, so any single stream
  is shorter.
- Avoid asking for a single huge generated artefact in one turn (full
  file rewrites of 4000-line files, multi-thousand-line reports). Break
  it into sections.

## If the error happens on every turn (network problem)

The failing middlebox is almost always one of:
- A corporate VPN / TLS terminator with an aggressive idle timeout.
- A captive portal or hotel Wi-Fi that closes idle TCP after 30-60s.
- A local proxy (Zscaler, Squid, BlueCoat) that buffers SSE and breaks
  the stream entirely.

Things to try, in order:
1. Disconnect the VPN and retry. If it works, the VPN is the problem.
2. Switch network (phone hotspot is a fast diagnostic).
3. If you must run behind a corporate proxy, ask IT to either
   allowlist `api.anthropic.com` for SSE pass-through (no buffering)
   or raise the idle timeout for that host to at least 120 seconds.
4. The Anthropic errors doc notes that "setting a TCP socket
   keep-alive can reduce the impact of idle connection timeouts on
   some networks." The official SDKs already set this; if you have a
   middlebox terminating TLS it will not help, because the
   keep-alive is now between you and the middlebox, not end-to-end.

## If you are operating a proxy in front of Anthropic

We hit the same problem in our own `netlify/functions/ai-proxy.mts`.
The fix shipped in PR #151 and lives at `ai-proxy.mts` lines 82-104:

- Wrap the upstream body in a `ReadableStream` that watches the
  inter-chunk gap.
- Inject a `: keepalive\n\n` SSE comment whenever the gap exceeds
  10 seconds.
- Force `X-Accel-Buffering: no` on the response so no downstream
  layer re-buffers and defeats the keepalive.
- Cap the upstream `fetch()` timeout at the longest expected stream
  lifetime (we use 5 minutes), not at the longest expected idle gap.
  A short upstream timeout will itself produce this exact error.

If you wrote a proxy and you are seeing this error, check those four
points before anything else.

## When streaming is the wrong tool entirely

Per the Anthropic long-requests guidance, if a single response is
expected to take more than 10 minutes, do not stream at all. Use the
Message Batches API and poll for `.jsonl` results. That avoids any
network-idle-timeout class of failure by design. The batch results
endpoint is documented at:
https://platform.claude.com/docs/en/api/messages/batches/results

This does not apply to interactive Claude Code use, but it is the
right answer for unattended long-running compliance jobs (bulk
sanctions re-screening, periodic UBO walks, multi-thousand-entity
KPI rollups). For those workflows, consider scheduling them through
the Batches API instead of the streaming `/v1/messages` path.

## Reporting a recurring failure

If retrying, shrinking, and switching networks all fail and you see
this error consistently:

1. Note the `request_id` (header `request-id`, format `req_xxx`).
2. File the issue at https://github.com/anthropics/claude-code/issues
   with the request ID, the model, the approximate prompt size, and
   the network path (VPN? corporate proxy? home network?).
3. For our internal web app users, check the Netlify function logs
   first. If the keepalives in `ai-proxy.mts` are firing but the
   browser still drops, the failing layer is between Netlify and the
   browser, not between Netlify and Anthropic.

## Quick reference

| Symptom                                     | First action                          |
|---------------------------------------------|---------------------------------------|
| One-off failure                             | Retry the same prompt                 |
| Partial answer is useful                    | "continue from where you stopped"     |
| Same turn fails twice                       | Shrink scope: fewer files, one task   |
| Fails across multiple turns in same session | `/compact` or `/clear`                |
| Fails on every session                      | Disconnect VPN, switch network        |
| Long unattended job                         | Use Message Batches API, not stream   |
| You operate the proxy                       | Inject SSE keepalives (PR #151)       |
