/**
 * Unit tests for harderBetterFasterStronger.ts — five native
 * capabilities shipped on the Phase 17 branch.
 */
import { describe, it, expect } from 'vitest';
import {
  generateApiDocFromExports,
  packageSubagent,
  prioritiseContextSnippets,
  createHookRegistry,
  buildCheckpointManifest,
  type ExportedSymbol,
  type ContextSnippet,
  type GitSnapshotInput,
} from '@/services/harderBetterFasterStronger';

// ---------------------------------------------------------------------------
// 1. generateApiDocFromExports
// ---------------------------------------------------------------------------

describe('generateApiDocFromExports', () => {
  it('extracts summary, signature, and citations from jsdoc', () => {
    const symbols: ExportedSymbol[] = [
      {
        file: 'netlify/functions/example.mts',
        name: 'handleFreeze',
        signature: '(req: Request) => Response',
        jsdoc: '/** Executes a sanctions freeze per Cabinet Res 74/2020 Art.4-7. */',
        isEndpoint: true,
      },
    ];
    const out = generateApiDocFromExports({ symbols });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].summary).toMatch(/Executes a sanctions freeze/);
    expect(out.entries[0].citations).toEqual(['Cabinet Res 74/2020 Art.']);
    expect(out.missingCitationEndpoints).toEqual([]);
  });

  it('flags HTTP endpoints without any regulatory citation', () => {
    const symbols: ExportedSymbol[] = [
      {
        file: 'netlify/functions/orphan.mts',
        name: 'handleOrphan',
        signature: '() => Response',
        jsdoc: '/** Placeholder. */',
        isEndpoint: true,
      },
    ];
    const out = generateApiDocFromExports({ symbols });
    expect(out.entries[0].citationMissing).toBe(true);
    expect(out.missingCitationEndpoints).toEqual(['netlify/functions/orphan.mts#handleOrphan']);
    expect(out.narrative).toMatch(/CLAUDE\.md §8/);
  });

  it('does not flag non-endpoint symbols that lack a citation', () => {
    const symbols: ExportedSymbol[] = [
      {
        file: 'src/services/util.ts',
        name: 'formatDate',
        signature: '(d: Date) => string',
        jsdoc: '/** Format a date. */',
      },
    ];
    const out = generateApiDocFromExports({ symbols });
    expect(out.entries[0].citationMissing).toBe(false);
    expect(out.missingCitationEndpoints).toEqual([]);
  });

  it('falls back to the symbol name when jsdoc is empty', () => {
    const symbols: ExportedSymbol[] = [
      {
        file: 'a.ts',
        name: 'doThing',
        signature: '() => void',
        jsdoc: '',
      },
    ];
    const out = generateApiDocFromExports({ symbols });
    expect(out.entries[0].summary).toBe('doThing');
  });
});

// ---------------------------------------------------------------------------
// 2. packageSubagent
// ---------------------------------------------------------------------------

