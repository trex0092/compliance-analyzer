# Record Retention SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular
or Cabinet Resolution affecting retention obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This SOP defines the records every tenant must keep, the
minimum retention period for each class, the storage
requirements, and the access and disposal protocols.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Article 24 (minimum
  ten-year retention for AML/CFT/CPF records).
- Cabinet Resolution 134 of 2025, Articles 7–10 (CDD records),
  Article 19 (internal review).
- Cabinet Resolution 74 of 2020, Articles 4–7 (TFS actions
  including freezes and notifications).
- MoE Circular 08/AML/2021 (DPMS sector record obligations).
- FATF Recommendation 11 (record-keeping).
- UAE Personal Data Protection Law (FDL No.45/2021) — applies
  to handling of personal data during the retention period and
  at disposal.

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy filed under `docs/compliance/aml-cft-cpf-policy/`.

## 2. Scope

All records created, received, or processed by the firm in the
course of AML/CFT/CPF compliance, customer relationship
management, and transaction processing, in any format (paper,
scanned, native digital), across all six tenants.

## 3. Retention schedule

Minimum ten-year retention applies to every class below (FDL
Art.24). Where another regulation or contract imposes a longer
period, the longer period prevails.

| # | Record class | Examples | Retention clock start | Minimum retention |
|---|---|---|---|---|
| 1 | CDD records | Questionnaire, IDs, address proofs, UBO register snapshot, risk-score payload | Relationship end date | 10 years |
| 2 | EDD records | EDD memo, full evidence pack, approvals, board votes | Relationship end date | 10 years |
| 3 | Transaction records | Ledger entries, invoices, receipts, settlement evidence | Transaction date | 10 years |
| 4 | Sanctions screening records | Run payloads, list snapshots, decision objects, MLRO sign-offs | Run date | 10 years |
| 5 | STR / SAR files | Internal alert, triage memo, MLRO decision memo, narrative, goAML XML, FIU ack | Filing date | 10 years |
| 6 | CTR / DPMSR / CNMR files | Trigger event, goAML XML, FIU ack | Filing date | 10 years |
| 7 | Freeze records | Freeze ledger entry, EOCN notification, CNMR, un-freeze authority | Freeze date | 10 years |
| 8 | Training records | Attendance, test scores, content version | Training delivery | 10 years |
| 9 | Board and management approvals | EDD approvals, PEP approvals, foreign PEP recorded votes, quarterly reports | Approval date | 10 years |
| 10 | Internal audit and regulator correspondence | Supervisory letters, inspection findings, remediation plans | Document date | 10 years |
| 11 | Compliance policies, SOPs, and circular logs | Signed policy PDFs, signed SOP PDFs, circular tracker | Effective date of latest version | 10 years from the date the version is superseded |
| 12 | Change notifications (CO, MLRO, Board) | Filings to MoE under Cabinet Res 134/2025 Art.18 | Filing date | 10 years |
| 13 | System logs relevant to AML | Sanctions ingest logs, audit-chain verifications, goAML submission logs | Log date | 10 years |
| 14 | Personal data subject requests | Data access, rectification, erasure requests | Request handling close | 10 years, subject to UAE PDPL lawful basis |

Retention is MINIMUM. Records MUST NOT be destroyed before the
retention expiry without MLRO written authority.

## 4. Storage requirements

- **Live working copy**: tenant's Asana KYC / CDD Tracker and
  the monthly compliance logs under `docs/compliance/`.
- **Immutable archive**: the tamper-proof hash-chain audit trail
  written by `src/utils/auditChain.ts`. Each event hashes the
  previous event; tampering breaks the chain. Verified by the
  zk-proof audit seal.
- **Encryption at rest**: all records containing personal or
  transaction data encrypted at rest. Key rotation per the
  firm's key-management policy.
- **Encryption in transit**: TLS 1.2+ for any transmission.
- **Access control**: least-privilege. Access logs retained for
  ten years (record class 13).
- **Geographic location**: UAE-residency by default. Any
  storage outside the UAE requires written MLRO approval and
  the data-residency review required by CLAUDE.md for
  third-party integrations.

No production record may be stored on personal devices, in
unapproved cloud accounts, in shared general-access folders,
or communicated outside the MLRO-only channel for STR content.

## 5. Access and disclosure

### 5.1 Internal access

- MLRO and Backup MLRO: full access.
- CO: operational access to live records; no access to
  immutable archive verification keys.
- Senior Management: access to EDD decision records for
  approvals in their scope; no access to STR files.
- Board: summary reports only, unless the MLRO briefs on a
  specific file.
- Operations / Front-office: live operational records needed
  to service the customer; no access to screening or STR
  decision records.

### 5.2 External disclosure

- UAE FIU via goAML, on lawful request or as part of a filing.
- MoE, CBUAE, EOCN on lawful supervisory request, logged.
- Independent auditors under a written confidentiality
  obligation, logged.
- Subject data access / rectification under the UAE PDPL,
  subject to AML confidentiality carve-outs (STR existence is
  NOT disclosable — FDL Art.29).

Every external disclosure is logged: date, recipient,
authority under which disclosed, records disclosed, and
MLRO signature.

## 6. Disposal

- No record may be destroyed before its retention expiry.
- Disposal on expiry requires written MLRO authority and is
  documented in a Disposal Register retained as a permanent
  record.
- Disposal method: cryptographic erasure for digital records;
  cross-cut shredding or equivalent for any paper originals.
- If litigation, investigation, regulator request, or audit is
  pending or expected against a record due for disposal, a
  Legal Hold is placed by the MLRO and the record is retained
  until the hold is released.

## 7. Integrity verification

- The tamper-proof hash-chain audit trail runs integrity
  verification on every new audit event (each event hashes
  the previous).
- The MLRO runs a quarterly sample verification on the chain
  and reports the result to the Board.
- Any chain break is a same-day notifiable incident, including
  forensic investigation to root cause.

## 8. Change notification trigger

Per Cabinet Res 134/2025 Art.18, any change in the MLRO, the
Backup MLRO, or the CO is notified to the MoE within the
prescribed window. The MLRO files the change notification and
stores the filing evidence under record class 12.

## 9. Evidence artefacts per disposal event

Every disposal event MUST produce and persist:

1. Disposal event ID.
2. Record class and unique identifiers of the records disposed.
3. Retention-expiry justification.
4. Method of disposal.
5. MLRO authority signature.
6. Any Legal Hold release, where applicable.

## 10. Quality assurance

- The MLRO reconciles the Asana retention tags against the
  immutable archive every quarter.
- The Board receives a quarterly report covering: records
  created per class, records disposed, pending disposals under
  Legal Hold, any chain-break incident.
- Any record found outside its approved storage location is a
  same-day notifiable incident.

## 11. Interaction with other SOPs and skills

- CDD SOP, EDD SOP, Sanctions SOP, STR SOP — each creates
  records governed by this SOP.
- `/audit-pack <entity>` — assembles an audit pack drawing
  from records under this SOP.
- `/traceability` — maps regulatory requirements to records
  and code, used in MoE inspections.
- `/filing-compliance` — proves filings landed inside the
  retention schedule.

## 12. Training

Every person with record-access authority in Section 5
completes, on appointment and annually thereafter, a
documented training module covering:

- This SOP in full.
- The ten-year minimum retention under FDL Art.24.
- The encryption-at-rest and in-transit requirements.
- The no-disclosure-of-STR prohibition under FDL Art.29.
- The UAE PDPL lawful basis for AML retention.

Training records are themselves retained for ten years under
record class 8.

## 13. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change
to the regulatory basis cited in Section 1.
