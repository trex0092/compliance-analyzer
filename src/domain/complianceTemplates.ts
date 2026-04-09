/**
 * Mandatory Compliance Form Templates — UAE DPMS Sector
 *
 * These templates guide compliance officers through required processes
 * per FDL No.10/2025, Cabinet Res 134/2025, MoE Circular 08/AML/2021,
 * FATF Recommendations, and EOCN/FIU protocols.
 *
 * Each template defines:
 *   - Required fields for the form
 *   - Regulatory basis
 *   - Approval requirements
 *   - Retention period
 */

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'checkbox' | 'file';
  required: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
}

export interface ComplianceTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  regulatoryBasis: string;
  approvalRequired: string[];
  retentionYears: number;
  fields: FormField[];
}

// ─── 1. CDD / KYC Forms ─────────────────────────────────────────────────────

export const TEMPLATE_CDD_INDIVIDUAL: ComplianceTemplate = {
  id: 'TPL-CDD-IND',
  name: 'Customer Due Diligence — Individual',
  description: 'Standard CDD form for individual customers per FDL Art.12-13',
  category: 'CDD/KYC',
  regulatoryBasis:
    'FDL No.10/2025 Art.12-13, Cabinet Res 134/2025 Art.4-6, MoE Circular 08/AML/2021',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    {
      name: 'fullName',
      label: 'Full Legal Name',
      type: 'text',
      required: true,
      placeholder: 'As per Emirates ID / Passport',
    },
    { name: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true },
    { name: 'nationality', label: 'Nationality', type: 'text', required: true },
    { name: 'emiratesId', label: 'Emirates ID Number', type: 'text', required: true },
    { name: 'passportNo', label: 'Passport Number', type: 'text', required: true },
    { name: 'passportExpiry', label: 'Passport Expiry Date', type: 'date', required: true },
    {
      name: 'residenceAddress',
      label: 'Residential Address (UAE)',
      type: 'textarea',
      required: true,
    },
    { name: 'occupation', label: 'Occupation / Position', type: 'text', required: true },
    { name: 'employerName', label: 'Employer Name', type: 'text', required: false },
    {
      name: 'purposeOfRelationship',
      label: 'Purpose of Business Relationship',
      type: 'textarea',
      required: true,
      helpText: 'Describe the expected nature and purpose of the business relationship',
    },
    {
      name: 'expectedTransactionVolume',
      label: 'Expected Monthly Transaction Volume (AED)',
      type: 'number',
      required: true,
    },
    {
      name: 'sourceOfFunds',
      label: 'Source of Funds',
      type: 'textarea',
      required: true,
      helpText: 'Describe the origin of funds used in transactions',
    },
    {
      name: 'sourceOfWealth',
      label: 'Source of Wealth',
      type: 'textarea',
      required: true,
      helpText: 'Describe the origin of overall wealth/assets',
    },
    {
      name: 'pepStatus',
      label: 'PEP Status',
      type: 'select',
      required: true,
      options: [
        'Not a PEP',
        'Domestic PEP',
        'Foreign PEP',
        'International Organization PEP',
        'Family member of PEP',
        'Close associate of PEP',
      ],
    },
    {
      name: 'sanctionsScreeningDate',
      label: 'Sanctions Screening Date',
      type: 'date',
      required: true,
    },
    {
      name: 'sanctionsScreeningResult',
      label: 'Sanctions Screening Result',
      type: 'select',
      required: true,
      options: ['Clear', 'Potential Match', 'Confirmed Match'],
    },
    {
      name: 'riskRating',
      label: 'Customer Risk Rating',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    {
      name: 'idDocumentUpload',
      label: 'Upload ID Document (Emirates ID / Passport)',
      type: 'file',
      required: true,
    },
    { name: 'proofOfAddress', label: 'Upload Proof of Address', type: 'file', required: true },
    { name: 'analystName', label: 'Completed By (Analyst)', type: 'text', required: true },
    { name: 'completionDate', label: 'Completion Date', type: 'date', required: true },
  ],
};

