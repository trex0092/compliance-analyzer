# /evidence-assembler — Audit-pack zip composer

Specialist supporting agent that composes the single-customer
audit-pack zip produced by `/evidence-bundle`. Collects screening
runs, dispositions, Asana threads, reports, brain payloads,
correctness logs, regulatory map, and chain-of-custody.

## Usage

```
/evidence-assembler <subjectCode> [--for=moe|lbma|cbuae|internal|legal]
```

## Inputs
- `subjectCode` · `forInspection`

## Outputs
- `bundleZipBlobKey` (Netlify Blob)
- `manifestJson` (SHA-256 per file + bundle fingerprint)
- `bundleFingerprint` (auditor reconciliation key)

## Asana target
`audit_inspection` board.

## Guards
- Manifest SHA-256 fingerprint stamped on every bundle.
- Bundle blob retained 10 years (FDL Art.24).
- MLRO signature required before release to external auditor.
- Bundle NEVER includes raw subject data accessible to other tenants.

## Regulatory basis
- FDL No.10/2025 Art.24 — 10-yr retention
- LBMA RGG v9 Step 5 — annual independent audit evidence pack
- Cabinet Res 71/2024 — MoE inspection + penalty regime
- UAE PDPL Art.6(1)(c) · ISO/IEC 27001 A.12.4 · ISO/IEC 42001 §9

## Related agents + skills
- `/timeline-agent` — orders the manifest chronologically.
- `/evidence-bundle` — the user-facing export skill that invokes
  this agent.
- `/audit-pack` — cross-entity version of this flow.
