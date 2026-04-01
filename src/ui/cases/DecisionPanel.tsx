import { useMemo } from "react";
import type { ComplianceCase } from "../../domain/cases";
import { decideCase } from "../../risk/decisions";

type Props = {
  item: ComplianceCase;
};

export default function DecisionPanel({ item }: Props) {
  const decision = useMemo(() => {
    const scores = item.redFlags.map(() => Math.max(item.riskScore, 1));
    return decideCase({
      sanctionMatch: item.redFlags.some((f) => f.includes("SANCTION") || f.includes("RF011")),
      pepMatch: item.redFlags.some((f) => f.includes("PEP")),
      redFlagScores: scores,
      highFlagCount: item.riskLevel === "high" ? item.redFlags.length : 0,
      criticalFlagCount: item.riskLevel === "critical" ? item.redFlags.length : 0,
      missingCDD: item.findings.some((f) => f.toLowerCase().includes("missing cdd")),
      thirdPartyPayment: item.redFlags.some((f) => f.toLowerCase().includes("third")),
      sourceOfFundsUnverified: item.redFlags.some((f) => f.includes("RF067")),
    });
  }, [item]);

  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
      <h3>Decision Engine Output</h3>
      <p><strong>Total Score:</strong> {decision.totalScore}</p>
      <p><strong>Risk Level:</strong> {decision.riskLevel}</p>
      <p><strong>Recommended Outcome:</strong> {decision.recommendedOutcome}</p>
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
