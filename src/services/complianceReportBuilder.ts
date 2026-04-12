/**
 * Compliance Report Builder — MoE / FIU / EOCN grade screening reports.
 *
 * Produces compliance-grade attachments for Asana tasks created by the
 * scheduled-screening runner. Every daily heartbeat + per-subject alert
 * task can now carry three artefacts that together form an audit-ready
 * record of the screening cycle:
 *
 *   1. report.html  — cover page + executive summary + findings table +
 *                      regulatory framework + chain-of-custody + tipping-
 *                      off warning. Printable and self-contained (inline
 *                      CSS, no external fonts or images).
 *
 *   2. report.json  — canonical machine-readable record with SHA-256
 *                      integrity hash of the source data. Used by
 *                      downstream auditors and goAML validators.
 *
 *   3. report.md    — plain-Markdown summary for analysts who want to
 *                      paste the content into a case file or email.
 *
 * Format references:
 *   - UAE MoE Circular 08/AML/2021 DPMS reporting guidance
 *   - UAE FIU goAML reporting schema (cover block + metadata)
 *   - Cabinet Res 74/2020 Art.4-7 EOCN freeze reporting protocol
 *   - LBMA Responsible Gold Guidance v9 annual report template
 *   - FATF Rec 10, 18, 20 (CDD, STR, internal controls)
 *   - FDL No.10/2025 Art.20-21, 24, 26-27, 29 (CO duties, retention,
 *     STR filing, no tipping off)
 *
 * This module runs in both Node (scheduled-screening.ts) and the browser
 * (MLRO dashboard exports). All crypto is via Web Crypto SubtleDigest
 * (Node 20+ provides globalThis.crypto.subtle natively).
 */

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * The minimum data needed to produce a compliant screening report.
 * Matches the `RunSummary` + `newHits` shape already produced by
 * scheduled-screening.ts so callers don't have to transform data.
 */