describe('packageSubagent', () => {
  it('packages a read-only subagent with a default regulatory gate', () => {
    const def = packageSubagent({
      id: 'sa-1',
      purpose: 'Survey orchestration files',
      prompt: 'Read-only survey of src/agents/orchestration/',
      allowedTools: ['Read', 'Grep', 'Glob'],
      contextBudgetTokens: 50_000,
    });
    expect(def.writeMode).toBe(false);
    expect(def.regulatoryGate[0]).toMatch(/CLAUDE\.md §10/);
    expect(def.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('allows an explicit writeMode subagent when Edit/Write is present', () => {
    const def = packageSubagent({
      id: 'sa-writer',
      purpose: 'Refactor one file',
      prompt: 'Refactor src/services/foo.ts',
      allowedTools: ['Read', 'Edit'],
      contextBudgetTokens: 30_000,
      writeMode: true,
      regulatoryGate: ['FDL Art.24'],
    });
    expect(def.writeMode).toBe(true);
    expect(def.regulatoryGate).toEqual(['FDL Art.24']);
  });

  it('rejects writeMode without Edit or Write in allowedTools', () => {
    expect(() =>
      packageSubagent({
        id: 'bad',
        purpose: 'broken',
        prompt: 'do stuff',
        allowedTools: ['Read'],
        contextBudgetTokens: 10_000,
        writeMode: true,
      })
    ).toThrow(/writeMode/);
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      packageSubagent({
        id: 'blank',
        purpose: 'blank',
        prompt: '   ',
        allowedTools: ['Read'],
        contextBudgetTokens: 10_000,
      })
    ).toThrow(/prompt/);
  });

  it('rejects an impossibly small context budget', () => {
    expect(() =>
      packageSubagent({
        id: 'tiny',
        purpose: 'tiny',
        prompt: 'x',
        allowedTools: ['Read'],
        contextBudgetTokens: 100,
      })
    ).toThrow(/budget/);
  });
});

// ---------------------------------------------------------------------------
// 3. prioritiseContextSnippets
// ---------------------------------------------------------------------------

describe('prioritiseContextSnippets', () => {
  it('prefers high-priority source-code over low-priority vendor', () => {
    const snippets: ContextSnippet[] = [
      { id: 'a', kind: 'source-code', sizeBytes: 1000, callerPriority: 0.9 },
      { id: 'b', kind: 'vendor', sizeBytes: 1000, callerPriority: 0.4 },
    ];
    const out = prioritiseContextSnippets({ snippets, budgetBytes: 1500 });
    expect(out.retained.map((r) => r.id)).toEqual(['a']);
    expect(out.dropped.map((r) => r.id)).toEqual(['b']);
  });

  it('drops node-modules aggressively regardless of callerPriority', () => {
    const snippets: ContextSnippet[] = [
      { id: 'node', kind: 'node-modules', sizeBytes: 500, callerPriority: 0.99 },
    ];
    const out = prioritiseContextSnippets({ snippets, budgetBytes: 10_000 });
    expect(out.retained).toEqual([]);
    expect(out.dropped.map((r) => r.id)).toEqual(['node']);
  });

  it('respects the byte budget', () => {
    const snippets: ContextSnippet[] = [
      { id: 'x', kind: 'source-code', sizeBytes: 900, callerPriority: 0.9 },
      { id: 'y', kind: 'source-code', sizeBytes: 900, callerPriority: 0.9 },
    ];
    const out = prioritiseContextSnippets({ snippets, budgetBytes: 1000 });
    expect(out.retained).toHaveLength(1);
    expect(out.retainedBytes).toBeLessThanOrEqual(1000);
  });

  it('penalises oversized compliance-suite mega-reads', () => {
    const snippets: ContextSnippet[] = [
      { id: 'big', kind: 'compliance-suite', sizeBytes: 20_000, callerPriority: 0.5 },
      { id: 'small', kind: 'source-code', sizeBytes: 500, callerPriority: 0.5 },
    ];
    const out = prioritiseContextSnippets({ snippets, budgetBytes: 10_000 });
    // The small source-code snippet should win despite same caller priority.
    expect(out.retained.map((r) => r.id)).toEqual(['small']);
  });
});

// ---------------------------------------------------------------------------
// 4. createHookRegistry
// ---------------------------------------------------------------------------

describe('createHookRegistry', () => {
  it('fires hooks in registration order and reports per-hook status', async () => {
    const seen: string[] = [];
    const reg = createHookRegistry();
    reg.register({
      name: 'first',
      event: 'sanctions-match',
      handler: async () => {
        seen.push('first');
      },
    });
    reg.register({
      name: 'second',
      event: 'sanctions-match',
      handler: async () => {
        seen.push('second');
      },
    });
    const results = await reg.fire('sanctions-match', { subject: 'X' });
    expect(seen).toEqual(['first', 'second']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('isolates a failing hook from subsequent hooks', async () => {
    const seen: string[] = [];
    const reg = createHookRegistry();
    reg.register({
      name: 'boom',
      event: 'str-filed',
      handler: async () => {
        throw new Error('boom');
      },
    });
    reg.register({
      name: 'ok',
      event: 'str-filed',
      handler: async () => {
        seen.push('ok');
      },
    });
    const results = await reg.fire('str-filed', {});
    expect(seen).toEqual(['ok']);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/boom/);
    expect(results[1].ok).toBe(true);
  });

  it('enforces per-hook timeout', async () => {
    const reg = createHookRegistry();
    reg.register({
      name: 'slow',
      event: 'audit-entry',
      handler: () => new Promise(() => {}), // never resolves
      timeoutMs: 30,
    });
    const results = await reg.fire('audit-entry', {});
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/timeout/);
  });

  it('rejects duplicate hook names', () => {
    const reg = createHookRegistry();
    reg.register({ name: 'x', event: 'policy-updated', handler: async () => {} });
    expect(() =>
      reg.register({ name: 'x', event: 'policy-updated', handler: async () => {} })
    ).toThrow(/already registered/);
  });

  it('unregisters by name and filters list by event', () => {
    const reg = createHookRegistry();
    reg.register({ name: 'a', event: 'freeze-executed', handler: async () => {} });
    reg.register({ name: 'b', event: 'four-eyes-approved', handler: async () => {} });
    expect(reg.list('freeze-executed')).toHaveLength(1);
    expect(reg.unregister('a')).toBe(true);
    expect(reg.unregister('missing')).toBe(false);
    expect(reg.list('freeze-executed')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. buildCheckpointManifest
// ---------------------------------------------------------------------------

describe('buildCheckpointManifest', () => {
  const baseSnapshot: GitSnapshotInput = {
    branch: 'claude/weaponize-phase17-PYv5c',
    headSha: 'abc1234def5678',
    modified: [],
    staged: [],
    untracked: [],
    label: 'before major refactor',
  };

  it('marks a clean tree and produces minimal restore steps', () => {
    const out = buildCheckpointManifest({
      snapshot: baseSnapshot,
      asOf: new Date('2026-04-16T12:00:00Z'),
    });
    expect(out.cleanTree).toBe(true);
    expect(out.restoreSteps).toContain('git fetch origin');
    expect(out.restoreSteps).toContain('git checkout abc1234def5678');
    expect(out.restoreSteps.some((s) => s.includes('stash'))).toBe(false);
  });

  it('emits stash steps when the tree has changes', () => {
    const out = buildCheckpointManifest({
      snapshot: {
        ...baseSnapshot,
        modified: ['src/a.ts'],
        untracked: ['src/new.ts'],
      },
      asOf: new Date('2026-04-16T12:00:00Z'),
    });
    expect(out.cleanTree).toBe(false);
    expect(out.restoreSteps.some((s) => s.includes('git stash push'))).toBe(true);
    expect(out.restoreSteps.some((s) => s.includes('git stash pop'))).toBe(true);
  });

  it('derives a stable id from label + branch + head', () => {
    const out = buildCheckpointManifest({
      snapshot: baseSnapshot,
      asOf: new Date('2026-04-16T12:00:00Z'),
    });
    expect(out.id).toBe('before_major_refactor::claude/weaponize-phase17-PYv5c::abc1234d');
  });

  it('preserves the original snapshot arrays (no aliasing)', () => {
    const modified = ['src/x.ts'];
    const out = buildCheckpointManifest({
      snapshot: { ...baseSnapshot, modified },
    });
    expect(out.snapshot.modified).toEqual(['src/x.ts']);
    modified.push('src/y.ts');
    // Manifest copy must not observe the mutation.
    expect(out.snapshot.modified).toEqual(['src/x.ts']);
  });
});
