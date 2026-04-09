# /agent-review — Multi-Agent Compliance Code Review

Perform a multi-agent code review focused on compliance correctness, using parallel specialist agents inspired by everything-claude-code's AgentShield pattern.

## Usage
```
/agent-review [file path or PR number]
```

## Instructions

### Step 1: Initialize Review Context
1. Call `get_minimal_context(task="compliance code review")`.
2. If PR number provided, use `get_review_context` for risk-scored change analysis.
3. If file path provided, use `detect_changes` for risk assessment.

### Step 2: Deploy Specialist Review Agents (Parallel)
Launch these review agents concurrently:

**Agent 1 — Regulatory Compliance Reviewer:**
- Verify all thresholds imported from `src/domain/constants.ts` (never hardcoded)
- Check sanctions screening covers ALL lists (UN, OFAC, EU, UK, UAE, EOCN)
- Verify STR workflow has no tipping-off exposure (FDL Art.29)
- Confirm date format is dd/mm/yyyy for UAE compliance documents
- Validate currency handling uses CBUAE rates, not hardcoded values

**Agent 2 — Security Reviewer:**
- Check for hardcoded secrets, API keys, tokens (OWASP Top 10)
- Verify rate limiting on all API endpoints
- Validate input sanitization (Zod/Joi schemas)
- Check for SQL injection, XSS, command injection vectors
- Verify security headers (CSP, X-Frame-Options, HSTS)

**Agent 3 — Audit Trail Reviewer:**
- Every compliance action must log timestamp, user, action
- Verify four-eyes principle for high-risk decisions
- Check record retention compliance (5-year minimum)
- Validate business day calculations use `src/utils/businessDays.ts`

**Agent 4 — Architecture Reviewer:**
- Check impact radius using `get_impact_radius`
- Verify no breaking changes to compliance-critical flows
- Validate goAML XML schema compliance
- Check downstream effects using `get_affected_flows`

### Step 3: Aggregate & Score
Combine findings from all agents into a unified review:
- **Critical**: Regulatory violations, security vulnerabilities → Block merge
- **High**: Missing audit trails, hardcoded thresholds → Require fix
- **Medium**: Suboptimal patterns, missing validation → Recommend fix
- **Low**: Style issues, minor improvements → Optional

### Step 4: Generate Review Report
Output structured review with:
- Per-agent findings with severity and file:line references
- Aggregate compliance risk score
- Pass/fail recommendation with blocking issues highlighted
- References to specific regulatory articles for each finding

### Architecture Reference
- `vendor/everything-claude-code` — AgentShield red-team/blue-team/auditor pattern
- `vendor/oh-my-claudecode` — Staged pipeline with verification loops
- `vendor/claude-code-system-prompts` — Prompt architecture for effective sub-agent delegation
