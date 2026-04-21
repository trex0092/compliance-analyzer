/**
 * Policy DSL Bridge — wires the per-tenant policy DSL rule
 * catalogue into the super-brain verdict pipeline.
 *
 * The policy DSL (src/services/policyDsl.ts) lets compliance
 * officers write rules like:
 *
 *     when risk_level == "critical" => freeze
 *     when pep_status != "clear" and country in ["KP", "IR"] => escalate
 *     when cash_amount > 55000 => flag
 *     default => pass
 *
 * This bridge builds a Facts map from a ComplianceCase +
 * CustomerProfile, runs the compiled policy, and returns the
 * override verdict. The super-brain dispatcher consults the
 * override BEFORE its own clamp table, so tenant-specific rules
 * can harden (but never soften) the default verdict.
 *
 * Hardening-only rule: if the policy says `pass` but the
 * case→brain derivation says `freeze`, the brain wins. The
 * policy can only take a verdict UP the ladder (pass → flag →
 * escalate → freeze), never down. This is a safety invariant.
 *
 * Pure function. No I/O. Tests cover the hardening invariant
 * and the facts builder.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite — per-tenant
 *     policy implements the firm's risk appetite)
 *   - FDL No.10/2025 Art.29 (no tipping off — facts builder
 *     uses case id, never entity legal name)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { Verdict } from './asanaCustomFields';
import { evaluatePolicy, type Policy, type Facts, parsePolicy } from './policyDsl';
import { UBO_OWNERSHIP_THRESHOLD_PCT } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyBridgeInput {
  case: ComplianceCase;
  customer?: CustomerProfile;
  /** Pre-compiled policy (parsePolicy result) or null to skip. */
  policy: Policy | null;
}

export interface PolicyBridgeResult {
  /** Verdict after hardening clamp against the brain default. */
  finalVerdict: Verdict;
  /** Raw policy verdict before hardening. */
  policyVerdict: Verdict;
  /** Brain default verdict passed in by the caller. */
  brainVerdict: Verdict;
  /** Whether the hardening invariant kicked in. */
  hardenedUp: boolean;
  /** Which policy rule matched, if any. */
  matchedRule?: string;
  /** Count of rules evaluated before a match. */
  evaluatedRules: number;
}

// ---------------------------------------------------------------------------
// Facts builder — pure
// ---------------------------------------------------------------------------

/**
 * Build a Facts map from a case + customer profile. Every fact
 * is a primitive (string / number / boolean / null) so the
 * policy DSL evaluator can handle it without special casing.
 */
export function buildPolicyFacts(input: Omit<PolicyBridgeInput, 'policy'>): Facts {
  const { case: c, customer } = input;
  return {
    case_id: c.id,
    case_type: c.caseType,
    status: c.status,
    risk_level: c.riskLevel,
    risk_score: c.riskScore,
    red_flag_count: c.redFlags?.length ?? 0,
    finding_count: c.findings?.length ?? 0,
    recommendation: c.recommendation,
    source_module: c.sourceModule,
    // Customer facets (optional)
    customer_type: customer?.type ?? null,
    customer_risk_rating: customer?.riskRating ?? null,
    customer_country: customer?.countryOfRegistration ?? null,
    pep_status: customer?.pepStatus ?? null,
    sanctions_status: customer?.sanctionsStatus ?? null,
    source_of_funds_status: customer?.sourceOfFundsStatus ?? null,
    source_of_wealth_status: customer?.sourceOfWealthStatus ?? null,
    ubo_count:
      customer?.beneficialOwners?.filter(
        (b) =>
          typeof b.ownershipPercent === 'number' &&
          // ownershipPercent is 0-100; constant is 0-1 decimal.
          // Cabinet Decision 109/2023 beneficial-ownership threshold.
          b.ownershipPercent >= UBO_OWNERSHIP_THRESHOLD_PCT * 100
      ).length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Hardening clamp
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function hardenVerdict(policyVerdict: Verdict, brainVerdict: Verdict): Verdict {
  return VERDICT_RANK[policyVerdict] > VERDICT_RANK[brainVerdict] ? policyVerdict : brainVerdict;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/**
 * Apply the policy DSL on top of a brain verdict. Returns the
 * final verdict after the hardening clamp.
 */
export function applyPolicyBridge(
  input: PolicyBridgeInput,
  brainVerdict: Verdict
): PolicyBridgeResult {
  if (!input.policy) {
    return {
      finalVerdict: brainVerdict,
      policyVerdict: brainVerdict,
      brainVerdict,
      hardenedUp: false,
      evaluatedRules: 0,
    };
  }
  const facts = buildPolicyFacts(input);
  const trace = evaluatePolicy(input.policy, facts);
  const policyVerdict = trace.verdict;
  const finalVerdict = hardenVerdict(policyVerdict, brainVerdict);
  return {
    finalVerdict,
    policyVerdict,
    brainVerdict,
    hardenedUp: finalVerdict !== brainVerdict,
    matchedRule: trace.matchedRule ? `rule-line-${trace.matchedRule.lineNumber}` : undefined,
    evaluatedRules: trace.evaluatedRules,
  };
}

// ---------------------------------------------------------------------------
// Persistent policy storage
// ---------------------------------------------------------------------------

const POLICY_STORAGE_KEY = 'fgl_super_brain_policy_source';

export function saveSuperBrainPolicy(source: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(POLICY_STORAGE_KEY, source);
  } catch {
    /* storage quota */
  }
}

export function loadSuperBrainPolicy(): Policy | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const source = localStorage.getItem(POLICY_STORAGE_KEY);
    if (!source) return null;
    return parsePolicy(source);
  } catch {
    return null;
  }
}