export const TEMPLATE_CDD_ENTITY: ComplianceTemplate = {
  id: 'TPL-CDD-ENT',
  name: 'Customer Due Diligence — Legal Entity',
  description:
    'CDD form for corporate/entity customers including UBO identification per FDL Art.14',
  category: 'CDD/KYC',
  regulatoryBasis: 'FDL No.10/2025 Art.12-14, Cabinet Res 134/2025 Art.4-7, FATF Rec 10/24',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    { name: 'legalName', label: 'Full Legal Name of Entity', type: 'text', required: true },
    { name: 'tradeLicenseNo', label: 'Trade License Number', type: 'text', required: true },
    {
      name: 'tradeLicenseExpiry',
      label: 'Trade License Expiry Date',
      type: 'date',
      required: true,
    },
    {
      name: 'countryOfIncorporation',
      label: 'Country of Incorporation',
      type: 'text',
      required: true,
    },
    { name: 'registeredAddress', label: 'Registered Address', type: 'textarea', required: true },
    {
      name: 'businessActivity',
      label: 'Nature of Business Activity',
      type: 'textarea',
      required: true,
    },
    {
      name: 'authorizedSignatory',
      label: 'Authorized Signatory Name',
      type: 'text',
      required: true,
    },
    {
      name: 'signatoryIdNo',
      label: 'Signatory Emirates ID / Passport No.',
      type: 'text',
      required: true,
    },
    {
      name: 'ubo1Name',
      label: 'UBO #1 — Full Name (>25% ownership)',
      type: 'text',
      required: true,
      helpText: 'Per FATF Rec 24 and Cabinet Res 134/2025 Art.7',
    },
    { name: 'ubo1Nationality', label: 'UBO #1 — Nationality', type: 'text', required: true },
    { name: 'ubo1OwnershipPct', label: 'UBO #1 — Ownership %', type: 'number', required: true },
    {
      name: 'ubo1PepStatus',
      label: 'UBO #1 — PEP Status',
      type: 'select',
      required: true,
      options: ['Not a PEP', 'Domestic PEP', 'Foreign PEP', 'Family/Associate of PEP'],
    },
    {
      name: 'ubo2Name',
      label: 'UBO #2 — Full Name (if applicable)',
      type: 'text',
      required: false,
    },
    { name: 'ubo2Nationality', label: 'UBO #2 — Nationality', type: 'text', required: false },
    { name: 'ubo2OwnershipPct', label: 'UBO #2 — Ownership %', type: 'number', required: false },
    {
      name: 'ownershipStructureDiagram',
      label: 'Upload Ownership Structure Diagram',
      type: 'file',
      required: true,
      helpText: 'Required per FATF Rec 24 for entities with complex structures',
    },
    { name: 'sourceOfFunds', label: 'Source of Funds', type: 'textarea', required: true },
    { name: 'sourceOfWealth', label: 'Source of Wealth', type: 'textarea', required: true },
    {
      name: 'expectedTransactionVolume',
      label: 'Expected Monthly Volume (AED)',
      type: 'number',
      required: true,
    },
    {
      name: 'sanctionsScreeningDate',
      label: 'Sanctions Screening Date',
      type: 'date',
      required: true,
    },
    {
      name: 'sanctionsScreeningResult',
      label: 'Screening Result',
      type: 'select',
      required: true,
      options: ['Clear', 'Potential Match', 'Confirmed Match'],
    },
    { name: 'pepScreeningDate', label: 'PEP Screening Date', type: 'date', required: true },
    {
      name: 'riskRating',
      label: 'Entity Risk Rating',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    { name: 'tradeLicenseUpload', label: 'Upload Trade License', type: 'file', required: true },
    {
      name: 'memorandumUpload',
      label: 'Upload Memorandum of Association',
      type: 'file',
      required: true,
    },
    { name: 'analystName', label: 'Completed By', type: 'text', required: true },
    { name: 'completionDate', label: 'Completion Date', type: 'date', required: true },
  ],
};

// ─── 2. EDD Form ─────────────────────────────────────────────────────────────

export const TEMPLATE_EDD: ComplianceTemplate = {
  id: 'TPL-EDD',
  name: 'Enhanced Due Diligence',
  description: 'EDD form for high-risk customers, PEPs, and high-risk jurisdiction relationships',
  category: 'EDD',
  regulatoryBasis: 'FDL No.10/2025 Art.14-15/18, Cabinet Res 134/2025 Art.8, FATF Rec 10/12/19',
  approvalRequired: ['compliance-officer', 'mlro', 'senior-management'],
  retentionYears: 10,
  fields: [
    { name: 'customerName', label: 'Customer Name', type: 'text', required: true },
    { name: 'customerId', label: 'Customer ID', type: 'text', required: true },
    {
      name: 'eddTrigger',
      label: 'EDD Trigger Reason',
      type: 'select',
      required: true,
      options: [
        'High Risk Rating',
        'PEP Identified',
        'High-Risk Jurisdiction',
        'Complex Ownership',
        'Adverse Media',
        'Sanctions Proximity',
        'Unusual Transaction Pattern',
        'FIU Request',
        'MoE Directive',
      ],
    },
    {
      name: 'riskFactorsSummary',
      label: 'Summary of Risk Factors',
      type: 'textarea',
      required: true,
    },
    {
      name: 'enhancedSOFVerification',
      label: 'Enhanced Source of Funds Verification',
      type: 'textarea',
      required: true,
      helpText: 'Detail additional steps taken to verify SOF beyond standard CDD',
    },
    {
      name: 'enhancedSOWVerification',
      label: 'Enhanced Source of Wealth Verification',
      type: 'textarea',
      required: true,
    },
    {
      name: 'adverseMediaFindings',
      label: 'Adverse Media Screening Findings',
      type: 'textarea',
      required: true,
    },
    {
      name: 'adverseMediaDate',
      label: 'Adverse Media Screening Date',
      type: 'date',
      required: true,
    },
    {
      name: 'additionalSanctionsScreening',
      label: 'Additional Sanctions Lists Checked',
      type: 'textarea',
      required: true,
      helpText: 'UN, OFAC, EU, UAE Local Lists, LBMA',
    },
    {
      name: 'seniorManagementApproval',
      label: 'Senior Management Approval Obtained',
      type: 'checkbox',
      required: true,
      helpText: 'Required per FDL Art.18 for PEPs and FDL Art.14 for high-risk',
    },
    {
      name: 'approvedBy',
      label: 'Approved By (Senior Management Name)',
      type: 'text',
      required: true,
    },
    { name: 'approvalDate', label: 'Approval Date', type: 'date', required: true },
    {
      name: 'ongoingMonitoringPlan',
      label: 'Ongoing Monitoring Plan',
      type: 'textarea',
      required: true,
      helpText: 'Describe enhanced monitoring measures (frequency, triggers, review schedule)',
    },
    { name: 'nextReviewDate', label: 'Next EDD Review Date', type: 'date', required: true },
    {
      name: 'eddDecision',
      label: 'EDD Decision',
      type: 'select',
      required: true,
      options: [
        'Continue Relationship with Enhanced Monitoring',
        'Suspend Relationship Pending Further Review',
        'Terminate Relationship',
        'File STR and Continue Monitoring',
        'File STR and Terminate',
      ],
    },
    {
      name: 'supportingDocuments',
      label: 'Upload Supporting Documents',
      type: 'file',
      required: true,
    },
    {
      name: 'completedBy',
      label: 'Completed By (Compliance Officer)',
      type: 'text',
      required: true,
    },
  ],
};

