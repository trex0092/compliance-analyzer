# Sanctions Screening and Targeted Financial Sanctions (TFS) SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 72 hours of any change to a listed
source (UN, OFAC, EU, UK, UAE Cabinet, EOCN).
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This Standard Operating Procedure implements the firm's obligation to
screen all customers, counterparties, beneficial owners, and related
natural persons against the mandatory sanctions lists, and to execute
asset freezes and Targeted Financial Sanctions (TFS) within the
statutory deadlines.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Article 20 (duties of the
  Compliance Officer) and Article 35 (TFS).
- Cabinet Resolution No. 74 of 2020 on the Implementing Regulation
  of Federal Law No. 20 of 2018 Concerning the Regulation of Lists
  of Terrorists and Implementation of UN Security Council Decisions
  Related to Preventing and Countering Financing of Terrorism and
  Leaders of Illegal Organisations and the Financing of the
  Proliferation of Weapons of Mass Destruction (Articles 4, 5, 6, 7).
- Cabinet Resolution No. 156 of 2025 (Proliferation Financing and
  Dual-Use Controls).
- MoE Circular 08/AML/2021 (DPMS Sector Guidance).
- FATF Recommendations 6 (Targeted Financial Sanctions — Terrorism
  and Terrorist Financing) and 7 (Proliferation Financing).

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy filed under `docs/compliance/aml-cft-cpf-policy/`.

## 2. Scope

This SOP covers, for every tenant in scope:

- Onboarding screening (before any transaction is processed).
- Periodic re-screening of existing customers and counterparties.
- Event-driven re-screening on list refresh (UN, OFAC, EU, UK, UAE,
  EOCN).
- Transaction-time screening for ad-hoc counterparties and paying/
  receiving agents.
- Related-party screening (beneficial owners >= 25%, directors,
  authorised signatories, PEPs by association).

Out of scope for this SOP: adverse-media screening (covered in a
separate monitoring SOP) and dual-use / strategic-goods screening
(covered in the PF SOP).

## 3. Roles and authorities

| Role | Authority under this SOP |
|---|---|
| MLRO (Luisa Fernanda) | Confirms or dismisses any potential match. Signs off all freezes. Files CNMR. Writes to EOCN within 24 hours on confirmed matches. Liaises with UAE FIU via goAML. |
| Backup MLRO | Exercises the MLRO's authority when the primary MLRO is unavailable, per the Backup MLRO Appointment Letter. |
| Compliance Officer | Reviews potential matches of confidence 0.5–0.89 before escalation to MLRO. Cannot dismiss a match without written MLRO concurrence. |
| Operations / Front-office | Triggers the screen. Never communicates a match or freeze to the subject. No override of system-flagged matches. |
| Board | Receives quarterly TFS summary. Approves any policy change. |

No role other than the MLRO (or Backup MLRO) may un-freeze an account
once frozen under this SOP.

## 4. Mandatory list coverage

Every screening run MUST evaluate the subject against ALL of the
following lists. A run that skips any list is invalid and MUST be
re-executed.

| # | List | Source | Refresh cadence |
|---|---|---|---|
| 1 | UN Security Council Consolidated List | `https://scsanctions.un.org/` | Daily, plus on-publication |
| 2 | OFAC SDN List | U.S. Treasury | Daily, plus on-publication |
| 3 | EU Consolidated Financial Sanctions List | EU Council | Daily |
| 4 | UK Consolidated Sanctions List | HM Treasury / OFSI | Daily |
| 5 | UAE Local Terrorist List | UAE Cabinet | On-publication |
| 6 | EOCN (Executive Office of the Committee for Goods & Materials Subjected to Import & Export Control) | UAE Cabinet / EOCN | On-publication |

The `src/services/sanctionsIngest.ts` service maintains these feeds.
If the ingest job reports a failed list pull, no new screening run
may complete with a "clean" verdict until the feed is restored and
re-ingested. The run is held in `pending-feed` state and the MLRO
is alerted.

## 5. Screening triggers

A screening run MUST be initiated in each of the following cases:

1. Customer onboarding, before any transaction is accepted.
2. New beneficial owner identified at or above the 25% threshold
   (Cabinet Decision 109/2023).
3. New authorised signatory or director.
4. Ad-hoc counterparty in a transaction (paying or receiving agent).
5. Scheduled re-screening: SDD at 12 months, CDD at 6 months,
   EDD at 3 months, computed from the last successful run.
6. Event-driven re-screening within 72 hours of any change to a
   listed source.
7. Regulator direction (MoE, CBUAE, EOCN, FIU).

## 6. Match handling

Every potential match is assigned a confidence score by the screening
engine. Handling follows the authoritative decision tree in
`CLAUDE.md`:

```
Match confidence >= 0.9 (confirmed)?
  YES -> FREEZE immediately (Section 7)
         Start 24-hour EOCN countdown (checkEOCNDeadline)
         File CNMR within 5 business days (checkDeadline)
         Do NOT notify the subject (FDL Art.29)
  0.5 - 0.89 (potential) -> Escalate to CO within 2 hours
         CO reviews and refers to MLRO within 8 business hours
         MLRO decides: confirm -> FREEZE path
                       or false positive -> document and dismiss
  < 0.5 -> Log and dismiss, document the reasoning
```

