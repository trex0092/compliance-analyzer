/**
 * Tests for subsystem scoring + repair task payload builder.
 *
 * Ensures the 5-dimension rubric computes correctly across a range of
 * run histories and that low-scoring subsystems never auto-repair —
 * they always produce an Asana task payload instead.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreSubsystem,
  buildRepairTaskPayload,
  type SubsystemRun,
} from '@/services/subsystemScoring';

function run(opts: Partial<SubsystemRun> = {}): SubsystemRun {
  return {
    subsystem: opts.subsystem ?? 'redTeamCritic',
    at: opts.at ?? '2026-04-01T00:00:00Z',
    verdict: opts.verdict ?? 'pass',
    mlroOverride: opts.mlroOverride,
    failed: opts.failed ?? false,
    complete: opts.complete ?? true,
    durationMs: opts.durationMs ?? 10,
    consumed: opts.consumed ?? true,
  };
}

describe('scoreSubsystem', () => {
  it('empty runs returns draft state with zero total', () => {
    const r = scoreSubsystem([]);
    expect(r.total).toBe(0);
    expect(r.maturity).toBe('draft');
    expect(r.runCount).toBe(0);
  });

  it('perfect runs score 100/100 and crystallize at 5+ executions', () => {
    const runs = Array.from({ length: 5 }, () => run());
    const r = scoreSubsystem(runs);
    expect(r.total).toBe(100);
    expect(r.maturity).toBe('crystallized');
    expect(r.recommendation).toBe('crystallize');
  });

  it('mostly-correct runs with one override drop correctness score', () => {
    const runs = [
      run({ verdict: 'pass' }),
      run({ verdict: 'pass' }),
      run({ verdict: 'pass', mlroOverride: 'escalate' }),
      run({ verdict: 'pass' }),
    ];
    const r = scoreSubsystem(runs);
    expect(r.rubric.correctness).toBe(15); // 3/4 correct * 20
    expect(r.total).toBeLessThan(100);
  });

  it('failed runs drop edge-case score', () => {
    const runs = [
      run(),
      run({ failed: true }),
      run({ failed: true }),
      run(),
    ];
    const r = scoreSubsystem(runs);
    expect(r.rubric.edgeCases).toBe(10); // 2/4 * 20
  });

  it('slow runs drop efficiency score', () => {
    const runs = [
      run({ durationMs: 10 }),
      run({ durationMs: 200 }),
      run({ durationMs: 300 }),
    ];
    const r = scoreSubsystem(runs);
    expect(r.rubric.efficiency).toBeLessThan(20);
  });

  it('low total triggers open_repair_task recommendation', () => {
    const runs = Array.from({ length: 5 }, () =>
      run({ failed: true, complete: false, consumed: false, durationMs: 500 })
    );
    const r = scoreSubsystem(runs);
    expect(r.total).toBeLessThan(50);
    expect(r.recommendation).toBe('open_repair_task');
  });

  it('hardened maturity requires >=80 and 5+ runs', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run({
        failed: false,
        complete: true,
        durationMs: 10,
        consumed: true,
        mlroOverride: i === 4 ? 'escalate' : undefined,
      })
    );
    const r = scoreSubsystem(runs);
    // 4/5 correct = 16/20 correctness + 80 from other dims = 96
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.maturity).toMatch(/hardened|crystallized/);
  });
});

describe('buildRepairTaskPayload', () => {
  it('builds a task with BRAIN-REPAIR prefix', () => {
    const runs = Array.from({ length: 5 }, () =>
      run({ failed: true, complete: false, consumed: false, durationMs: 500 })
    );
    const report = scoreSubsystem(runs);
    const payload = buildRepairTaskPayload(report);
    expect(payload.name).toContain('[BRAIN-REPAIR]');
    expect(payload.name).toContain('redTeamCritic');
    expect(payload.notes).toContain('Cabinet Res 134/2025');
    expect(payload.notes).toContain('do NOT auto-rewrite');
  });

  it('priority is critical when total < 30', () => {
    const runs = Array.from({ length: 5 }, () =>
      run({ failed: true, complete: false, consumed: false, durationMs: 5000, mlroOverride: 'freeze' })
    );
    const report = scoreSubsystem(runs);
    const payload = buildRepairTaskPayload(report);
    expect(payload.priority).toBe('critical');
  });
});
