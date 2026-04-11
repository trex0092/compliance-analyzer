/**
 * UAE AI Governance control library.
 *
 * The UAE does not (as of April 2026) have a single codified AI Act
 * comparable to EU Reg 2024/1689. Instead, AI governance obligations
 * are derived from:
 *
 *   - National AI Strategy 2031 (Ministerial endorsement)
 *   - UAE AI Charter (transparency, accountability, fairness)
 *   - Federal Law No.45/2021 on Personal Data Protection (PDPL)
 *   - Central Bank of UAE Information Security Regulation (CN 15/2021)
 *   - MoE Circular 08/AML/2021 (DPMS reporting applies to AI in
 *     compliance tooling)
 *
 * When the UAE publishes a specific AI regulation, this file will be
 * the first place to update — extend the control list here, bump
 * REGULATORY_CONSTANTS_VERSION, and re-run the self-audit.
 *
 * For now, this library encodes 7 controls drawn from the AI Charter
 * principles and the PDPL. Every control cites its source.
 */

import type { Control } from './types';

export const UAE_AI_GOV_CONTROLS: readonly Control[] = [
  {
    id: 'UAE-AIG-01',
    title: 'Alignment with National AI Strategy 2031',
    framework: 'uae_ai_gov',
    citation: 'UAE National AI Strategy 2031',
    requirement:
      'AI systems deployed in the UAE should align with the goals of the National AI Strategy, including sustainability and citizen benefit.',
    evidenceKeys: ['hasUaeAlignment'],
    severity: 'low',
  },
  {
    id: 'UAE-AIG-02',
    title: 'Transparency and explainability (AI Charter)',
    framework: 'uae_ai_gov',
    citation: 'UAE AI Charter Principle 3',
    requirement:
      'AI systems must provide transparent and explainable decisions to affected parties.',
    evidenceKeys: ['hasExplainability', 'hasUserDisclosure'],
    severity: 'high',
  },
  {
    id: 'UAE-AIG-03',
    title: 'Accountability (AI Charter)',
    framework: 'uae_ai_gov',
    citation: 'UAE AI Charter Principle 4',
    requirement:
      'A clear chain of accountability exists for AI system decisions, including human oversight for consequential outcomes.',
    evidenceKeys: ['hasHumanOversight', 'hasFourEyesApproval', 'hasAuditTrail'],
    severity: 'critical',
  },
  {
    id: 'UAE-AIG-04',
    title: 'Data residency',
    framework: 'uae_ai_gov',
    citation: 'Federal Law 45/2021 (PDPL) + CBUAE CN 15/2021',
    requirement:
      'Personal data processed by AI systems should comply with UAE data residency and protection rules.',
    evidenceKeys: ['hasLocalDataResidency', 'hasAccessControl'],
    severity: 'high',
  },
  {
    id: 'UAE-AIG-05',
    title: 'Arabic language support',
    framework: 'uae_ai_gov',
    citation: 'UAE AI Charter Principle 6',
    requirement: 'AI systems serving UAE users should support Arabic for user-facing interactions.',
    evidenceKeys: ['hasArabicSupport'],
    severity: 'medium',
  },
  {
    id: 'UAE-AIG-06',
    title: 'DPMS compliance reporting (MoE)',
    framework: 'uae_ai_gov',
    citation: 'MoE Circular 08/AML/2021',
    requirement:
      'AI systems used in DPMS compliance must support goAML reporting and the quarterly DPMS return.',
    evidenceKeys: ['hasDecisionLogging', 'hasAuditTrail'],
    severity: 'high',
  },
  {
    id: 'UAE-AIG-07',
    title: 'Bias mitigation for UAE populations',
    framework: 'uae_ai_gov',
    citation: 'UAE AI Charter Principle 5',
    requirement:
      'AI system bias is measured and mitigated with attention to UAE-resident populations and expatriate communities.',
    evidenceKeys: ['hasBiasAssessment'],
    severity: 'high',
  },
];
