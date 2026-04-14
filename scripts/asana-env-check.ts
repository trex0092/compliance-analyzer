#!/usr/bin/env -S npx tsx
/**
 * asana-env-check.ts — CLI entry point for the deploy-readiness
 * env validator. Wired into skills/deploy-check/SKILL.md as the
 * pre-deploy gate that catches missing env vars before they hit
 * production.
 *
 * Exits 0 when all checks pass (or only warnings exist).
 * Exits 1 when any blocker is present.
 *
 * Usage:
 *   npm run asana:env:check
 *   npm run asana:env:check -- --strict   # treat warnings as blockers
 *
 * Reads from process.env — pass values via env vars or .env file.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — operational
 *     readiness must be verifiable before going live)
 */

import {
  checkAsanaDeployReadiness,
  formatEnvCheckReport,
} from '../src/utils/asanaEnvCheck';

function main(): void {
  const strict = process.argv.includes('--strict');
  const result = checkAsanaDeployReadiness(process.env);
  console.log(formatEnvCheckReport(result));

  if (!result.ok) {
    process.exit(1);
  }
  if (strict && result.warningCount > 0) {
    console.log('');
    console.log(
      '# --strict: warnings present — treating as deploy blockers. Exit 1.'
    );
    process.exit(1);
  }
  process.exit(0);
}

const isMain =
  typeof import.meta !== 'undefined' &&
  typeof process !== 'undefined' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main();
}
