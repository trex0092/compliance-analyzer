# Hawkeye Sterling — Module Catalog

Extracted from the live site at `hawkeye-sterling-v2.netlify.app`.
Machine-readable version: `modules.json`.

Fifteen operational modules are exposed across four landing pages.
Each module is a card on a landing page and opens in an inline
iframe via `module-viewer.js`.

## 1. Screening Command — `/screening-command`

Section: Operational Surfaces · 4 modules.

### 01 · Subject Screening 🔍
- Route: `screening` · Slug: `subject-screening`
- URL: `/screening-command/subject-screening`
- Multi-modal fuzzy matching (Jaro-Winkler + Levenshtein + Soundex +
  Double Metaphone + token-set) against UN, EOCN, OFAC, EU, UK and
  adverse-media. Four-eyes MLRO disposition on every partial /
  confirmed match.
- Stats: `6+` Lists screened · `24h` EOCN freeze
- Regulatory basis: FDL No.10/2025 Art.20-21 · Cabinet Res 74/2020 Art.4-7

### 02 · Transaction Monitor 💸
- Route: `transaction-monitor` · Slug: `transaction-monitor`
- URL: `/screening-command/transaction-monitor`
- Rule-based + behavioural engine: structuring near AED 55K, velocity
  spikes, third-party payers, offshore routing, round-number +
  price-gaming patterns. Critical alerts auto-open an Asana case.
- Stats: `AED 55K` DPMS CTR · `AED 60K` Cross-border
- Regulatory basis: MoE Circular 08/AML/2021 · Cabinet Res 134/2025 Art.16

### 03 · STR Case Management 🚨
- Route: `str` · Slug: `str-cases`
- URL: `/screening-command/str-cases`
- STR / SAR / AIF / PEPR / HRCR / FTFR case files with red-flag
  taxonomy, suspicion narrative, goAML reference, and four-eyes
  approval. File without delay upon suspicion arising. No tipping off.
- Stats: `goAML` XML schema · `Without delay` Filing SLA
- Regulatory basis: FDL No.10/2025 Art.26-27 · FDL No.10/2025 Art.29

### 04 · Active Watchlist 📡
- Route: `watchlist` · Slug: `watchlist`
- URL: `/screening-command/watchlist`
- Every screened subject auto-enrolled in ongoing monitoring. Two
  scheduled crons per day (06:00 / 14:00 UTC) re-screen the full
  watchlist and push delta alerts to Asana. No opt-out under Art.20-21.
- Stats: `2x/day` Re-screen · `10yr` Retention
- Regulatory basis: FDL No.10/2025 Art.20-21 · FDL No.10/2025 Art.24

## 2. Workbench — `/workbench`

Section: Operations Surfaces · 3 modules.

### 01 · Compliance Tasks 📋
- Route: `asana` · Slug: `compliance-tasks`
- URL: `/workbench/compliance-tasks`
- Every MLRO task, assignment, and deadline tracked against the
  responsible owner. Syncs with Asana and the goAML filing calendar;
  every status change audit-logged.
- Stats: `12` Open · `Asana` Sync
- Regulatory basis: FDL No.10/2025 Art.24

### 02 · Onboarding 👤
- Route: `onboarding` · Slug: `onboarding`
- URL: `/workbench/onboarding`
- KYC / CDD / EDD wizard for new customers and counterparties.
  Runs the risk-scoring engine, PEP + sanctions screen, and UBO
  capture — routes high-risk cases to senior-management approval.
- Stats: `4` In review · `EDD` Senior mgmt
- Regulatory basis: Cabinet Res 134/2025 Art.7-10 · Art.14 · Cabinet Decision 109/2023

### 03 · Approvals ✅
- Route: `approvals` · Slug: `approvals`
- URL: `/workbench/approvals`
- Four-eyes approval queue for high-risk decisions — EDD upgrades,
  freeze confirmations, STR filings. Two independent approvers enforce
  the separation of duties required by Cabinet Res 134/2025.
- Stats: `3` Pending · `4-eyes` SoD
- Regulatory basis: Cabinet Res 134/2025 Art.19

## 3. Logistics — `/logistics`

Section: Regulated Surfaces · 4 modules.

