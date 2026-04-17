# Customer Due Diligence (CDD) SOP

Owner: Luisa Fernanda, MLRO
Document date: 17/04/2026
Effective date: On MLRO signature
Review cycle: Annual and within 30 days of any new MoE circular or
Cabinet Resolution affecting CDD obligations.
Version: 1.0
Applies to: Fine Gold LLC, Fine Gold LLC – Branch, Madison LLC,
Naples LLC, Gramaltin AS, ZOE FZE.

## 1. Purpose and regulatory basis

This SOP implements the firm's Customer Due Diligence obligations
for every customer, counterparty, and related natural or legal
person, from onboarding through periodic review to exit.

Primary regulatory basis:

- Federal Decree-Law No. 10 of 2025, Articles 12–14 (CDD),
  Articles 15–17 (thresholds, including Art.16 DPMS cash and
  Art.17 cross-border cash/BNI), Article 24 (record retention),
  Article 29 (no tipping off).
- Cabinet Resolution 134 of 2025, Articles 5 (risk appetite),
  7–10 (CDD tiers), 14 (PEP and Enhanced Due Diligence),
  16 (cross-border cash AED 60,000), 19 (internal review).
- Cabinet Decision 109 of 2023 (Beneficial ownership >= 25%,
  re-verification within 15 working days).
- MoE Circular 08/AML/2021 (DPMS sector guidance, AED 55,000
  DPMSR threshold, goAML reporting).
- FATF Recommendations 10 (Customer Due Diligence), 22 (DNFBPs),
  24 (Transparency and BO of legal persons), 25 (BO of legal
  arrangements).
- LBMA Responsible Gold Guidance v9 (5-step framework, CAHRA due
  diligence) where the counterparty supplies or refines gold.

This SOP operates under, and does not replace, the entity-level
AML/CFT/CPF Policy filed under `docs/compliance/aml-cft-cpf-policy/`.
It is a companion to the Sanctions Screening and TFS SOP at
`docs/compliance/sop/sanctions-screening-tfs.md` — both MUST be
executed together for every onboarding.

## 2. Scope

This SOP covers, for every tenant in scope:

- Onboarding CDD for natural persons, legal persons, legal
  arrangements (trusts, foundations), and for occasional
  customers crossing the CDD trigger thresholds.
- Ongoing CDD: periodic review, event-driven review, beneficial
  ownership re-verification.
- Tiered handling: Simplified Due Diligence (SDD), Standard CDD,
  Enhanced Due Diligence (EDD — handled by a separate SOP).
- Exit CDD: record of relationship termination and the reason.

Out of scope for this SOP: sanctions screening mechanics (covered
in the Sanctions SOP), STR filing (covered in the STR SOP),
Enhanced Due Diligence operational steps (covered in the EDD SOP),
proliferation-financing screening (covered in the PF SOP).

## 3. Roles and authorities

| Role | Authority under this SOP |
|---|---|
| MLRO (Luisa Fernanda) | Signs off every EDD case. Approves any deviation from the CDD tier matrix. Reviews all rejected onboardings within the same business day. |
| Backup MLRO | Exercises the MLRO's authority when the primary MLRO is unavailable, per the Backup MLRO Appointment Letter. |
| Compliance Officer | Runs the CDD questionnaire. First-line risk scoring. Escalates anything scoring >= 6 to the MLRO. Cannot approve EDD cases. |
| Relationship / Front-office | Collects identification documents. Never decides the CDD tier. Cannot override a risk-score-driven tier. |
| Senior Management | Approves onboarding of any customer scoring >= 16 (EDD). Approves any PEP relationship. |
| Board | Approves onboarding of any foreign PEP or any customer flagged as "high political exposure" per Cabinet Res 134/2025 Art.14. |

No role other than the MLRO (or Backup MLRO) may:

- Waive a required identification document.
- Accept a beneficial-ownership declaration that does not resolve
  to at least one identified natural person.
- Close out an EDD case.

## 4. CDD tier matrix

