# /dfsa-adgm-passport — DFSA (DIFC) + ADGM FSRA cross-border passport screening & reporting

Screen a customer, counterparty, transaction, or structure for cross-border
exposure to the UAE's two federal financial free zones — the **Dubai
Financial Services Authority** (DFSA, DIFC jurisdiction) and the **Abu
Dhabi Global Market Financial Services Regulatory Authority** (ADGM FSRA,
ADGM jurisdiction) — and generate the reporting pack that satisfies the
"passporting" / recognition regime between them and onshore CBUAE / SCA
supervision.

## Why this skill exists

DIFC and ADGM are common-law financial free zones that sit OUTSIDE the
UAE federal AML/CFT perimeter for civil and commercial purposes but INSIDE
it for the federal sanctions, STR, and TFS obligations (FDL No.10/2025
applies UAE-wide; Cabinet Res 74/2020 applies to every UAE-licensed
entity regardless of zone). Any customer, counterparty, UBO, or
transaction that touches a DFSA- or ADGM-licensed firm needs a
passporting screen:

1. Which regulator is the home jurisdiction?
2. Is the licence + passport permission actually in scope for the
   activity on offer?
3. Does the DIFC / ADGM gatekeeping regime (DFSA AML Rulebook / ADGM
   AML Rulebook) add obligations on top of the federal UAE floor?
4. Is the counterparty a federally-regulated CBUAE / SCA entity that
   requires cross-border recognition (recognition orders, MoUs, MMoU)?
5. What changes between the onshore federal report and the passported
   report (tax residency, PDPL applicability, court jurisdiction,
   ultimate financial-crime competent authority)?

Missing one of the five makes the compliance report inadmissible to the
home regulator.

## Usage

```
/dfsa-adgm-passport [customer name or code or transaction ID]
```

## Instructions

### Step 1 · Identify the home zone
1. Call `get_minimal_context(task="dfsa-adgm passport screening")`.
2. Resolve the home jurisdiction for the subject:
   - DIFC — DFSA Public Register (`/public-register/firms`)
   - ADGM — ADGM Public Register (`/en/public-registers/`)
   - Onshore UAE — CBUAE / SCA / MoE
3. Record the licence number, licence category, authorised activities,
   and any conditions / restrictions. A dormant / suspended / cancelled
   licence is a HARD STOP — refuse the relationship and file an STR if
   the counterparty presented the licence as active.

### Step 2 · Passport scope check
1. For DIFC-licensed firms, confirm whether the activity is:
   - Accepted under DFSA General Module (GEN) + the Conduct of Business
     (COB) module; or
   - Exempt / excluded under GEN A2.3; or
   - Requires DFSA recognition for the non-DIFC leg (Recognised Member
     / Recognised Body / Recognised Exchange regime).
2. For ADGM-licensed firms, confirm the FSRA Financial Services and
   Markets Regulations (FSMR) permission matches the activity; check
   the FSRA Prudential — Investment, Insurance Intermediation & Banking
   (PRU) rulebook if the activity involves own-balance-sheet risk.
3. Flag any cross-jurisdiction activity — e.g. a DIFC firm dealing
   with a mainland UAE retail counterparty — because the DFSA Client
   Classification regime (COB Chapter 2) forbids some categorisations.

### Step 3 · AML gatekeeping overlay
Both zones carry their own AML rulebook ABOVE the federal floor:

| Topic | DFSA AML Rulebook | ADGM AML Rulebook (FSRA) | Federal UAE (FDL 10/2025) |
|-------|------------------|--------------------------|--------------------------|
| CDD tiering | AML 7 (SDD/CDD/EDD) | AML Ch.7 | Cabinet Res 134/2025 Art.7-10 |
| PEP | AML 7.3 (F/D/IO) | AML 7.3 | Cabinet Res 134/2025 Art.14 |
| Record retention | 6 yr (DIFC Data Prot. Law 5/2020) | 6 yr | 10 yr (FDL Art.24) — LONGER WINS |
| Sanctions | DFSA Notice to Relevant Persons | ADGM Sanctions Guidance | Cabinet Res 74/2020 Art.4 |
| STR | goAML via UAE FIU (zone reports THROUGH UAE FIU) | goAML via UAE FIU | FDL Art.26-27 |
| MLRO | Authorised Individual SEO-4 | Approved Person | FDL Art.20-21 |

Rule of thumb: **when the zone rule and the federal rule differ, apply
the stricter of the two**. The 10-year federal retention ALWAYS wins over
the 6-year zone rule. Sanctions freezes fire on the federal 24-hour
clock regardless of zone.