// ─── 3. STR / SAR / CTR Filing Forms ─────────────────────────────────────────

export const TEMPLATE_STR: ComplianceTemplate = {
  id: 'TPL-STR',
  name: 'Suspicious Transaction Report (STR)',
  description: 'STR filing form for goAML submission per FDL Art.26',
  category: 'Reporting',
  regulatoryBasis: 'FDL No.10/2025 Art.26, FIU goAML Guidelines, FATF Rec 20',
  approvalRequired: ['mlro'],
  retentionYears: 10,
  fields: [
    { name: 'reportingEntityName', label: 'Reporting Entity Name', type: 'text', required: true },
    {
      name: 'reportingEntityLicense',
      label: 'Reporting Entity License No.',
      type: 'text',
      required: true,
    },
    { name: 'mlroName', label: 'MLRO Name', type: 'text', required: true },
    { name: 'mlroContact', label: 'MLRO Contact Number', type: 'text', required: true },
    {
      name: 'subjectName',
      label: 'Subject of Report (Customer Name)',
      type: 'text',
      required: true,
    },
    {
      name: 'subjectIdType',
      label: 'Subject ID Type',
      type: 'select',
      required: true,
      options: ['Emirates ID', 'Passport', 'Trade License', 'Other'],
    },
    { name: 'subjectIdNumber', label: 'Subject ID Number', type: 'text', required: true },
    { name: 'subjectNationality', label: 'Subject Nationality', type: 'text', required: true },
    { name: 'subjectAddress', label: 'Subject Address', type: 'textarea', required: true },
    {
      name: 'transactionDate',
      label: 'Transaction Date(s)',
      type: 'text',
      required: true,
      helpText: 'Date or date range of suspicious transactions',
    },
    {
      name: 'transactionAmount',
      label: 'Transaction Amount (AED)',
      type: 'number',
      required: true,
    },
    { name: 'transactionCurrency', label: 'Currency', type: 'text', required: true },
    {
      name: 'transactionMethod',
      label: 'Payment Method',
      type: 'select',
      required: true,
      options: ['Cash', 'Wire Transfer', 'Cheque', 'Virtual Asset', 'E-Wallet', 'Mixed'],
    },
    {
      name: 'commodityType',
      label: 'Commodity Type (if DPMS)',
      type: 'select',
      required: false,
      options: [
        'Gold Bullion',
        'Gold Jewellery',
        'Silver',
        'Platinum',
        'Diamonds',
        'Precious Stones',
        'Mixed',
      ],
    },
    { name: 'weightGrams', label: 'Weight (grams)', type: 'number', required: false },
    { name: 'purity', label: 'Purity / Fineness', type: 'text', required: false },
    {
      name: 'reasonForSuspicion',
      label: 'Reason for Suspicion',
      type: 'textarea',
      required: true,
      helpText: 'Detailed narrative explaining why the transaction is suspicious',
    },
    { name: 'redFlagsIdentified', label: 'Red Flags Identified', type: 'textarea', required: true },
    {
      name: 'actionsTaken',
      label: 'Actions Taken by Reporting Entity',
      type: 'textarea',
      required: true,
    },
    { name: 'relatedCaseId', label: 'Related Case ID', type: 'text', required: false },
    {
      name: 'previousSTRRef',
      label: 'Previous STR Reference (if follow-up)',
      type: 'text',
      required: false,
    },
    {
      name: 'tippingOffPrevention',
      label: 'Tipping-Off Prevention Measures Taken',
      type: 'textarea',
      required: true,
      helpText: 'Per FDL Art.27 — describe how customer has not been informed',
    },
    { name: 'filingDate', label: 'Filing Date', type: 'date', required: true },
    { name: 'mlroApproval', label: 'MLRO Approval', type: 'checkbox', required: true },
  ],
};