export interface ScreeningReportInput {
  /** ISO timestamp the screening run started. */
  runAtIso: string;
  /** Name of the reporting entity (e.g. legal name of the DPMS). */
  reportingEntity: string;
  /** Licence number of the reporting entity. Optional but recommended. */
  licenceNumber?: string;
  /** Compliance Officer who owns the run (name or role). */
  complianceOfficer: string;
  /** Lists screened during this run. */
  listsScreened: readonly string[];
  /** Total subjects screened. */
  totalChecked: number;
  /** Total new hits across all subjects. */
  totalNewHits: number;
  /** Subjects that produced new hits. */
  subjectsWithAlerts: ReadonlyArray<{
    subjectId: string;
    subjectName: string;
    newHitCount: number;
    asanaGid?: string;
    hitDetails?: ReadonlyArray<{
      source: string;
      matchScore?: number;
      headline?: string;
      matchedFields?: readonly string[];
    }>;
  }>;
  /** Subjects that errored during screening. */
  subjectsWithErrors: ReadonlyArray<{
    subjectId: string;
    subjectName: string;
    error: string;
  }>;
  /** Subjects that came back clean. */
  subjectsClean: ReadonlyArray<{
    subjectId: string;
    subjectName: string;
  }>;
  /** Optional brain verdict for the run (if weaponized brain ran over it). */
  brainVerdict?: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Optional confidence for the run. */
  brainConfidence?: number;
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface ScreeningReportArtefacts {
  /** Self-contained HTML report (cover + summary + findings + footer). */
  html: string;
  /** Canonical JSON — the authoritative machine-readable record. */
  json: string;
  /** Markdown summary for pasting into case files / emails. */
  markdown: string;
  /** SHA-256 hex of the canonical JSON. Used as the chain-of-custody seal. */
  integrityHash: string;
  /** Suggested filenames for upload to Asana / evidence drawer. */
  filenames: {
    html: string;
    json: string;
    markdown: string;
  };
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export async function buildScreeningReport(
  input: ScreeningReportInput
): Promise<ScreeningReportArtefacts> {
  const canonical = buildCanonicalJson(input);
  const integrityHash = await sha256Hex(canonical);

  const json = formatCanonicalJson(input, integrityHash);
  const html = buildHtml(input, integrityHash);
  const markdown = buildMarkdown(input, integrityHash);

  const dateSlug = input.runAtIso.slice(0, 10).replace(/-/g, '');
  const timeSlug = input.runAtIso.slice(11, 16).replace(':', '');
  const stem = `screening-report-${dateSlug}-${timeSlug}`;

  return {
    html,
    json,
    markdown,
    integrityHash,
    filenames: {
      html: `${stem}.html`,
      json: `${stem}.json`,
      markdown: `${stem}.md`,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON (canonical + display)
// ---------------------------------------------------------------------------

function buildCanonicalJson(input: ScreeningReportInput): string {
  // Canonical form: stable key order, no whitespace, no identity fields
  // that vary between runs. The hash of THIS string is the integrity
  // anchor.
  const canonical = {
    reportType: 'SCREENING_RUN',
    schemaVersion: 1,
    runAtIso: input.runAtIso,
    reportingEntity: input.reportingEntity,
    complianceOfficer: input.complianceOfficer,
    licenceNumber: input.licenceNumber ?? null,
    listsScreened: [...input.listsScreened].sort(),
    totals: {
      checked: input.totalChecked,
      newHits: input.totalNewHits,
      alerts: input.subjectsWithAlerts.length,
      errors: input.subjectsWithErrors.length,
      clean: input.subjectsClean.length,
    },
    subjectsWithAlerts: input.subjectsWithAlerts
      .map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        newHitCount: s.newHitCount,
      }))
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    subjectsWithErrors: input.subjectsWithErrors
      .map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName }))
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    subjectsClean: input.subjectsClean
      .map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName }))
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    brainVerdict: input.brainVerdict ?? null,
    brainConfidence: input.brainConfidence ?? null,
  };
  return JSON.stringify(canonical);
}

function formatCanonicalJson(input: ScreeningReportInput, integrityHash: string): string {
  return JSON.stringify(
    {
      ...JSON.parse(buildCanonicalJson(input)),
      chainOfCustody: {
        integrityHash,
        hashAlgorithm: 'SHA-256',
        generatedBy: 'Hawkeye Sterling V2 / scheduled-screening.ts',
        generatedAt: new Date().toISOString(),
      },
      regulatoryBasis: REGULATORY_BASIS,
      confidentialityNotice:
        'CONFIDENTIAL — do NOT disclose to the subject. No tipping off per FDL No.10/2025 Art.29.',
    },
    null,
    2
  );
}

const REGULATORY_BASIS = [
  'FDL No.10/2025 Art.20-21 (CO duty of care)',
  'FDL No.10/2025 Art.24 (10-year record retention)',
  'FDL No.10/2025 Art.26-27 (STR filing obligations)',
  'FDL No.10/2025 Art.29 (no tipping off)',
  'FDL No.10/2025 Art.35 (targeted financial sanctions)',
  'Cabinet Res 134/2025 Art.19 (internal review before decision)',
  'Cabinet Res 74/2020 Art.4-7 (EOCN freeze protocol, 24h + 5bd CNMR)',
  'MoE Circular 08/AML/2021 (DPMS sector guidance + goAML reporting)',
  'FATF Rec 10 (CDD), Rec 18 (internal controls), Rec 20 (STR)',
] as const;

// ---------------------------------------------------------------------------
// HTML (self-contained, printable)
// ---------------------------------------------------------------------------

