#!/usr/bin/env tsx
/**
 * validate-goaml — CLI wrapper around src/utils/goamlValidator.ts
 *
 * Usage:
 *   npx tsx scripts/validate-goaml.ts <type> <path>
 *   npx tsx scripts/validate-goaml.ts STR  path/to/str.xml
 *   npx tsx scripts/validate-goaml.ts --all
 *
 * Or via the npm script:
 *   npm run validate:goaml -- --all
 *
 * Exits 0 on success, 1 on validation error, 2 on usage error.
 * Wired into CI so every PR that touches a goAML fixture gets
 * validated before merge.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import {
  validateByType,
  type ReportType,
  type ValidationResult,
} from '../src/utils/goamlValidator';

const VALID_TYPES: ReportType[] = ['STR', 'SAR', 'CTR', 'DPMSR', 'CNMR'];
const VALID_TYPE_SET = new Set<string>(VALID_TYPES);

function printResult(label: string, result: ValidationResult): boolean {
  const { valid, errors, warnings } = result;
  console.log(
    valid
      ? `\x1b[32m✓\x1b[0m ${label}: valid (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
      : `\x1b[31m✗\x1b[0m ${label}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  );
  for (const e of errors) {
    console.log(`    \x1b[31merror\x1b[0m ${e.field}: ${e.message}  [${e.regulatory}]`);
  }
  for (const w of warnings) {
    console.log(`    \x1b[33mwarn\x1b[0m  ${w.field}: ${w.message}`);
  }
  return valid;
}

function typeFromFilename(name: string): ReportType | null {
  const base = basename(name, '.xml').toLowerCase();
  for (const type of VALID_TYPES) {
    if (base.includes(type.toLowerCase())) return type;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.error('Usage:');
    console.error('  npx tsx scripts/validate-goaml.ts <type> <path>');
    console.error('  npx tsx scripts/validate-goaml.ts --all');
    console.error('');
    console.error(`Types: ${VALID_TYPES.join(' | ')}`);
    process.exit(args.length === 0 ? 2 : 0);
  }

  if (args[0] === '--all') {
    const dir = resolve('tests/fixtures/goaml');
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.xml'));
    } catch (err) {
      console.error(`fatal: cannot read ${dir}: ${(err as Error).message}`);
      process.exit(2);
    }
    if (files.length === 0) {
      console.error(`no .xml fixtures found in ${dir}`);
      process.exit(2);
    }

    let allOk = true;
    for (const file of files.sort()) {
      const type = typeFromFilename(file);
      if (!type) {
        console.log(`\x1b[33m?\x1b[0m ${file}: filename does not include a report type — skipping`);
        continue;
      }
      const xml = await readFile(resolve(dir, file), 'utf8');
      const result = validateByType(type, xml);
      const ok = printResult(`${type} ${file}`, result);
      const expectedInvalid = file.startsWith('invalid-');
      if (expectedInvalid && !ok) continue;
      if (expectedInvalid && ok) {
        console.error(`    \x1b[31mexpected ${file} to be invalid but it validated\x1b[0m`);
        allOk = false;
        continue;
      }
      if (!ok) allOk = false;
    }

    if (!allOk) {
      console.error('\n\x1b[31mone or more fixtures failed validation\x1b[0m');
      process.exit(1);
    }
    console.log(`\n\x1b[32mall ${files.length} fixture(s) valid\x1b[0m`);
    return;
  }

  const [type, path] = args;
  if (!VALID_TYPE_SET.has(type)) {
    console.error(`unknown type: ${type}. Valid: ${VALID_TYPES.join(', ')}`);
    process.exit(2);
  }

  let xml: string;
  try {
    xml = await readFile(resolve(path), 'utf8');
  } catch (err) {
    console.error(`cannot read ${path}: ${(err as Error).message}`);
    process.exit(2);
  }

  const result = validateByType(type as ReportType, xml);
  const ok = printResult(`${type} ${path}`, result);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`fatal: ${(err as Error).message ?? err}`);
  process.exit(2);
});
