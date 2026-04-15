#!/usr/bin/env tsx
/**
 * Regulatory Watcher — detect changes in UAE AML/CFT/CPF source material.
 *
 * Fetches a known list of regulatory pages (MoE, Cabinet Office, EOCN,
 * FATF, LBMA), hashes their content, and compares against the last-seen
 * hash stored in `data/regulatory-hashes.json`. When a hash changes:
 *
 *   1. Logs the change with regulatory citation
 *   2. POSTs a `manual` brain event so it's persisted and routed
 *   3. Updates the stored hash
 *
 * Triggers the MLRO agent on the next run (separate workflow) so the
 * 30-day policy update clock starts automatically (FDL Art.34 / MoE
 * Circular 08/AML/2021 §5).
 *
 * Runs locally (`npm run regulatory:watch`) or daily via GitHub Actions
 * (`.github/workflows/regulatory-watcher.yml`).
 *
 * Environment:
 *   HAWKEYE_BRAIN_URL     — optional, defaults to hawkeye-sterling-v2.netlify.app
 *   HAWKEYE_BRAIN_TOKEN   — required to post brain events (otherwise skipped)
 *   REGULATORY_WATCH_OFFLINE=1 — skip HTTP fetches, use only local snapshots
 *
 * Exit codes:
 *   0 — no changes (or changes detected and published successfully)
 *   1 — fatal error (cannot read/write state, unrecoverable fetch errors)
 *   2 — usage error
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBrainUrl } from '../src/utils/normalizeBrainUrl';

// ---------------------------------------------------------------------------
// Sources — the regulatory pages we monitor
// ---------------------------------------------------------------------------

interface RegulatorySource {
  id: string;
  label: string;
  url: string;
  regulatoryRef: string;
  /** If set, only hash the substring matching this pattern (ignores timestamps). */
  extract?: RegExp;
}

const SOURCES: RegulatorySource[] = [
  {
    id: 'uae-moe-dpms',
    label: 'UAE MoE DPMS Sector Guidance',
    url: 'https://www.moec.gov.ae/en/aml-cft',
    regulatoryRef: 'MoE Circular 08/AML/2021',
  },
  {
    id: 'uae-eocn-tfs',
    label: 'UAE EOCN Targeted Financial Sanctions',
    url: 'https://www.uaeiec.gov.ae/en-us/un-page',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
  },
  {
    id: 'fatf-public',
    label: 'FATF public statement',
    url: 'https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html',
    regulatoryRef: 'FATF Rec.19',
  },
  {
    id: 'lbma-rgg',
    label: 'LBMA Responsible Gold Guidance',
    url: 'https://www.lbma.org.uk/responsible-sourcing/responsible-gold-guidance',
    regulatoryRef: 'LBMA RGG v9',
  },
  {
    id: 'un-sc-consolidated',
    label: 'UN Security Council Consolidated Sanctions List',
    url: 'https://scsanctions.un.org/consolidated',
    regulatoryRef: 'UNSCR 1267 / 1373 / 1540 / 2231',
  },
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');
const STATE_FILE = resolve(PROJECT_ROOT, 'data', 'regulatory-hashes.json');

interface StoredHash {
  hash: string;
  lastSeenAt: string;
  lastChangedAt: string;
}
type StateFile = Record<string, StoredHash>;

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

async function loadState(): Promise<StateFile> {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw) as StateFile;
  } catch (err) {
    console.warn(`  warn: cannot parse ${STATE_FILE}, starting fresh: ${(err as Error).message}`);
    return {};
  }
}

async function saveState(state: StateFile): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Fetch + hash
// ---------------------------------------------------------------------------

async function fetchContent(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Hawkeye-Sterling-RegulatoryWatcher/1.0 (+hawkeye-sterling-v2.netlify.app)',
        Accept: 'text/html,application/json,*/*',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`  warn: ${url} returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`  warn: fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hashContent(content: string, extract?: RegExp): string {
  let material = content;
  if (extract) {
    const match = content.match(extract);
    if (match) material = match[0];
  }
  // Strip script/style blocks + normalise whitespace so trivial
  // reformatting (indentation, line breaks between tags) doesn't
  // produce spurious diffs.
  material = material
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/>\s+/g, '>') // strip whitespace immediately after a tag
    .replace(/\s+</g, '<') // strip whitespace immediately before a tag
    .replace(/\s+/g, ' ') // collapse remaining internal whitespace runs
    .trim();
  return createHash('sha256').update(material).digest('hex');
}

