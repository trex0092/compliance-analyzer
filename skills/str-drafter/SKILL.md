# /str-drafter — goAML XML STR / SAR / CTR / DPMSR / CNMR drafter

Specialist supporting agent that generates FIU-schema-valid goAML
XML drafts from a disposition payload + the full evidence bundle.
The MLRO + a second approver both sign before submission.

## Usage

```
/str-drafter <eventId> [--kind=STR|SAR|CTR|DPMSR|CNMR]
```

## Inputs
- `eventId` · `dispositionPayload` · `evidenceBundleRef`

## Outputs
- `goamlXml` (UAE FIU schema-validated)
- `validationReport` (schema errors per XPath)
- `filingDeadlineCountdown` (wall clock per FDL Art.26-27)

## Asana target
`str_cases` board.

## Guards
- XML is VALIDATED against the UAE FIU schema before the MLRO signs.
- MLRO + second approver both required (FDL Art.20-21, Cabinet Res
  134/2025 Art.19).
- Subject is NEVER notified (FDL Art.29).
- Draft retained 10 years (FDL Art.24) in `str-deadline-audit` blob.

## Regulatory basis
- FDL No.10/2025 Art.26-27 — file without delay
- Cabinet Res 74/2020 Art.6 — CNMR within 5 business days
- goAML Schema (UAE FIU)

## Related agents
- `/four-eyes-arbitrator` — second-approver gate
- `/evidence-assembler` — attaches the supporting bundle
- `/citation-agent` — annotates every narrative claim with the
  regulation that authorises it
