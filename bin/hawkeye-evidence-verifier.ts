#!/usr/bin/env node
/**
 * hawkeye-evidence-verifier — inspector CLI for evidence bundles.
 *
 * Re-computes the SHA3-512 integrity hash on a previously-exported
 * EvidenceBundle JSON file and reports whether it matches the
 * stored hash. Used by MoE / LBMA / EOCN auditors who receive an
 * evidence bundle from the operator and need to verify it has not
 * been tampered with.
 *
 * Usage:
 *
 *    npx tsx bin/hawkeye-evidence-verifier.ts <path-to-bundle.json>
 *    npx tsx bin/hawkeye-evidence-verifier.ts --stdin < bundle.json
 *    npx tsx bin/hawkeye-evidence-verifier.ts --json <path>   # machine-readable
 *
 * Exit codes:
 *    0 — bundle is intact (stored hash == recomputed hash)
 *    1 — bundle is corrupted, modified, or unreadable
 *    2 — usage error
 *
 * Why this is a CLI (and not just an API endpoint):
 *   - Auditors run this OFFLINE in their own environment. Sending the
 *     bundle to a network endpoint defeats the integrity model.
 *   - The verifier MUST be standalone and not need any blob store, env
 *     var, or network call. A bundle is self-contained: every field
 *     needed to verify it is in the file.
 *   - The auditor wants a human-readable PASS / FAIL line with the
 *     hash on screen so they can paste it into their report.
 *
 * Output (human mode):
 *
 *    HAWKEYE Evidence Bundle Verifier
 *    --------------------------------
 *    File:        bundle.json
 *    Tenant:      tenant-a
 *    Case:        case-uuid-1
 *    Exported:    2026-04-15T04:30:00.000Z
 *    Conclusion:  stable
 *    Algorithm:   sha3-512
 *    Stored:      8a3f...e9
 *    Recomputed:  8a3f...e9
 *    Citations:   FDL Art.20-22, FDL Art.24, ...
 *    --------------------------------
 *    INTEGRITY:   PASS  (bundle is intact)
 *
 * Output (JSON mode):
 *
 *    {
 *      "ok": true,
 *      "tenantId": "tenant-a",
 *      "caseId": "case-uuid-1",
 *      "conclusion": "stable",
 *      "algorithm": "sha3-512",
 *      "storedHashHex": "8a3f...e9",
 *      "recomputedHashHex": "8a3f...e9",
 *      "match": true
 *    }
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22, Art.24
 *   Cabinet Res 134/2025 Art.19
 *   NIST AI RMF 1.0 MANAGE-2/4
 *   FATF Rec 11
 */

import { readFileSync } from 'node:fs';
import {
  verifyEvidenceBundleIntegrity,
  type EvidenceBundle,
} from '../src/services/evidenceBundleExporter';

interface ParsedArgs {
  jsonMode: boolean;
  fromStdin: boolean;
  filePath: string | null;
  showHelp: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let jsonMode = false;
  let fromStdin = false;
  let filePath: string | null = null;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '-j') {
      jsonMode = true;
    } else if (a === '--stdin') {
      fromStdin = true;
    } else if (a === '--help' || a === '-h') {
      showHelp = true;
    } else if (!a.startsWith('-') && filePath === null) {
      filePath = a;
    }
  }

  return { jsonMode, fromStdin, filePath, showHelp };
}

function printHelp(): void {
  process.stdout.write(
    [
      'hawkeye-evidence-verifier — verify a HAWKEYE evidence bundle',
      '',
      'Usage:',
      '  hawkeye-evidence-verifier <bundle.json>',
      '  hawkeye-evidence-verifier --stdin < bundle.json',
      '  hawkeye-evidence-verifier --json <bundle.json>',
      '',
      'Flags:',
      '  --json, -j   Emit a single JSON object instead of human text',
      '  --stdin      Read the bundle from stdin instead of a file',
      '  --help, -h   Show this help and exit',
      '',
      'Exit codes:',
      '  0   integrity PASS',
      '  1   integrity FAIL or unreadable bundle',
      '  2   usage error',
      '',
    ].join('\n')
  );
}

