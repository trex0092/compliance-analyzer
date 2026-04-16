# Records Retention Schedule — Gramaltin AS

Issuing officer: Luisa Fernanda, MLRO
Document date: 16/04/2026
Review date: 16/04/2027 or within 30 days of any new MoE circular
Version: 1.0

## 1. Scope

Gramaltin AS is the firm's cross-border trading counterparty entity.
It settles international bullion and refined-metal transactions with
refiners and dealers outside the UAE. This schedule therefore pays
particular attention to cross-border evidence, correspondent records,
and transfer documentation that UAE inspectors and counterparty
jurisdictions may both request.

The schedule covers every record the entity creates or receives in
connection with counterparties, cross-border transactions, sanctions
screenings, regulatory filings, and internal controls. It applies to
records held on the firm's infrastructure (HAWKEYE STERLING, Netlify
Blobs, ERP, GitHub) and to correspondence held in the firm's email
archive.

## 2. Data categories

1. Counterparty KYC — legal-entity identifiers, trade licences,
   group-structure charts, UBO declarations, beneficial-ownership
   evidence.
2. Cross-border transactions — bills of lading, airway bills, export
   declarations, customs filings, invoices, assay certificates.
3. Correspondent banking and settlement — SWIFT messages, payment
   instructions, settlement confirmations, bank statements, currency
   conversion records.
4. Sanctions screening — full-list checks against UN, OFAC (including
   secondary sanctions exposure), EU, UK, UAE and EOCN lists, plus
   relevant export-control screenings under Cabinet Resolution 156/2025.
5. Filings — any CNMR, TFS notification, export-control disclosure, or
   STR produced in connection with the counterparty.
6. Audit logs, four-eyes approvals, policy versions, brain telemetry
   (as for other entities in this pack).

## 3. Storage location by category

| Category | Primary | Secondary / mirror |
|---|---|---|
| Counterparty KYC | Internal secure drive | HAWKEYE Netlify Blobs |
| Cross-border transactions | ERP + scanned customs file | HAWKEYE case file |
| Correspondent records | Bank portal export + email archive | HAWKEYE case file |
| Screenings (all lists) | HAWKEYE STERLING database | Netlify Blobs snapshot |
| Filings | goAML archive | HAWKEYE case file, Asana task |
| Audit logs | HAWKEYE append-only log | Weekly export to Netlify Blobs |
| Four-eyes approvals | HAWKEYE signature store | Audit-log cross-reference |
| Brain telemetry | HAWKEYE run database | Anthropic tenant logs (30 days) |

Email correspondence with correspondent banks and foreign counterparties
is archived in a dedicated, write-once mailbox so that export-control
and sanctions inspectors can be given a read-only view without exposing
unrelated internal mail.

## 4. Retention period

Ten years minimum in all cases, per Article 24 of FDL No. 10 of 2025.
For dual-use and strategic-goods records governed by Cabinet Resolution
156/2025 the firm applies the longer of ten years or any period
specified in that Resolution's implementing guidance. Bills of lading
and customs declarations are also retained for ten years to satisfy
UAE Customs inspection practice. Where a counterparty jurisdiction
requires a longer period and the firm holds a duplicate for compliance
reasons, the longer period applies for that copy.

## 5. Legal basis

Article 24 of FDL No. 10 of 2025 is the floor. Cross-border activity
additionally engages Cabinet Resolution 74/2020 (TFS), Cabinet
Resolution 156/2025 (proliferation financing and dual-use controls),
and FATF Recommendation 16 on wire transfers. The lawful basis for
processing personal data belonging to counterparty officers during
retention is compliance with a legal obligation under UAE PDPL Article
7, together with the firm's legitimate interest in maintaining a
cross-border audit trail.

## 6. Deletion authority

No record may be deleted until the retention floor has been reached.
Deletion requires written proposal from the MLRO, countersignature
from the Compliance Officer, and, because of the cross-border nature
of the entity, a confirmation from the Board representative that no
foreign regulator has an outstanding request touching the record.

## 7. Disposal procedure

Digital records: cryptographic erasure of the encryption key, followed
by a hard delete and an audit entry. For SWIFT and correspondent-bank
exports, the original bank-side record is treated as the authoritative
copy and the firm's own copy is destroyed; the audit entry records
that the authoritative copy remains at the bank. Paper records:
cross-cut shredding with a two-officer witness and a destruction
certificate.

## 8. Legal hold

A legal hold is triggered by: an active UAE investigation; a court
order in any jurisdiction; a sanctions freeze under Cabinet Resolution
74/2020; a pending inspection by UAE MoE, UAE Central Bank, UAE
Customs, or the Executive Office for Anti-Money Laundering and
Countering the Financing of Terrorism; or a credible request from a
foreign regulator where cooperation is expected under the UAE's
mutual-legal-assistance framework. The hold suspends all deletion and
is recorded in the audit log.

## 9. Cross-border-specific notes

For every cross-border transaction the firm retains, inside the ten-year
window: (a) the full originator and beneficiary details required by
FATF Recommendation 16; (b) the customs and shipping paperwork; (c)
the screening outcome on all sanctions and export-control lists in
force at the time; (d) the internal risk assessment note justifying
the transaction. This is held together as a single bundle per
transaction so that inspectors do not need to reassemble it from
disparate systems.

## 10. Signatures

MLRO
Name: Luisa Fernanda
Signature: ____________________
Date: ____________________

Compliance Officer
Name: [CO Full Legal Name]
Signature: ____________________
Date: ____________________

Board representative
Name: [Board Member Full Legal Name]
Signature: ____________________
Date: ____________________
