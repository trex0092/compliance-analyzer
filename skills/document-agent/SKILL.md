# /document-agent — OCR + structured extraction from KYC documents

Specialist supporting agent that reads passports, Emirates IDs,
trade licences, bank statements, bullion assay certificates, and
customs declarations. Emits structured fields with per-field
confidence + flagged anomalies.

## Usage

```
/document-agent <documentBlobKey> [--expect=passport|emirates-id|trade-licence|...]
```

## Inputs
- `documentBlobKey` · `expectedDocType` · `subjectCode`

## Outputs
- `structuredFields` (JSON — name, DoB, document number, issuer…)
- `confidencePerField` (0.0 - 1.0)
- `flaggedAnomalies` (photo tampering, expiry passed, issuer mismatch)

## Asana target
`onboarding_workbench` board.

## Guards
- On-prem / sovereign-resident model for UAE subject data
  (MiniCPM-V gate — provenance + dual-use controls).
- No OCR output leaves the tenant perimeter unencrypted.
- Every document processed under a signed data-processing addendum.
- Confidence < 0.8 on any mandatory field forces re-submission.

## Regulatory basis
- Cabinet Res 134/2025 Art.7-10 — CDD documentary evidence
- FDL No.10/2025 Art.24 — 10-yr retention of extracted fields
- UAE PDPL Art.6(1)(c) — legal-obligation basis

## Related agents
- `/research-agent` + `/life-story-agent` — consume the structured
  output for evidence corroboration.
- `/evidence-assembler` — bundles extracted + original docs together.
