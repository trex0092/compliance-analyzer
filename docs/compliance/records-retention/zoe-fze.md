# Records Retention Schedule — Zoe FZE

Issuing officer: Luisa Fernanda, MLRO
Document date: 16/04/2026
Review date: 16/04/2027 or within 30 days of any new MoE circular
Version: 1.0

## 1. Scope

Zoe FZE is a Free Zone Establishment inside a UAE free zone. Its
records are subject to both the federal AML/CFT/CPF framework and the
free-zone authority's own record-keeping rules. This schedule aligns
the two so that Zoe FZE files one consolidated record set, retained
for the longer of the two applicable periods wherever they differ.

The schedule covers every record the entity creates in connection with
customers, counterparties, inbound and outbound shipments, stock
movements, sanctions screening, filings, training and controls. It
applies to records inside HAWKEYE STERLING, the free-zone authority's
portal exports, the firm's ERP, Asana, GitHub, Netlify Blobs, and
Anthropic, and to any physical records kept on the premises.

## 2. Data categories

1. Customer and counterparty KYC, with free-zone licence copies on
   file.
2. Stock movements inside and across the free-zone perimeter,
   including delivery notes, gate passes, and customs paperwork.
3. Transactions, including intra-group and third-party settlements.
4. Sanctions, PEP, and export-control screenings.
5. Filings (STR, SAR, CTR, DPMSR, CNMR) and any free-zone authority
   reports.
6. Audit logs, four-eyes approvals, policy versions, training records,
   brain telemetry.

## 3. Storage location by category

| Category | Primary | Secondary / mirror |
|---|---|---|
| KYC | Internal file server (Zoe FZE folder) | HAWKEYE Netlify Blobs |
| Stock movements | Free-zone portal export + ERP | HAWKEYE case file |
| Transactions | ERP | HAWKEYE case file |
| Screenings | HAWKEYE STERLING database | Netlify Blobs snapshot |
| Filings | goAML archive + free-zone portal receipts | HAWKEYE case file, Asana task |
| Audit logs | HAWKEYE append-only log | Weekly export to Netlify Blobs |
| Four-eyes approvals | HAWKEYE signature store | Audit-log cross-reference |
| Brain telemetry | HAWKEYE run database | Anthropic tenant logs (30 days) |

Where the free-zone authority's portal allows only a short retrieval
window for filings, the firm exports the filing receipt on the day of
submission and stores the export as the authoritative local copy.

## 4. Retention period

Ten years minimum under Article 24 of FDL No. 10 of 2025. Where the
free-zone authority requires longer (for example, stock-movement
records for companies holding certain regulated activities), the
longer period applies. Where the free-zone requires shorter, the
federal floor still applies.

## 5. Legal basis

Article 24 of FDL No. 10 of 2025, together with the licensing
conditions of the free-zone authority and any regulations it issues,
provides the legal basis for retention. The lawful basis for
processing personal data is UAE PDPL Article 7 (compliance with a
legal obligation). Cabinet Resolution 134/2025 Article 19 drives the
annual review.

## 6. Deletion authority

Deletion is proposed in writing by the MLRO, countersigned by the
Compliance Officer, and — because the entity operates under a
free-zone licence — a note from the Licensing Officer is added
confirming no open free-zone authority matter touches the record.

## 7. Disposal procedure

Digital records: cryptographic erasure of the encryption key followed
by a hard delete and a certified audit entry. Free-zone portal exports
are treated as firm-held copies; the authoritative copy remains with
the free-zone authority. Paper records: cross-cut shredding with a
two-officer witness and a destruction certificate.

## 8. Legal hold

Holds apply in every case of: active UAE investigation, free-zone
authority inquiry, customs or export-control enquiry, open STR, or
freeze under Cabinet Resolution 74/2020. The MLRO logs the hold in
the audit trail and notifies the Licensing Officer so that the
free-zone authority does not receive an inconsistent response if it
separately requests the same record.

## 9. Free-zone-specific notes

Free-zone establishment paperwork (establishment agreement, licence
renewals, lease agreements) is retained for the full life of the
entity plus ten years from dissolution. UBO and shareholder records
are refreshed on every licence renewal and the superseded versions
are retained, not overwritten.

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
