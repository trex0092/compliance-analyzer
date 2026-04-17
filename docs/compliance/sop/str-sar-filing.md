# Suspicious Transaction Report (STR) and Suspicious Activity Report (SAR) SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular,
Cabinet Resolution, or FIU notice affecting STR/SAR obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This SOP governs the identification, investigation, and filing
of Suspicious Transaction Reports and Suspicious Activity
Reports to the UAE Financial Intelligence Unit (FIU) via goAML,
together with the accompanying internal workflow.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Articles 20 (CO duties),
  26–27 (STR filing), 29 (no tipping off), 24 (record retention).
- Cabinet Resolution 134 of 2025, Articles 14, 19 (internal
  review).
- Cabinet Resolution 74 of 2020 (TFS, for overlap with STR
  filings on sanctions-linked activity).
- MoE Circular 08/AML/2021 (DPMS-specific filing guidance:
  AED 55,000 DPMSR threshold via goAML).
- FATF Recommendations 20 (STR), 21 (tipping off and
  confidentiality).

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy filed under `docs/compliance/aml-cft-cpf-policy/`.
It is the companion to the Sanctions SOP, CDD SOP, and EDD SOP
and inherits their no-tipping-off, record-keeping, and escalation
requirements.

## 2. Scope — what must be reported

The MLRO files an STR or SAR when there are reasonable grounds to
suspect that funds or activity are:

1. The proceeds of a predicate offence under UAE law.
2. Linked to terrorism financing or proliferation financing.
3. Linked to sanctions evasion.
4. Structured to avoid a regulatory threshold (AED 55,000 DPMS,
   AED 60,000 cross-border, AED 40,000 cumulative 30-day cash).
5. Otherwise suspicious on professional judgement, even where
   the underlying predicate is not identified.

The standard is "reasonable grounds to suspect" — it does not
require proof, and it does not require a completed transaction.
An attempted transaction, an aborted onboarding, or a refused
instruction can all be STR-worthy.

DPMS-sector-specific mandatory reports under MoE Circular
08/AML/2021:

- **DPMSR (Dealers in Precious Metals and Stones Report)**:
  any cash transaction at or above AED 55,000.
- **CTR (Cash Transaction Report)**: threshold-driven.
- **CNMR (Confirmed Name Match Report)**: sanctions match
  confirmed at confidence >= 0.9 — the Sanctions SOP governs
  the filing path.

## 3. Roles and authorities

| Role | Authority under this SOP |
|---|---|
| MLRO (Luisa Fernanda) | Sole authority to decide whether to file and to sign the STR. Owns the full file until closed. Liaises directly with the UAE FIU. |
| Backup MLRO | Exercises the MLRO's authority when the primary MLRO is unavailable, per the Backup MLRO Appointment Letter. Signs for the MLRO during annual leave or incapacity. |
| Compliance Officer | Receives and triages internal alerts. Escalates within 2 hours of identification. Cannot decide or file. |
| Operations / Front-office | Raises suspicion through the internal alert channel (see Section 5). Never discusses the alert with the subject (FDL Art.29). |
| Senior Management | Receives a quarterly STR summary (anonymised where lawful). Does not see individual files unless the MLRO briefs for a material relationship decision. |
| Board | Receives the quarterly STR summary. Approves any STR-driven exit of a strategically material relationship. |

No role other than the MLRO (or Backup MLRO) may:

- Decide not to file once suspicion is documented.
- Draft or send the goAML submission.
- Close the internal file.
- Discuss the file contents with anyone outside the MLRO
  channel.

## 4. Mandatory list of predicate offences considered

The MLRO evaluates each alert against, at minimum, the UAE AML
predicate-offence list: money laundering, terrorism and its
financing, proliferation financing, corruption, fraud, organised
crime, tax crimes, human trafficking, environmental crime,
sanctions evasion, and any predicate offence designated by
federal or emirate-level law. Absence of a specific predicate
does not defeat an STR — professional suspicion stands on its
own.

## 5. Internal alert channel and triage

1. **Alert sources** — transaction monitoring, sanctions
   screening, adverse-media screening, staff observation,
   external communications, regulator notices.
2. **Front-office or Operations** logs the alert to the
   internal Asana alert project within the same business hour,
   or within 15 minutes for any cash transaction escalating in
   real time.
3. **CO triages** within 2 hours: attaches evidence pack,
   tags predicate candidates, and escalates to the MLRO. The CO
   does not decide.
4. **MLRO decides** within 8 business hours of CO escalation:
   open STR file, dismiss with documented rationale, or direct
   further investigation.
5. **No communication with the subject** — FDL Art.29 applies
   from the moment the alert is logged.

## 6. Investigation

On opening an STR file, the MLRO directs:

- Refresh sanctions, PEP, and adverse-media screens.
- Pull the customer's full transaction history from the firm's
  ledger.
- Pull related counterparties' identifiers, with their own
  screening where they are also customers.
- Request additional documentation from the customer only where
  the request can be framed as routine CDD refresh — never in
  terms that would tip off under FDL Art.29.
