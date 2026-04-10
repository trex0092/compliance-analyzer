import { describe, it, expect } from 'vitest';
import {
  generateScenarios,
  runRedTeam,
  type Detector,
  type RedTeamScenario,
} from '@/services/redTeamSimulator';

describe('redTeamSimulator — scenario generation', () => {
  it('is deterministic given a seed', () => {
    const a = generateScenarios(42, 10);
    const b = generateScenarios(42, 10);
    expect(a).toEqual(b);
  });

  it('different seeds produce different scenarios', () => {
    const a = generateScenarios(1, 20);
    const b = generateScenarios(2, 20);
    expect(a).not.toEqual(b);
  });

  it('every scenario has regulatory citation', () => {
    const scenarios = generateScenarios(99, 50);
    for (const s of scenarios) {
      expect(s.regulatory).toBeTruthy();
      expect(s.id).toMatch(/^rt-/);
      expect(['flag', 'escalate', 'freeze']).toContain(s.expected);
    }
  });

  it('includes all 10 scenario kinds given enough samples', () => {
    const scenarios = generateScenarios(7, 500);
    const kinds = new Set(scenarios.map((s) => s.kind));
    expect(kinds.size).toBe(10);
  });
});

describe('redTeamSimulator — detector evaluation', () => {
  const allSeeScenarios: RedTeamScenario[] = generateScenarios(1, 20);

  it('perfect detector achieves 100% detection rate', async () => {
    const perfect: Detector = (s) => ({
      verdict: s.expected,
      confidence: 1,
    });
    const report = await runRedTeam(allSeeScenarios, perfect);
    expect(report.detectionRate).toBe(1);
    expect(report.detected).toBe(allSeeScenarios.length);
  });

  it('blind detector achieves 0% detection rate', async () => {
    const blind: Detector = () => ({ verdict: 'pass', confidence: 0 });
    const report = await runRedTeam(allSeeScenarios, blind);
    expect(report.detectionRate).toBe(0);
  });

  it('stronger verdict than expected still counts as detected', async () => {
    const hawk: Detector = () => ({ verdict: 'freeze', confidence: 1 });
    const report = await runRedTeam(allSeeScenarios, hawk);
    expect(report.detectionRate).toBe(1);
  });

  it('aggregates results by kind and difficulty', async () => {
    const detector: Detector = (s) => ({ verdict: s.expected, confidence: 1 });
    const report = await runRedTeam(allSeeScenarios, detector);
    const totalByKind = Object.values(report.byKind).reduce((s, b) => s + b.total, 0);
    expect(totalByKind).toBe(allSeeScenarios.length);
    for (const bucket of Object.values(report.byKind)) {
      expect(bucket.rate).toBeGreaterThanOrEqual(0);
      expect(bucket.rate).toBeLessThanOrEqual(1);
    }
  });

  it('handles detector errors without crashing', async () => {
    const broken: Detector = () => {
      throw new Error('detector crashed');
    };
    const report = await runRedTeam(allSeeScenarios, broken);
    expect(report.detected).toBe(0);
    expect(report.runs.every((r) => r.result.verdict === 'pass')).toBe(true);
  });

  it('produces a sealed reasoning chain with one node per scenario', async () => {
    const detector: Detector = () => ({ verdict: 'flag', confidence: 0.8 });
    const report = await runRedTeam(allSeeScenarios, detector);
    expect(report.chain.sealed).toBe(true);
    // root + one per scenario
    expect(report.chain.nodes).toHaveLength(allSeeScenarios.length + 1);
  });
});