export const TEMPLATE_SAR: ComplianceTemplate = {
  id: 'TPL-SAR',
  name: 'Suspicious Activity Report (SAR)',
  description: 'SAR filing form for non-transaction suspicious activity per FDL Art.26',
  category: 'Reporting',
  regulatoryBasis: 'FDL No.10/2025 Art.26, FIU goAML Guidelines',
  approvalRequired: ['mlro'],
  retentionYears: 10,
  fields: [
    { name: 'reportingEntityName', label: 'Reporting Entity Name', type: 'text', required: true },
    { name: 'mlroName', label: 'MLRO Name', type: 'text', required: true },
    { name: 'subjectName', label: 'Subject of Report', type: 'text', required: true },
    { name: 'subjectIdNumber', label: 'Subject ID Number', type: 'text', required: true },
    { name: 'subjectNationality', label: 'Subject Nationality', type: 'text', required: true },
    {
      name: 'activityDescription',
      label: 'Description of Suspicious Activity',
      type: 'textarea',
      required: true,
      helpText: 'Detailed narrative of the observed suspicious behavior or activity',
    },
    { name: 'activityDateRange', label: 'Activity Date Range', type: 'text', required: true },
    { name: 'redFlagsIdentified', label: 'Red Flags Identified', type: 'textarea', required: true },
    {
      name: 'adverseMediaFindings',
      label: 'Adverse Media Findings (if any)',
      type: 'textarea',
      required: false,
    },
    {
      name: 'linkedTransactions',
      label: 'Linked Transactions (if any)',
      type: 'textarea',
      required: false,
    },
    { name: 'actionsTaken', label: 'Actions Taken', type: 'textarea', required: true },
    {
      name: 'tippingOffPrevention',
      label: 'Tipping-Off Prevention Measures',
      type: 'textarea',
      required: true,
    },
    { name: 'filingDate', label: 'Filing Date', type: 'date', required: true },
    { name: 'mlroApproval', label: 'MLRO Approval', type: 'checkbox', required: true },
  ],
};

export const TEMPLATE_CTR: ComplianceTemplate = {
  id: 'TPL-CTR',
  name: 'Cash Transaction Report (CTR) — DPMS',
  description: 'CTR for single cash transactions >= AED 55,000 per FDL Art.16',
  category: 'Reporting',
  regulatoryBasis: 'FDL No.10/2025 Art.16, MoE Circular 08/AML/2021, FATF Rec 22',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    { name: 'reportingEntityName', label: 'Reporting Entity Name', type: 'text', required: true },
    { name: 'reportingEntityLicense', label: 'Trade License No.', type: 'text', required: true },
    { name: 'customerName', label: 'Customer Name', type: 'text', required: true },
    {
      name: 'customerIdType',
      label: 'Customer ID Type',
      type: 'select',
      required: true,
      options: ['Emirates ID', 'Passport', 'Trade License'],
    },
    { name: 'customerIdNumber', label: 'Customer ID Number', type: 'text', required: true },
    { name: 'transactionDate', label: 'Transaction Date', type: 'date', required: true },
    {
      name: 'cashAmount',
      label: 'Cash Amount (AED)',
      type: 'number',
      required: true,
      helpText: 'Must be >= AED 55,000 per DPMS threshold',
    },
    { name: 'currency', label: 'Currency', type: 'text', required: true },
    {
      name: 'transactionType',
      label: 'Transaction Type',
      type: 'select',
      required: true,
      options: ['Purchase', 'Sale', 'Exchange', 'Other'],
    },
    {
      name: 'commodityType',
      label: 'Commodity Purchased/Sold',
      type: 'select',
      required: true,
      options: [
        'Gold Bullion',
        'Gold Jewellery',
        'Silver',
        'Platinum',
        'Diamonds',
        'Precious Stones',
        'Mixed',
      ],
    },
    { name: 'weightGrams', label: 'Weight (grams)', type: 'number', required: true },
    { name: 'purity', label: 'Purity / Fineness', type: 'text', required: false },
    {
      name: 'certificateOfOrigin',
      label: 'Certificate of Origin Available',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'payerMatchesCustomer',
      label: 'Payer Matches Customer Identity',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'thirdPartyDetails',
      label: 'Third-Party Payer Details (if applicable)',
      type: 'textarea',
      required: false,
    },
    { name: 'filingDate', label: 'Filing Date', type: 'date', required: true },
    { name: 'filedBy', label: 'Filed By', type: 'text', required: true },
  ],
};

// ─── 4. TFS / Asset Freeze Form ──────────────────────────────────────────────