### Step 4 · Cross-jurisdiction red flags
Screen the subject for the passport-specific red-flag pattern:

- Shell DIFC / ADGM SPV with onshore-mainland UBO but no DIFC/ADGM
  economic substance (Cabinet Decision 57/2020 Economic Substance).
- DIFC Holding-only licence used to book mainland-UAE operating
  activity without a dual licence.
- ADGM tech-sector licence holding custodial crypto without the
  Virtual Asset Regulatory Framework (VARA equivalent in ADGM: FSRA's
  Digital Securities & Virtual Assets rulebook).
- Passporting claim where the home-regulator licence is suspended,
  cancelled, or restricted.
- Use of a free-zone entity to hop a sanctions-prohibited counterparty
  between the federal sanctions list and a non-UAE jurisdiction.

### Step 5 · Compliance report
Generate the report deliverable in three parts:

**Part A — Passport Classification Summary**
```
Subject:          [name + customer code]
Home regulator:   [DFSA / ADGM FSRA / CBUAE / SCA / MoE]
Licence number:   [number + category + status + issue date]
Authorised activities: [list from register]
Passport scope:   [explicit | excluded | recognition required]
```

**Part B — Rulebook Overlay**
Map every applicable AML / CFT / sanctions / prudential rulebook and
pick the stricter rule for each line item (CDD tier, PEP handling,
record retention, STR channel, sanctions freeze clock). Cite the exact
rulebook module for every line.

**Part C — Cross-Jurisdiction Actions**
- If an Economic Substance concern is flagged, open an Asana EDD task
  on the onshore-mainland beneficial owner.
- If the DIFC / ADGM licence is not clean, HOLD the relationship and
  notify the home regulator via the MoU channel.
- If the subject claims recognition status, verify against the DFSA
  recognition register or ADGM Recognised Bodies list.
- If the activity is covered by recognition, record the recognition
  order / passport permission reference in the screening event.
- File an STR WITHOUT DELAY (FDL Art.26-27) if any red flag from
  Step 4 fires, and mirror it to the home regulator's channel when
  the home-regulator rulebook requires a separate notification.

## Regulatory basis

- FDL No.10/2025 (UAE AML/CFT/CPF federal law — Art.20-21 CO duties,
  Art.24 retention, Art.26-27 STR, Art.29 no tipping off, Art.35 TFS).
- Cabinet Res 74/2020 Art.4-7 (freeze + CNMR timeline — applies
  UAE-wide).
- Cabinet Res 134/2025 Art.14 (EDD triggers — applies UAE-wide).
- Cabinet Decision 57/2020 (Economic Substance Regulations).
- DFSA AML Rulebook (AML modules 7-14) + GEN + COB + PIB (prudential).
- ADGM FSRA AML Rulebook + FSMR + Conduct of Business Rulebook (COBS)
  + PRU (prudential).
- DIFC Data Protection Law 5/2020 + ADGM Data Protection Regulations 2021
  vs UAE PDPL (Federal Decree-Law 45/2021) — the stricter rule wins.
- FATF Recommendations 10 (CDD), 12 (PEP), 16 (wire transfers), 22
  (DNFBPs), 26 (supervision), 40 (international cooperation).

## Asana delivery

A passport-screening run creates a task on the same Asana board as the
base `/screen` flow (GID `ASANA_SCREENINGS_PROJECT_GID`), with:

- **Name**: `[PASSPORT: DFSA|ADGM|ONSHORE|MISMATCH] <customer code> · <name>`
- **Tags**: `passport-screen`, home regulator, licence status, any
  red-flag code from Step 4.
- **Body**: Parts A + B + C of the compliance report above.
- **Section**: "Passport Reviews" (auto-created if missing).

Runs are persisted 10 years (FDL Art.24 — the LONGER retention wins
even when the home-zone rule is 6 years).

## Related skills

- `/screen` — base sanctions + adverse-media screening (always runs
  first; `/dfsa-adgm-passport` layers on top).
- `/onboard` — new customer onboarding; this skill is MANDATORY when
  the customer presents a DIFC or ADGM licence.
- `/incident` — freeze + 24h EOCN countdown; the passport layer does
  not change the freeze clock, but it does change the notification
  channels (home regulator via MoU).
- `/goaml` — STR / SAR / CTR XML; zone STRs still flow through UAE
  FIU (goAML), never directly to the DFSA or ADGM.
- `/traceability` — map each article cited above to code + test +
  evidence so the audit pack is defensible.