The CDD tier applied to a customer is determined by the risk score
computed by the firm's scoring engine at the end of the onboarding
questionnaire. The score uses the formula and context multipliers
documented in `CLAUDE.md` ("likelihood × impact × jurisdiction /
PEP / cash multipliers"). The authoritative constants live in
`src/domain/constants.ts` and their regulatory provenance is
version-locked by `tests/constants.test.ts`.

| Score | Tier | Review cadence | Approval required |
|---|---|---|---|
| < 6 | Simplified Due Diligence (SDD) | 12 months | CO |
| 6 – 15 | Standard CDD | 6 months | CO |
| >= 16 | Enhanced Due Diligence (EDD) | 3 months | MLRO + Senior Management |
| PEP detected (any score) | EDD | 3 months | MLRO + Board |
| Foreign PEP (any score) | EDD | 3 months | MLRO + Board (recorded vote) |
| Sanctions match >= 0.5 confidence | STOP — no onboarding | n/a | MLRO incident per Sanctions SOP |

The tier assigned at onboarding MUST NOT be reduced later without
an MLRO-signed reassessment documented in the customer's file.
Tier upgrades on re-screening are applied automatically and
notified to the MLRO within one business day.

## 5. Mandatory identification and verification

### 5.1 Natural persons

- Government-issued photo identification with date of birth and
  full legal name (passport, Emirates ID, or equivalent national
  ID for non-residents).
- Residential address evidence dated within the last three months
  (utility bill, bank statement, tenancy contract).
- Source of funds declaration with documentary evidence at or
  above AED 55,000 single-transaction or aggregate in 30 days
  (FDL No.10/2025 Art.16 and MoE Circular 08/AML/2021).
- Occupation, employer, and source of wealth.
- PEP self-declaration and independent PEP screening (mandatory,
  never rely on self-declaration alone).

### 5.2 Legal persons

- Trade licence or equivalent certificate of incorporation.
- Memorandum / Articles of Association.
- Register of directors and authorised signatories with IDs.
- Proof of registered address.
- Full beneficial-ownership chain resolving to natural persons at
  or above the 25% threshold (Cabinet Decision 109/2023). Where
  no single natural person meets the 25% threshold, the senior
  managing official is recorded as the BO of last resort.
- UBO register snapshot at the time of onboarding, signed by the
  customer and stored in the tenant's Asana KYC / CDD Tracker.

### 5.3 Legal arrangements (trusts, foundations)

- The trust deed or foundation charter.
- Identification of the settlor, trustee(s), protector (if any),
  beneficiaries or class of beneficiaries, and any other natural
  person exercising ultimate effective control.
- Source of funds for the trust corpus.

### 5.4 Occasional customers

- Any occasional customer crossing AED 55,000 (single transaction
  or aggregate in 30 days) is treated as a full CDD customer.
- Any cross-border cash or BNI at or above AED 60,000 triggers
  the cross-border declaration check (FDL No.10/2025 Art.17 and
  Cabinet Res 134/2025 Art.16) and full CDD.

## 6. Risk scoring inputs

The onboarding questionnaire MUST capture, at minimum:

- Customer type (natural, legal, arrangement, occasional).
- Country of residence and country of operation.
- Jurisdictional exposure (sanctioned, high-risk, CAHRA for gold).
- Product and service lines.
- Transaction profile (cash intensity, volumes, typical counterparties).
- Source of funds and source of wealth.
- PEP status (self, family, close associate).
- Adverse media hits (from the firm's adverse media feed).
- For gold counterparties: origin, refiner DD, LBMA RGG v9 status,
  UAE MoE RSG compliance, CAHRA flag, Dubai Good Delivery status.

All inputs feed the risk-scoring engine. The engine output — a
score, a tier recommendation, and the top three contributing
factors — is persisted with the customer record for ten years
(FDL Art.24).

## 7. Onboarding workflow

```
Customer request
  |
  v
(1) Front-office collects documents per Section 5
  |
  v
(2) CO runs CDD questionnaire, engine scores risk
  |
  v
(3) Sanctions SOP executed in parallel (/screen)
  |    - match >= 0.5 -> STOP, incident path
  |
  v
(4) Engine proposes tier per Section 4 matrix
  |
  v
(5) SDD/CDD: CO approves and onboards
    EDD: MLRO + Senior Management approval
    PEP: MLRO + Board approval (recorded vote for foreign PEP)
  |
  v
(6) Record filed in Asana KYC / CDD Tracker, BO register, and
    the tenant's audit-trail blob.
  |
  v
(7) Monitoring schedule set per tier (SDD 12mo, CDD 6mo, EDD 3mo)
```

Any step that cannot complete within three business days from the
customer request MUST be escalated to the MLRO.

No transaction may be processed before step (5) approval is
recorded in the customer file.

## 8. Ongoing CDD

### 8.1 Periodic review

- SDD: full re-screen and refresh at 12 months.
- CDD: full re-screen and refresh at 6 months.
- EDD: full re-screen and refresh at 3 months.

Periodic review includes: re-running the sanctions screen against
the current lists, re-running the risk score, refreshing expired
identification documents, refreshing address proofs, refreshing
the UBO register snapshot, and re-confirming PEP status.

### 8.2 Event-driven review

Any of the following events triggers an immediate CDD refresh,
regardless of the periodic cadence:

- Change in beneficial ownership (UBO re-verification within 15
  working days, Cabinet Decision 109/2023).
- New director or authorised signatory.
- Change in trade-licence scope.
- New jurisdiction of operation added.
- PEP status change (acquired, elevated, ceased — ceased triggers
  a 12-month post-PEP tail per Cabinet Res 134/2025 Art.14).
- Material adverse media hit.
- Sanctions list update affecting a related party (handled by
  the Sanctions SOP, cross-referenced here).
- Transaction profile deviation beyond the documented norm.

### 8.3 Data minimisation

CDD records are retained for ten years (FDL Art.24) and are not
used for any purpose other than AML/CFT/CPF compliance. They are
not shared with sales, marketing, or any third party except:

- UAE FIU via goAML on lawful request.
- MoE, CBUAE, EOCN on lawful supervisory request.
- An auditor under a written confidentiality obligation.

## 9. Exit CDD

When a customer relationship ends — voluntarily or by firm
decision — the MLRO ensures the following is recorded:

- Date of termination.
- Reason for termination (customer-initiated, commercial, risk,
  regulatory direction, STR-driven exit).
- Final CDD state snapshot (risk tier, last screen result, last
  BO snapshot).
- Any outstanding filings triggered by the exit.

Records are retained for ten years from the date of termination
(FDL Art.24). No employee may communicate an STR-driven exit to
the subject (FDL Art.29).

## 10. Evidence artefacts produced per onboarding

Every onboarding MUST produce and persist:

1. The signed CDD questionnaire.
2. Copies of all identification and supporting documents.
3. The sanctions-screening evidence pack from the Sanctions SOP.
4. The risk-score decision payload (score, tier, top factors).
5. The approval chain (CO, MLRO, Senior Management, Board as
   applicable) with timestamps.
6. The UBO register snapshot, where applicable.
7. For gold counterparties: LBMA RGG v9 due-diligence pack and
   Dubai Good Delivery status evidence.

All artefacts are filed in the tenant's Asana KYC / CDD Tracker
and mirrored to the tamper-proof hash-chain audit trail written by
`src/utils/auditChain.ts`.

## 11. Quality assurance

- The MLRO reviews 10% of SDD onboardings, 25% of CDD
  onboardings, and 100% of EDD onboardings each month for
  completeness and tier-assignment accuracy.
- Any misclassification is logged as a calibration incident and
  reported to the Board in the next quarterly pack.
- Front-office staff receive monthly metrics on completeness and
  escalation rates.

## 12. Interaction with other SOPs and skills

- `/onboard <customer>` — the slash-command entry point for every
  new onboarding. Must be used in preference to manual routing.
- `/screen <customer>` — the screening leg called automatically by
  `/onboard`, or invoked standalone for periodic re-screening.
- `/incident <customer> sanctions-match` — invoked by the
  Sanctions SOP when onboarding is halted by a confirmed match.
- Sanctions SOP — executed in parallel with every onboarding.
- EDD SOP — executed when the tier matrix assigns EDD.
- STR SOP — executed when onboarding triggers a suspicion.

## 13. Training

Every person named in Section 3 completes, on appointment and
annually thereafter, a documented training module covering:

- This SOP in full.
- The tier matrix and the regulatory provenance of each threshold.
- The PEP definition, including family members and close
  associates, per Cabinet Res 134/2025 Art.14.
- The UBO re-verification 15-working-day deadline.
- The FDL Art.29 tipping-off prohibition.
- The Sanctions SOP decision tree, because every onboarding runs
  it in parallel.

Training records are retained for ten years.

## 14. Review and version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 17/04/2026 | Luisa Fernanda (MLRO) | Initial issue. |

Next scheduled review: 17/04/2027, or earlier on any change to
the regulatory basis cited in Section 1.
