# Records Retention Schedule — Fine Gold Branch

Issuing officer: Luisa Fernanda, MLRO
Document date: 16/04/2026
Review date: 16/04/2027 or within 30 days of any new MoE circular
Version: 1.0

## 1. Scope

Fine Gold Branch operates as a branch of Fine Gold LLC and does not
hold a separate legal personality. This schedule nevertheless treats
the Branch's records as a distinct set for inspection purposes, so
that MoE and internal audit can reconstruct the Branch's activity
without having to filter the parent's data. Any record that is
jointly produced (for example, a consolidated year-end report) is
held against both entities.

The schedule covers every record generated at the Branch in connection
with customers, transactions, screenings, filings, training and
controls. It applies to digital records inside HAWKEYE STERLING, the
firm's ERP system, GitHub, Netlify Blobs, Asana and Anthropic, and to
any paper records kept on the Branch premises.

## 2. Data categories

1. Customer KYC and onboarding evidence generated at the Branch.
2. Transactions settled or booked through the Branch.
3. Sanctions and PEP screening records produced for Branch customers.
4. STR, SAR, CTR, DPMSR, CNMR narratives and filings originating from
   the Branch.
5. Audit logs for every Branch user action inside HAWKEYE.
6. Four-eyes approval records for decisions taken at the Branch.
7. Policy acknowledgements, training attendance sheets and assessment
   results of Branch staff.
8. Brain telemetry for HAWKEYE runs initiated by Branch users.

## 3. Storage location by category

| Category | Primary | Secondary / mirror |
|---|---|---|
| Customer KYC | Shared file server (Branch folder, encrypted) | HAWKEYE Netlify Blobs |
| Transactions | Group ERP, Branch ledger segment | HAWKEYE case file |
| Screenings | HAWKEYE STERLING database, tenant scope | Netlify Blobs snapshot |
| Filings | goAML archive (ZIP) | HAWKEYE case file, Asana task |
| Audit logs | HAWKEYE append-only log | Weekly export to Netlify Blobs |
| Four-eyes approvals | HAWKEYE signature store | Audit-log cross-reference |
| Training records | HR folder on shared drive | PDF archive held by MLRO |
| Brain telemetry | HAWKEYE run database | Anthropic tenant logs (30 days) |

Training records and staff attendance sheets are not held at Fine Gold
LLC parent level and are therefore the sole responsibility of the
Branch MLRO function.

## 4. Retention period

Ten years minimum from the date of the last customer transaction or
from the date the record was created, whichever is later, in line with
Article 24 of FDL No. 10 of 2025. Where a customer of the Branch is
also a customer of the parent, both sides hold the full record set.
Duplication is acceptable and preferred to shared-ownership ambiguity.

Policy versions and this schedule itself are retained indefinitely.

## 5. Legal basis

Article 24 of FDL No. 10 of 2025 sets the ten-year floor. Article 7
of the UAE Personal Data Protection Law provides the lawful basis for
processing personal data during retention. Cabinet Resolution 134/2025
Article 19 requires an annual internal review of records and the
adequacy of storage. MoE Circular 08/AML/2021 applies because the
Branch trades in precious metals as part of Fine Gold LLC's DPMS
activity. Where the parent holds a duplicate, the parent's legal basis
is cross-referenced rather than asserted independently.

## 6. Deletion authority

Deletion is proposed by the Branch MLRO function, reviewed by the
firm-wide MLRO (Luisa Fernanda), countersigned by the Compliance
Officer, and executed by Group IT under a witnessed procedure. A
Branch cannot self-authorise deletion.

## 7. Disposal procedure

Digital records: cryptographic key erasure followed by a hard delete
and a certified audit entry. Paper records: cross-cut shredding with
a two-officer witness and a destruction certificate. For any record
duplicated at parent level, the parent must confirm in writing that
its copy has also been deleted before the disposal is considered
complete at Branch level.

## 8. Legal hold

Active investigations, pending MoE requests, open STRs, court orders,
and freezes under Cabinet Resolution 74/2020 suspend the normal
retention rules. The hold is applied at both Branch and parent
level simultaneously to prevent one copy being destroyed while the
other is under investigation.

## 9. Branch-specific notes

Because the Branch does not hold its own trade licence but operates
under Fine Gold LLC's licence, the firm retains a copy of the licence
document at Branch level as a convenience for inspectors, with a note
that the authoritative copy is at the parent. Refiner due diligence
files, CAHRA screenings and responsible sourcing audit reports produced
at Branch level are also retained for ten years minimum, aligned with
LBMA Responsible Gold Guidance v9.

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
