import { calcFlagScore, applyContextMultiplier, scoreToLevel } from '@/risk/scoring';

const makeFlag = (likelihood: number, impact: number) =>
  ({ likelihood, impact } as any);

describe('calcFlagScore', () => {
  it('1 x 1 = 1', () => {
    expect(calcFlagScore(makeFlag(1, 1))).toBe(1);
  });

  it('5 x 5 = 25', () => {
    expect(calcFlagScore(makeFlag(5, 5))).toBe(25);
  });

  it('3 x 4 = 12', () => {
    expect(calcFlagScore(makeFlag(3, 4))).toBe(12);
  });

  it('0 x 5 = 0', () => {
    expect(calcFlagScore(makeFlag(0, 5))).toBe(0);
  });
});

describe('applyContextMultiplier', () => {
  it('no context flags -> multiplier 1 (score unchanged)', () => {
    expect(applyContextMultiplier(10, {})).toBe(10);
  });

  it('highRiskJurisdiction only -> +0.5 multiplier (10 -> 15)', () => {
    expect(applyContextMultiplier(10, { highRiskJurisdiction: true })).toBe(15);
  });

  it('pep only -> +0.5 (10 -> 15)', () => {
    expect(applyContextMultiplier(10, { pep: true })).toBe(15);
  });

  it('cash only -> +0.5 (10 -> 15)', () => {
    expect(applyContextMultiplier(10, { cash: true })).toBe(15);
  });

  it('sanctionsProximity only -> +1.0 (10 -> 20)', () => {
    expect(applyContextMultiplier(10, { sanctionsProximity: true })).toBe(20);
  });

  it('all flags true -> multiplier 3.5 (10 -> 35)', () => {
    expect(
      applyContextMultiplier(10, {
        highRiskJurisdiction: true,
        pep: true,
        cash: true,
        sanctionsProximity: true,
      }),
    ).toBe(35);
  });

  it('returns Math.round result', () => {
    // 7 * 1.5 = 10.5 -> rounds to 11 (banker's rounding irrelevant, Math.round(10.5) = 11)
    expect(applyContextMultiplier(7, { highRiskJurisdiction: true })).toBe(11);
  });
});

describe('scoreToLevel', () => {
  it('0 -> low', () => {
    expect(scoreToLevel(0)).toBe('low');
  });

  it('5 -> low', () => {
    expect(scoreToLevel(5)).toBe('low');
  });

  it('6 -> medium', () => {
    expect(scoreToLevel(6)).toBe('medium');
  });

  it('10 -> medium', () => {
    expect(scoreToLevel(10)).toBe('medium');
  });

  it('11 -> high', () => {
    expect(scoreToLevel(11)).toBe('high');
  });

  it('15 -> high', () => {
    expect(scoreToLevel(15)).toBe('high');
  });

  it('16 -> critical', () => {
    expect(scoreToLevel(16)).toBe('critical');
  });

  it('25 -> critical', () => {
    expect(scoreToLevel(25)).toBe('critical');
  });

  it('100 -> critical', () => {
    expect(scoreToLevel(100)).toBe('critical');
  });
});
