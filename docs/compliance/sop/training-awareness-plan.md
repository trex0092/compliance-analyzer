# AML/CFT/CPF Training and Awareness Plan

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular
or Cabinet Resolution affecting training obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This Plan sets out how the firm meets its obligation to train
and continuously make aware every person whose role carries
AML/CFT/CPF responsibilities, so that knowledge matches the
obligations of the regulations in force at the time of action.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Article 20(4) (training
  duty of the Compliance Officer / MLRO), Article 21 (CO
  responsibilities).
- Cabinet Resolution 134 of 2025, Article 19 (internal review
  and training).
- MoE Circular 08/AML/2021 (DPMS sector training expectations).
- FATF Recommendation 18 (Internal controls and foreign
  branches: training).

This Plan operates alongside, and does not replace, the
entity-level AML/CFT/CPF Policy and the operational SOPs. Each
SOP's own training section references this Plan for the
mechanics.

## 2. Scope — who is trained

Every person in any of the following roles receives training
under this Plan:

1. MLRO and Backup MLRO.
2. Compliance Officer.
3. Senior Management.
4. Board members (compliance-focused induction + annual
   refresher).
5. Front-office and Operations staff who handle customers,
   counterparties, or transactions.
6. Engineering staff who maintain compliance code paths, risk
   scoring, sanctions ingest, STR generation, or the audit
   chain.
7. Interim or contract staff in any role above.

Out of scope: purely administrative staff with no access to
customer or transaction data. If their scope changes, they
come into scope.

## 3. Curriculum structure

Training is delivered in four tracks. Each person takes at
least the baseline track; role-specific tracks stack on top.

### 3.1 Baseline — all in-scope staff

- UAE AML/CFT/CPF legal landscape: FDL No.10/2025, Cabinet
  Resolutions 134/2025 / 74/2020 / 156/2025, Cabinet Decision
  109/2023, MoE Circular 08/AML/2021.
- Predicate offences considered under UAE law.
- Roles and responsibilities under the entity AML/CFT/CPF
  Policy.
- The FDL Art.29 tipping-off prohibition.
- How to raise an internal alert.
- The ten-year record retention requirement (FDL Art.24).

### 3.2 Operational track — Front-office, Operations

- The CDD SOP tier matrix (SDD/CDD/EDD) and what triggers each.
- The AED 55,000 DPMS threshold and the AED 60,000 cross-border
  threshold.
- The 25% UBO threshold and the 15-working-day UBO
  re-verification deadline.
- Red flags by DPMS product (cash intensity, CAHRA gold,
  VASP exposure, rapid in-out).
- The scripted neutral response on any alert-driven action
  visible to the subject.
- How to escalate suspicions to the CO.

### 3.3 Compliance track — CO, MLRO, Backup MLRO

- Full coverage of every operational SOP: Sanctions, CDD, EDD,
  STR, Record Retention, Ongoing Monitoring.
- The match-confidence decision tree (Sanctions SOP Section 6).
- The 24-hour EOCN freeze deadline and the 5-business-day
  CNMR filing deadline (Cabinet Res 74/2020 Art.4-7).
- The 10-business-day STR filing deadline and the 15-business-
  day DPMSR / CTR deadlines.
- The PEP definition under Cabinet Res 134/2025 Art.14
  including family and close associates.
- goAML XML submission mechanics and validation via
  `src/utils/goamlValidator.ts`.
- LBMA RGG v9 5-step framework for gold counterparties.
- Cross-border reporting and strategic-goods screening under
  Cabinet Res 156/2025.
- Monthly calibration review of dismissed alerts.

### 3.4 Governance track — Senior Management, Board

- The firm's risk appetite under Cabinet Res 134/2025 Art.5.
- Their approval authorities: EDD at score >= 16, domestic PEP
  (Senior Management), foreign PEP (Board recorded vote).
- Reading an EDD memo and an STR decision memo.
- The Cabinet Res 134/2025 Art.18 change-notification trigger
  for CO / MLRO / Backup MLRO changes.
- Quarterly compliance reports they receive and what "red"
  looks like in each report.

### 3.5 Engineering track — compliance-code maintainers

