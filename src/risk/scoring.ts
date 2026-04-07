import type { RedFlagDefinition } from './redFlags';

export function calcFlagScore(flag: RedFlagDefinition): number {
  return flag.likelihood * flag.impact;
}

export function applyContextMultiplier(
  baseScore: number,
  context: {
    highRiskJurisdiction?: boolean;
    pep?: boolean;
    repeatAlert?: boolean;
    cash?: boolean;
    sanctionsProximity?: boolean;
  }
): number {
  let multiplier = 1;
  if (context.highRiskJurisdiction) multiplier += 0.5;
  if (context.pep) multiplier += 0.5;
  if (context.repeatAlert) multiplier += 0.5;
  if (context.cash) multiplier += 0.5;
  if (context.sanctionsProximity) multiplier += 1.0;
  return Math.round(baseScore * multiplier);
}

export function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 16) return 'critical';
  if (score >= 11) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}
