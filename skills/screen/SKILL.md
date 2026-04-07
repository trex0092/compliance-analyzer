# /screen — Sanctions & Risk Screening Analysis

Analyze an entity, customer, or transaction for sanctions, PEP, and risk indicators.

## Usage
```
/screen [entity name or description]
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Identify Context
1. Call `get_minimal_context(task="screening analysis")`.
2. Determine the entity type: customer, supplier, counterparty, UBO, or transaction.

### Step 2: Check Against Red Flags
1. Query the red flag library in `src/risk/redFlags.ts` — match applicable flags.
2. Calculate risk score using `src/risk/scoring.ts` logic:
   - Base score = likelihood x impact
   - Apply context multipliers (jurisdiction, PEP, cash, sanctions proximity)
3. Run through decision engine (`src/risk/decisions.ts`) for recommended action.

### Step 3: Sanctions List Coverage
Check entity against all 15+ configured lists:
- **UN**: UN Consolidated Sanctions
- **US**: OFAC SDN, Sectoral Sanctions
- **EU**: EU Consolidated Financial Sanctions
- **UK**: UK Financial Sanctions (OFSI)
- **UAE**: UAE Local Terrorist List, EOCN designations
- **FATF**: Grey List / Black List status
- **CAHRA**: Conflict-Affected & High-Risk Areas
- **PEP**: Politically Exposed Persons databases

### Step 4: Geographic Risk
Assess jurisdiction risk:
- FATF Grey/Black List country?
- UAE NRA 2024 high-risk country?
- EU High-Risk Third Countries?
- CAHRA (LBMA/OECD) territory?

### Step 5: Report

```
# Screening Report
Entity: [name]
Type: [customer / supplier / UBO / transaction]
Date: [today]

## Risk Score
- Base Score: [N] ([level])
- Context Multipliers: [list applied]
- Final Score: [N] ([level])

## Red Flags Triggered
| Code | Flag | Category | Score | Regulatory Ref |
|------|------|----------|-------|----------------|

## Sanctions Screening
| List | Status | Match Type | Details |
|------|--------|------------|---------|

## Geographic Risk
- Jurisdiction: [country]
- FATF Status: [clean / grey / black]
- CAHRA: [yes/no]
- EU High-Risk: [yes/no]

## Decision Engine Output
- Recommended Action: [continue / edd / reject / freeze / str-review]
- Mandatory Actions: [list]

## Regulatory Requirements
[cite specific FDL/Cabinet Res articles that apply]
```