False-positive dismissals MUST cite at least two discriminating
factors (date of birth mismatch, nationality mismatch, transliteration
variant ruled out, etc.) and MUST be signed by the CO with MLRO
concurrence for scores in the 0.3–0.49 band.

Under no circumstance may a match of confidence >= 0.5 be dismissed
without written MLRO sign-off stored in `docs/compliance/screening-logs-<month>/<tenant>.md`.

## 7. Freeze procedure (confirmed match, >= 0.9)

On a confirmed match the MLRO (or Backup MLRO) executes, in order:

1. **T+0 minutes** — Place all known accounts, pending transactions,
   open orders, and stored value held for the subject into a
   system-level freeze state. Production systems use the
   `weaponizedBrain` freeze primitive which writes a freeze marker
   to the tenant ledger and halts downstream settlement.
2. **T+0 minutes** — Open an incident via `/incident <subject> sanctions-match`
   which starts the 24-hour EOCN countdown and the 5-business-day
   CNMR deadline simultaneously.
3. **T+1 hour** — Notify the Board (written, no phone) with the
   list reference, the match evidence, and the freeze ledger entry.
4. **Within 24 clock hours** — Submit the freeze notification to
   EOCN using the EOCN prescribed template. Evidence of submission
   stored under `docs/compliance/goaml-filing-reconciliation-<month>/<tenant>.md`.
5. **Within 5 business days** — File the CNMR (Confirmed Name Match
   Report) with the UAE FIU via goAML XML. Validation is performed
   by `src/utils/goamlValidator.ts` before submission.
6. **Ongoing** — Monitor the list daily for any de-listing. On
   de-listing the MLRO (and only the MLRO) authorises the un-freeze.

The 24-hour deadline is calculated in clock hours, not business
hours, per Cabinet Resolution 74/2020 Article 4. The 5-business-day
deadline uses `src/utils/businessDays.ts` — never calendar days.

## 8. No-tipping-off protocol (FDL Article 29)

- No employee, at any level, may communicate to the subject or any
  person related to the subject that a screening match has occurred,
  that an STR has been filed, or that a freeze is in place.
- Customer-facing staff receive a scripted neutral response:
  "Your request is under standard review. Please contact us again
  after [date]." No explanation beyond this script is permitted.
- All internal communications about the match travel through the
  MLRO-only channel (encrypted e-mail, restricted Asana project).
- Any breach of this protocol is a notifiable incident to the Board
  within the same business day and must be logged in
  `docs/compliance/str-decision-log-<month>/<tenant>.md`.

## 9. Record-keeping

Every screening run, match, dismissal, freeze, and un-freeze is
retained for at least ten years from the date of the action, per
Federal Decree-Law No. 10 of 2025 Article 24.

Records kept:

- Full subject payload submitted to the screening engine.
- List snapshots (one per list, at the time of the run).
- Engine decision payload with confidence scores per list.
- MLRO / CO sign-offs with timestamp, user, and decision.
- Downstream artefacts: freeze ledger entry, EOCN filing receipt,
  goAML CNMR XML and FIU acknowledgement.

Storage locations:

- Live working copy: `docs/compliance/screening-logs-<month>/<tenant>.md`.
- Immutable archive: the blob-backed audit trail written by
  `src/services/auditTrail.ts` (verified by the zk-proof audit seal).

## 10. Evidence artefacts produced per run

Every run MUST produce and persist:

1. A screening-run ID (UUID v4, monotonic).
2. The subject payload hash (SHA-256 of the canonicalised JSON).
3. The list snapshot hashes (one per list).
4. The decision object: `{ confidence, list, matched_entity, verdict, reviewer }`.
5. A Markdown summary line appended to the tenant's monthly
   screening log.
6. If a freeze was executed: the freeze ledger entry, the EOCN
   filing payload, and the goAML CNMR XML.

Artefacts 1–5 are produced on every run. Artefact 6 is produced
only on confirmed matches.

## 11. Quality assurance

- The MLRO reviews a random 5% sample of dismissed potential matches
  each month, plus 100% of dismissed matches with confidence >= 0.7.
- Any discrepancy between the engine verdict and the MLRO review
  triggers a calibration incident, logged and reported to the Board
  in the next quarterly pack.
- The Board receives a quarterly TFS report summarising: runs
  executed, matches seen (binned by confidence), freezes placed,
  un-freezes authorised, and deadline performance (% filed within
  24h and 5 business days).

## 12. Interaction with other SOPs and skills

- `/screen` — the slash-command entry point used for any ad-hoc
  screening request. Always used in preference to hand-running the
  engine.
- `/incident <subject> sanctions-match` — the entry point on a
  confirmed match. Starts the statutory countdowns.
- `/goaml` — used to generate the CNMR XML. Never hand-write the
  XML.
- `/multi-agent-screen` — used for bulk or periodic sweeps so that
  all six lists are covered in parallel.
- CDD SOP, EDD SOP, STR SOP — companion SOPs (to be filed
  separately) that share this SOP's record-keeping and no-tipping-off
  requirements.

## 13. Training

Every person named in Section 3 completes, on appointment and
annually thereafter, a documented training module covering:

- This SOP in full.
- The FDL Article 29 tipping-off prohibition.
- The 24-hour EOCN deadline and the 5-business-day CNMR deadline.
- The match-confidence decision tree and the escalation path.

Training records are retained for ten years under the firm's
Records Retention schedule.

## 14. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to a
listed source or to the regulatory basis cited in Section 1.
