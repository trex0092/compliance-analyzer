# Ongoing Monitoring SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular
or Cabinet Resolution affecting monitoring obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This SOP defines how the firm monitors customer relationships
and transactions on an ongoing basis so that suspicion, risk
changes, and threshold events are detected and acted upon in
time.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Articles 12–14 (CDD with
  ongoing obligation), Article 15 (risk-based approach),
  Article 24 (record retention), Article 26–27 (STR obligations
  arising from monitoring).
- Cabinet Resolution 134 of 2025, Article 5 (risk appetite),
  Article 19 (internal review).
- MoE Circular 08/AML/2021 (DPMS thresholds — AED 55,000 cash,
  AED 40,000 cumulative 30-day cash).
- FATF Recommendation 10 (CDD, including ongoing monitoring),
  20 (STRs).

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy. It interoperates with the CDD, EDD,
Sanctions, STR, and Record Retention SOPs.

## 2. Scope

This SOP covers:

- Transaction monitoring across all product lines and channels.
- Periodic and event-driven relationship re-screening.
- Adverse-media monitoring.
- Sanctions list-refresh monitoring (Section 4 of the Sanctions
  SOP governs the screening mechanics).
- Behavioural monitoring (profile deviation, velocity,
  counterparty density, rapid in-out, threshold hugging).
- Gold-specific monitoring: CAHRA jurisdiction changes, LBMA
  RGG v9 audit outcomes, refiner DD refreshes.

Out of scope: initial onboarding CDD (CDD SOP) and EDD decision
mechanics (EDD SOP).

## 3. Roles and authorities

| Role | Authority under this SOP |
|---|---|
| MLRO (Luisa Fernanda) | Owns the monitoring parameter matrix. Approves any parameter change. Signs off on every alert escalated from the CO. |
| Backup MLRO | Exercises the MLRO's authority when the primary MLRO is unavailable, per the Backup MLRO Appointment Letter. |
| Compliance Officer | Runs daily review of the alert queue. Triages within 2 hours of each alert. Cannot dismiss an alert scoring >= 6 without MLRO concurrence. |
| Operations | Feeds transaction data into the monitoring system. Reports any system or feed outage to the CO within 30 minutes. |
| Board | Receives quarterly monitoring summary. Approves any monitoring parameter that materially changes the firm's risk tolerance. |

## 4. Monitoring parameters

Monitoring parameters live in `src/domain/constants.ts` or in
the tenant-specific configuration downstream of it. Parameters
are version-locked by `tests/constants.test.ts`. Changes follow
the Decision-Tree rule in CLAUDE.md under "When modifying risk
scoring logic".

Parameter classes:

### 4.1 Threshold monitors (hard)

- DPMS cash transaction threshold: AED 55,000 single or
  aggregate over 30 days (FDL No.10/2025 Art.16, MoE Circular
  08/AML/2021). Triggers DPMSR / CTR per the STR SOP Section 8.
- Cross-border cash or BNI threshold: AED 60,000 (FDL No.10/2025
  Art.17, Cabinet Res 134/2025 Art.16). Triggers the cross-border
  declaration check and full CDD.
- Cumulative 30-day cash threshold: AED 40,000. Triggers an
  internal alert for profile review.

### 4.2 Behavioural monitors (soft)

- Deviation from declared transaction profile (volume, value,
  velocity) beyond configured multiples.
- Rapid in-out within configured windows.
- Counterparty density spikes (same counterparty repeatedly).
- Structuring candidates (aggregations just under a threshold).
- Geographic anomaly (new jurisdiction not on the declared
  footprint).
- Time-of-day anomaly for cash-intensive businesses.
- VASP / private-wallet exposure increase.

### 4.3 Relationship monitors

- Re-screen cadence by tier (SDD 12mo, CDD 6mo, EDD 3mo) per
  the CDD SOP.
- Event triggers per Section 8 of the CDD SOP.
- Annual or shorter PEP re-verification.
- UBO re-verification within 15 working days on any ownership
  change (Cabinet Decision 109/2023).

### 4.4 External feed monitors

- Sanctions lists: refreshed per the Sanctions SOP Section 4.
- Adverse-media feeds: refreshed daily, escalated by relevance
  score per the firm's adverse-media configuration.
- FATF public statements: reviewed on publication.
- UAE MoE circulars: reviewed on publication; the firm's
  compliance policy is updated within 30 days of a new circular.

## 5. Alert workflow

