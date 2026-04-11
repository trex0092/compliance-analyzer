/**
 * ISO/IEC 42001:2023 — AI Management System control library.
 *
 * ISO/IEC 42001 is the first international certifiable standard for
 * AI management systems (AIMS). It borrows the Annex SL management
 * system structure used by ISO 27001 and ISO 9001, so organisations
 * can plug AI governance into existing ISMS / QMS machinery.
 *
 * This file encodes 15 controls drawn from Annex A (AI management
 * controls). Numbering mirrors ISO 42001:2023 Annex A.
 */

import type { Control } from './types';

export const ISO_42001_CONTROLS: readonly Control[] = [
  {
    id: 'ISO-42001-A.2.2',
    title: 'AI policy documented',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.2.2',
    requirement: 'Organisation has a documented AI policy approved by leadership.',
    evidenceKeys: ['hasDataGovernancePolicy'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.2.4',
    title: 'Roles and responsibilities',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.2.4',
    requirement: 'AI-related roles, responsibilities, and authorities are defined and communicated.',
    evidenceKeys: ['hasAgentIdentity', 'hasAgentPermissions'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.3.2',
    title: 'Internal organisation for AI',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.3.2',
    requirement: 'Processes exist for reporting AI-related concerns and incidents.',
    evidenceKeys: ['hasIncidentReporting'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.4.2',
    title: 'Resources for AI systems',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.4.2',
    requirement: 'Adequate resources (data, compute, personnel) are allocated to AI systems.',
    evidenceKeys: ['hasModelInventory'],
    severity: 'medium',
  },
  {
    id: 'ISO-42001-A.5.2',
    title: 'AI system impact assessment',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.5.2',
    requirement: 'Impact assessments are performed for AI systems before deployment.',
    evidenceKeys: ['hasImpactAssessment'],
    severity: 'critical',
  },
  {
    id: 'ISO-42001-A.6.1',
    title: 'AI system lifecycle',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.6.1',
    requirement: 'AI system lifecycle is documented from design through retirement.',
    evidenceKeys: ['hasModelVersioning'],
    severity: 'medium',
  },
  {
    id: 'ISO-42001-A.6.2',
    title: 'Risk treatment',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.6.2',
    requirement: 'Identified risks have defined treatments and residual-risk owners.',
    evidenceKeys: ['hasRiskRegister', 'hasRiskAssessment'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.6.3',
    title: 'Human oversight mechanisms',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.6.3',
    requirement: 'Human oversight is implemented proportionate to AI system risk.',
    evidenceKeys: ['hasHumanOversight', 'hasFourEyesApproval'],
    severity: 'critical',
  },
  {
    id: 'ISO-42001-A.7.2',
    title: 'Data quality',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.7.2',
    requirement: 'Data used in AI systems meets quality requirements.',
    evidenceKeys: ['hasDataQualityChecks', 'hasTrainingDataLineage'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.7.3',
    title: 'Data privacy',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.7.3',
    requirement: 'Personal data in AI systems is handled in accordance with privacy obligations.',
    evidenceKeys: ['hasAccessControl'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.8.2',
    title: 'System information to users',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.8.2',
    requirement: 'Users of the AI system receive information about its purpose, limitations, and results.',
    evidenceKeys: ['hasUserDisclosure', 'hasExplainability'],
    severity: 'medium',
  },
  {
    id: 'ISO-42001-A.9.2',
    title: 'Performance monitoring',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.9.2',
    requirement: 'AI system performance is monitored throughout its lifetime.',
    evidenceKeys: ['hasMonitoring', 'hasDriftDetection'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.9.3',
    title: 'Internal audit of AIMS',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.9.3',
    requirement: 'The AIMS is subject to periodic internal audits.',
    evidenceKeys: ['hasAuditTrail'],
    severity: 'high',
  },
  {
    id: 'ISO-42001-A.10.2',
    title: 'Incident investigation',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.10.2',
    requirement: 'AI incidents are investigated and root causes addressed.',
    evidenceKeys: ['hasIncidentReporting'],
    severity: 'critical',
  },
  {
    id: 'ISO-42001-A.10.3',
    title: 'Continuous improvement',
    framework: 'iso_42001',
    citation: 'ISO/IEC 42001:2023 A.10.3',
    requirement: 'The AIMS is continually improved based on audit findings and incident learnings.',
    evidenceKeys: ['hasAuditTrail', 'hasIncidentReporting'],
    severity: 'medium',
  },
];
