/**
 * Regression tests proving that the compliance report scaffolding
 * modules can be `require()`d cleanly even when their optional runtime
 * deps (`node-cron`, `nodemailer`, `axios`) are not installed.
 *
 * Motivation: three earlier review rounds flagged that these six
 * modules pulled in deps that are not declared in `package.json`, so
 * merely requiring any of them from a consumer, a smoke-test, or a
 * dependency-inventory scan would crash. The fix wraps the required
 * bindings in lazy resolvers (or, for `phase1-asana-sync-engine.js`,
 * a Proxy-backed stub) so the module can always be loaded. Actual
 * method calls that genuinely need a dep now throw a clear
 * "install with npm" error instead of crashing at import time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';

const req = createRequire(import.meta.url);

const TARGETS = [
  '../daily-compliance-report-system.js',
  '../asana-brain-daily-report-executor.js',
  '../daily-compliance-reporter.js',
  '../asana-brain-intelligence.js',
  '../hawkeye-str-analysis-engine.js',
  '../phase1-asana-sync-engine.js',
] as const;

const MISSING = new Set(['node-cron', 'nodemailer', 'axios']);

type Resolver = (this: unknown, request: string, ...rest: unknown[]) => string;
let origResolve: Resolver;

beforeAll(() => {
  // Patch the Node resolver to make the three optional deps look
  // uninstalled. This simulates the production environment where the
  // SPA's package.json does not include them.
  origResolve = (Module as unknown as { _resolveFilename: Resolver })._resolveFilename;
  (Module as unknown as { _resolveFilename: Resolver })._resolveFilename = function patched(request, ...rest) {
    if (MISSING.has(request)) {
      const err = new Error(`Cannot find module '${request}'`) as Error & { code?: string };
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    return origResolve.call(this, request, ...rest);
  };
});

afterAll(() => {
  (Module as unknown as { _resolveFilename: Resolver })._resolveFilename = origResolve;
});

describe('Report scaffolding modules load without optional runtime deps', () => {
  for (const target of TARGETS) {
    it(`require('${target}') succeeds without node-cron/nodemailer/axios`, () => {
      // Clear any cached copy so the patched resolver actually runs.
      const resolved = req.resolve(target);
      delete (req.cache as Record<string, unknown>)[resolved];
      let loaded: unknown;
      expect(() => {
        loaded = req(target);
      }).not.toThrow();
      expect(loaded).toBeDefined();
    });
  }
});
