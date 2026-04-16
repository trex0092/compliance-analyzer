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
 *   - FDL No.10/2025 Art.24 (10yr retention — rollup visibility)
 *   - Cabinet Res 134/2025 Art.19 (internal review — SLA tracking)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';
export type DeadlineType = 'STR' | 'CTR' | 'CNMR' | 'DPMSR' | 'EOCN' | 'SAR';

/**
 * Manual action state — surfaces the "this freeze needs MLRO action
 * in the bank portal because we can't call a banking API" signal as
 * a coloured chip on the Asana task card. Tier-4 #13 from the Asana
 * setup gap audit.
 */
export type ManualActionState = 'pending' | 'done';

export interface ComplianceCustomFieldInput {
  riskLevel?: RiskLevel;
  verdict?: Verdict;
  caseId?: string;
  deadlineType?: DeadlineType;
  daysRemaining?: number;
  confidence?: number;
  regulationCitation?: string;
  /**
   * Optional numeric risk score (0–100). Silently dropped by the
   * builder when no corresponding Asana field GID is configured — same
   * degradation contract as every other field in this interface.
   */
  riskScore?: number;
  /** Optional CDD level label (SDD / CDD / EDD). */
  cddLevel?: string;
  /** Optional sanctions flag for enum custom field. */
  sanctionsFlag?: boolean;
  /** Optional ESG grade (A–F). */
  esgGrade?: string;
  /**
   * Optional manual-action flag. Set to 'pending' on freeze
   * verdicts so the MLRO sees a red chip on the task card prompting
   * them to execute the freeze in the bank portal manually (we
   * don't have a banking-rail API integration yet). Cleared to
   * 'done' once the MLRO confirms the manual freeze landed.
   */
  manualActionRequired?: ManualActionState;
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
// Observability — "silent degradation" but not silent ops.
//
// The builder intentionally returns an empty record when a field GID is
// missing (see the file header for the design rationale). The cost of
// that contract is that an operator cannot see from the Asana task alone
// whether reporting was skipped for a field. We keep the degradation
// but emit a warn-once log per missing key so the gap is observable in
// the Netlify function log stream. The set is process-local; it resets
// on cold start, which is the right behaviour — a fresh deploy should
// re-emit warnings so a missing env var after a deploy is visible.
// ---------------------------------------------------------------------------

const warnedKeys: Set<string> = new Set();

function warnMissing(key: string, context: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[asanaCustomFields] Skipping ${context}: env ${key} is not set. ` +
      `Task will be created without this field. Run POST /api/asana/migrate-schema?apply=1 ` +
      `to provision the workspace schema, then configure the returned GIDs as env vars.`
  );
}

/**
 * Reset the warn-once state. Exported for tests only; production code
 * should never call this. Prefixed with an underscore to discourage
 * accidental use.
 */
export function _resetWarnedKeysForTest(): void {
  warnedKeys.clear();
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
    const optionKey = `ASANA_CF_RISK_LEVEL_${input.riskLevel.toUpperCase()}`;
    const optionGid = env(optionKey);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    } else {
      if (!fieldGid) warnMissing('ASANA_CF_RISK_LEVEL_GID', 'risk_level field');
      if (fieldGid && !optionGid) warnMissing(optionKey, `risk_level option ${input.riskLevel}`);
    }
  }

  // Verdict (enum)
  if (input.verdict) {
    const fieldGid = env('ASANA_CF_VERDICT_GID');
    const optionKey = `ASANA_CF_VERDICT_${input.verdict.toUpperCase()}`;
    const optionGid = env(optionKey);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    } else {
      if (!fieldGid) warnMissing('ASANA_CF_VERDICT_GID', 'verdict field');
      if (fieldGid && !optionGid) warnMissing(optionKey, `verdict option ${input.verdict}`);
    }
  }

  // Case ID (text)
  if (input.caseId) {
    const fieldGid = env('ASANA_CF_CASE_ID_GID');
    if (fieldGid) {
      out[fieldGid] = input.caseId;
    } else {
      warnMissing('ASANA_CF_CASE_ID_GID', 'case_id field');
    }
  }

  // Deadline type (enum)
  if (input.deadlineType) {
    const fieldGid = env('ASANA_CF_DEADLINE_TYPE_GID');
    const optionKey = `ASANA_CF_DEADLINE_TYPE_${input.deadlineType}`;
    const optionGid = env(optionKey);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    } else {
      if (!fieldGid) warnMissing('ASANA_CF_DEADLINE_TYPE_GID', 'deadline_type field');
      if (fieldGid && !optionGid)
        warnMissing(optionKey, `deadline_type option ${input.deadlineType}`);
    }
  }

  // Days remaining (number)
  if (typeof input.daysRemaining === 'number') {
    const fieldGid = env('ASANA_CF_DAYS_REMAINING_GID');
    if (fieldGid) {
      out[fieldGid] = input.daysRemaining;
    } else {
      warnMissing('ASANA_CF_DAYS_REMAINING_GID', 'days_remaining field');
    }
  }

  // Confidence (number)
  if (typeof input.confidence === 'number') {
    const fieldGid = env('ASANA_CF_CONFIDENCE_GID');
    if (fieldGid) {
      out[fieldGid] = Math.round(input.confidence * 100);
    } else {
      warnMissing('ASANA_CF_CONFIDENCE_GID', 'confidence field');
    }
  }

  // Regulation citation (text)
  if (input.regulationCitation) {
    const fieldGid = env('ASANA_CF_REGULATION_GID');
    if (fieldGid) {
      out[fieldGid] = input.regulationCitation;
    } else {
      warnMissing('ASANA_CF_REGULATION_GID', 'regulation field');
    }
  }

  // Manual action required (enum) — Tier-4 #13. Surfaces the "MLRO
  // needs to execute this in the bank portal" signal as a coloured
  // chip on the task card.
  if (input.manualActionRequired) {
    const fieldGid = env('ASANA_CF_MANUAL_ACTION_GID');
    const optionGid = env(`ASANA_CF_MANUAL_ACTION_${input.manualActionRequired.toUpperCase()}`);
    if (fieldGid && optionGid) {
      out[fieldGid] = optionGid;
    }
  }

  return out;
}

/**
 * Utility: map case risk level → filing deadline type. Used by
 * filingAsanaSync when it doesn't have an explicit deadline type.
 */
export function deadlineTypeFromCaseType(caseType: string | undefined): DeadlineType | undefined {
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
