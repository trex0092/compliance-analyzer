# /evidence-bundle — One-click export of the complete audit evidence pack

Assemble every artefact tied to a single screening / disposition / STR
into one deterministic, auditor-ready bundle: the screening run payload,
the Asana run task, the Asana disposition task, the Life-Story markdown
report, the compliance-report PDF, the brain reasoning chain, the
Reasoning Console snapshot, the Opus advisor transcript, the snapshot-
hashes for every sanctions list screened against, and a manifest
signed with the evidence fingerprint.

## Why this skill exists

MoE inspections, LBMA independent audits, internal audit, CBUAE thematic
reviews, and external counsel responding to a subpoena all ask the
same question: "give me everything you had on this customer at the
moment you made the decision." Today that answer lives in eight
places (Asana · Netlify Blobs · browser-side PDF · goAML schema · the
brain audit-seal · localStorage verdict history · the life-story
markdown · the advisor transcript). This skill fuses them into one zip
so the MLRO exports once and the auditor reads once — no inter-system
reconciliation, no missing artefact, no denial of evidence.

## Usage

```
/evidence-bundle <customer-code-or-runId>
/evidence-bundle <customer-code> --since=<iso-date>
/evidence-bundle <customer-code> --for-inspection=<moe|lbma|cbuae|internal|legal>
```

## Bundle contents

```
evidence-bundle-<customerCode>-<timestamp>.zip
├── 00_manifest.json         # {version, customerCode, generatedAt,
│                            #  fingerprint, contentsHashes, mlroSig}
├── 01_screening_runs/
│   ├── <runId>.json         # Request + response from /api/screening/run
│   └── …                    # One file per run in scope
├── 02_dispositions/
│   ├── <eventId>.json       # MLRO disposition payload (outcome +
│   └── …                    # rationale + four-eyes attestation)
├── 03_asana/
│   ├── run-<gid>.json       # Asana run task snapshot
│   ├── disposition-<gid>.json
│   ├── tm-alerts/           # All TM alert tasks for this customer
│   └── deltas/              # Watchlist + sanctions-delta alerts
├── 04_reports/
│   ├── life-story.md        # Life-Story deep-dive markdown
│   ├── compliance-report-<eventId>-<outcome>.pdf
│   ├── str-draft-<id>.xml   # goAML STR/SAR/CTR XML (if filed)
│   └── cnmr-<id>.xml        # CNMR XML (if filed)
├── 05_brain/
│   ├── weaponized-<runId>.json   # 19-subsystem verdict + clamps
│   ├── deepBrain-<runId>.json    # reasoning chain + posteriors
│   ├── advisor-transcript-<runId>.json
│   └── reasoning-console-<runId>.html  # Full reasoning console render
├── 06_correctness/
│   ├── snapshot-hashes.json      # SHA-256 per list per run
│   ├── consistency-checks.json   # /decision-consistency-check outputs
│   └── freshness-gate-log.json   # /snapshot-freshness-gate per run
├── 07_regulatory/
│   ├── citations.json            # Article-by-article citation map
│   ├── constants-version.json    # REGULATORY_CONSTANTS_VERSION at run
│   └── traceability-matrix.csv   # /traceability output for this case
└── 08_chain-of-custody/
    ├── access-log.json           # Every MLRO action on this customer
    ├── four-eyes-attestations.json
    └── zk-audit-seal.json        # Anchored audit-trail hash
```

## Instructions

### Step 1 · Resolve scope
1. Given a customer code, collect every runId, eventId, Asana GID, and
   filing ID tied to that code from the verdict-history store, Asana
   tag search, and Netlify Blob indexes.
2. Given a runId, collect the single run + its disposition + the Asana
   thread it belongs to.

### Step 2 · Fetch + hash
For each artefact, read the authoritative copy and compute SHA-256.
Write into the correct folder above.

### Step 3 · Compose the manifest
```
{
  "version": 1,
  "customerCode": "FGL-0284",
  "generatedAt": "2026-04-20T12:47:11.342Z",
  "forInspection": "moe",
  "mlroName": "<reviewer>",
  "mlroSignedAt": "<iso>",
  "fingerprint": "3f2a9c7d4e8b1a2c",
  "contentsHashes": { "<path>": "<sha256>", … },
  "regulatoryConstantsVersion": "<REGULATORY_CONSTANTS_VERSION>",
  "brainVersion": "<weaponized-brain-version>",
  "bundleSha256": "<sha256-of-zip>"
}
```

### Step 4 · Emit + archive
- Write the zip to Netlify Blobs under
  `evidence-bundles/<customerCode>/<timestamp>.zip`.
- Post a new Asana task with tag `evidence-bundle` linking to the blob
  URL, the inspection type, and the manifest summary.
- Retain 10 years (FDL Art.24).

## Regulatory basis

- FDL No.10/2025 Art.24 — 10-yr retention of all compliance records
- FDL No.10/2025 Art.20-21 — CO must be able to produce evidence on demand
- Cabinet Res 71/2024 — MoE inspection + penalty regime
- LBMA RGG v9 Step 5 — annual independent audit evidence pack
- FATF Rec 22-23 — DNFBP record-keeping
- UAE PDPL Art.6(1)(c) — legal-obligation processing basis for retention
- ISO/IEC 27001 Annex A.12.4 — evidence preservation
- ISO/IEC 42001 §9 — AI-management system audit evidence

## Related skills

- `/audit-pack` — broader cross-entity audit; `/evidence-bundle` is
  the single-customer granular cousin.
- `/moe-readiness` — 25-item MOE inspection-readiness check; this
  bundle is the deliverable the readiness check validates.
- `/filing-compliance` — proves STR/CTR/CNMR filed on time; the
  filings themselves land in this bundle's `04_reports/`.
- `/timeline` — chronological trail; this bundle is the forensic
  counterpart that includes the artefacts, not just the events.
- `/traceability` — maps every regulation → code + test + evidence;
  this skill produces the `evidence` column.