```
(1) Monitor fires an alert
  |
  v
(2) Alert written to the tenant's monitoring queue
  |
  v
(3) CO triage within 2 business hours
      - attach evidence
      - tag suspected pattern
      - propose dismissal or escalate
  |
  v
(4) MLRO decision within 8 business hours of escalation
      - dismiss with rationale, OR
      - open investigation, OR
      - open STR file (STR SOP takes over), OR
      - open EDD case (EDD SOP takes over)
  |
  v
(5) Outcome recorded in the tenant's monthly screening log
    at docs/compliance/screening-logs-<month>/<tenant>.md
```

A dismissal at step 4 with confidence >= 6 on any soft monitor
MUST cite at least two discriminating factors. Dismissals at
confidence >= 8 require Backup MLRO co-signature within one
week.

No alert may be silently dismissed. Every alert produces an
artefact in the log regardless of outcome.

## 6. Transaction monitoring runs

- Real-time monitors: threshold-driven (DPMS AED 55,000,
  cross-border AED 60,000, sanctions proximity) run inline on
  transaction submission.
- Near-real-time monitors: behavioural (velocity, structuring,
  counterparty density) run on a five-minute cadence.
- Batch monitors: end-of-day reconciliation, profile deviation
  compared to a rolling 30-day baseline, monthly cumulative
  cash aggregation.

Any production monitor run that fails to complete is a
same-day notifiable incident to the MLRO. Until the monitor
is restored, no new transactions in that monitor's scope may
be processed.

## 7. Adverse-media monitoring

- Daily pull across configured feeds for every existing
  customer and counterparty.
- Relevance scoring filters out low-signal hits; the remainder
  flow into the alert queue.
- For gold counterparties, the feed set includes CAHRA watch
  and LBMA RGG v9 audit outcomes.
- Searches in the customer's local language where feasible.

## 8. Sanctions-list-refresh monitoring

Covered in detail by the Sanctions SOP Sections 4–6. Summary:
any list refresh triggers a re-screen of the affected customer
population within 72 hours, and a potential match is handled
by the Sanctions SOP decision tree.

## 9. Monitoring parameter change control

No parameter in Section 4 may be changed without:

1. A written MLRO rationale.
2. Test update in `tests/constants.test.ts` where applicable.
3. Bump of `REGULATORY_CONSTANTS_VERSION` per CLAUDE.md.
4. Board approval for any change that materially shifts the
   firm's alert volume or risk tolerance.
5. Documentation in the monthly monitoring log.

This closes the loop required by CLAUDE.md "When modifying
risk scoring logic" decision tree.

## 10. Evidence artefacts per monitoring cycle

Every monitoring day MUST produce and persist:

1. The run IDs of every monitor executed.
2. Any outages and their resolution.
3. The alert queue snapshot.
4. Every alert outcome (dismissed, escalated, STR-opened,
   EDD-opened) with MLRO / CO sign-off.
5. Any parameter change log entry.

Persistence: live working copy in
`docs/compliance/screening-logs-<month>/<tenant>.md` and
immutable archive in the tamper-proof hash-chain audit trail
written by `src/utils/auditChain.ts`.

## 11. Quality assurance

- 5% random sample of dismissed alerts is MLRO-reviewed each
  month; 100% of dismissed alerts with confidence >= 8 are
  MLRO-reviewed.
- Any calibration issue (false-positive rate, false-negative
  rate) is reported to the Board in the next quarterly pack.
- The Board receives a quarterly monitoring summary:
  transactions processed, alerts raised, alerts dismissed,
  alerts escalated, STRs opened, EDD cases opened, parameter
  changes made, deadline performance.

## 12. Interaction with other SOPs and skills

- CDD SOP — monitoring escalations feed CDD refresh.
- EDD SOP — monitoring escalations may open an EDD case.
- Sanctions SOP — the screening engine feeds alerts into this
  SOP.
- STR SOP — filings originate from alerts escalated here.
- Record Retention SOP — governs 10-year retention of all
  monitoring artefacts.
- `/kpi-report` — quarterly 30-KPI DPMS compliance report
  (MoE, EOCN, FIU).
- `/filing-compliance` — proves filings triggered by monitoring
  landed on time.
- `/audit` — quarterly compliance audit draws heavily from
  this SOP's artefacts.

## 13. Training

Every person named in Section 3 completes, on appointment and
annually thereafter, a documented training module covering:

- This SOP in full.
- The threshold parameters under Section 4.1 and their
  regulatory provenance.
- The alert-workflow decision tree under Section 5.
- The FDL Art.29 tipping-off prohibition (applies to any
  monitoring-driven action visible to the subject).
- The monitoring parameter change-control process under
  Section 9.

Training records are retained for ten years under the Record
Retention SOP.

## 14. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to
the regulatory basis cited in Section 1.
