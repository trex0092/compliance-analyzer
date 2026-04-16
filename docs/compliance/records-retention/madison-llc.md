# Records Retention Schedule — Madison LLC

Issuing officer: Luisa Fernanda, MLRO
Document date: 16/04/2026
Review date: 16/04/2027 or within 30 days of any new MoE circular
Version: 1.0

## 1. Scope

Madison LLC is the group's jewellery retail arm. Its record set is
dominated by customer-facing sales, repairs, and occasional old-gold
buy-backs from the public. Compared with the group's trading
entities, Madison sees a higher volume of lower-value transactions
and a larger number of distinct individual customers. This schedule
reflects that shape.

The schedule covers customer KYC, sales and repairs, old-gold
buy-back evidence, sanctions and PEP screenings, filings, training,
and internal controls. It applies across HAWKEYE STERLING, the
point-of-sale and ERP systems, Asana, GitHub, Netlify Blobs, and
Anthropic, and to any physical paperwork kept at the retail
location.

## 2. Data categories

1. Customer KYC — identity documents for any customer above the
   identification threshold, source-of-funds notes for higher-value
   items, and PEP/adverse-media checks.
2. Sales — invoice, serial numbers, hallmark records, assay
   certificates (for investment-grade pieces), delivery and
   collection notes.
3. Old-gold buy-backs — supplier identity, item photographs, weight
   and assay, payment method, and the RF-R16 old-gold verification
   record where applicable.
4. Repairs — intake notes, identity capture where the item value or
   customer profile requires it.
5. Sanctions and PEP screenings, including re-screening events.
6. Filings (STR, SAR, CTR, DPMSR, CNMR) and supporting evidence.
7. Audit logs, four-eyes approvals, policy versions, training
   records, brain telemetry.

## 3. Storage location by category

| Category | Primary | Secondary / mirror |
|---|---|---|
| Customer KYC | Retail CRM + ERP | HAWKEYE Netlify Blobs |
| Sales | POS / ERP | HAWKEYE case file where flagged |
| Old-gold buy-back evidence | ERP + photo archive | HAWKEYE case file |
| Repairs | Repair management system | n/a unless escalated |
| Screenings | HAWKEYE STERLING database | Netlify Blobs snapshot |
| Filings | goAML archive | HAWKEYE case file, Asana task |
| Audit logs | HAWKEYE append-only log | Weekly export to Netlify Blobs |
| Four-eyes approvals | HAWKEYE signature store | Audit-log cross-reference |
| Brain telemetry | HAWKEYE run database | Anthropic tenant logs (30 days) |

Photo archives for old-gold buy-backs are held at original resolution
for the full retention period so that an inspector can verify the
item description against the stored image.

## 4. Retention period

Ten years minimum, per Article 24 of FDL No. 10 of 2025. Repair
intake records are retained for ten years from the completion of the
repair or the collection of the item, whichever is later. Old-gold
buy-back records are retained for ten years from the final disposal
of the bought-back item (either resale, melt, or write-off).

## 5. Legal basis

Article 24 of FDL No. 10 of 2025 sets the floor. MoE Circular
08/AML/2021 applies in full because Madison LLC is a DPMS. Consumer-
protection rules applicable to jewellery retail require additional
retention of hallmark and assay records; where those periods are
longer they prevail. The lawful basis for processing personal data is
UAE PDPL Article 7.

## 6. Deletion authority

Deletion requires written proposal from the MLRO, countersignature
from the Compliance Officer, and a note from the Retail Manager
confirming no open warranty claim, repair, or consumer complaint
touches the record.

## 7. Disposal procedure

Digital records: cryptographic erasure of the encryption key, hard
delete, and a certified audit entry. Paper records (till receipts,
counter notes, old-gold intake forms): cross-cut shredding with a
two-officer witness and a destruction certificate. Photographs of
bought-back items are destroyed in the same audit event as the
underlying transaction record.

## 8. Legal hold

Holds apply for any active investigation, MoE inspection notice,
consumer-court claim, STR, or freeze under Cabinet Resolution 74/2020.
Retail staff are given written notice when a hold is in place that
affects customer-facing documents, so that a customer request for a
copy is routed through the MLRO.

## 9. Retail-specific notes

Hallmark and assay certificates issued at point of sale are retained
for the life of the item plus ten years. Loyalty programme data is
kept within the ten-year AML floor regardless of whether the customer
remains active, because a re-engagement after a dormant period must
be able to draw on the original KYC record.

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
