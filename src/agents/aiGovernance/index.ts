/**
 * AI Governance Agent — public entry point.
 *
 * Re-exports the control libraries, assessor, self-audit map, audit
 * runner, and types so callers can import from a single path:
 *
 *   import { runGovernanceAudit, SELF_AUDIT_EVIDENCE } from '@/agents/aiGovernance';
 */

export * from './types';
export { EU_AI_ACT_CONTROLS } from './euAiAct';
export { NIST_AI_RMF_CONTROLS } from './nistAiRmf';
export { ISO_42001_CONTROLS } from './iso42001';
export { UAE_AI_GOV_CONTROLS } from './uaeAiGov';
export { assessFramework } from './assessor';
export { SELF_AUDIT_EVIDENCE, extendSelfAudit } from './selfAudit';
export { runGovernanceAudit } from './auditRunner';
export type { RunAuditOptions } from './auditRunner';
