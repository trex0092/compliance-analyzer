import { useMemo } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import { decideCase } from '../../risk/decisions';
import { RED_FLAGS } from '../../risk/redFlags';
import { calcFlagScore } from '../../risk/scoring';

type Props = {
  item: ComplianceCase;
};

export default function DecisionPanel({ item }: Props) {
  const decision = useMemo(() => {
    // Map each red flag code to its actual definition score, falling back to case riskScore
    const scores = item.redFlags.map((flagCode) => {
      const definition = RED_FLAGS.find((rf) => rf.code === flagCode);
      return definition ? calcFlagScore(definition) : Math.max(item.riskScore, 1);
    });

    const highFlagCount = item.redFlags.filter((flagCode) => {
      const def = RED_FLAGS.find((rf) => rf.code === flagCode);
      if (!def) return false;
      const score = calcFlagScore(def);
      return score >= 11 && score < 16;
    }).length;

    const criticalFlagCount = item.redFlags.filter((flagCode) => {
      const def = RED_FLAGS.find((rf) => rf.code === flagCode);
      if (!def) return false;
      return calcFlagScore(def) >= 16;
    }).length;

    return decideCase({
      sanctionMatch: item.redFlags.some(
        (f) => f === 'RF011' || f.toUpperCase().includes('SANCTION')
      ),
      pepMatch: item.redFlags.some((f) => f.toUpperCase().includes('PEP')),
      redFlagScores: scores,
      highFlagCount,
      criticalFlagCount,
      missingCDD: item.findings.some((f) => f.toLowerCase().includes('missing cdd')),
      thirdPartyPayment: item.redFlags.some((f) => f.toLowerCase().includes('third')),
      sourceOfFundsUnverified: item.redFlags.includes('RF067'),
    });
  }, [item]);

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <h3>Decision Engine Output</h3>
      <p>
        <strong>Total Score:</strong> {decision.totalScore}
      </p>
      <p>
        <strong>Risk Level:</strong> {decision.riskLevel}
      </p>
      <p>
        <strong>Recommended Outcome:</strong> {decision.recommendedOutcome}
      </p>
      <div>
        <strong>Mandatory Actions:</strong>
        <ul>
          {decision.mandatoryActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
