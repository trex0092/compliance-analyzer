#!/usr/bin/env node
/**
 * compute-csp-hashes.mjs — Generate CSP `script-src` sha256 hashes for
 * every inline <script> in the site's HTML files.
 *
 * Why this exists: netlify.toml's Content-Security-Policy lists a fixed
 * set of `'sha256-...'` tokens that must match EVERY inline script on
 * every live HTML page, byte-for-byte. When any inline script changes
 * (new watermark, new preload shim, new pre-paint class toggle), the
 * existing hash stops matching and the browser blocks the script.
 * Each drift has historically produced a "CSP hash drift" emergency PR
 * (PR #416 added one hash + dropped 7 orphans; 910a7c6 did another).
 *
 * Usage:
 *
 *   node scripts/compute-csp-hashes.mjs
 *
 *   # Pipe directly into your clipboard on macOS:
 *   node scripts/compute-csp-hashes.mjs | pbcopy
 *
 *   # Or on Windows PowerShell:
 *   node scripts/compute-csp-hashes.mjs | Set-Clipboard
 *
 * The script scans every .html file at the repo root (the ones published
 * by `publish = "."` in netlify.toml), extracts each <script> element
 * that has NO src= attribute, and computes the SHA-256 of its exact body
 * (the bytes between the opening `>` and the closing `</script>`). It
 * prints:
 *
 *   1. A table of { page → script-id → hash } for manual review.
 *   2. A de-duplicated `script-src` CSP fragment ready to paste into
 *      netlify.toml line 153 (the `Content-Security-Policy` header).
 *   3. A diff against the current netlify.toml CSP, showing which hashes
 *      are missing / which are orphaned (declared but no longer used).
 *
 * This script is READ-ONLY. It never modifies netlify.toml — drift
 * resolution stays an explicit human commit with a regulatory-citation
 * message per CLAUDE.md §8. The goal is to remove the "hunt for the
 * right hash" step, not to auto-patch production.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO visibility into CSP
 * drift before it blocks the MLRO surface), Art.24 (audit of which
 * hash corresponds to which inline block across time).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function listRootHtml() {
  return readdirSync(REPO_ROOT)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => statSync(join(REPO_ROOT, f)).isFile())
    .sort();
}

/**
 * Extract every inline <script> body from an HTML string.
 *
 * "Inline" means the <script> tag has NO src= attribute. Scripts with
 * src= are external files and are governed by the `'self'` / CDN host
 * tokens in script-src, not by sha256 hashes.
 *
 * The regex uses [\s\S] to handle multiline bodies and a negative
 * lookahead on `src=` inside the opening tag. The id= attribute is
 * captured so the output can point back to a specific script.
 */
function extractInlineScripts(html) {
  const matches = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const idMatch = /\bid=["']([^"']+)["']/.exec(attrs);
    matches.push({
      id: idMatch ? idMatch[1] : null,
      body,
      firstChars: body.replace(/\s+/g, ' ').slice(0, 60).trim(),
    });
  }
  return matches;
}

function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

function cspHashToken(body) {
  return `'sha256-${sha256Base64(body)}='`;
}

/**
 * Extract the existing `script-src` sha256 tokens from netlify.toml so
 * we can diff what's declared vs what's actually needed. Very light
 * parser — just looks for tokens of the shape `'sha256-...='` inside
 * the Content-Security-Policy line.
 */
function extractExistingCspHashes(tomlText) {
  const cspLine = tomlText
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy') && l.includes('script-src'));
  if (!cspLine) return new Set();
  const hashRe = /'sha256-[A-Za-z0-9+/=]+='/g;
  const tokens = cspLine.match(hashRe) || [];
  return new Set(tokens);
}

function main() {
  const htmlFiles = listRootHtml();
  const perPage = [];
  const uniqueHashes = new Map(); // hash token -> first sighting info

  for (const file of htmlFiles) {
    const abs = join(REPO_ROOT, file);
    const html = readFileSync(abs, 'utf8');
    const scripts = extractInlineScripts(html);
    const seen = scripts.map((s, idx) => {
      const token = cspHashToken(s.body);
      if (!uniqueHashes.has(token)) {
        uniqueHashes.set(token, {
          firstFile: file,
          id: s.id,
          firstChars: s.firstChars,
          byteLen: Buffer.byteLength(s.body, 'utf8'),
        });
      }
      return { idx, id: s.id, token, byteLen: Buffer.byteLength(s.body, 'utf8') };
    });
    perPage.push({ file, scripts: seen });
  }

  // Diff against current netlify.toml (best-effort, non-fatal).
  let declaredHashes = new Set();
  try {
    const toml = readFileSync(join(REPO_ROOT, 'netlify.toml'), 'utf8');
    declaredHashes = extractExistingCspHashes(toml);
  } catch {
    /* netlify.toml missing — skip diff */
  }
  const neededHashes = new Set(uniqueHashes.keys());
  const missing = [...neededHashes].filter((h) => !declaredHashes.has(h));
  const orphaned = [...declaredHashes].filter((h) => !neededHashes.has(h));

  // ---- Output ----

  console.log('# CSP inline-script hash inventory');
  console.log('# Generated: ' + new Date().toISOString());
  console.log('# Repo root: ' + REPO_ROOT);
  console.log('');

  console.log('## 1. Per-page inline scripts');
  for (const page of perPage) {
    console.log(`\n### ${page.file} (${page.scripts.length} inline script${page.scripts.length === 1 ? '' : 's'})`);
    for (const s of page.scripts) {
      const idStr = s.id ? `id="${s.id}"` : `(no id, #${s.idx + 1})`;
      console.log(`  - ${idStr.padEnd(28)} ${s.byteLen.toString().padStart(6)} bytes  ${s.token}`);
    }
  }

  console.log('\n## 2. De-duplicated script-src fragment (paste into netlify.toml)');
  console.log('');
  const sortedHashes = [...neededHashes].sort();
  console.log('    script-src \'self\' \\');
  for (const h of sortedHashes) {
    console.log(`      ${h} \\`);
  }
  console.log('      https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;');

  console.log('\n## 3. Diff vs current netlify.toml');
  if (missing.length === 0 && orphaned.length === 0) {
    console.log('  ✅ In sync. No CSP drift detected.');
  } else {
    if (missing.length > 0) {
      console.log(`  ❌ ${missing.length} hash${missing.length === 1 ? '' : 'es'} MISSING from netlify.toml:`);
      for (const h of missing) {
        const info = uniqueHashes.get(h);
        console.log(`     ${h}  (first seen in ${info.firstFile}${info.id ? ' #' + info.id : ''}: "${info.firstChars}")`);
      }
    }
    if (orphaned.length > 0) {
      console.log(`  ⚠️  ${orphaned.length} hash${orphaned.length === 1 ? '' : 'es'} ORPHANED in netlify.toml (no matching inline script):`);
      for (const h of orphaned) {
        console.log(`     ${h}`);
      }
    }
  }

  // Exit non-zero if drift exists — makes this CI-friendly if you ever
  // wire it into the `lint-and-test` workflow.
  if (missing.length > 0 || orphaned.length > 0) {
    process.exitCode = 1;
  }
}

main();
