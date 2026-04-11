/**
 * EU AI Act control library.
 *
 * EU Regulation 2024/1689 (AI Act) — full enforcement for high-risk
 * systems lands August 2026. The compliance-analyzer is a high-risk AI
 * system under Annex III (point 5a — access to essential financial
 * services; point 6b — creditworthiness evaluation; arguably point 8
 * — justice / democracy for the sanctions decision path). That means
 * the full conformity-assessment, registration, and post-market
 * monitoring obligations apply.
 *
 * This file encodes 15 concrete controls the self-audit can check
 * against the compliance-analyzer repo. Each control cites the
 * specific Article. The control set is NOT exhaustive — it's the
 * minimum-viable starting point. Future regulatory updates should
 * extend this library and bump REGULATORY_CONSTANTS_VERSION.
 */

import type { Control } from './types';

export const EU_AI_ACT_CONTROLS: readonly Control[] = [
  {
    id: 'EU-AIA-01',
    title: 'Risk classification documented',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.6 + Annex III',
    requirement:
      'The AI system must be classified into one of the four risk tiers (unacceptable, high, limited, minimal) with written justification.',
    tier: 'high',
    evidenceKeys: ['hasRiskAssessment'],
    severity: 'critical',
  },
  {
    id: 'EU-AIA-02',
    title: 'Risk management system in place',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.9',
    requirement:
      'A risk management system operating across the AI system lifecycle, including identification, estimation, and evaluation of risks.',
    tier: 'high',
    evidenceKeys: ['hasRiskRegister', 'hasImpactAssessment'],
    severity: 'critical',
  },
  {
    id: 'EU-AIA-03',
    title: 'Data governance for training data',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.10',
    requirement:
      'Training, validation and test datasets must be subject to data governance practices covering lineage, bias, and quality.',
    tier: 'high',
    evidenceKeys: ['hasDataGovernancePolicy', 'hasTrainingDataLineage', 'hasBiasAssessment', 'hasDataQualityChecks'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-04',
    title: 'Technical documentation',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.11 + Annex IV',
    requirement:
      'Technical documentation describing the AI system, its intended purpose, and the evidence for conformity.',
    tier: 'high',
    evidenceKeys: ['hasModelInventory', 'hasModelCards'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-05',
    title: 'Record-keeping (logging)',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.12',
    requirement:
      'Automatic recording of events while the AI system operates, traceable per decision.',
    tier: 'high',
    evidenceKeys: ['hasDecisionLogging', 'hasAuditTrail'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-06',
    title: 'Transparency and user information',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.13',
    requirement:
      'The AI system must be designed to allow users to interpret its output and to be informed they are interacting with AI.',
    tier: 'high',
    evidenceKeys: ['hasExplainability', 'hasUserDisclosure'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-07',
    title: 'Human oversight',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.14',
    requirement:
      'Effective human oversight including the ability to override, intervene, or stop the system.',
    tier: 'high',
    evidenceKeys: ['hasHumanOversight', 'hasKillSwitch', 'hasFourEyesApproval'],
    severity: 'critical',
  },
  {
    id: 'EU-AIA-08',
    title: 'Accuracy, robustness, and cybersecurity',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.15',
    requirement:
      'Appropriate levels of accuracy, robustness, and cybersecurity throughout the lifecycle.',
    tier: 'high',
    evidenceKeys: ['hasSecurityTesting', 'hasAccessControl'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-09',
    title: 'Quality management system',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.17',
    requirement:
      'Providers must put in place a documented quality management system for the AI system.',
    tier: 'high',
    evidenceKeys: ['hasRiskRegister'],
    severity: 'medium',
  },
  {
    id: 'EU-AIA-10',
    title: 'Conformity assessment',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.43',
    requirement:
      'High-risk systems must undergo a conformity assessment before being placed on the market.',
    tier: 'high',
    evidenceKeys: ['hasImpactAssessment'],
    severity: 'critical',
  },
  {
    id: 'EU-AIA-11',
    title: 'Registration in the EU database',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.49',
    requirement:
      'High-risk AI systems must be registered in the EU-wide database maintained by the Commission.',
    tier: 'high',
    evidenceKeys: ['hasModelInventory'],
    severity: 'medium',
  },
  {
    id: 'EU-AIA-12',
    title: 'Post-market monitoring',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.72',
    requirement:
      'Providers must establish a post-market monitoring system proportionate to the risk.',
    tier: 'high',
    evidenceKeys: ['hasMonitoring', 'hasPostMarketMonitoring', 'hasDriftDetection'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-13',
    title: 'Serious incident reporting',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.73',
    requirement:
      'Providers must report serious incidents to the national competent authority within 15 days.',
    tier: 'high',
    evidenceKeys: ['hasIncidentReporting'],
    severity: 'critical',
  },
  {
    id: 'EU-AIA-14',
    title: 'Fundamental rights impact assessment',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.27',
    requirement:
      'Deployers of high-risk AI systems in the financial sector must perform a fundamental rights impact assessment.',
    tier: 'high',
    evidenceKeys: ['hasImpactAssessment'],
    severity: 'high',
  },
  {
    id: 'EU-AIA-15',
    title: 'Prohibited practices — no biometric categorisation',
    framework: 'eu_ai_act',
    citation: 'EU Reg 2024/1689 Art.5',
    requirement:
      'The system must not perform real-time remote biometric identification or inferring emotions in workplace / education.',
    tier: 'unacceptable',
    evidenceKeys: [],
    severity: 'critical',
  },
];
