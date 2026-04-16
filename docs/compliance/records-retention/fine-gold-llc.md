# Records Retention Schedule — Fine Gold LLC

Issuing officer: Luisa Fernanda, MLRO
Document date: 16/04/2026
Review date: 16/04/2027 or within 30 days of any new MoE circular
Version: 1.0

## 1. Scope

This schedule applies to Fine Gold LLC as a UAE-registered Dealer in
Precious Metals and Stones (DPMS). It covers every record the firm
creates or holds in connection with its customers, transactions,
screening activity, internal controls, and regulatory filings. It
applies to records held on the firm's internal servers, in third-party
platforms (Asana, Netlify Blobs, the HAWKEYE STERLING application,
GitHub, Anthropic), and on any physical storage.

## 2. Data categories

The following eight categories cover the whole record set.

1. Customer KYC — identity documents, trade licences, UBO declarations,
   source-of-funds evidence, risk assessment forms.
2. Transactions — invoices, purchase orders, bullion receipts, cash
   counters, settlement confirmations, goods-in / goods-out logs.
3. Sanctions and PEP screenings — list-hit reports, disposition notes,
   false-positive justifications, re-screening events.
4. STR and related filings — STR, SAR, CTR, DPMSR, CNMR narratives,
   supporting evidence, goAML receipts, MLRO internal assessment notes.
5. Audit logs — every action inside the HAWKEYE STERLING platform,
   every four-eyes approval, every brain decision trace.
6. Four-eyes approvals and signatures — signer identity, timestamp,
   decision context, override reasons where applicable.
7. Policy versions — this schedule, the AML/CFT/CPF policy, the risk
   appetite, MoE circular acknowledgements.
8. Brain telemetry — model identifier, prompt, response, confidence
   score, escalation reason for every HAWKEYE brain invocation.

## 3. Storage location by category

| Category | Primary | Secondary / mirror |
|---|---|---|
| Customer KYC | Internal file server (encrypted) | HAWKEYE Netlify Blobs |
| Transactions | ERP / accounting system | HAWKEYE case file |
| Screenings | HAWKEYE STERLING database | Netlify Blobs snapshot |
| Filings | goAML archive export (ZIP) | HAWKEYE case file, Asana task |
| Audit logs | HAWKEYE append-only log store | Weekly export to Netlify Blobs |
| Four-eyes approvals | HAWKEYE signature store | Audit-log cross-reference |
| Policy versions | GitHub repository (this repo) | PDF archive on file server |
| Brain telemetry | HAWKEYE run database | Anthropic tenant logs (30 days) |

Anthropic logs are short-lived by design and are not treated as a
primary source. The HAWKEYE run database is authoritative.

## 4. Retention period

Every category above is retained for a minimum of ten years from the
date of the last transaction with the customer, or from the date of
creation where no customer is involved. This is the floor set by
Article 24 of Federal Decree-Law No. 10 of 2025. The firm does not
delete any record before the floor, even where a shorter period would
be lawful under data-protection rules.

Policy versions and this schedule itself are retained indefinitely.
Older versions are superseded but never destroyed, so the evolution of
the firm's controls can be reconstructed if an auditor asks.

## 5. Legal basis

The ten-year floor is set by Article 24 of FDL No. 10 of 2025. The
lawful basis for processing personal data within the retention window
is compliance with a legal obligation under Article 7 of Federal
Decree-Law No. 45 of 2021 (UAE Personal Data Protection Law). Cabinet
Resolution 134/2025 Article 19 requires that the firm's own internal
review of these records occurs at least annually. Sector-specific
guidance from MoE Circular 08/AML/2021 applies in full because
Fine Gold LLC trades in precious metals.

## 6. Deletion authority

Records are only deleted after the retention floor has been reached
and only with dual sign-off. The MLRO proposes the deletion in writing,
the Compliance Officer reviews and countersigns, and the deletion is
then executed by IT under a witnessed procedure. The deletion is
itself a record and is retained indefinitely as part of the audit
trail.

## 7. Disposal procedure

For digital records: cryptographic erasure of the encryption key that
protects the record, followed by a delete operation on the blob or
row, followed by a certification note stored in the audit log. For
paper records: cross-cut shredding witnessed by a second officer, with
a destruction certificate signed by both. In both cases the audit log
entry captures the date, the volume destroyed, and the signatures of
the two officers.

## 8. Legal hold

If any record is subject to an active investigation, a pending regulatory
request, an ongoing STR, a court order, or a freeze under Cabinet
Resolution 74/2020, the normal retention rules are suspended. The record
is held until the MLRO confirms in writing, with the Compliance Officer's
countersignature, that the hold has been lifted. No deletion occurs during
a hold. The hold itself is logged in the audit trail.

## 9. Sector notes specific to Fine Gold LLC

As an LBMA-aligned gold trader, the firm additionally retains, for the
same ten-year minimum: refiner due diligence files, CAHRA screenings,
chain-of-custody documentation, and annual responsible sourcing audit
reports in line with LBMA Responsible Gold Guidance v9 and the UAE
MoE Responsible Sourcing of Gold Framework. Dubai Good Delivery
assay certificates are retained for the life of the bar plus ten
years from the date of disposal.

## 10. Signatures

This schedule is only in force once the three signatures below are
complete.

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