export const TEMPLATE_ASSET_FREEZE: ComplianceTemplate = {
  id: 'TPL-FREEZE',
  name: 'TFS Asset Freeze Report',
  description: 'Immediate asset freeze and EOCN reporting form per FDL Art.22-23',
  category: 'TFS/Sanctions',
  regulatoryBasis: 'FDL No.10/2025 Art.22-23, Cabinet Res 156/2025 Art.11, EOCN Protocol',
  approvalRequired: ['mlro', 'senior-management'],
  retentionYears: 10,
  fields: [
    { name: 'entityName', label: 'Designated Entity / Person Name', type: 'text', required: true },
    {
      name: 'matchType',
      label: 'Match Type',
      type: 'select',
      required: true,
      options: [
        'UN Sanctions List',
        'OFAC SDN List',
        'EU Sanctions List',
        'UAE Local List',
        'EOCN Designation',
      ],
    },
    {
      name: 'designationReference',
      label: 'Designation / List Reference',
      type: 'text',
      required: true,
      helpText: 'e.g., UNSC Res 1718, OFAC SDN ID, etc.',
    },
    {
      name: 'matchConfidence',
      label: 'Match Confidence',
      type: 'select',
      required: true,
      options: ['Confirmed Match', 'Potential Match — Under Review'],
    },
    {
      name: 'assetsDescription',
      label: 'Description of Assets to be Frozen',
      type: 'textarea',
      required: true,
    },
    { name: 'estimatedValue', label: 'Estimated Value (AED)', type: 'number', required: true },
    {
      name: 'freezeExecutedAt',
      label: 'Date/Time Freeze Executed',
      type: 'text',
      required: true,
      helpText: 'Must be IMMEDIATE upon identification',
    },
    { name: 'freezeExecutedBy', label: 'Freeze Executed By', type: 'text', required: true },
    {
      name: 'eocnNotifiedAt',
      label: 'Date/Time EOCN Notified',
      type: 'text',
      required: true,
      helpText: 'MUST be within 24 hours of freeze per Cabinet Res 156/2025 Art.11',
    },
    { name: 'eocnReferenceNo', label: 'EOCN Reference Number', type: 'text', required: false },
    { name: 'fiuNotified', label: 'FIU Also Notified', type: 'checkbox', required: true },
    { name: 'strFiled', label: 'STR Filed in Connection', type: 'checkbox', required: true },
    {
      name: 'customerNotified',
      label: 'Has Customer Been Notified?',
      type: 'select',
      required: true,
      options: ['No — Tipping-off prohibition applies', 'Yes — Per EOCN directive'],
      helpText: 'Per FDL Art.27, do NOT notify unless directed by EOCN',
    },
    { name: 'mlroApproval', label: 'MLRO Approval', type: 'checkbox', required: true },
    {
      name: 'seniorMgmtApproval',
      label: 'Senior Management Approval',
      type: 'checkbox',
      required: true,
    },
  ],
};

// ─── 5. Periodic Review Form ─────────────────────────────────────────────────

export const TEMPLATE_PERIODIC_REVIEW: ComplianceTemplate = {
  id: 'TPL-REVIEW',
  name: 'Periodic CDD Review',
  description: 'Scheduled CDD refresh per risk-based review frequency',
  category: 'CDD/KYC',
  regulatoryBasis: 'FDL No.10/2025 Art.12, Cabinet Res 134/2025 Art.16, MoE Guidance',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    { name: 'customerName', label: 'Customer Name', type: 'text', required: true },
    { name: 'customerId', label: 'Customer ID', type: 'text', required: true },
    {
      name: 'currentRiskRating',
      label: 'Current Risk Rating',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    { name: 'lastReviewDate', label: 'Last Review Date', type: 'date', required: true },
    {
      name: 'reviewFrequency',
      label: 'Review Frequency',
      type: 'select',
      required: true,
      options: ['3 months (High Risk)', '6 months (Medium Risk)', '12 months (Low Risk)'],
    },
    {
      name: 'kycDocsCurrent',
      label: 'KYC Documents Still Current',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'sanctionsReScreened',
      label: 'Sanctions Re-Screening Completed',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'sanctionsResult',
      label: 'Sanctions Screening Result',
      type: 'select',
      required: true,
      options: ['Clear', 'Potential Match', 'Confirmed Match'],
    },
    {
      name: 'pepReScreened',
      label: 'PEP Re-Screening Completed',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'adverseMediaChecked',
      label: 'Adverse Media Check Completed',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'transactionPatternReview',
      label: 'Transaction Pattern Review Summary',
      type: 'textarea',
      required: true,
      helpText: 'Describe any changes in transaction patterns since last review',
    },
    {
      name: 'sofSowStillValid',
      label: 'SOF/SOW Information Still Valid',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'uboChanges',
      label: 'Any Changes to Beneficial Ownership',
      type: 'select',
      required: true,
      options: ['No Changes', 'Minor Changes — Updated', 'Significant Changes — EDD Required'],
    },
    {
      name: 'riskRatingChange',
      label: 'Risk Rating Change',
      type: 'select',
      required: true,
      options: ['No Change', 'Upgraded (Higher Risk)', 'Downgraded (Lower Risk)'],
    },
    {
      name: 'newRiskRating',
      label: 'New Risk Rating (if changed)',
      type: 'select',
      required: false,
      options: ['Low', 'Medium', 'High'],
    },
    {
      name: 'reviewOutcome',
      label: 'Review Outcome',
      type: 'select',
      required: true,
      options: [
        'Continue Relationship',
        'Continue with Enhanced Monitoring',
        'Escalate for EDD',
        'Recommend Exit',
        'File STR',
      ],
    },
    { name: 'nextReviewDate', label: 'Next Review Due Date', type: 'date', required: true },
    { name: 'reviewedBy', label: 'Reviewed By', type: 'text', required: true },
    { name: 'reviewDate', label: 'Review Completion Date', type: 'date', required: true },
  ],
};

