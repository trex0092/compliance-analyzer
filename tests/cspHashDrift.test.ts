/**
 * Regression test: every inline <script> block shipped to the browser
 * must have its SHA-256 hash allowlisted in the Content-Security-Policy
 * `script-src` directive of netlify.toml, and every hash in the CSP
 * must correspond to an actual inline script.
 *
 * This drift was the root cause of PRs #403, #405, #412, #416 — a new
 * inline script was added to an HTML file but netlify.toml was not
 * updated, so the browser silently CSP-blocked the script and the
 * feature looked broken with no operator-visible error.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO must be able to
 * reach every operations surface), Art.24 (10-year audit — every
 * deploy-blocking drift must be caught pre-merge, not post-deploy).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function extractCspHashes(): Set<string> {
  const toml = readFileSync(resolve(ROOT, 'netlify.toml'), 'utf8');
  const csp = toml
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy'));
  if (!csp) throw new Error('Content-Security-Policy not found in netlify.toml');
  const hashes = new Set<string>();
  const re = /sha256-([A-Za-z0-9+/=]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(csp)) !== null) hashes.add(m[1]);
  return hashes;
}

type InlineScript = { file: string; line: number; hash: string };

function extractInlineScripts(): InlineScript[] {
  // Root-level HTML files only. Sample reports, graphify artefacts and
  // vendor/ are not served from the site's publish dir.
  const htmlFiles = readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !f.startsWith('SAMPLE_'))
    .sort();
  const out: InlineScript[] = [];
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  for (const file of htmlFiles) {
    const src = readFileSync(resolve(ROOT, file), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(src)) !== null) {
      const firstTag = m[0].split('>', 1)[0];
      if (firstTag.includes('src=')) continue;
      const body = m[1];
      const hash = createHash('sha256').update(body, 'utf8').digest('base64');
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ file, line, hash });
    }
  }
  return out;
}

describe('CSP script-src hash drift', () => {
  const cspHashes = extractCspHashes();
  const inlineScripts = extractInlineScripts();

  it('every inline <script> block has its hash allowlisted in netlify.toml', () => {
    const missing = inlineScripts.filter((s) => !cspHashes.has(s.hash));
    const details = missing
      .map((s) => `  ${s.file}:${s.line}  sha256-${s.hash}`)
      .join('\n');
    expect(
      missing,
      `${missing.length} inline script(s) would be CSP-blocked in production:\n${details}\n\n` +
        `Add each missing sha256-... to the script-src list in netlify.toml.`,
    ).toEqual([]);
  });

  it('every CSP hash in netlify.toml is actually used by an inline script', () => {
    const usedHashes = new Set(inlineScripts.map((s) => s.hash));
    const orphans = [...cspHashes].filter((h) => !usedHashes.has(h));
    expect(
      orphans,
      `${orphans.length} orphan CSP hash(es) in netlify.toml:\n` +
        orphans.map((h) => `  sha256-${h}`).join('\n') +
        `\n\nRemove each one from the script-src list.`,
    ).toEqual([]);
  });
});
