# ASANA WORKFLOW — Skill Registry

47 skill runners that fire when an MLRO comments `/<skill>` on a
brain task. Mapping lives in `src/services/asana/skillRunnerRegistry.ts`.

---

## How a comment becomes a skill execution

```
MLRO comments on Asana task:  "/screen subject-name"
        │
        ▼
asana-webhook receives story.added event
        │
        ▼
asanaWebhookRouter routes to commentAddedHandler
        │
        ▼
commentAddedHandler matches /^\/(\w[\w-]*)\s*(.*)$/
        │
        ▼
skillRunnerRegistry["screen"](context, "subject-name")
        │
        ▼
skill runner posts result as reply story via orchestrator
```

---

## Compliance skills

| Skill | Args | Permission | Anchor |
|---|---|---|---|
| `/screen` | `<subject>` | analyst+ | FATF Rec 6 |
| `/onboard` | `<customer-id>` | analyst+ | FDL Art.12-14 |
| `/incident` | `<type>` | mlro+ | FDL Art.20-22 |
| `/goaml` | `<filing-type> <case-id>` | mlro+ | FDL Art.26-27 |
| `/audit` | `<scope>` | mlro+ | FDL Art.20 |
| `/audit-pack` | `<entity>` | co+ | FDL Art.24 |
| `/moe-readiness` | (none) | co+ | MoE Circular 08/AML/2021 |
| `/traceability` | `<article>` | analyst+ | (audit) |
| `/timeline` | `<entity>` | analyst+ | FDL Art.20 |
| `/filing-compliance` | `<period>` | mlro+ | Cabinet Res 74/2020 Art.6 |
| `/kpi-report` | `<quarter>` | co+ | MoE quarterly |
| `/regulatory-update` | `<citation>` | co+ | (regulatory) |
| `/review-pr` | `<pr-number>` | analyst+ | (code review) |
| `/deploy-check` | (none) | co+ | (release gate) |
| `/multi-agent-screen` | `<subject>` | mlro+ | FATF Rec 6 |
| `/agent-orchestrate` | `<workflow>` | mlro+ | Cabinet Res 134/2025 Art.19 |
| `/agent-review` | `<diff>` | analyst+ | (code review) |

## Brain skills

| Skill | Args | Permission | Anchor |
|---|---|---|---|
| `/brain-analyze` | `<case-id>` | analyst+ | FDL Art.20-22 |
| `/brain-replay` | `<case-id>` | mlro+ | FDL Art.20 |
| `/brain-evidence-bundle` | `<case-id>` | mlro+ | FDL Art.24 |
| `/brain-telemetry` | `<range>` | analyst+ | (observability) |
| `/brain-diagnostics` | (none) | analyst+ | (observability) |
| `/brain-debate` | `<case-id>` | mlro+ | NIST AI RMF GOVERN-3 |
| `/brain-uncertainty` | `<case-id>` | analyst+ | NIST AI RMF MEASURE-2 |
| `/brain-correlate` | `<case-id>` | mlro+ | FDL Art.20-22 |

## Tier C skills

| Skill | Args | Permission | Anchor |
|---|---|---|---|
| `/clamp-suggest` | `<key>` | mlro+ | NIST AI RMF GOVERN-4 |
| `/clamp-accept` | `<id>` | co+ | NIST AI RMF GOVERN-4 |
| `/clamp-reject` | `<id>` | mlro+ | NIST AI RMF GOVERN-4 |
| `/outbound-enqueue` | `<recipient>` | analyst+ | FDL Art.29 |
| `/outbound-release` | `<id>` | co+ | FDL Art.29 |
| `/outbound-cancel` | `<id>` | mlro+ | FDL Art.29 |
| `/break-glass-request` | `<case-id>` | mlro+ | Cabinet Res 134/2025 Art.12-14 |
| `/break-glass-approve` | `<id>` | co+ (different user) | Cabinet Res 134/2025 Art.12-14 |
| `/zk-cross-tenant-commit` | `<subject-key>` | analyst+ | EU GDPR Art.25 |
| `/zk-cross-tenant-aggregate` | (none) | mlro+ | EU GDPR Art.25 |

## Asana ops skills

| Skill | Args | Permission | Anchor |
|---|---|---|---|
| `/asana-simulate` | `<dispatch>` | analyst+ | (ops) |
| `/asana-replay` | `<idem-key>` | co+ | (ops) |
| `/asana-dead-letter-list` | (none) | mlro+ | (ops) |
| `/asana-dead-letter-drain` | `<entry-id>` | co+ | (ops) |
| `/asana-schema-migrate` | (none) | co+ | (ops) |
| `/asana-health` | (none) | analyst+ | (ops) |

## Reporting skills

| Skill | Args | Permission | Anchor |
|---|---|---|---|
| `/report-cdd` | `<entity>` | analyst+ | Cabinet Res 134/2025 Art.7-10 |
| `/report-edd` | `<entity>` | mlro+ | Cabinet Res 134/2025 Art.14 |
| `/report-ubo` | `<entity>` | analyst+ | Cabinet Decision 109/2023 |
| `/report-incident` | `<incident-id>` | mlro+ | Cabinet Res 71/2024 |
| `/report-quarterly` | `<quarter>` | co+ | MoE Circular 08/AML/2021 |
| `/report-annual` | `<year>` | co+ | MoE Circular 08/AML/2021 |

---

## Permission roles

| Role | Examples |
|---|---|
| `analyst+` | analyst, mlro, co, board |
| `mlro+` | mlro, co, board |
| `co+` | co, board |

Permission is checked via `context.authorGid` against the Asana
custom field `Role` on the user's profile task. If the role is
insufficient, the runner posts:

```
🚫 /<skill> denied
You need <required-role> permission. Your role: <actual-role>.
Contact your CO if you need elevated access.
```

The denial is logged to `audit:skill-denial:*`.

---

## Adding a new skill runner

1. Define the runner function:
   ```typescript
   // src/services/asana/skillRunners/myNewSkill.ts
   export async function myNewSkill(
     ctx: SkillContext,
     args: string
   ): Promise<SkillResult> {
     // validate args
     // check permission
     // execute
     // return { ok, summary, details, link? }
   }
   ```
2. Register it in `skillRunnerRegistry.ts`:
   ```typescript
   import { myNewSkill } from './skillRunners/myNewSkill';
   export const skillRunnerRegistry = {
     // ...
     'my-new-skill': {
       runner: myNewSkill,
       permission: 'analyst+',
       regulatory: 'FDL Art.X',
     },
   };
   ```
3. Add a row to this file under the right section.
4. Add a row to `hawkeye-sterling-v2/SKILLS.md` under "Compliance Skills".
5. Add a test under `tests/asana/skills/<my-new-skill>.test.ts`.
6. Cite the regulatory anchor in the commit message.

---

## Skill execution audit log

Every skill execution writes:

```
audit:skill:<tenantId>:<authorGid>:<epochMs>
{
  skill: 'screen',
  args: 'subject-name',
  authorGid: 'user-gid',
  taskGid: 'task-gid',
  caseId: 'case-id',
  result: 'ok' | 'denied' | 'error',
  durationMs: 412,
  timestamp: '2026-04-15T04:30:00Z',
}
```

Retention: forever (FDL Art.24, 10-year minimum).

---

## Testing

Tests cover, per skill:

- Happy path with valid args
- Permission denial for insufficient role
- Args validation failure
- Skill not found path
- Audit log entry written
- Reply story posted via orchestrator
- Self-approval rejected (for break-glass-approve)

The skill test fixture lives in `tests/asana/skills/_fixture.ts`.
