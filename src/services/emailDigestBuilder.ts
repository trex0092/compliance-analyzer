/**
 * Email Digest Builder — daily / weekly / monthly operator digest
 * templates. Pure function — takes a structured `DigestInput` and
 * returns plain-text + HTML strings ready for SMTP dispatch.
 *
 * Why this exists:
 *   The tool produces structured telemetry hourly but operators do
 *   not want hourly emails. A single well-designed daily digest is
 *   the right cadence for the CO, and a weekly one for the Board.
 *
 *   This module is the pure template. No SMTP, no network — the cron
 *   wrapper reads telemetry + incidents + SLA data, feeds them in,
 *   and sends the resulting string via the SMTP adapter.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational visibility)
 *   FDL No.10/2025 Art.29    (no tipping off — digests never
 *                              mention subject identities)
 *   Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   NIST AI RMF 1.0 GOVERN-3 (oversight via regular digest)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DigestCadence = 'daily' | 'weekly' | 'monthly';

export interface DigestInput {
  tenantId: string;
  tenantLegalName: string;
  cadence: DigestCadence;
  windowStartIso: string;
  windowEndIso: string;
  /** Total decisions in the window. */
  totalDecisions: number;
  /** Per-verdict counts. */
  verdictCounts: Readonly<Record<'pass' | 'flag' | 'escalate' | 'freeze', number>>;
  /** Number of STR/SAR drafts created. */
  strDraftsCreated: number;
  /** Number of SLA breaches (already breached in the window). */
  slaBreaches: number;
  /** Number of clamp suggestions still pending MLRO review. */
  pendingClampSuggestions: number;
  /** Number of break-glass requests still pending approval. */
  pendingBreakGlass: number;
  /** Top FATF typologies observed. */
  topTypologies: ReadonlyArray<{ id: string; label: string; count: number }>;
  /** Average brain power score over the window. */
  avgPowerScore: number | null;
  /** Drift detected? */
  driftDetected: boolean;
  /** Fuzzer robustness score. */
  robustnessScore: number | null;
  /** Recipient display name. */
  recipientName: string;
}

