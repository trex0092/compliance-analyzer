# Friday (Tony Stark) Voice + MCP Integration Notes

**Date:** 10/04/2026
**Branch:** `claude/setup-friday-demo-EqCk3`
**Vendor reference:** `vendor/friday-tony-stark-demo`
**Upstream:** https://github.com/SAGAR-TAMANG/friday-tony-stark-demo

---

## Purpose

The Friday demo pairs a **FastMCP server** (tools exposed over SSE) with a
**LiveKit voice agent** (STT → LLM → TTS) that calls those tools in real time.
The pattern is directly adaptable to the compliance-analyzer project: a
compliance officer (CO) can drive STR triage, sanctions screening, and
filing-status queries by voice instead of clicking through the React UI.

This document captures what we borrow, what we intentionally don't, and how
the pattern maps onto existing compliance-analyzer modules.

---

## Architecture (upstream)

```
Mic ──► STT (Sarvam Saaras v3)
           │
           ▼
      LLM (Gemini 2.5 Flash) ◄──► MCP Server (FastMCP / SSE @ :8000)
           │                          ├─ get_world_news
           ▼                          ├─ search_web
      TTS (OpenAI nova)                └─ system tools
           │
           ▼
       LiveKit room
```

Entry points:
- `uv run friday`        — starts MCP server (`server.py`)
- `uv run friday_voice`  — starts voice agent (`agent_friday.py`)

Python 3.11+, dependencies: `fastmcp`, `livekit-agents[deepgram,groq,openai,sarvam,silero]`, `livekit-plugins-google`, `httpx`, `python-dotenv`.

---

## Why this matters for compliance-analyzer

Compliance work is interrupt-driven. A CO may need to ask:
- *"Is counterparty Acme Gold still on any sanctions list?"*
- *"What's the CNMR deadline countdown on incident #INC-204?"*
- *"How many STRs are unfiled this quarter?"*

Today those answers require navigating the React dashboard. A voice MCP tool
surface lets the CO keep eyes on a document while the assistant answers,
which is particularly useful during MoE inspections and EOCN escalations.

---

## Mapping Friday tools → compliance tools

| Friday upstream tool   | Compliance-analyzer equivalent                          | Existing module                     |
|------------------------|----------------------------------------------------------|-------------------------------------|
| `get_world_news`       | `get_sanctions_list_updates`                             | `compliance-suite.js` sanctions sync |
| `search_web`           | `lookup_entity` (sanctions + UBO register)               | `src/services/screeningService`     |
| `system.now`           | `deadline_countdown(incident_id)`                        | `src/utils/businessDays.ts`         |
| —                      | `check_str_status(customer_id)`                          | `workflow-engine.js`                |
| —                      | `generate_goaml_xml(filing_id)`                          | `compliance-suite.js` goAML exporter |
| —                      | `four_eyes_request(action, approver_id)`                 | `auth.js` / approval workflow       |

All new tools MUST:
1. Log every invocation (actor, timestamp, payload hash) to the audit trail —
   FDL Art.24 record retention (5yr).
2. Refuse to expose STR status to the subject or their agents — FDL Art.29
   (no tipping off).
3. Use `src/domain/constants.ts` for any threshold value (no hardcoding).
4. Use `checkDeadline` / `checkEOCNDeadline` for any deadline computation —
   never calendar-day math.

---

## What we do NOT adopt

| Upstream choice             | Decision | Reason |
|-----------------------------|----------|--------|
| Gemini 2.5 Flash as LLM     | Replace with Claude (Sonnet 4.6) | Project standard; already wired for audit logging |
| OpenAI TTS "nova" voice     | Keep as option, default off      | Voice output of compliance data must be opt-in per client confidentiality |
| Sarvam Saaras v3 STT        | Evaluate vs Deepgram             | Saaras is Indian-English optimized; UAE CO population is multi-accent — needs A/B test |
| Public `search_web` tool    | Drop                             | Uncontrolled web access violates source-attribution requirement for compliance decisions |
| SSE transport on port 8000  | Keep, but bind to 127.0.0.1 only | Never expose compliance tool surface on 0.0.0.0 |

---

## Security requirements layered on top

Per project `CLAUDE.md` § Seguridad:

1. **Rate limiting** — MCP tool endpoints: 100 req/15min per CO. Sensitive
   tools (freeze, STR, goAML export): 10 req/15min.
2. **Env vars only** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
   `ANTHROPIC_API_KEY`, `STT_PROVIDER_KEY`. Add to `.env.example`, never commit.
3. **Input validation** — every tool arg goes through a zod schema. Reject +
   log any violation.
4. **Auth** — MCP server requires a signed session token tied to the CO user.
   No anonymous tool calls.
5. **Audit log** — every voice transcript + tool invocation persisted with
   the same retention as UI-driven actions.

---

## Suggested implementation path (not yet built)

Phase 1 — **Read-only proof of concept**
- Stand up a FastMCP server exposing 3 read-only tools:
  `deadline_countdown`, `check_str_status`, `lookup_entity`.
- Wire to existing JS services via a thin HTTP bridge (Node side keeps the
  compliance logic; Python MCP side only marshals calls).
- No voice yet — validate via `mcp` CLI client.

Phase 2 — **Voice layer**
- Add LiveKit agent, Claude as LLM, opt-in TTS.
- Gate behind a feature flag in `settings.json`.
- Dry-run against a sanitized staging dataset.

Phase 3 — **Write tools + four-eyes**
- Add `four_eyes_request`, `generate_goaml_xml`, `freeze_asset`.
- Every write tool requires a second approver via the existing
  workflow-engine four-eyes mechanism — the voice channel alone is NEVER
  sufficient authorization for a write.

---

## Running the upstream demo (for reference)

The submodule lives at `vendor/friday-tony-stark-demo`. To try it:

```bash
cd vendor/friday-tony-stark-demo
uv sync
cp .env.example .env  # fill in LiveKit, Sarvam, OpenAI, Google keys
uv run friday         # terminal 1 — MCP server
uv run friday_voice   # terminal 2 — voice agent
```

Do **not** point the upstream demo at any real compliance data — it has no
audit logging, no rate limiting, and no auth. It is a reference
implementation only.

---

## References

- Upstream: https://github.com/SAGAR-TAMANG/friday-tony-stark-demo
- FastMCP: https://github.com/jlowin/fastmcp
- LiveKit Agents: https://github.com/livekit/agents
- Project MCP patterns: `vendor/code-review-graph` (already in use)
