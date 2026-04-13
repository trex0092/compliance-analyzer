/**
 * CDD → Asana Custom Field Push.
 *
 * When a CDD record is saved, customer name / risk tier / jurisdiction
 * / UBO count / PEP flag / sanctions flag must land on the customer's
 * compliance task in Asana as native custom fields. The field GIDs
 * already exist in the workspace (wired via env vars — see
 * asanaCustomFields.ts) but nothing has been pushing CDD snapshots to
 * them. This module bridges that gap.
 *
 * Pure builder (buildCddCustomFieldPayload) plus dispatcher
 * (pushCddCustomFields). The builder takes a CustomerProfile and
 * returns a `custom_fields` map ready to hand to updateAsanaTask.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14 (CDD)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiers — SDD/CDD/EDD)
 *   - Cabinet Res 134/2025 Art.14 (PEP / EDD)
 *   - Cabinet Decision 109/2023 (UBO ≥25% re-verification)
 *   - FDL No.10/2025 Art.24 (10yr record retention — rollup visibility)
 */

import type { CustomerProfile } from '../domain/customers';
import { isAsanaConfigured, asanaRequestWithRetry } from './asanaClient';
import {
  buildComplianceCustomFields,
  type RiskLevel,
  type ComplianceCustomFieldInput,
} from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CddCustomFieldInput {
  customer: CustomerProfile;
  /** Target Asana task GID to update (usually the customer's case task). */
  taskGid: string;
  /** Optional explicit CDD level override — defaults to derivation. */
  cddLevelOverride?: 'SDD' | 'CDD' | 'EDD';
  /** Optional regulatory citation override. */
  regulationCitation?: string;
}

export interface CddCustomFieldPushResult {
  ok: boolean;
  error?: string;
  /** The payload that was (or would have been) sent. */
  payload: Record<string, string | number>;
  /** The derived CDD level for logging. */
  derivedCddLevel: 'SDD' | 'CDD' | 'EDD';
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * Map the customer risk rating + PEP/sanctions flags to a CDD tier.
 * High/PEP/sanctions → EDD; medium → CDD; low → SDD. This mirrors the
 * decision tree in CLAUDE.md "When a new customer is onboarded" and is
 * intentionally conservative.
 */
export function deriveCddLevel(customer: CustomerProfile): 'SDD' | 'CDD' | 'EDD' {
  if (
    customer.riskRating === 'high' ||
    customer.pepStatus !== 'clear' ||
    customer.sanctionsStatus !== 'clear'
  ) {
    return 'EDD';
  }
  if (customer.riskRating === 'medium') {
    return 'CDD';
  }
  return 'SDD';
}

function deriveRiskLevel(customer: CustomerProfile): RiskLevel {
  if (customer.pepStatus === 'match' || customer.sanctionsStatus === 'match') {
    return 'critical';
  }
  if (customer.riskRating === 'high') return 'high';
  if (customer.riskRating === 'medium') return 'medium';
  return 'low';
}

function countQualifyingUBOs(customer: CustomerProfile): number {
  // UBO register threshold: ownership >= 25% (Cabinet Decision 109/2023).
  return customer.beneficialOwners.filter(
    (b) => typeof b.ownershipPercent === 'number' && b.ownershipPercent >= 25
  ).length;
}

// ---------------------------------------------------------------------------
// Pure payload builder
// ---------------------------------------------------------------------------

/**
 * Build the custom_fields payload for a CDD → Asana push. Pure — no
 * I/O, safe to unit test without mocking fetch.
 *
 * Every field is degradation-tolerant: if the env GID is not
 * configured, asanaCustomFields.ts silently drops the entry. The
 * payload may therefore be empty; the caller MUST tolerate that.
 */
export function buildCddCustomFieldPayload(
  input: CddCustomFieldInput
): { payload: Record<string, string | number>; derivedCddLevel: 'SDD' | 'CDD' | 'EDD' } {
  const { customer } = input;
  const derivedCddLevel = input.cddLevelOverride ?? deriveCddLevel(customer);
  const riskLevel = deriveRiskLevel(customer);

  // Map the CDD level into the compliance custom-field input shape.
  // We set:
  //   - riskLevel (enum)
  //   - verdict (enum)            — "flag" if EDD/PEP/sanctions
  //   - caseId (text)             — customer id so Asana rollups match
  //   - cddLevel (string)         — SDD / CDD / EDD label
  //   - confidence (number)       — 1.0 if both SoF & SoW verified
  //   - regulationCitation (text)
  const verdict: ComplianceCustomFieldInput['verdict'] =
    derivedCddLevel === 'EDD' ? 'flag' : 'pass';

  const confidence =
    customer.sourceOfFundsStatus === 'verified' &&
    customer.sourceOfWealthStatus === 'verified'
      ? 1.0
      : 0.6;

  const payload = buildComplianceCustomFields({
    riskLevel,
    verdict,
    caseId: customer.id,
    confidence,
    cddLevel: derivedCddLevel,
    regulationCitation:
      input.regulationCitation ??
      `FDL Art.12-14; Cabinet Res 134/2025 Art.${derivedCddLevel === 'EDD' ? '14' : '7-10'}`,
    sanctionsFlag:
      customer.pepStatus !== 'clear' || customer.sanctionsStatus !== 'clear',
  });

  // Side-channel fields that asanaCustomFields doesn't currently map —
  // we attach them under optional env GIDs so deployments can pick them
  // up without changing the core builder.
  const extra: Record<string, string | number> = { ...payload };
  const nameGid = readEnv('ASANA_CF_CUSTOMER_NAME_GID');
  if (nameGid) extra[nameGid] = customer.legalName;
  const jurisdictionGid = readEnv('ASANA_CF_JURISDICTION_GID');
  if (jurisdictionGid && customer.countryOfRegistration) {
    extra[jurisdictionGid] = customer.countryOfRegistration;
  }
  const uboCountGid = readEnv('ASANA_CF_UBO_COUNT_GID');
  if (uboCountGid) extra[uboCountGid] = countQualifyingUBOs(customer);
  const pepFlagGid = readEnv('ASANA_CF_PEP_FLAG_GID');
  if (pepFlagGid) extra[pepFlagGid] = customer.pepStatus === 'clear' ? 'NO' : 'YES';

  return { payload: extra, derivedCddLevel };
}

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Push CDD custom fields onto an existing Asana task. Skips the API
 * call when the derived payload is empty (no env GIDs configured) —
 * no point spending a rate-limit slot on a no-op update.
 */
export async function pushCddCustomFields(
  input: CddCustomFieldInput
): Promise<CddCustomFieldPushResult> {
  const { payload, derivedCddLevel } = buildCddCustomFieldPayload(input);

  if (!isAsanaConfigured()) {
    return {
      ok: false,
      error: 'Asana not configured',
      payload,
      derivedCddLevel,
    };
  }

  if (Object.keys(payload).length === 0) {
    return {
      ok: true,
      error: 'No custom field GIDs configured — push is a no-op',
      payload,
      derivedCddLevel,
    };
  }

  const result = await asanaRequestWithRetry<{ gid: string }>(
    `/tasks/${encodeURIComponent(input.taskGid)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        data: { custom_fields: payload },
      }),
    }
  );

  return {
    ok: result.ok,
    error: result.error,
    payload,
    derivedCddLevel,
  };
}