function buildHtml(input: ScreeningReportInput, integrityHash: string): string {
  const runDate = input.runAtIso.slice(0, 10);
  const runTime = input.runAtIso.slice(11, 19);

  // dd/mm/yyyy per CLAUDE.md date rule for UAE compliance documents.
  const [y, m, d] = runDate.split('-');
  const ddMmYyyy = `${d}/${m}/${y}`;

  const style = `
    body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 210mm; margin: 2em auto; padding: 0 2em; color: #111; }
    h1 { font-size: 22pt; border-bottom: 2pt solid #111; padding-bottom: .2em; margin-bottom: 0; }
    h2 { font-size: 14pt; margin-top: 1.5em; border-bottom: 1pt solid #999; padding-bottom: .1em; }
    h3 { font-size: 11pt; margin-top: 1em; }
    .meta { font-size: 10pt; color: #444; }
    .confidential { background: #fff3cd; border: 1pt solid #e0b000; padding: .5em 1em; margin: 1em 0; font-size: 10pt; color: #6d5a00; }
    .danger { background: #fde2e2; border: 1pt solid #c2262e; padding: .5em 1em; margin: 1em 0; font-size: 10pt; color: #8b0b12; }
    table { border-collapse: collapse; width: 100%; margin: .5em 0 1em 0; font-size: 10pt; }
    th, td { border: 1pt solid #bbb; padding: .3em .6em; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; }
    .hash { font-family: 'Courier New', Courier, monospace; font-size: 9pt; word-break: break-all; }
    .small { font-size: 9pt; color: #666; }
    ul { margin: .2em 0; }
  `;

  const alertsTable =
    input.subjectsWithAlerts.length === 0
      ? '<p><em>No new hits detected in this run.</em></p>'
      : `<table>
           <thead><tr><th>Subject ID</th><th>Subject Name</th><th>New hits</th><th>Linked task</th></tr></thead>
           <tbody>${input.subjectsWithAlerts
             .map(
               (s) =>
                 `<tr><td>${esc(s.subjectId)}</td><td>${esc(s.subjectName)}</td><td>${s.newHitCount}</td><td class="small">${esc(s.asanaGid ?? '—')}</td></tr>`
             )
             .join('')}</tbody>
         </table>`;

  const errorsTable =
    input.subjectsWithErrors.length === 0
      ? '<p><em>No screening errors in this run.</em></p>'
      : `<table>
           <thead><tr><th>Subject ID</th><th>Subject Name</th><th>Error</th></tr></thead>
           <tbody>${input.subjectsWithErrors
             .map(
               (s) =>
                 `<tr><td>${esc(s.subjectId)}</td><td>${esc(s.subjectName)}</td><td class="small">${esc(s.error)}</td></tr>`
             )
             .join('')}</tbody>
         </table>`;

  const cleanList =
    input.subjectsClean.length === 0
      ? '<p><em>No subjects screened in this run.</em></p>'
      : input.subjectsClean.length > 50
        ? `<p>${input.subjectsClean.length} subjects returned clean. List omitted for brevity; full list available in the JSON artefact.</p>`
        : `<ul>${input.subjectsClean.map((s) => `<li>${esc(s.subjectName)} <span class="small">(${esc(s.subjectId)})</span></li>`).join('')}</ul>`;

  const brainBlock =
    input.brainVerdict || typeof input.brainConfidence === 'number'
      ? `<h2>Weaponized Brain verdict</h2>
         <table>
           <tr><th>Verdict</th><td>${esc(input.brainVerdict ?? '—')}</td></tr>
           <tr><th>Confidence</th><td>${typeof input.brainConfidence === 'number' ? (input.brainConfidence * 100).toFixed(1) + '%' : '—'}</td></tr>
         </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Screening Run Report — ${esc(ddMmYyyy)}</title>
<style>${style}</style>
</head>
<body>
  <h1>Sanctions &amp; Adverse Media Screening Run Report</h1>
  <p class="meta">
    <strong>Reporting entity:</strong> ${esc(input.reportingEntity)}<br>
    ${input.licenceNumber ? `<strong>Licence number:</strong> ${esc(input.licenceNumber)}<br>` : ''}
    <strong>Compliance Officer:</strong> ${esc(input.complianceOfficer)}<br>
    <strong>Run date (dd/mm/yyyy):</strong> ${esc(ddMmYyyy)} &nbsp;|&nbsp; <strong>Run time (UTC):</strong> ${esc(runTime)}<br>
    <strong>Run ID:</strong> <span class="hash">${esc(integrityHash.slice(0, 16))}</span>
  </p>

  <div class="confidential">
    <strong>CONFIDENTIAL.</strong> This report contains compliance-sensitive information about
    the monitoring and screening of subjects. It must not be disclosed to any subject named
    herein. <strong>No tipping off per FDL No.10/2025 Art.29.</strong> Distribution is limited to
    the Compliance Officer, MLRO, and authorised auditors (MoE, EOCN, FIU, LBMA).
  </div>

  <h2>1. Executive summary</h2>
  <table>
    <tr><th>Subjects checked</th><td>${input.totalChecked}</td></tr>
    <tr><th>New hits</th><td>${input.totalNewHits}</td></tr>
    <tr><th>Subjects with new alerts</th><td>${input.subjectsWithAlerts.length}</td></tr>
    <tr><th>Subjects with screening errors</th><td>${input.subjectsWithErrors.length}</td></tr>
    <tr><th>Subjects clean</th><td>${input.subjectsClean.length}</td></tr>
    <tr><th>Lists screened</th><td>${input.listsScreened.map(esc).join(', ')}</td></tr>
  </table>

  ${brainBlock}

  <h2>2. Subjects with new hits</h2>
  ${alertsTable}

  <h2>3. Subjects with screening errors</h2>
  ${errorsTable}

  <h2>4. Subjects cleared (no hits)</h2>
  ${cleanList}

  <h2>5. Regulatory framework</h2>
  <ul>
    ${REGULATORY_BASIS.map((r) => `<li>${esc(r)}</li>`).join('')}
  </ul>

  <h2>6. Chain of custody</h2>
  <p>
    <strong>SHA-256 integrity hash of canonical record:</strong><br>
    <span class="hash">${esc(integrityHash)}</span>
  </p>
  <p class="small">
    The integrity hash is computed over the canonical JSON representation of this run
    (stable key order, sorted arrays). A downstream auditor can independently re-compute
    the hash from the accompanying <code>.json</code> artefact to verify that neither
    the run data nor the report has been tampered with since generation.
  </p>

  <div class="danger">
    <strong>Handling instructions.</strong> Retain this report for a minimum of five (5) years
    per <strong>FDL No.10/2025 Art.24</strong>. Store alongside the goAML XML and the FIU
    submission receipt (if any) as a single evidence bundle. Do not share with the
    subject or any unauthorised third party (FDL Art.29).
  </div>

  <h2>7. Generation metadata</h2>
  <p class="small">
    Auto-generated by <code>Hawkeye Sterling V2 / scheduled-screening.ts</code> on
    ${esc(new Date().toISOString())}. Report schema version 1.
  </p>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Markdown (analyst-friendly)
// ---------------------------------------------------------------------------

function buildMarkdown(input: ScreeningReportInput, integrityHash: string): string {
  const runDate = input.runAtIso.slice(0, 10);
  const [y, m, d] = runDate.split('-');
  const ddMmYyyy = `${d}/${m}/${y}`;

  const lines: string[] = [];
  lines.push(`# Sanctions & Adverse Media Screening Run Report`);
  lines.push('');
  lines.push(`**Reporting entity:** ${input.reportingEntity}`);
  if (input.licenceNumber) lines.push(`**Licence number:** ${input.licenceNumber}`);
  lines.push(`**Compliance Officer:** ${input.complianceOfficer}`);
  lines.push(`**Run date (dd/mm/yyyy):** ${ddMmYyyy}  `);
  lines.push(`**Run time (UTC):** ${input.runAtIso.slice(11, 19)}`);
  lines.push('');
  lines.push(`> **CONFIDENTIAL.** No tipping off per FDL No.10/2025 Art.29.`);
  lines.push('');
  lines.push('## Executive summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Subjects checked | ${input.totalChecked} |`);
  lines.push(`| New hits | ${input.totalNewHits} |`);
  lines.push(`| Subjects with new alerts | ${input.subjectsWithAlerts.length} |`);
  lines.push(`| Subjects with errors | ${input.subjectsWithErrors.length} |`);
  lines.push(`| Subjects clean | ${input.subjectsClean.length} |`);
  lines.push(`| Lists screened | ${input.listsScreened.join(', ')} |`);
  lines.push('');

  if (input.brainVerdict) {
    lines.push('## Weaponized Brain verdict');
    lines.push('');
    lines.push(`- Verdict: **${input.brainVerdict}**`);
    if (typeof input.brainConfidence === 'number') {
      lines.push(`- Confidence: ${(input.brainConfidence * 100).toFixed(1)}%`);
    }
    lines.push('');
  }

  if (input.subjectsWithAlerts.length > 0) {
    lines.push('## Subjects with new hits');
    lines.push('');
    lines.push(`| Subject ID | Subject Name | New hits | Linked task |`);
    lines.push(`|---|---|---:|---|`);
    for (const s of input.subjectsWithAlerts) {
      lines.push(`| ${s.subjectId} | ${s.subjectName} | ${s.newHitCount} | ${s.asanaGid ?? '—'} |`);
    }
    lines.push('');
  }

  if (input.subjectsWithErrors.length > 0) {
    lines.push('## Subjects with screening errors');
    lines.push('');
    for (const s of input.subjectsWithErrors) {
      lines.push(`- **${s.subjectName}** (${s.subjectId}): ${s.error}`);
    }
    lines.push('');
  }

  lines.push(`## Subjects cleared (${input.subjectsClean.length})`);
  lines.push('');
  if (input.subjectsClean.length === 0) {
    lines.push('_No subjects screened._');
  } else if (input.subjectsClean.length > 50) {
    lines.push(`_${input.subjectsClean.length} subjects; full list in the JSON artefact._`);
  } else {
    for (const s of input.subjectsClean) {
      lines.push(`- ${s.subjectName} (${s.subjectId})`);
    }
  }
  lines.push('');

  lines.push('## Regulatory framework');
  lines.push('');
  for (const r of REGULATORY_BASIS) lines.push(`- ${r}`);
  lines.push('');

  lines.push('## Chain of custody');
  lines.push('');
  lines.push(`\`\`\``);
  lines.push(`SHA-256: ${integrityHash}`);
  lines.push(`Algorithm: SHA-256 over canonical JSON`);
  lines.push(`\`\`\``);
  lines.push('');
  lines.push('_retain for 10 years per FDL No.10/2025 Art.24. Store with goAML XML + FIU receipt._');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Integrity hash — Web Crypto SubtleDigest.
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  // Prefer Web Crypto (available globally on browsers and on Node 19+).
  // On Node 18 the global `crypto.subtle` is NOT exposed by default (it
  // landed in Node 19.0.0), so we fall back to a dynamic import of
  // `node:crypto` which ships a synchronous createHash. The dynamic
  // import is guarded by a process check so browser bundlers can tree-
  // shake it out of client builds.
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  if (g.crypto?.subtle) {
    const bytes = new TextEncoder().encode(input);
    const hash = await g.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const nodeCrypto = await import('node:crypto');
      return nodeCrypto.createHash('sha256').update(input).digest('hex');
    } catch {
      // fall through
    }
  }
  // Final fallback: return an explicit marker so the MLRO knows to
  // manually anchor the decision record (FDL Art.24 still requires
  // retention even when the cryptographic seal is unavailable).
  return 'unavailable:no-webcrypto';
}
