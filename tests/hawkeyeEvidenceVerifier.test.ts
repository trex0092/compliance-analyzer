/**
 * hawkeye-evidence-verifier CLI tests.
 *
 * Covers:
 *   - parseArgs handles flags, positional file, --stdin, --json, --help
 *   - verifyBundleFromText returns ok=true for an intact bundle
 *   - verifyBundleFromText returns ok=false for a tampered bundle
 *   - JSON parse errors are surfaced as ok=false
 *   - Missing integrity field is rejected
 */
import { describe, it, expect } from 'vitest';

import { verifyBundleFromText, __test__ } from '../bin/hawkeye-evidence-verifier';
import {
  exportEvidenceBundle,
  type EvidenceBundleLoaders,
  type EvidenceBundle,
} from '../src/services/evidenceBundleExporter';

const { parseArgs, renderHuman, renderJson } = __test__;

// ---------------------------------------------------------------------------
// Fixture: build a real bundle via exportEvidenceBundle so the integrity
// hash is computed by the same canonicalStringify path.
// ---------------------------------------------------------------------------

async function makeRealBundle(): Promise<EvidenceBundle> {
  const loaders: EvidenceBundleLoaders = {
    async loadReplayCase() {
      return null; // 'not_found' bundle is still a real bundle with a hash
    },
    async loadTelemetryForDay() {
      return [];
    },
  };
  return exportEvidenceBundle('tenant-a', 'case-1', loaders, () => new Date('2026-04-15T04:30:00Z'));
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses a positional file path', () => {
    const a = parseArgs(['bundle.json']);
    expect(a.filePath).toBe('bundle.json');
    expect(a.jsonMode).toBe(false);
    expect(a.fromStdin).toBe(false);
  });

  it('recognises --json and -j', () => {
    expect(parseArgs(['--json', 'b.json']).jsonMode).toBe(true);
    expect(parseArgs(['-j', 'b.json']).jsonMode).toBe(true);
  });

  it('recognises --stdin', () => {
    const a = parseArgs(['--stdin']);
    expect(a.fromStdin).toBe(true);
    expect(a.filePath).toBeNull();
  });

  it('recognises --help', () => {
    expect(parseArgs(['--help']).showHelp).toBe(true);
    expect(parseArgs(['-h']).showHelp).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyBundleFromText
// ---------------------------------------------------------------------------

describe('verifyBundleFromText', () => {
  it('returns ok=true for an intact bundle', async () => {
    const bundle = await makeRealBundle();
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    expect(outcome.ok).toBe(true);
    expect(outcome.match).toBe(true);
    expect(outcome.error).toBeNull();
    expect(outcome.bundle?.tenantId).toBe('tenant-a');
  });

  it('returns ok=false when a field has been mutated', async () => {
    const bundle = await makeRealBundle();
    bundle.tenantId = 'tenant-EVIL';
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    expect(outcome.ok).toBe(false);
    expect(outcome.match).toBe(false);
  });

  it('returns ok=false when the integrity hash has been mutated', async () => {
    const bundle = await makeRealBundle();
    bundle.integrity.hashHex =
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000';
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    expect(outcome.ok).toBe(false);
  });

  it('returns ok=false on invalid JSON', () => {
    const outcome = verifyBundleFromText('{not json');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/JSON/);
  });

  it('returns ok=false when integrity field is missing', () => {
    const outcome = verifyBundleFromText(JSON.stringify({ tenantId: 'x' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/integrity/);
  });

  it('returns ok=false when algorithm is wrong', () => {
    const outcome = verifyBundleFromText(
      JSON.stringify({
        tenantId: 'x',
        integrity: { algorithm: 'md5', hashHex: 'deadbeef', preimagePrefix: 'evidence-bundle-v1' },
      })
    );
    expect(outcome.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

describe('renderHuman / renderJson', () => {
  it('renderHuman includes PASS for an intact bundle', async () => {
    const bundle = await makeRealBundle();
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    const out = renderHuman('bundle.json', outcome);
    expect(out).toContain('INTEGRITY:');
    expect(out).toContain('PASS');
    expect(out).toContain('tenant-a');
  });

  it('renderHuman includes FAIL for a tampered bundle', async () => {
    const bundle = await makeRealBundle();
    bundle.tenantId = 'tenant-EVIL';
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    const out = renderHuman('bundle.json', outcome);
    expect(out).toContain('FAIL');
  });

  it('renderJson emits a single JSON line', async () => {
    const bundle = await makeRealBundle();
    const outcome = verifyBundleFromText(JSON.stringify(bundle));
    const out = renderJson('bundle.json', outcome);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.match).toBe(true);
    expect(parsed.tenantId).toBe('tenant-a');
    expect(parsed.algorithm).toBe('sha3-512');
  });
});