### 01 · Inbound Advice 🚚
- Route: `shipments` · Slug: `inbound-advice`
- URL: `/logistics/inbound-advice`
- Every incoming shipment recorded against supplier, invoice, assay,
  and Dubai Customs / Brinks paperwork. Primary control for
  supply-chain traceability.
- Stats: `10yr` Retention · `Auto` Assay log
- Regulatory basis: LBMA RGG v9 · UAE MoE RSG Framework · FDL No.10/2025 Art.24

### 02 · Tracking ✈️
- Route: `tracking` · Slug: `tracking`
- URL: `/logistics/tracking`
- Live in-transit status, ETA, carrier, and custody handovers for
  every shipment on the move. Flags any deviation from the declared
  routing.
- Stats: `Live` Custody · `GPS` Deviation
- Regulatory basis: LBMA RGG v9 (chain of custody) · Dubai Good Delivery

### 03 · Approved Accounts ✅
- Route: `approvedaccounts` · Slug: `approved-accounts`
- URL: `/logistics/approved-accounts`
- Pre-vetted suppliers, refiners, and vault counterparties cleared
  through CDD, sanctions screening, and UBO verification. Gates every
  inbound, in-transit, and local movement to an approved list.
- Stats: `CDD` Vetted · `UBO` >25% register
- Regulatory basis: Cabinet Res 134/2025 Art.7-10 · Cabinet Decision 109/2023

### 04 · Local Shipments 📦
- Route: `localshipments` · Slug: `local-shipments`
- URL: `/logistics/local-shipments`
- Intra-UAE and counter-to-counter transfers — same-day movements
  between branches, refiners, and vault counterparties. Ties into the
  DPMS CTR threshold (AED 55,000).
- Stats: `AED 55K` CTR trigger · `goAML` Auto-file
- Regulatory basis: MoE Circular 08/AML/2021

## 4. Compliance Ops — `/compliance-ops`

Section: Operational Surfaces · 4 modules.

### 01 · Training 🎓
- Route: `training` · Slug: `training`
- URL: `/compliance-ops/training`
- AML/CFT + sanctions + PEP screening curriculum. Attendance logged
  per employee with quiz scores and certificate expiry tracking.
- Stats: `Annual` Cadence · `100%` Coverage target
- Regulatory basis: MoE Circular 08/AML/2021 §9

### 02 · Employees 👥
- Route: `employees` · Slug: `employees`
- URL: `/compliance-ops/employees`
- Employee registry with role, MLRO flag, KYC status, and training
  assignment. Feeds four-eyes approval pool and separation-of-duties
  checks per Cabinet Res 134/2025 Art.19.
- Stats: `RBAC` Access control · `4-Eyes` Approver pool
- Regulatory basis: Cabinet Res 134/2025 Art.19

### 03 · Incidents 🚨
- Route: `incidents` · Slug: `incidents`
- URL: `/compliance-ops/incidents`
- Incident case files — sanctions matches, suspected tipping off,
  breach triage, and root-cause log. Wired to the 24h EOCN +
  5-business-day CNMR countdowns per Cabinet Res 74/2020 Art.4-7.
- Stats: `24h` EOCN freeze · `5bd` CNMR deadline
- Regulatory basis: Cabinet Res 74/2020 Art.4-7 · FDL No.10/2025 Art.29

### 04 · Reports 📊
- Route: `reports` · Slug: `reports`
- URL: `/compliance-ops/reports`
- Regulator-ready reports — goAML STR/SAR/CTR/DPMSR/CNMR XML,
  quarterly DPMS rollups, audit packs, and ad-hoc MLRO digests.
- Stats: `goAML` XML schema · `10yr` Retention
- Regulatory basis: FDL No.10/2025 Art.20 · FDL No.10/2025 Art.24

## Notes

- The main SPA at `/` (`index.html`) exposes additional feature tabs
  from `compliance-suite.js` which are not surfaced as cards on a
  landing page and therefore are not "modules" in the sense this
  catalog uses. Ask if you need those enumerated too.
- Routes on landing cards correspond to the `data-route` attribute,
  which `landing-module-viewer.js` looks up in
  `window.__landingModules[<landing>][<route>]` to decide between
  the native renderer (e.g. `workbench-modules.js`) and the legacy
  iframe fetch fallback.
