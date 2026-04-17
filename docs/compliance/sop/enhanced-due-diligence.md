# Enhanced Due Diligence (EDD) SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular or
Cabinet Resolution affecting EDD obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This SOP implements the firm's Enhanced Due Diligence obligations
for customers, counterparties, and relationships that present a
high ML/TF/PF risk — whether identified at onboarding or surfacing
during the life of the relationship.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Articles 12–14 (CDD and EDD),
  Article 15 (risk-based approach), Article 20 (CO duties),
  Article 24 (record retention), Article 29 (no tipping off).
- Cabinet Resolution 134 of 2025, Article 5 (risk appetite),
  Article 14 (PEP and Enhanced Due Diligence), Article 19
  (internal review).
- Cabinet Resolution 156 of 2025 (proliferation financing, dual-use
  controls).
- Cabinet Decision 109 of 2023 (beneficial ownership >= 25%,
  15-working-day re-verification).
- MoE Circular 08/AML/2021 (DPMS sector guidance).
- FATF Recommendations 10 (CDD), 12 (PEPs), 19 (higher-risk
  countries), 22 (DNFBPs).
- LBMA Responsible Gold Guidance v9 (CAHRA due diligence).
- UAE MoE Responsible Sourcing of Gold (RSG) Framework (origin
  traceability, CAHRA mitigation, ASM compliance).

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy filed under `docs/compliance/aml-cft-cpf-policy/`.
It is the operational companion to the CDD SOP at
`docs/compliance/sop/customer-due-diligence.md` and inherits its
tier matrix (Section 4 of that SOP).

## 2. Scope — when EDD is mandatory

EDD MUST be applied in any of the following cases, whether the
trigger is seen at onboarding or later:

1. Risk score at or above 16 (authoritative tier from the CDD SOP).
2. Any politically exposed person (PEP), domestic or foreign,
   including family members and close associates per Cabinet
   Res 134/2025 Art.14. A 12-month post-PEP tail applies after
   the role ceases.
3. Customers or counterparties resident or operating in
   high-risk jurisdictions — the FATF "Call for Action" and
   "Other Monitored Jurisdictions" lists, any UAE-listed
   high-risk country, and any CAHRA for gold counterparties.
4. Complex or unusual ownership structures, including layering
   through multiple jurisdictions, nominee shareholders, or
   bearer instruments.
5. Counterparties exposed to dual-use goods or strategic goods
   under Cabinet Res 156/2025.
6. Relationships with customers operating through VASPs, private
   wallets, or other high-anonymity channels.
7. Adverse media with credible links to ML, TF, PF, corruption,
   organised crime, or sanctions evasion.
8. Transaction patterns suggestive of structuring, layering,
   rapid in-out movement, or deviation from the documented norm.
9. Any case where the MLRO, on written grounds, determines that
   EDD is warranted.

## 3. Roles and authorities

| Role | Authority under this SOP |
|---|---|
| MLRO (Luisa Fernanda) | Opens, chairs, and closes every EDD case. Signs the EDD memo. Directs all source-of-funds and source-of-wealth enquiries. Escalates to Senior Management for approval, and to the Board for foreign PEPs. |
| Backup MLRO | Exercises the MLRO's authority when the primary MLRO is unavailable, per the Backup MLRO Appointment Letter. |
| Compliance Officer | Prepares the EDD evidence pack. Coordinates external searches. Cannot approve the case. Cannot close an EDD file. |
| Senior Management | Approves EDD onboardings at score >= 16 and domestic PEPs. Receives the EDD memo before approval, never after. |
| Board | Approves onboarding of any foreign PEP with a recorded vote, per Cabinet Res 134/2025 Art.14. |
| Relationship / Front-office | No authority under this SOP. Never communicates EDD status to the subject (FDL Art.29). |

No role other than the MLRO (or Backup MLRO) may:

- Waive an EDD requirement.
- Re-classify an EDD file as standard CDD.
- Close an EDD case.

## 4. Mandatory EDD measures

Every EDD case MUST execute, at minimum, each of the following
measures. A case cannot be closed with any measure omitted; the
reason any measure is not feasible MUST be documented and
MLRO-signed.

