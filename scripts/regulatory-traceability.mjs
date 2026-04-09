/**
 * Regulatory Traceability Matrix
 * Maps every regulatory requirement to its implementation, test, and evidence.
 * Used for MoE inspections, LBMA audits, and internal compliance reviews.
 */

export const TRACEABILITY_MATRIX = [
  // FDL No.10/2025
  { id: 'REQ-001', law: 'FDL No.10/2025', article: 'Art.12-14', requirement: 'Customer Due Diligence (CDD)', implementation: 'compliance-suite.js → CRA module', test: 'tests/scoring.test.ts', evidence: 'CDD records in data store', status: 'IMPLEMENTED' },
  { id: 'REQ-002', law: 'FDL No.10/2025', article: 'Art.15-16', requirement: 'Transaction thresholds (AED 55K CTR)', implementation: 'src/domain/constants.ts → DPMS_CASH_THRESHOLD_AED', test: 'tests/constants.test.ts', evidence: 'CTR filing records', status: 'IMPLEMENTED' },
  { id: 'REQ-003', law: 'FDL No.10/2025', article: 'Art.20-21', requirement: 'Compliance Officer duties', implementation: 'compliance-suite.js → Governance module', test: 'tests/rbacGuard.test.ts', evidence: 'CO appointment records', status: 'IMPLEMENTED' },
  { id: 'REQ-004', law: 'FDL No.10/2025', article: 'Art.24', requirement: 'Record retention (5 years min)', implementation: 'scripts/evidence-chain.mjs', test: 'tests/auditChain.test.ts', evidence: 'Evidence chain with 10yr archive', status: 'IMPLEMENTED' },
  { id: 'REQ-005', law: 'FDL No.10/2025', article: 'Art.26-27', requirement: 'STR filing without delay', implementation: 'compliance-suite.js → STR module, skills/goaml', test: 'tests/goamlValidator.test.ts', evidence: 'goAML XML filings', status: 'IMPLEMENTED' },
  { id: 'REQ-006', law: 'FDL No.10/2025', article: 'Art.29', requirement: 'No tipping off', implementation: 'STR workflow restricts subject visibility', test: 'Manual verification', evidence: 'STR access controls', status: 'IMPLEMENTED' },
  { id: 'REQ-007', law: 'FDL No.10/2025', article: 'Art.35', requirement: 'Targeted Financial Sanctions (TFS)', implementation: 'tfs-refresh.js, screening modules', test: 'tests/multiModelScreening.test.ts', evidence: 'Sanctions screening logs', status: 'IMPLEMENTED' },

  // Cabinet Res 134/2025
  { id: 'REQ-008', law: 'Cabinet Res 134/2025', article: 'Art.5', requirement: 'Risk appetite framework', implementation: 'src/domain/constants.ts → RISK_THRESHOLDS', test: 'tests/scoring.test.ts', evidence: 'Risk appetite statement', status: 'IMPLEMENTED' },
  { id: 'REQ-009', law: 'Cabinet Res 134/2025', article: 'Art.7-10', requirement: 'CDD tiers (SDD/CDD/EDD)', implementation: 'compliance-suite.js → CRA/CDD/EDD', test: 'tests/decisions.test.ts', evidence: 'CDD tier assignments', status: 'IMPLEMENTED' },
  { id: 'REQ-010', law: 'Cabinet Res 134/2025', article: 'Art.14', requirement: 'PEP Enhanced Due Diligence', implementation: 'screening modules, compliance-suite.js', test: 'tests/multiModelScreening.test.ts', evidence: 'PEP screening results', status: 'IMPLEMENTED' },
  { id: 'REQ-011', law: 'Cabinet Res 134/2025', article: 'Art.16', requirement: 'Cross-border cash AED 60K', implementation: 'src/domain/constants.ts → CROSS_BORDER_CASH_THRESHOLD_AED', test: 'tests/constants.test.ts', evidence: 'Cross-border declarations', status: 'IMPLEMENTED' },
  { id: 'REQ-012', law: 'Cabinet Res 134/2025', article: 'Art.18', requirement: 'CO change notification', implementation: 'workflow-engine.js → notification rules', test: 'Manual verification', evidence: 'Notification logs', status: 'IMPLEMENTED' },
  { id: 'REQ-013', law: 'Cabinet Res 134/2025', article: 'Art.19', requirement: 'Internal compliance review', implementation: 'scripts/compliance-health-score.mjs', test: 'Autopilot daily run', evidence: 'Health score reports', status: 'IMPLEMENTED' },

  // Cabinet Res 74/2020 (TFS)
  { id: 'REQ-014', law: 'Cabinet Res 74/2020', article: 'Art.4-7', requirement: 'Asset freeze within 24 hours', implementation: 'tfs-refresh.js, screening alerts', test: 'tests/multiModelScreening.test.ts', evidence: 'Freeze action logs', status: 'IMPLEMENTED' },
  { id: 'REQ-015', law: 'Cabinet Res 74/2020', article: 'Art.6', requirement: 'CNMR filing within 5 business days', implementation: 'src/domain/constants.ts → CNMR_FILING_DEADLINE_BUSINESS_DAYS', test: 'tests/businessDays.test.ts', evidence: 'CNMR filing records', status: 'IMPLEMENTED' },

  // Cabinet Res 156/2025 (PF)
  { id: 'REQ-016', law: 'Cabinet Res 156/2025', article: 'Full', requirement: 'PF risk assessment', implementation: 'src/domain/constants.ts → PF_HIGH_RISK_JURISDICTIONS, DUAL_USE_KEYWORDS', test: 'tests/constants.test.ts', evidence: 'PF risk assessments', status: 'IMPLEMENTED' },

  // Cabinet Decision 109/2023 (UBO)
  { id: 'REQ-017', law: 'Cabinet Decision 109/2023', article: 'Full', requirement: 'UBO register (>25%)', implementation: 'compliance-suite.js → UBO Register', test: 'tests/scoring.test.ts', evidence: 'UBO register entries', status: 'IMPLEMENTED' },
  { id: 'REQ-018', law: 'Cabinet Decision 109/2023', article: 'Full', requirement: 'UBO re-verification within 15 working days', implementation: 'src/domain/constants.ts → UBO_REVERIFICATION_WORKING_DAYS', test: 'tests/constants.test.ts', evidence: 'UBO change logs', status: 'IMPLEMENTED' },

  // Cabinet Res 71/2024 (Penalties)
  { id: 'REQ-019', law: 'Cabinet Res 71/2024', article: 'Full', requirement: 'Administrative penalty framework', implementation: 'scripts/moe-inspection-simulator.mjs', test: 'Autopilot MOE simulation', evidence: 'Penalty exposure reports', status: 'IMPLEMENTED' },

  // MoE Circular 08/AML/2021
  { id: 'REQ-020', law: 'MoE Circular 08/AML/2021', article: 'Full', requirement: 'goAML registration & reporting', implementation: 'skills/goaml, integrations-enhanced.js', test: 'tests/goamlValidator.test.ts', evidence: 'goAML submission logs', status: 'IMPLEMENTED' },
  { id: 'REQ-021', law: 'MoE Circular 08/AML/2021', article: 'Full', requirement: 'Quarterly DPMS reports', implementation: 'scripts/compliance-calendar.mjs', test: 'Calendar check', evidence: 'DPMS report archives', status: 'IMPLEMENTED' },
  { id: 'REQ-022', law: 'MoE Circular 08/AML/2021', article: 'Full', requirement: 'AED 55K CTR threshold for DPMS', implementation: 'src/domain/constants.ts → DPMS_CASH_THRESHOLD_AED', test: 'tests/constants.test.ts', evidence: 'Transaction monitoring logs', status: 'IMPLEMENTED' },

  // LBMA RGG v9
  { id: 'REQ-023', law: 'LBMA RGG v9', article: 'Step 1-5', requirement: '5-step due diligence framework', implementation: 'supply-chain.js', test: 'Manual verification', evidence: 'Supply chain DD records', status: 'IMPLEMENTED' },
  { id: 'REQ-024', law: 'LBMA RGG v9', article: 'CAHRA', requirement: 'CAHRA due diligence', implementation: 'src/domain/constants.ts → EU_HIGH_RISK_COUNTRIES', test: 'tests/constants.test.ts', evidence: 'CAHRA screening results', status: 'IMPLEMENTED' },
  { id: 'REQ-025', law: 'LBMA RGG v9', article: 'Audit', requirement: 'Annual responsible gold audit', implementation: 'scripts/compliance-calendar.mjs → LBMA-AUDIT', test: 'Calendar check', evidence: 'Audit reports', status: 'IMPLEMENTED' },

  // FATF Rec 22/23
  { id: 'REQ-026', law: 'FATF Rec 22/23', article: 'Rec 22', requirement: 'DPMS CDD obligations', implementation: 'compliance-suite.js → CRA module', test: 'tests/scoring.test.ts', evidence: 'CDD records', status: 'IMPLEMENTED' },
  { id: 'REQ-027', law: 'FATF Rec 22/23', article: 'Rec 23', requirement: 'DPMS record-keeping', implementation: 'scripts/evidence-chain.mjs', test: 'tests/auditChain.test.ts', evidence: 'Evidence chain', status: 'IMPLEMENTED' },
  { id: 'REQ-028', law: 'FATF Rec 22/23', article: 'Rec 23', requirement: 'DPMS STR obligations', implementation: 'compliance-suite.js → STR module', test: 'tests/goamlValidator.test.ts', evidence: 'STR filings', status: 'IMPLEMENTED' },

  // UAE MoE RSG / DGD
  { id: 'REQ-029', law: 'UAE MoE RSG', article: 'Full', requirement: 'Responsible sourcing origin traceability', implementation: 'supply-chain.js', test: 'Manual verification', evidence: 'Supply chain records', status: 'IMPLEMENTED' },
  { id: 'REQ-030', law: 'DGD Standard', article: 'Full', requirement: 'Refiner accreditation & assay certification', implementation: 'supply-chain.js', test: 'Manual verification', evidence: 'Accreditation records', status: 'IMPLEMENTED' },
];