function readBundleFromStdin(): string {
  // Synchronously read all of stdin into a buffer. The bundle is
  // small (< 64 KB in practice) so this is fine.
  const chunks: Buffer[] = [];
  const fd = 0;
  const buf = Buffer.alloc(65536);
  let n: number;
  // node:fs readSync on stdin loops until EOF.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      n = (require('node:fs') as typeof import('node:fs')).readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') continue;
      throw err;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface VerificationOutcome {
  ok: boolean;
  match: boolean;
  bundle: EvidenceBundle | null;
  error: string | null;
}

export function verifyBundleFromText(text: string): VerificationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      match: false,
      bundle: null,
      error: `bundle is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, match: false, bundle: null, error: 'bundle root is not an object' };
  }
  const bundle = parsed as EvidenceBundle;
  if (
    !bundle.integrity ||
    bundle.integrity.algorithm !== 'sha3-512' ||
    typeof bundle.integrity.hashHex !== 'string'
  ) {
    return {
      ok: false,
      match: false,
      bundle: null,
      error: 'bundle.integrity is missing or malformed',
    };
  }
  let match = false;
  try {
    match = verifyEvidenceBundleIntegrity(bundle);
  } catch (err) {
    return {
      ok: false,
      match: false,
      bundle: null,
      error: `integrity check threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: match, match, bundle, error: null };
}

function renderHuman(filePath: string, outcome: VerificationOutcome): string {
  const lines: string[] = [];
  lines.push('HAWKEYE Evidence Bundle Verifier');
  lines.push('--------------------------------');
  lines.push(`File:        ${filePath}`);
  if (outcome.bundle) {
    lines.push(`Tenant:      ${outcome.bundle.tenantId}`);
    lines.push(`Case:        ${outcome.bundle.caseId}`);
    lines.push(`Exported:    ${outcome.bundle.exportedAtIso}`);
    lines.push(`Conclusion:  ${outcome.bundle.conclusion}`);
    lines.push(`Algorithm:   ${outcome.bundle.integrity.algorithm}`);
    lines.push(`Stored:      ${outcome.bundle.integrity.hashHex.slice(0, 16)}...`);
    lines.push(
      `Citations:   ${outcome.bundle.citations.slice(0, 4).join(', ')}` +
        (outcome.bundle.citations.length > 4
          ? ` (+${outcome.bundle.citations.length - 4} more)`
          : '')
    );
  }
  lines.push('--------------------------------');
  if (outcome.error) {
    lines.push(`ERROR:       ${outcome.error}`);
    lines.push('INTEGRITY:   FAIL');
  } else if (outcome.match) {
    lines.push('INTEGRITY:   PASS  (bundle is intact)');
  } else {
    lines.push('INTEGRITY:   FAIL  (stored hash does not match recomputed hash)');
    lines.push('             The bundle has been modified since export, or the export was corrupted.');
  }
  return lines.join('\n') + '\n';
}

function renderJson(filePath: string, outcome: VerificationOutcome): string {
  return (
    JSON.stringify({
      ok: outcome.ok,
      filePath,
      error: outcome.error,
      match: outcome.match,
      tenantId: outcome.bundle?.tenantId ?? null,
      caseId: outcome.bundle?.caseId ?? null,
      conclusion: outcome.bundle?.conclusion ?? null,
      algorithm: outcome.bundle?.integrity?.algorithm ?? null,
      storedHashHex: outcome.bundle?.integrity?.hashHex ?? null,
      citations: outcome.bundle?.citations ?? null,
    }) + '\n'
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);

  if (args.showHelp) {
    printHelp();
    return 0;
  }

  if (!args.fromStdin && !args.filePath) {
    process.stderr.write(
      'hawkeye-evidence-verifier: no bundle path given. Use --help for usage.\n'
    );
    return 2;
  }

  let bundleText: string;
  const sourceLabel = args.fromStdin ? '<stdin>' : args.filePath!;
  try {
    if (args.fromStdin) {
      bundleText = readBundleFromStdin();
    } else {
      bundleText = readFileSync(args.filePath!, 'utf8');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (args.jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok: false, filePath: sourceLabel, error: `read failed: ${msg}` }) + '\n'
      );
    } else {
      process.stderr.write(`hawkeye-evidence-verifier: cannot read bundle: ${msg}\n`);
    }
    return 1;
  }

  const outcome = verifyBundleFromText(bundleText);

  if (args.jsonMode) {
    process.stdout.write(renderJson(sourceLabel, outcome));
  } else {
    process.stdout.write(renderHuman(sourceLabel, outcome));
  }

  return outcome.ok ? 0 : 1;
}

// Exported for unit tests.
export const __test__ = { parseArgs, renderHuman, renderJson };

// Only run main() when invoked as a CLI, not when imported by tests.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /hawkeye-evidence-verifier(\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (isMain) {
  process.exit(main());
}
