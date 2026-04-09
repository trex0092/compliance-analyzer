import { useMemo } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import { decideCase } from '../../risk/decisions';
import { RED_FLAGS } from '../../risk/redFlags';
import { calcFlagScore } from '../../risk/scoring';

type Props = {
  item: ComplianceCase;
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  continue: { label: 'Continue — Standard Monitoring', color: '#3DA876' },
  edd: { label: 'Enhanced Due Diligence Required', color: '#E8A030' },
  reject: { label: 'Reject Relationship', color: '#D94F4F' },
  suspend: { label: 'Suspend Activity', color: '#D94F4F' },
  freeze: { label: 'FREEZE ASSETS — Immediate Action', color: '#FF2D2D' },
  'str-review': { label: 'STR Filing Required', color: '#f85149' },
  'sar-review': { label: 'SAR Filing Required', color: '#f85149' },
  'ctr-filing': { label: 'CTR Filing Required (≥ AED 55,000)', color: '#E8A030' },
};

export default function DecisionPanel({ item }: Props) {
  const decision = useMemo(() => {
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

    // Use explicit RF codes for detection — string matching on codes is unreliable
    const PEP_CODES = ['RF016', 'RF017', 'RF019'];
    const SANCTION_CODES = ['RF011', 'RF012', 'RF013'];
    const THIRD_PARTY_CODES = ['RF007'];

    return decideCase({
      sanctionMatch: item.redFlags.some((f) => SANCTION_CODES.includes(f)),
      pepMatch: item.redFlags.some((f) => PEP_CODES.includes(f)),
      redFlagScores: scores,
      highFlagCount,
      criticalFlagCount,
      missingCDD: item.findings.some((f) => f.toLowerCase().includes('missing cdd')),
      thirdPartyPayment: item.redFlags.some((f) => THIRD_PARTY_CODES.includes(f)),
      sourceOfFundsUnverified: item.redFlags.includes('RF067'),
    });
  }, [item]);

  const outcomeInfo = OUTCOME_LABELS[decision.recommendedOutcome] || {
    label: decision.recommendedOutcome,
    color: '#8b949e',
  };

  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #21262d',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>DECISION ENGINE</span>
        <span
          style={{
            fontSize: 11,
            color: '#484f58',
          }}
        >
          Score: {decision.totalScore} · Level: {decision.riskLevel}
        </span>
      </div>

      {/* Recommended Outcome */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 6,
          background: '#0d1117',
          border: `1px solid ${outcomeInfo.color}40`,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: outcomeInfo.color }}>
          {outcomeInfo.label}
        </div>
      </div>

      {/* Mandatory Actions */}
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Mandatory Actions:</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {decision.mandatoryActions.map((a) => (
          <span
            key={a}
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
              background: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
            }}
          >
            {a.replace(/-/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}
