/**
 * NIST AI Risk Management Framework (AI RMF 1.0) control library.
 *
 * The NIST AI RMF organises controls into four functions:
 *
 *   Govern  — culture, processes, accountability
 *   Map     — context, categorisation, impact
 *   Measure — testing, monitoring, documentation
 *   Manage  — treatment, response, communication
 *
 * US-aligned but widely adopted globally as an operating playbook.
 * This file encodes 20 controls covering the four functions. Every
 * control cites the specific category (e.g. GV-1.1, MP-2.3).
 */

import type { Control } from './types';

export const NIST_AI_RMF_CONTROLS: readonly Control[] = [
  // Govern
  {
    id: 'NIST-GV-1.1',
    title: 'Policies and procedures documented',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-1.1',
    requirement:
      'Legal and regulatory requirements involving AI are understood, managed, and documented.',
    nistFunction: 'govern',
    evidenceKeys: ['hasDataGovernancePolicy'],
    severity: 'high',
  },
  {
    id: 'NIST-GV-1.2',
    title: 'Characteristics of trustworthy AI integrated',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-1.2',
    requirement:
      'Characteristics of trustworthy AI are integrated into organisational policies, processes, and procedures.',
    nistFunction: 'govern',
    evidenceKeys: ['hasExplainability', 'hasHumanOversight'],
    severity: 'high',
  },
  {
    id: 'NIST-GV-1.5',
    title: 'AI risk management processes defined',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-1.5',
    requirement:
      'Ongoing AI risk management, including risk treatment options, are defined, documented, and communicated.',
    nistFunction: 'govern',
    evidenceKeys: ['hasRiskAssessment', 'hasRiskRegister'],
    severity: 'high',
  },
  {
    id: 'NIST-GV-1.6',
    title: 'Security architecture for AI',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-1.6',
    requirement:
      'Mechanisms are in place to inventory AI systems and address security, privacy, and fairness risks.',
    nistFunction: 'govern',
    evidenceKeys: ['hasModelInventory', 'hasSecurityTesting', 'hasAccessControl'],
    severity: 'critical',
  },
  {
    id: 'NIST-GV-2.1',
    title: 'Shadow AI detection',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-2.1',
    requirement:
      'Roles and responsibilities for AI systems are defined, documented, and communicated — unauthorized AI usage ("shadow AI") is detected and controlled.',
    nistFunction: 'govern',
    evidenceKeys: ['hasShadowAiScan', 'hasApprovedToolList'],
    severity: 'high',
  },
  {
    id: 'NIST-GV-4.1',
    title: 'Agentic AI identity management',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF GV-4.1 (agentic extension)',
    requirement:
      'Autonomous AI agents have documented identity, scoped permissions, and an audit trail of every action they take.',
    nistFunction: 'govern',
    evidenceKeys: ['hasAgentIdentity', 'hasAgentPermissions', 'hasAgentAuditTrail'],
    severity: 'critical',
  },

  // Map
  {
    id: 'NIST-MP-1.1',
    title: 'Context of use established',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MP-1.1',
    requirement:
      'Intended purposes, potentially beneficial uses, context-specific laws, norms, and expectations are understood.',
    nistFunction: 'map',
    evidenceKeys: ['hasImpactAssessment'],
    severity: 'high',
  },
  {
    id: 'NIST-MP-1.2',
    title: 'AI system categorisation',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MP-1.2',
    requirement:
      'The AI system is categorised according to its risk level and intended use.',
    nistFunction: 'map',
    evidenceKeys: ['hasRiskAssessment'],
    severity: 'high',
  },
  {
    id: 'NIST-MP-2.3',
    title: 'Impact assessment covers stakeholders',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MP-2.3',
    requirement:
      'Potential impacts on individuals, groups, communities, and the environment are identified.',
    nistFunction: 'map',
    evidenceKeys: ['hasImpactAssessment'],
    severity: 'medium',
  },
  {
    id: 'NIST-MP-4.1',
    title: 'Model inventory maintained',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MP-4.1',
    requirement:
      'An inventory of AI systems, including versions, training data, and intended purposes.',
    nistFunction: 'map',
    evidenceKeys: ['hasModelInventory', 'hasModelVersioning'],
    severity: 'high',
  },

  // Measure
  {
    id: 'NIST-MS-1.1',
    title: 'AI system testing',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MS-1.1',
    requirement:
      'Appropriate methods are used to evaluate AI system performance and trustworthiness.',
    nistFunction: 'measure',
    evidenceKeys: ['hasSecurityTesting'],
    severity: 'high',
  },
  {
    id: 'NIST-MS-1.2',
    title: 'Bias assessment',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MS-1.2',
    requirement:
      'Potential biases in training data and model outputs are measured and documented.',
    nistFunction: 'measure',
    evidenceKeys: ['hasBiasAssessment'],
    severity: 'high',
  },
  {
    id: 'NIST-MS-2.1',
    title: 'Drift detection',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MS-2.1',
    requirement:
      'AI system performance is monitored continuously and drift is detected.',
    nistFunction: 'measure',
    evidenceKeys: ['hasDriftDetection', 'hasMonitoring'],
    severity: 'high',
  },
  {
    id: 'NIST-MS-2.2',
    title: 'Explainability evaluated',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MS-2.2',
    requirement:
      'The interpretability of AI system decisions is measured.',
    nistFunction: 'measure',
    evidenceKeys: ['hasExplainability'],
    severity: 'medium',
  },
  {
    id: 'NIST-MS-4.1',
    title: 'Audit trail for decisions',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MS-4.1',
    requirement:
      'Every AI system decision is logged and traceable.',
    nistFunction: 'measure',
    evidenceKeys: ['hasDecisionLogging', 'hasAuditTrail'],
    severity: 'critical',
  },

  // Manage
  {
    id: 'NIST-MG-1.1',
    title: 'Risk treatment plan',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MG-1.1',
    requirement:
      'A risk treatment plan identifies, prioritises, and addresses AI risks.',
    nistFunction: 'manage',
    evidenceKeys: ['hasRiskRegister'],
    severity: 'high',
  },
  {
    id: 'NIST-MG-2.1',
    title: 'Incident response',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MG-2.1',
    requirement:
      'Mechanisms are in place to respond to AI incidents.',
    nistFunction: 'manage',
    evidenceKeys: ['hasIncidentReporting'],
    severity: 'critical',
  },
  {
    id: 'NIST-MG-3.1',
    title: 'Human oversight checkpoints',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MG-3.1',
    requirement:
      'Human oversight checkpoints are defined for high-impact decisions.',
    nistFunction: 'manage',
    evidenceKeys: ['hasHumanOversight', 'hasFourEyesApproval'],
    severity: 'critical',
  },
  {
    id: 'NIST-MG-3.2',
    title: 'Kill switch available',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MG-3.2',
    requirement:
      'A kill switch or disable mechanism is available for autonomous systems.',
    nistFunction: 'manage',
    evidenceKeys: ['hasKillSwitch'],
    severity: 'critical',
  },
  {
    id: 'NIST-MG-4.1',
    title: 'Post-deployment monitoring',
    framework: 'nist_ai_rmf',
    citation: 'NIST AI RMF MG-4.1',
    requirement:
      'Post-deployment monitoring captures real-world performance.',
    nistFunction: 'manage',
    evidenceKeys: ['hasPostMarketMonitoring'],
    severity: 'high',
  },
];