// ---------------------------------------------------------------------------
// Brain publication
// ---------------------------------------------------------------------------

async function publishChangeToBrain(
  source: RegulatorySource,
  oldHash: string | null,
  newHash: string
): Promise<boolean> {
  const base = normalizeBrainUrl(process.env.HAWKEYE_BRAIN_URL);
  const token = process.env.HAWKEYE_BRAIN_TOKEN;
  if (!token) {
    console.log(`  skip: HAWKEYE_BRAIN_TOKEN not set — event not published`);
    return false;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/brain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kind: 'manual',
        severity: 'high',
        summary: `Regulatory change detected: ${source.label}`,
        refId: source.id,
        meta: {
          source: 'regulatory-watcher',
          regulatoryRef: source.regulatoryRef,
          url: source.url,
          oldHash: oldHash ? oldHash.slice(0, 12) : null,
          newHash: newHash.slice(0, 12),
          policyUpdateDeadlineDays: 30,
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`  warn: brain publish failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`  warn: brain publish error: ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Summary {
  total: number;
  checked: number;
  skipped: number;
  changed: number;
  new: number;
  published: number;
  failures: number;
}

async function main(): Promise<Summary> {
  const offline = process.env.REGULATORY_WATCH_OFFLINE === '1';
  const state = await loadState();
  const now = new Date().toISOString();

  console.log('\x1b[36m▸ Regulatory Watcher\x1b[0m');
  console.log(`  state file: ${STATE_FILE}`);
  console.log(`  sources:    ${SOURCES.length}`);
  if (offline) console.log('  mode:       \x1b[33moffline (no fetches)\x1b[0m');
  console.log();

  const summary: Summary = {
    total: SOURCES.length,
    checked: 0,
    skipped: 0,
    changed: 0,
    new: 0,
    published: 0,
    failures: 0,
  };

  for (const source of SOURCES) {
    process.stdout.write(`  ${source.id.padEnd(24)} `);

    if (offline) {
      console.log('\x1b[33mskipped (offline)\x1b[0m');
      summary.skipped++;
      continue;
    }

    const content = await fetchContent(source.url);
    if (content === null) {
      console.log('\x1b[31mfetch failed\x1b[0m');
      summary.failures++;
      continue;
    }

    const hash = hashContent(content, source.extract);
    const prev = state[source.id];
    summary.checked++;

    if (!prev) {
      console.log(`\x1b[32mnew\x1b[0m  (${hash.slice(0, 12)}…)`);
      state[source.id] = { hash, lastSeenAt: now, lastChangedAt: now };
      summary.new++;
    } else if (prev.hash !== hash) {
      console.log(`\x1b[33mCHANGED\x1b[0m  ${prev.hash.slice(0, 12)}… → ${hash.slice(0, 12)}…`);
      console.log(`    regulatory:  ${source.regulatoryRef}`);
      console.log(`    last change: ${prev.lastChangedAt}`);
      console.log(`    url:         ${source.url}`);

      const ok = await publishChangeToBrain(source, prev.hash, hash);
      if (ok) summary.published++;

      state[source.id] = { hash, lastSeenAt: now, lastChangedAt: now };
      summary.changed++;
    } else {
      console.log(`\x1b[90munchanged\x1b[0m`);
      state[source.id].lastSeenAt = now;
    }
  }

  await saveState(state);

  console.log();
  console.log(
    `  \x1b[36msummary:\x1b[0m ${summary.checked}/${summary.total} checked, ${summary.changed} changed, ${summary.new} new, ${summary.published} published, ${summary.failures} failures`
  );

  return summary;
}

// Only run as CLI when invoked directly — tests import the exports.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main()
    .then((summary) => {
      // Exit 0 even when changes are detected — the change itself is a
      // signal, not a failure. CI uses the step summary to surface changes.
      process.exit(summary.failures > 0 && summary.checked === 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error(`fatal: ${(err as Error).message ?? err}`);
      process.exit(1);
    });
}

export { SOURCES, hashContent };