### 4.1 Identity verification — reinforced

- Secondary identification document (passport plus national ID,
  or passport plus utility bill and bank statement from
  independent sources).
- Live video or in-person verification where feasible.
- Independent sanctions re-screen at the time EDD is opened
  (invoke `/screen` — do not rely on the onboarding screen if
  more than 30 days old).

### 4.2 Beneficial ownership — full chain

- Resolve the ownership chain to all natural persons at or above
  the 25% threshold. No "senior managing official" fallback is
  permitted in an EDD file unless the ownership chain is proved
  to be non-resolvable after documented independent research.
- Refresh the UBO register snapshot (Cabinet Decision 109/2023),
  store signed by the customer, and file in the tenant's Asana
  KYC / CDD Tracker.
- Cross-check UBO identities against sanctions and PEP lists.

### 4.3 Source of funds and source of wealth

- Documentary evidence for BOTH source of funds (the specific
  money entering the relationship) and source of wealth (the
  overall economic origin of the customer's assets).
- Independent verification where possible: bank reference,
  audited accounts, tax returns, land registry extract, sale
  contracts, inheritance documents.
- Narrative explanation of how the declared source of wealth
  supports the declared transaction profile.

### 4.4 Purpose and intended nature

- Written narrative from the customer of the purpose and
  intended nature of the relationship.
- Expected transaction volumes, counterparties, and products.
- Planned geographic footprint.

### 4.5 Adverse media and open-source research

- Minimum two independent, credible sources.
- Search in the customer's local language where feasible.
- Search for related natural persons (directors, UBOs,
  signatories) in addition to the entity.
- Any credible hit is appended to the EDD memo with source URL
  and date accessed.

### 4.6 PEP handling (Cabinet Res 134/2025 Art.14)

- PEP status verified against at least one independent PEP
  database (never self-declaration alone).
- Domestic PEP: Senior Management approval before onboarding.
- Foreign PEP: Board approval with recorded vote before
  onboarding.
- Family member or close associate: treated as PEP for all
  purposes under this SOP.
- Post-PEP tail: 12 months after the role ceases, unless the
  MLRO extends in writing on case-specific grounds.

### 4.7 High-risk jurisdiction handling

- Apply the jurisdiction multiplier from
  `src/domain/constants.ts` to the risk score.
- Document the specific risk indicators triggered by the
  jurisdiction (sanctioned party exposure, terrorism finance
  risk, PF risk, corruption index, tax-haven status).
- Where the jurisdiction is a CAHRA for gold counterparties,
  execute the 5-step LBMA RGG v9 framework in full (Section 4.8).

### 4.8 Gold-counterparty EDD (LBMA RGG v9 + UAE MoE RSG)

Where the EDD subject supplies, refines, or deals in gold:

- Origin declaration: mine, concession, or recycled stream.
- Refiner due diligence: LBMA-good-delivery status, audit
  history, UAE MoE RSG compliance.
- CAHRA mitigation plan where origin is in a conflict-affected
  or high-risk area.
- ASM (artisanal and small-scale mining) compliance evidence
  where relevant.
- Dubai Good Delivery (DGD) status where applicable.
- Chain-of-custody documentation with serial numbers.

### 4.9 Ongoing enhanced monitoring

- Transaction monitoring thresholds tightened (volume, value,
  velocity, counterparty).
- Re-screen cadence shortened to three months, or sooner on
  event triggers (Section 8 of the CDD SOP).
- Quarterly management-level review of the open EDD file until
  the MLRO re-classifies the relationship.

## 5. EDD memo — mandatory structure

Every EDD case produces a single EDD Memo, written by the CO
under MLRO direction. The memo structure is fixed so that
inspectors can locate any field quickly.

1. Case ID, date opened, date of current revision.
2. Subject identification (legal name, type, jurisdiction,
   trade licence, goAML ID if any).
3. EDD trigger (Section 2 cause).
4. Risk score at open, broken into scoring factors and
   multipliers. Top three contributing factors called out.
5. Sanctions, PEP, and adverse-media summary with evidence URLs.
6. Beneficial-ownership chain with signed UBO register snapshot.
7. Source of funds and source of wealth with independent
   evidence.
8. Purpose and intended nature of the relationship.
9. Transaction-profile declaration and monitoring parameters.
10. For gold counterparties, the LBMA RGG v9 5-step pack.
11. Proposed decision (approve, approve with conditions,
    decline) and the conditions or decline grounds.
12. Approval chain: MLRO, Senior Management, Board (if
    foreign PEP) with timestamps.
13. Next review date (three-month default).

## 6. Decision gate

After the EDD memo is complete, the MLRO decides one of:

1. **Approve** — the relationship is onboarded (or retained) at
   the EDD tier. Senior Management (and Board for foreign PEP)
   approval must be recorded before any transaction is processed.
2. **Approve with conditions** — conditions are enforced in the
   monitoring system (e.g. transaction cap, counterparty list,
   no cash, mandatory pre-transaction MLRO sign-off).
3. **Decline** — onboarding is refused, or the existing
   relationship is exited per Section 9 of the CDD SOP.
4. **Escalate** — the MLRO files an STR if the EDD process
   surfaces reasonable grounds to suspect ML / TF / PF. The
   STR SOP governs from that point.

A decision gate is recorded with a written MLRO rationale in
every case. There is no silent approval.

## 7. No-tipping-off protocol (FDL Article 29)

- No employee, at any level, may communicate to the subject or
  any person related to the subject that EDD is in progress,
  that an STR has been filed, or that the relationship is
  being exited on AML grounds.
- Customer-facing staff receive the scripted neutral response
  from Section 8 of the Sanctions SOP.
- Any breach is a same-day notifiable incident to the Board.

## 8. Record-keeping

Every EDD case, including the memo, evidence pack, approvals,
and monitoring outputs, is retained for at least ten years from
the date the relationship ends (FDL Art.24). Retention is
governed by the Record Retention SOP.

Records are filed:

- Live working copy in the tenant's Asana KYC / CDD Tracker.
- Immutable archive in the tamper-proof hash-chain audit trail
  written by `src/utils/auditChain.ts`.

## 9. Evidence artefacts produced per case

Every EDD case MUST produce and persist:

1. Case ID, UUID v4.
2. The EDD memo per Section 5.
3. The identity-verification pack per Section 4.1.
4. The UBO register snapshot per Section 4.2.
5. The source-of-funds and source-of-wealth evidence bundle
   per Section 4.3.
6. The adverse-media pack per Section 4.5.
7. The PEP-verification evidence per Section 4.6.
8. Where applicable, the LBMA RGG v9 5-step pack.
9. The approval chain with timestamps and recorded votes.
10. The monitoring parameters loaded into the transaction
    monitoring system on approval.

## 10. Quality assurance

- 100% of EDD files are MLRO-reviewed at open, at every
  quarterly review, and at close.
- The Board receives a quarterly EDD summary: cases opened,
  cases closed, average close time, PEP onboardings (domestic
  vs foreign), CAHRA gold counterparties onboarded, cases
  converted to STR.
- Any EDD file older than 12 months without progress is
  automatically escalated to the Board.

## 11. Interaction with other SOPs and skills

- CDD SOP — the tier matrix and onboarding workflow feed EDD.
- Sanctions SOP — executed in parallel with every EDD case.
- STR SOP — opened when an EDD case surfaces suspicion.
- Record Retention SOP — governs the 10-year retention.
- `/onboard <customer>` — the onboarding entry point.
- `/screen <customer>` — the parallel sanctions leg.
- `/agent-orchestrate` — the multi-agent workflow for complex
  EDD cases (PEER pattern) per CLAUDE.md skill table.
- `/incident <subject> sanctions-match` — when a confirmed
  sanctions match intervenes during EDD.

## 12. Training

Every person named in Section 3 completes, on appointment and
annually thereafter, a documented training module covering:

- This SOP in full.
- The Cabinet Res 134/2025 Art.14 PEP definition, including
  family and close associates.
- The FDL Art.29 tipping-off prohibition.
- The LBMA RGG v9 5-step framework where the role touches gold
  counterparties.
- The EDD memo template.

Training records are retained for ten years under the Record
Retention SOP.

## 13. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to
the regulatory basis cited in Section 1.