// ─── 6. EWRA Form ────────────────────────────────────────────────────────────

export const TEMPLATE_EWRA: ComplianceTemplate = {
  id: 'TPL-EWRA',
  name: 'Enterprise-Wide Risk Assessment (EWRA)',
  description: 'Annual EWRA per FDL Art.4 and FATF Rec 1',
  category: 'Risk Assessment',
  regulatoryBasis: 'FDL No.10/2025 Art.4, FATF Rec 1, MoE DPMS Supervisory Expectations',
  approvalRequired: ['mlro', 'senior-management'],
  retentionYears: 10,
  fields: [
    {
      name: 'assessmentPeriod',
      label: 'Assessment Period',
      type: 'text',
      required: true,
      placeholder: 'e.g., Jan 2025 – Dec 2025',
    },
    {
      name: 'customerRiskSummary',
      label: 'Customer Risk Summary',
      type: 'textarea',
      required: true,
      helpText: 'Breakdown of customer base by risk rating (low/medium/high)',
    },
    {
      name: 'productServiceRisks',
      label: 'Product & Service Risk Assessment',
      type: 'textarea',
      required: true,
    },
    {
      name: 'geographicRisks',
      label: 'Geographic Risk Assessment',
      type: 'textarea',
      required: true,
      helpText: 'Assessment of jurisdictional risks per FATF listings',
    },
    {
      name: 'deliveryChannelRisks',
      label: 'Delivery Channel Risks',
      type: 'textarea',
      required: true,
    },
    {
      name: 'inherentRiskLevel',
      label: 'Overall Inherent Risk Level',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    {
      name: 'controlEffectiveness',
      label: 'Control Effectiveness Assessment',
      type: 'textarea',
      required: true,
    },
    {
      name: 'residualRiskLevel',
      label: 'Residual Risk Level (After Controls)',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    {
      name: 'mlTfTypologies',
      label: 'ML/TF Typologies Relevant to DPMS',
      type: 'textarea',
      required: true,
    },
    {
      name: 'pfRiskAssessment',
      label: 'Proliferation Financing Risk Assessment',
      type: 'textarea',
      required: true,
      helpText: 'Per Cabinet Res 156/2025 and FATF Rec 1/7',
    },
    { name: 'gapIdentified', label: 'Gaps Identified', type: 'textarea', required: true },
    {
      name: 'remediationPlan',
      label: 'Remediation / Action Plan',
      type: 'textarea',
      required: true,
    },
    {
      name: 'boardApprovalDate',
      label: 'Board / Senior Management Approval Date',
      type: 'date',
      required: true,
    },
    { name: 'nextAssessmentDate', label: 'Next EWRA Due Date', type: 'date', required: true },
    { name: 'preparedBy', label: 'Prepared By (MLRO / Compliance)', type: 'text', required: true },
  ],
};

// ─── 7. Training Record Form ─────────────────────────────────────────────────

export const TEMPLATE_TRAINING: ComplianceTemplate = {
  id: 'TPL-TRAINING',
  name: 'AML/CFT Training Record',
  description: 'Training completion record per FDL Art.20',
  category: 'Training',
  regulatoryBasis: 'FDL No.10/2025 Art.20, MoE DPMS Supervisory Expectations',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    { name: 'trainingTitle', label: 'Training Title', type: 'text', required: true },
    {
      name: 'trainingType',
      label: 'Training Type',
      type: 'select',
      required: true,
      options: [
        'Annual AML/CFT Awareness',
        'New Joiner Induction',
        'Role-Specific (MLRO)',
        'Role-Specific (Analyst)',
        'Sanctions & TFS',
        'PF Awareness',
        'DPMS Sector-Specific',
        'goAML Filing',
        'Red Flag Recognition',
      ],
    },
    { name: 'trainingDate', label: 'Training Date', type: 'date', required: true },
    { name: 'duration', label: 'Duration (hours)', type: 'number', required: true },
    { name: 'provider', label: 'Training Provider', type: 'text', required: true },
    { name: 'attendeeName', label: 'Attendee Name', type: 'text', required: true },
    {
      name: 'attendeeRole',
      label: 'Attendee Role',
      type: 'select',
      required: true,
      options: [
        'Analyst',
        'Compliance Officer',
        'MLRO',
        'Senior Management',
        'Sales Staff',
        'All Staff',
      ],
    },
    { name: 'assessmentPassed', label: 'Assessment Passed', type: 'checkbox', required: true },
    {
      name: 'certificateUpload',
      label: 'Upload Certificate / Attendance Record',
      type: 'file',
      required: true,
    },
    { name: 'nextTrainingDue', label: 'Next Training Due Date', type: 'date', required: true },
  ],
};

// ─── 8. Know Your Supplier (KYS) Form ────────────────────────────────────────

export const TEMPLATE_KYS: ComplianceTemplate = {
  id: 'TPL-KYS',
  name: 'Know Your Supplier (KYS) Due Diligence',
  description: 'Supplier DD for precious metals sourcing per LBMA RGG v9 and OECD DDG',
  category: 'Supply Chain',
  regulatoryBasis: 'LBMA RGG v9, OECD Due Diligence Guidance, MoE DPMS Guidance, UAE NRA 2024',
  approvalRequired: ['compliance-officer', 'mlro'],
  retentionYears: 10,
  fields: [
    { name: 'supplierName', label: 'Supplier Legal Name', type: 'text', required: true },
    { name: 'supplierCountry', label: 'Country of Registration', type: 'text', required: true },
    {
      name: 'supplierLicenseNo',
      label: 'Trade License / Registration No.',
      type: 'text',
      required: true,
    },
    {
      name: 'supplierType',
      label: 'Supplier Type',
      type: 'select',
      required: true,
      options: ['Refinery', 'Mine', 'Trader', 'Recycler', 'Artisanal/Small-Scale'],
    },
    {
      name: 'lbmaAccredited',
      label: 'LBMA Accredited / Good Delivery List',
      type: 'checkbox',
      required: false,
    },
    {
      name: 'cahraAssessment',
      label: 'CAHRA Assessment',
      type: 'select',
      required: true,
      options: [
        'Not in CAHRA',
        'CAHRA — Enhanced DD Applied',
        'CAHRA — High Risk — Review Required',
      ],
      helpText: 'Conflict-Affected and High-Risk Area assessment per OECD DDG Annex II',
    },
    { name: 'originCountry', label: 'Country of Origin of Metals', type: 'text', required: true },
    {
      name: 'chainOfCustody',
      label: 'Chain of Custody Documentation Available',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'certificateOfOriginVerified',
      label: 'Certificate of Origin Verified',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'sanctionsScreened',
      label: 'Supplier Sanctions Screened',
      type: 'checkbox',
      required: true,
    },
    {
      name: 'sanctionsResult',
      label: 'Screening Result',
      type: 'select',
      required: true,
      options: ['Clear', 'Potential Match', 'Confirmed Match'],
    },
    {
      name: 'environmentalCompliance',
      label: 'Environmental / Ethical Standards Met',
      type: 'checkbox',
      required: false,
    },
    {
      name: 'riskRating',
      label: 'Supplier Risk Rating',
      type: 'select',
      required: true,
      options: ['Low', 'Medium', 'High'],
    },
    {
      name: 'approvalDecision',
      label: 'Approval Decision',
      type: 'select',
      required: true,
      options: ['Approved', 'Approved with Conditions', 'Rejected', 'Suspended Pending Review'],
    },
    { name: 'ddCompletedBy', label: 'DD Completed By', type: 'text', required: true },
    { name: 'ddDate', label: 'DD Completion Date', type: 'date', required: true },
    { name: 'nextReviewDate', label: 'Next Review Date', type: 'date', required: true },
  ],
};

// ─── 9. PEP Enhanced Review ─────────────────────────────────────────────────

export const TEMPLATE_PEP_REVIEW: ComplianceTemplate = {
  id: 'TPL-PEP',
  name: 'PEP Enhanced Review',
  description:
    'Enhanced review form for Politically Exposed Persons requiring board-level approval',
  category: 'PEP',
  regulatoryBasis: 'FDL No.10/2025 Art.18, Cabinet Res 134/2025 Art.14, FATF Rec 12',
  approvalRequired: ['compliance-officer', 'senior-management', 'board'],
  retentionYears: 10,
  fields: [
    { name: 'customerRef', label: 'Customer Reference', type: 'text', required: true },
    { name: 'pepName', label: 'PEP Full Name', type: 'text', required: true },
    { name: 'pepPosition', label: 'PEP Position / Title', type: 'text', required: true },
    {
      name: 'pepCategory',
      label: 'PEP Category',
      type: 'select',
      required: true,
      options: ['domestic', 'foreign', 'international-org', 'family-member', 'close-associate'],
    },
    { name: 'countryOfPEPStatus', label: 'Country of PEP Status', type: 'text', required: true },
    {
      name: 'sourceOfWealth',
      label: 'Source of Wealth',
      type: 'textarea',
      required: true,
    },
    {
      name: 'sourceOfFunds',
      label: 'Source of Funds',
      type: 'textarea',
      required: true,
    },
    {
      name: 'adverseMediaCheck',
      label: 'Adverse Media Check Result',
      type: 'select',
      required: true,
      options: ['clear', 'findings'],
    },
    {
      name: 'adverseMediaDetails',
      label: 'Adverse Media Details',
      type: 'textarea',
      required: false,
    },
    {
      name: 'riskAssessment',
      label: 'Risk Assessment',
      type: 'textarea',
      required: true,
    },
    { name: 'boardApprovalDate', label: 'Board Approval Date', type: 'date', required: true },
    { name: 'boardApproverName', label: 'Board Approver Name', type: 'text', required: true },
    {
      name: 'monitoringFrequency',
      label: 'Monitoring Frequency',
      type: 'select',
      required: true,
      options: ['3months', '6months'],
    },
    { name: 'nextReviewDate', label: 'Next Review Date', type: 'date', required: true },
    {
      name: 'evidenceAttachments',
      label: 'Evidence Attachments',
      type: 'file',
      required: true,
    },
  ],
};

// ─── 10. UBO Registration ───────────────────────────────────────────────────

export const TEMPLATE_BENEFICIAL_OWNER: ComplianceTemplate = {
  id: 'TPL-UBO',
  name: 'Beneficial Owner (UBO) Registration',
  description:
    'UBO registration form per Cabinet Decision 109/2023 for entities with >=25% ownership',
  category: 'CDD/KYC',
  regulatoryBasis: 'Cabinet Decision 109/2023, FDL No.10/2025 Art.12-14',
  approvalRequired: ['compliance-officer'],
  retentionYears: 10,
  fields: [
    { name: 'entityName', label: 'Entity Name', type: 'text', required: true },
    { name: 'entityLicenseNumber', label: 'Entity License Number', type: 'text', required: true },
    { name: 'uboFullName', label: 'UBO Full Name', type: 'text', required: true },
    { name: 'uboNationality', label: 'UBO Nationality', type: 'text', required: true },
    { name: 'uboEmiratesId', label: 'UBO Emirates ID', type: 'text', required: true },
    { name: 'uboDob', label: 'UBO Date of Birth', type: 'date', required: true },
    {
      name: 'ownershipPercentage',
      label: 'Ownership Percentage',
      type: 'number',
      required: true,
      helpText: 'Must be >=25% per Cabinet Decision 109/2023',
    },
    {
      name: 'ownershipType',
      label: 'Ownership Type',
      type: 'select',
      required: true,
      options: ['direct', 'indirect', 'control'],
    },
    {
      name: 'verificationMethod',
      label: 'Verification Method',
      type: 'select',
      required: true,
      options: ['trade-license', 'shareholder-register', 'declaration', 'other'],
    },
    { name: 'verificationDate', label: 'Verification Date', type: 'date', required: true },
    {
      name: 'uboScreeningResult',
      label: 'UBO Screening Result',
      type: 'select',
      required: true,
      options: ['clear', 'potential-match', 'confirmed-match'],
    },
    {
      name: 'pepCheck',
      label: 'PEP Check Result',
      type: 'select',
      required: true,
      options: ['clear', 'pep-identified'],
    },
    {
      name: 'evidenceAttachments',
      label: 'Evidence Attachments',
      type: 'file',
      required: true,
    },
    {
      name: 'reverificationDueDate',
      label: 'Re-verification Due Date',
      type: 'date',
      required: true,
      helpText: '15 working days after any ownership change',
    },
    {
      name: 'additionalNotes',
      label: 'Additional Notes',
      type: 'textarea',
      required: false,
    },
  ],
};

// ─── Export All Templates ────────────────────────────────────────────────────

export const ALL_TEMPLATES: ComplianceTemplate[] = [
  TEMPLATE_CDD_INDIVIDUAL,
  TEMPLATE_CDD_ENTITY,
  TEMPLATE_EDD,
  TEMPLATE_STR,
  TEMPLATE_SAR,
  TEMPLATE_CTR,
  TEMPLATE_PEP_REVIEW,
  TEMPLATE_BENEFICIAL_OWNER,
  TEMPLATE_ASSET_FREEZE,
  TEMPLATE_PERIODIC_REVIEW,
  TEMPLATE_EWRA,
  TEMPLATE_TRAINING,
  TEMPLATE_KYS,
];

/** @deprecated Use ALL_TEMPLATES instead */
export const ALL_COMPLIANCE_TEMPLATES: ComplianceTemplate[] = ALL_TEMPLATES;

export function getTemplateById(id: string): ComplianceTemplate | undefined {
  return ALL_COMPLIANCE_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): ComplianceTemplate[] {
  return ALL_COMPLIANCE_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplateCategories(): string[] {
  return [...new Set(ALL_COMPLIANCE_TEMPLATES.map((t) => t.category))];
}
