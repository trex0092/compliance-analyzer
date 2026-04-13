/**
 * Asana Inspector Read Access — F13.
 *
 * Generate a read-only Asana project view for a regulator inspector
 * that mirrors the regulator portal but lives inside the inspector's
 * existing Asana tooling. The orchestrator translates the resulting
 * `InspectorViewPlan` into a real Asana project + role assignment
 * via asanaClient.
 *
 * The view is locked down to:
 *   - Read-only access (no edit, no comment, no attachment upload).
 *   - Per-inspector seat — never shared.
 *   - Time-boxed expiry matching the inspection window.
 *   - Subject names ALWAYS rendered as the opaque hash, never raw.
 *
 * Pure compute. No I/O. The orchestrator + asanaClient handle the
 * project + role API calls.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (supervisor access)
 *   FATF Methodology 2022 §4
 *   EOCN Inspection Manual §9
 *   FDL Art.29 (no tipping off — even inspectors see only hashes
 *               for active investigations)
 */

export interface InspectorViewInput {
  /** Plain-text inspector name. */
  inspectorName: string;
  /** Authority code: 'EOCN' | 'MoE' | 'FIU' | 'LBMA' etc. */
  authority: string;
  /** ISO timestamp the inspection window opens. */
  windowStartIso: string;
  /** ISO timestamp the inspection window closes. */
  windowEndIso: string;
  /** Tenant being inspected. */
  tenantId: string;
}

export interface InspectorViewPlan {
  projectName: string;
  description: string;
  /** Asana sections to create, in display order. */
  sections: readonly string[];
  /** Permission overrides — orchestrator applies via Asana role API. */
  permissions: {
    readOnly: true;
    expiresAtIso: string;
    inspector: {
      name: string;
      authority: string;
    };
  };
  /** Regulatory disclaimer the orchestrator pins to every task it creates. */
  disclaimer: string;
}

const DAYS_MS = 24 * 60 * 60 * 1000;
const HARD_MAX_WINDOW_DAYS = 90; // even an inspection cannot last more than 3 months without renewal

export function buildInspectorView(input: InspectorViewInput): InspectorViewPlan {
  const startMs = new Date(input.windowStartIso).getTime();
  const endMs = new Date(input.windowEndIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('buildInspectorView: invalid window');
  }
  const cappedEndMs = Math.min(endMs, startMs + HARD_MAX_WINDOW_DAYS * DAYS_MS);
  const fromDay = new Date(startMs).toISOString().slice(0, 10);
  const toDay = new Date(cappedEndMs).toISOString().slice(0, 10);

  const projectName = `[INSPECTOR — READ ONLY] ${input.authority} ${fromDay} → ${toDay}`;
  const description =
    `Read-only inspection view for ${input.inspectorName} (${input.authority}).\n\n` +
    `Tenant: ${input.tenantId}\n` +
    `Window: ${fromDay} → ${toDay}\n\n` +
    `This project is automatically created by the compliance brain and is reset at the close of the inspection window. ` +
    `Subject names are rendered as opaque hashes (FDL Art.29). No edit, comment, or attachment-upload permissions are granted.`;
  const disclaimer =
    'INSPECTOR READ-ONLY VIEW — every entry rendered with a hashed subject id. ' +
    'Direct contact with the underlying subject is prohibited (FDL Art.29). ' +
    'For full unredacted access, request the audit pack via the inspector portal one-time-code flow.';

  return {
    projectName,
    description,
    sections: [
      'Open incidents',
      'Closed incidents',
      'Filed reports',
      'Audit anchors',
      'Drift reports',
      'KPI snapshots',
    ],
    permissions: {
      readOnly: true,
      expiresAtIso: new Date(cappedEndMs).toISOString(),
      inspector: { name: input.inspectorName, authority: input.authority },
    },
    disclaimer,
  };
}
