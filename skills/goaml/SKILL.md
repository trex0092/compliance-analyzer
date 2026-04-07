# /goaml — Generate & Validate goAML XML Filing

Generate UAE FIU-compliant goAML XML for STR, SAR, CTR, DPMSR, or CNMR filings with pre-flight validation.

## Usage
```
/goaml [report-type] [entity-name]
```
Types: `str`, `sar`, `ctr`, `dpmsr`, `cnmr`

## Instructions

### Step 1: Pre-Flight Validation
Before generating ANY goAML XML, verify ALL of these:

1. **Reporter Authority**: Confirm the active user has `reports` or `export` permission (check auth-rbac.js roles)
2. **Required Fields Present**:
   - STR/SAR: subjectName, groundsForSuspicion (min 3 indicators), transactionDetails, reportingOfficer
   - CTR: customerName, amount (must be >= AED 55,000 from constants.ts), paymentMethod (must be "cash")
   - CNMR: entityName, matchedList, matchConfidenceScore, freezeStatus
3. **Filing Deadline Check**: Use `checkDeadline()` from `src/utils/businessDays.ts`:
   - STR/SAR: 10 business days from suspicion trigger
   - CTR: 15 business days from transaction date
   - CNMR: 5 business days from confirmed match
4. **No Tipping Off**: Verify the report does NOT contain any text that could alert the subject (FDL Art.29)
5. **Prior Filing Check**: Search existing reports to prevent duplicate filings

### Step 2: Generate XML
Use `goaml-export.js` functions:
- `buildSTRXml()` for STR/SAR
- `buildCTRXml()` for CTR/DPMSR
- For CNMR: Generate custom XML per EOCN template

### Step 3: Validate Output
Check the generated XML against:
- All required XML nodes present (reportHeader, reportingEntity, subject, transactions)
- Date formats: YYYY-MM-DD (ISO)
- Amount formats: numeric, 2 decimal places
- Entity names: escaped via `escapeXml()`
- Report ID: unique RPT-[timestamp]-[random] format
- Reporter info: matches active company from fgl_companies

### Step 4: Output
```
## goAML Filing — [TYPE]

### Pre-Flight ✓
- [x] Reporter authorized: [username] ([role])
- [x] Required fields: all present
- [x] Deadline: [N] business days remaining (deadline: [date])
- [x] No tipping-off risk
- [x] No duplicate filing

### Generated Report
- Report ID: RPT-[id]
- Type: [STR/SAR/CTR/DPMSR/CNMR]
- Subject: [name]
- Filing deadline: [date] ([N] business days remaining)

### XML Preview
[first 50 lines of XML]

### Next Steps
1. Review XML in goAML portal test environment
2. Submit via goAML portal
3. Save confirmation reference
4. Mark report as "Filed" in system
```