export interface DigestOutput {
  schemaVersion: 1;
  subject: string;
  text: string;
  html: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cadenceLabel(c: DigestCadence): string {
  return c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : 'Monthly';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildDigest(input: DigestInput): DigestOutput {
  const { verdictCounts } = input;
  const subject = `[HAWKEYE STERLING] ${cadenceLabel(input.cadence)} digest — ${input.tenantLegalName}`;

  const textLines: string[] = [];
  textLines.push(`HAWKEYE STERLING — ${cadenceLabel(input.cadence)} digest`);
  textLines.push(`Tenant: ${input.tenantLegalName} (${input.tenantId})`);
  textLines.push(`Window: ${input.windowStartIso} → ${input.windowEndIso}`);
  textLines.push(`Recipient: ${input.recipientName}`);
  textLines.push('');
  textLines.push(`Total decisions: ${input.totalDecisions}`);
  textLines.push(
    `  pass:     ${verdictCounts.pass} (${pct(verdictCounts.pass, input.totalDecisions)})`
  );
  textLines.push(
    `  flag:     ${verdictCounts.flag} (${pct(verdictCounts.flag, input.totalDecisions)})`
  );
  textLines.push(
    `  escalate: ${verdictCounts.escalate} (${pct(verdictCounts.escalate, input.totalDecisions)})`
  );
  textLines.push(
    `  freeze:   ${verdictCounts.freeze} (${pct(verdictCounts.freeze, input.totalDecisions)})`
  );
  textLines.push('');
  textLines.push(`STR drafts created: ${input.strDraftsCreated}`);
  textLines.push(`SLA breaches:       ${input.slaBreaches}${input.slaBreaches > 0 ? ' ⚠' : ''}`);
  textLines.push(`Pending clamp suggestions: ${input.pendingClampSuggestions}`);
  textLines.push(`Pending break-glass:       ${input.pendingBreakGlass}`);
  textLines.push('');
  textLines.push(
    `Average brain power score: ${input.avgPowerScore !== null ? input.avgPowerScore.toFixed(1) : 'n/a'}`
  );
  textLines.push(
    `Fuzzer robustness:         ${input.robustnessScore !== null ? `${input.robustnessScore}/100` : 'n/a'}`
  );
  textLines.push(`Drift detected:            ${input.driftDetected ? 'YES ⚠' : 'no'}`);
  textLines.push('');
  if (input.topTypologies.length > 0) {
    textLines.push('Top FATF typologies:');
    for (const t of input.topTypologies) {
      textLines.push(`  - ${t.label} (${t.id}): ${t.count}`);
    }
  }
  textLines.push('');
  textLines.push('Regulatory anchors:');
  textLines.push('  - FDL No.10/2025 Art.20-22, Art.24, Art.29');
  textLines.push('  - Cabinet Res 134/2025 Art.19');
  textLines.push('  - NIST AI RMF 1.0 GOVERN-3');
  textLines.push('');
  textLines.push('This digest NEVER names individual customers (FDL Art.29).');
  textLines.push('Click into the Brain Console to review underlying cases.');

  const text = textLines.join('\n');

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#fafafa; margin:0; padding:20px;">
  <div style="max-width: 640px; margin:0 auto; background:#ffffff; border-radius:8px; padding:24px; border:1px solid #e5e5e5;">
    <h1 style="font-size:18px; color:#d4a843; margin:0 0 6px 0;">HAWKEYE STERLING</h1>
    <div style="font-size:12px; color:#888; margin-bottom:16px;">${cadenceLabel(input.cadence)} digest &middot; ${escapeHtml(input.tenantLegalName)}</div>

    <h2 style="font-size:14px; color:#333;">Decisions in window</h2>
    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <tr><td style="padding:4px 8px;">Total</td><td style="padding:4px 8px; text-align:right;"><strong>${input.totalDecisions}</strong></td></tr>
      <tr><td style="padding:4px 8px;">Pass</td><td style="padding:4px 8px; text-align:right;">${verdictCounts.pass}</td></tr>
      <tr><td style="padding:4px 8px;">Flag</td><td style="padding:4px 8px; text-align:right;">${verdictCounts.flag}</td></tr>
      <tr><td style="padding:4px 8px;">Escalate</td><td style="padding:4px 8px; text-align:right;">${verdictCounts.escalate}</td></tr>
      <tr><td style="padding:4px 8px;">Freeze</td><td style="padding:4px 8px; text-align:right; color:#D94F4F;"><strong>${verdictCounts.freeze}</strong></td></tr>
    </table>

    <h2 style="font-size:14px; color:#333; margin-top:16px;">Compliance queue</h2>
    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <tr><td style="padding:4px 8px;">STR drafts</td><td style="padding:4px 8px; text-align:right;">${input.strDraftsCreated}</td></tr>
      <tr><td style="padding:4px 8px;">SLA breaches</td><td style="padding:4px 8px; text-align:right; ${input.slaBreaches > 0 ? 'color:#D94F4F;font-weight:700;' : ''}">${input.slaBreaches}</td></tr>
      <tr><td style="padding:4px 8px;">Pending clamp suggestions</td><td style="padding:4px 8px; text-align:right;">${input.pendingClampSuggestions}</td></tr>
      <tr><td style="padding:4px 8px;">Pending break-glass</td><td style="padding:4px 8px; text-align:right;">${input.pendingBreakGlass}</td></tr>
    </table>

    <h2 style="font-size:14px; color:#333; margin-top:16px;">Brain health</h2>
    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <tr><td style="padding:4px 8px;">Avg power score</td><td style="padding:4px 8px; text-align:right;">${input.avgPowerScore !== null ? input.avgPowerScore.toFixed(1) : 'n/a'}</td></tr>
      <tr><td style="padding:4px 8px;">Robustness</td><td style="padding:4px 8px; text-align:right;">${input.robustnessScore !== null ? `${input.robustnessScore}/100` : 'n/a'}</td></tr>
      <tr><td style="padding:4px 8px;">Drift detected</td><td style="padding:4px 8px; text-align:right; ${input.driftDetected ? 'color:#D94F4F;font-weight:700;' : ''}">${input.driftDetected ? 'YES' : 'no'}</td></tr>
    </table>

    <div style="font-size:10px; color:#888; margin-top:24px; border-top:1px solid #e5e5e5; padding-top:12px; line-height:1.6;">
      This digest NEVER names individual customers (FDL Art.29).<br>
      Regulatory anchors: FDL Art.20-22/24/29 &middot; Cabinet Res 134/2025 Art.19 &middot; NIST AI RMF 1.0 GOVERN-3
    </div>
  </div>
</body>
</html>`;

  return {
    schemaVersion: 1,
    subject,
    text,
    html,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'FDL No.10/2025 Art.29',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 GOVERN-3',
    ],
  };
}

// Exports for tests.
export const __test__ = { cadenceLabel, escapeHtml, pct };