- Consider in-house open-source investigation (shell company
  indicators, UBO chain anomalies, adverse media in the
  customer's local language).

Investigation time is not open-ended — see Section 8 deadlines.

## 7. Drafting the STR narrative

The STR narrative is the single most important artefact.
Inspectors and FIU analysts read it first. It must stand alone
without external context.

Mandatory structure:

1. **Subject identification** — legal name, national IDs,
   entity identifiers, goAML ID if known, addresses.
2. **Relationship with the reporting entity** — date opened,
   tier (SDD/CDD/EDD), risk score history.
3. **The suspicion** — what triggered the file, in plain
   English.
4. **The activity** — dates, amounts in AED and in the
   transaction currency, counterparties, product, payment
   method, channel.
5. **Why it is suspicious** — deviation from declared
   transaction profile, threshold evasion pattern, rapid
   in-out, PEP or sanctions proximity, adverse media, etc.
6. **Predicate offence considered** — list the predicates the
   MLRO considered and which one(s) are the closest fit.
7. **Corroboration** — documents, screens, adverse media
   (with source and date).
8. **Actions taken** — account restriction, transaction hold,
   freeze where applicable, exit decision.
9. **Assistance requested** — what the MLRO asks the FIU to
   consider, if anything.

The narrative is fully verbose — per CLAUDE.md Token-Efficient
Output Rules, STR narratives are a non-negotiable carve-out and
must remain fully cited even where terse rules apply.

## 8. Filing deadlines

All deadlines use `src/utils/businessDays.ts` — never calendar
days unless the regulation says clock hours.

| Filing | Deadline | Counter start |
|---|---|---|
| STR / SAR | 10 business days from MLRO decision to file | Decision to file |
| DPMSR (cash >= AED 55,000) | 15 business days from the transaction | Transaction date |
| CTR | 15 business days from the transaction | Transaction date |
| CNMR (confirmed sanctions match) | 5 business days to FIU after 24 clock-hour EOCN notification | Confirmation |

Once a file is opened in the internal channel, the MLRO MUST
decide within 8 business hours of CO escalation whether to open
an STR. Indecision is not an option — the decision itself is
recorded, either way.

## 9. goAML submission

- The goAML XML is generated by the `/goaml` skill. STR XML is
  never hand-written.
- Validation is performed by `src/utils/goamlValidator.ts`
  before submission. A file that fails validation is not
  submitted — the MLRO resolves the error and validates again.
- Submission is made from the firm's registered goAML account.
- The FIU acknowledgement is saved with the file as evidence
  of filing. A filing with no acknowledgement is not closed.
- Where the goAML account is unreachable for more than four
  business hours, the MLRO notifies the FIU by the prescribed
  backup channel and logs the outage.

## 10. No-tipping-off protocol (FDL Article 29)

- The subject is never told that an STR was filed, that one is
  being considered, that an internal alert was raised, or that
  the account is restricted because of AML concerns.
- Customer-facing staff receive the scripted neutral response
  from Section 8 of the Sanctions SOP.
- All STR-related communication inside the firm is MLRO-only
  channel (encrypted email, restricted Asana project, no
  general distribution lists).
- Any breach of this section is a same-day notifiable incident
  to the Board.

## 11. Record-keeping

Every STR file is retained for at least ten years from the date
of filing (FDL Art.24). The retention clock runs from the filing
date, not the date the relationship ends.

Records kept:

- The original internal alert, with source and timestamp.
- The CO triage memo.
- The MLRO decision memo.
- Full investigation evidence pack.
- The final STR narrative.
- The goAML XML and FIU acknowledgement.
- Any subsequent FIU correspondence.
- The monthly STR decision log in
  `docs/compliance/str-decision-log-<month>/<tenant>.md`.

Storage:

- Live working copy: the monthly STR decision log above.
- Immutable archive: the tamper-proof hash-chain audit trail
  written by `src/utils/auditChain.ts`.

## 12. Evidence artefacts per STR

Every filed STR MUST produce and persist:

1. A file ID (UUID v4, monotonic).
2. The investigation evidence pack.
3. The narrative per Section 7.
4. The goAML XML and FIU acknowledgement.
5. Any action taken on the relationship (restriction, hold,
   exit).
6. A Markdown summary appended to
   `docs/compliance/str-decision-log-<month>/<tenant>.md`.

## 13. Quality assurance

- 100% of STR files are MLRO-signed, CO-witnessed, and peer-
  reviewed by the Backup MLRO within 30 days of filing.
- The MLRO reports to the Board each quarter on: files opened,
  files filed, files dismissed (with reasons in aggregate),
  average time to decision, average time to filing, and any
  deadline breach.
- Any deadline breach is investigated to root cause in the
  next week and a remediation action recorded.

## 14. Interaction with other SOPs and skills

- CDD SOP and EDD SOP — feed suspicions into this SOP.
- Sanctions SOP — where a sanctions match is confirmed, the
  Sanctions SOP governs the freeze and CNMR path and this SOP
  governs any collateral STR.
- Record Retention SOP — governs the 10-year retention.
- `/goaml` — the skill that produces STR / SAR / CTR / DPMSR /
  CNMR goAML XML. Never hand-write the XML.
- `/incident <subject> <trigger>` — used when an STR opening
  also triggers a statutory incident countdown.
- `/filing-compliance` — used quarterly to prove all filings
  landed on time.

## 15. Training

Every person named in Section 3 completes, on appointment and
annually thereafter, a documented training module covering:

- This SOP in full.
- The FDL Art.26–27 obligations and Art.29 tipping-off
  prohibition.
- The MoE Circular 08/AML/2021 DPMS thresholds.
- The STR narrative template.
- Case-study walk-throughs for common DPMS predicates.

Training records are retained for ten years under the Record
Retention SOP.

## 16. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to
the regulatory basis cited in Section 1.
