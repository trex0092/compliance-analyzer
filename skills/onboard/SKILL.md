# /onboard — Customer Onboarding Compliance Workflow

Walk through full customer/counterparty onboarding with regulatory checkpoints at every step.

## Usage
```
/onboard [customer-name]
```

## Instructions

Execute this as a sequential workflow. Do NOT skip steps.

### Step 1: Initial Identification (FDL Art.12, Cabinet Res 134/2025 Art.7)
Verify the following are captured:
- [ ] Legal name and trading name
- [ ] Country of incorporation
- [ ] Commercial register / trade license number
- [ ] License expiry date
- [ ] Business activity description
- [ ] Source of wealth declaration
- [ ] Source of funds declaration

### Step 2: UBO Identification (Cabinet Decision 109/2023)
- [ ] Identify ALL individuals with >= 25% ownership (use UBO_OWNERSHIP_THRESHOLD_PCT from constants.ts)
- [ ] Verify UBO identity documents (passport/EID)
- [ ] Check UBO against sanctions lists (Step 4)
- [ ] Document ownership chain if multi-layered structure
- [ ] Flag if no individual meets 25% threshold — escalate to senior management

### Step 3: Risk Assessment (FDL Art.13-14)
Run `/screen [customer-name]` to get:
- [ ] Red flag analysis
- [ ] Geographic risk (FATF Grey, CAHRA, EU High-Risk)
- [ ] Risk score and level
- [ ] CDD tier determination:
  - Score < 6 → SDD (Simplified Due Diligence)
  - Score 6-15 → CDD (Standard)
  - Score >= 16 or PEP → EDD (Enhanced Due Diligence)

### Step 4: Sanctions Screening (Cabinet Res 74/2020)
Screen against ALL lists:
- [ ] UN Consolidated Sanctions
- [ ] OFAC SDN + Non-SDN
- [ ] EU Consolidated Financial Sanctions
- [ ] UK OFSI
- [ ] UAE Local Terrorist List
- [ ] EOCN designations
- [ ] Interpol Red Notices
- [ ] PEP databases

If ANY match confidence > 0.5:
- STOP onboarding
- Escalate to Compliance Officer
- If confirmed: trigger `/incident [entity-name]`

### Step 5: Evidence Collection
- [ ] Trade license (certified copy)
- [ ] Certificate of incorporation
- [ ] Memorandum of Association
- [ ] Board resolution / power of attorney
- [ ] Passport copies of authorized signatories
- [ ] Proof of address (utility bill < 3 months)
- [ ] Bank reference letter
- [ ] Financial statements (latest 2 years if EDD)

### Step 6: Approval (Four-Eyes Principle)
- [ ] Analyst completes assessment
- [ ] Compliance Officer reviews and approves/rejects
- [ ] If high-risk: Senior Management approval required (Cabinet Res 134/2025 Art.14)
- [ ] If PEP: Board-level approval required

### Step 7: System Setup
- [ ] Create customer record in compliance-suite
- [ ] Set CDD review schedule:
  - High-risk: 3 months
  - Medium-risk: 6 months
  - Low-risk: 12 months
- [ ] Create Asana project (if new customer)
- [ ] Set evidence expiry monitoring
- [ ] Log onboarding in audit trail

### Output
```
## Customer Onboarding Report

| Field | Status |
|-------|--------|
| Customer | [name] |
| Risk Level | [low/medium/high/critical] |
| CDD Tier | [SDD/CDD/EDD] |
| Sanctions | [Clear / Match Found] |
| UBO | [Identified / Escalated] |
| Approval | [Pending / Approved / Rejected] |
| Next Review | [date] |

### Checklist Completion: [N]/[total] items
### Regulatory References: [list applicable articles]
```