- `src/domain/constants.ts` is the single source of truth for
  regulatory values. `tests/constants.test.ts` version-locks
  them.
- The "graph first, files second" rule and the other
  token-efficient workflow rules from CLAUDE.md.
- The tamper-proof hash-chain audit trail at
  `src/utils/auditChain.ts`.
- The advisor strategy: when the executor model escalates to
  the Opus advisor (six triggers in CLAUDE.md §1).
- The "never --no-verify" rule and the other golden rules
  from CLAUDE.md §9 Error Recovery Playbook.
- The read-only versus write-mode subagent discipline from
  CLAUDE.md §10.

## 4. Delivery cadence

| Event | Delivery |
|---|---|
| On appointment to any in-scope role | Full track completion within 10 business days. No substantive compliance action taken by the individual until completion is recorded. |
| Annually | Full refresher on the individual's track. Completion within the individual's anniversary month. |
| Within 30 days of any new MoE circular or Cabinet Resolution affecting the firm's obligations | Targeted briefing plus policy / SOP delta summary. |
| Within 14 days of a material firm-wide compliance incident | Lessons-learned briefing across all affected tracks. |
| Within 7 days of a sanctions-list methodology change (UN, OFAC, EU, UK, UAE, EOCN) | Compliance-track and Engineering-track briefing. |

On-demand briefings may be added by the MLRO.

## 5. Delivery format

- **Baseline and Operational tracks**: recorded video module
  plus multiple-choice test, minimum 80% pass. Retake required
  on failure within 5 business days.
- **Compliance track**: live MLRO-led session plus scenario
  walk-throughs. Written case-study response required.
- **Governance track**: live MLRO briefing at the next Board
  or Senior Management meeting. Written Q&A captured in the
  minutes.
- **Engineering track**: live MLRO / CTO joint session plus
  pair-review of a compliance-code PR.

Attendance is documented for every session. Tests are
retained for ten years under record class 8 of the Record
Retention SOP.

## 6. Content sources

All content is sourced from, and kept consistent with:

- The entity-level AML/CFT/CPF Policy.
- The operational SOPs (Sanctions, CDD, EDD, STR, Record
  Retention, Ongoing Monitoring).
- The regulatory knowledge section in `CLAUDE.md`.
- The current constants in `src/domain/constants.ts`.
- The current signed MoE circulars and Cabinet Resolutions.

On any source-of-truth change, the affected training module
is updated within 30 days and the delivery cadence rule in
Section 4 triggers a re-briefing.

## 7. Records

Per the Record Retention SOP, training records are retained
for ten years under record class 8. Records include:

1. Individual's name and role.
2. Track(s) taken.
3. Content version delivered.
4. Attendance evidence (video completion, live attendance log).
5. Test result and retake history.
6. MLRO sign-off on completion.

Records are filed in the tenant's Asana KYC / CDD Tracker
compliance project and mirrored to the tamper-proof hash-chain
audit trail at `src/utils/auditChain.ts`.

## 8. Evidence artefacts per training event

Every training event produces and persists:

1. Event ID.
2. Date, trainer, attendees, track(s).
3. Content version reference.
4. Attendance and test results.
5. MLRO sign-off.

## 9. Quality assurance

- Pass rate per track is reviewed by the MLRO each quarter.
  Sub-90% pass rate on a track triggers content revision and
  a targeted re-briefing.
- Spot tests: the MLRO runs an unannounced competency check
  on one in-scope role each quarter (for example, the
  scripted neutral response for front-office under FDL
  Art.29). Results are logged.
- The Board receives a quarterly training summary covering
  appointments, completions, refreshers, ad-hoc briefings,
  outstanding items, and pass rates.

## 10. Interaction with other SOPs and skills

- Every operational SOP references this Plan for the
  mechanics of Section 13 of that SOP.
- The Record Retention SOP governs the 10-year retention of
  training records.
- `/audit` — the quarterly compliance audit checks that all
  in-scope staff have current training.
- `/moe-readiness` — the pre-inspection readiness check
  includes training coverage.
- `/traceability` — maps each training module to the
  regulatory requirement it covers.

## 11. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to
the regulatory basis cited in Section 1.
