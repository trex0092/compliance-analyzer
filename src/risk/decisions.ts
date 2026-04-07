import { scoreToLevel } from './scoring';

export interface DecisionInput {
  sanctionMatch: boolean;
  pepMatch: boolean;
  redFlagScores: number[];
  highFlagCount: number;
  criticalFlagCount: number;
  missingCDD: boolean;
  thirdPartyPayment: boolean;
  sourceOfFundsUnverified: boolean;
}

export interface DecisionOutput {
  totalScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  mandatoryActions: string[];
  recommendedOutcome:
    | 'continue'
    | 'edd'
    | 'reject'
    | 'suspend'
    | 'freeze'
    | 'str-review'
    | 'sar-review'
    | 'ctr-filing';
}

export function decideCase(input: DecisionInput): DecisionOutput {
  const totalScore = input.redFlagScores.reduce((a, b) => a + b, 0);

  if (input.sanctionMatch) {
    return {
      totalScore: Math.max(totalScore, 25),
      riskLevel: 'critical',
      mandatoryActions: ['freeze', 'reject', 'str-review'],
      recommendedOutcome: 'freeze',
    };
  }

  if (input.criticalFlagCount >= 1 || input.sourceOfFundsUnverified) {
    return {
      totalScore,
      riskLevel: 'critical',
      mandatoryActions: ['escalate-to-compliance', 'str-review'],
      recommendedOutcome: 'str-review',
    };
  }

  if (input.highFlagCount >= 2 || input.missingCDD || input.pepMatch) {
    return {
      totalScore,
      riskLevel: totalScore >= 16 ? 'critical' : 'high',
      mandatoryActions: ['edd', 'management-approval'],
      recommendedOutcome: 'edd',
    };
  }

  if (totalScore >= 6 || input.thirdPartyPayment) {
    return {
      totalScore,
      riskLevel: scoreToLevel(totalScore),
      mandatoryActions: ['analyst-review'],
      recommendedOutcome: 'continue',
    };
  }

  return {
    totalScore,
    riskLevel: 'low',
    mandatoryActions: ['log-only'],
    recommendedOutcome: 'continue',
  };
}
