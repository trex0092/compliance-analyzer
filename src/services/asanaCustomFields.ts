/**
 * Asana Custom Fields — compliance enum → Asana custom-field GID mapping.
 *
 * Phase 4 Asana reporting: every task created by asanaSync.ts now carries
 * compliance custom fields so Asana's native dashboards can roll up risk,
 * verdict, deadline, and regulatory citation without the compliance-analyzer
 * having to build its own dashboard surface.
 *
 * Field GIDs come from environment variables (set per-workspace in Netlify)
 * so the same code runs against different Asana workspaces without hardcoded
 * GIDs in the source tree. Missing env vars make the builder return an empty
 * object — the task still gets created, just without custom fields. That's
 * the correct degradation: lose reporting, not the task.
 *
 * Expected environment variables (all optional):
 *   ASANA_CF_RISK_LEVEL_GID         — enum custom field
 *   ASANA_CF_RISK_LEVEL_CRITICAL    — enum option GID
 *   ASANA_CF_RISK_LEVEL_HIGH        — enum option GID
 *   ASANA_CF_RISK_LEVEL_MEDIUM      — enum option GID
 *   ASANA_CF_RISK_LEVEL_LOW         — enum option GID
 *   ASANA_CF_VERDICT_GID            — enum custom field
 *   ASANA_CF_VERDICT_PASS           — enum option GID
 *   ASANA_CF_VERDICT_FLAG           — enum option GID
 *   ASANA_CF_VERDICT_ESCALATE       — enum option GID
 *   ASANA_CF_VERDICT_FREEZE         — enum option GID
 *   ASANA_CF_CASE_ID_GID            — text custom field
 *   ASANA_CF_DEADLINE_TYPE_GID      — enum custom field
 *   ASANA_CF_DEADLINE_TYPE_STR      — enum option GID
 *   ASANA_CF_DEADLINE_TYPE_CTR      — enum option GID
 *   ASANA_CF_DEADLINE_TYPE_CNMR     — enum option GID
 *   ASANA_CF_DEADLINE_TYPE_DPMSR    — enum option GID
 *   ASANA_CF_DEADLINE_TYPE_EOCN     — enum option GID
 *   ASANA_CF_DAYS_REMAINING_GID     — number custom field
 *   ASANA_CF_CONFIDENCE_GID         — number custom field
 *   ASANA_CF_REGULATION_GID         — text custom field
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5yr retention — rollup visibility)
 *   - Cabinet Res 134/2025 Art.19 (internal review — SLA tracking)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';
export type DeadlineType = 'STR' | 'CTR' | 'CNMR' | 'DPMSR' | 'EOCN' | 'SAR';

export interface ComplianceCustomFieldInput {
  riskLevel?: RiskLevel;
  verdict?: Verdict;
  caseId?: string;
  deadlineType?: DeadlineType;
  daysRemaining?: number;
  confidence?: number;
  regulationCitation?: string;
}

// ---------------------------------------------------------------------------
// Env lookup — safe on both server and browser.
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  // Browser fallback: allow deployments to inject GIDs via globalThis.
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the custom_fields map for an Asana task from compliance input.
 * Returns an empty object if no custom field GIDs are configured in env.
 * The caller MUST tolerate an empty result — reporting is a reliability
 * degradation, not a hard failure.
 */
export function buildComplianceCustomFields(
  input: ComplianceCustomFieldInput
): Record<string, string | number> {
  const out: Record<string, string | number> = {};

  // Risk level (enum)
  if (input.riskLevel) {
    const fieldGid = env('ASANA_CF_RISK_LEVEL_GID');
    const optionGid = env(`ASANA_CF_RISK_LEVEL_${input.riskLevel.toUpperCase()}`);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    }
  }

  // Verdict (enum)
  if (input.verdict) {
    const fieldGid = env('ASANA_CF_VERDICT_GID');
    const optionGid = env(`ASANA_CF_VERDICT_${input.verdict.toUpperCase()}`);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    }
  }

  // Case ID (text)
  if (input.caseId) {
    const fieldGid = env('ASANA_CF_CASE_ID_GID');
    if (fieldGid) {
      out[fieldGid] = input.caseId;
    }
  }

  // Deadline type (enum)
  if (input.deadlineType) {
    const fieldGid = env('ASANA_CF_DEADLINE_TYPE_GID');
    const optionGid = env(`ASANA_CF_DEADLINE_TYPE_${input.deadlineType}`);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    }
  }

  // Days remaining (number)
  if (typeof input.daysRemaining === 'number') {
    const fieldGid = env('ASANA_CF_DAYS_REMAINING_GID');
    if (fieldGid) {
      out[fieldGid] = input.daysRemaining;
    }
  }

  // Confidence (number)
  if (typeof input.confidence === 'number') {
    const fieldGid = env('ASANA_CF_CONFIDENCE_GID');
    if (fieldGid) {
      out[fieldGid] = Math.round(input.confidence * 100);
    }
  }

  // Regulation citation (text)
  if (input.regulationCitation) {
    const fieldGid = env('ASANA_CF_REGULATION_GID');
    if (fieldGid) {
      out[fieldGid] = input.regulationCitation;
    }
  }

  return out;
}

/**
 * Utility: map case risk level → filing deadline type. Used by
 * filingAsanaSync when it doesn't have an explicit deadline type.
 */
export function deadlineTypeFromCaseType(
  caseType: string | undefined
): DeadlineType | undefined {
  if (!caseType) return undefined;
  const upper = caseType.toUpperCase();
  if (upper.includes('STR')) return 'STR';
  if (upper.includes('SAR')) return 'SAR';
  if (upper.includes('CTR')) return 'CTR';
  if (upper.includes('CNMR')) return 'CNMR';
  if (upper.includes('DPMSR')) return 'DPMSR';
  if (upper.includes('FREEZE') || upper.includes('EOCN')) return 'EOCN';
  return undefined;
}
