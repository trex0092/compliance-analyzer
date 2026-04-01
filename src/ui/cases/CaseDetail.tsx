import type { ComplianceCase } from "../../domain/cases";
import DecisionPanel from "./DecisionPanel";

type Props = {
  item: ComplianceCase;
};

export default function CaseDetail({ item }: Props) {
  return (
    <div style={{ padding: 16 }}>
      <h2>{item.id}</h2>
      <p><strong>Case Type:</strong> {item.caseType}</p>
      <p><strong>Status:</strong> {item.status}</p>
      <p><strong>Risk Score:</strong> {item.riskScore}</p>
      <p><strong>Risk Level:</strong> {item.riskLevel}</p>
      <p><strong>Narrative:</strong> {item.narrative}</p>

      <h3>Red Flags</h3>
      <ul>
        {item.redFlags.map((flag) => (
          <li key={flag}>{flag}</li>
        ))}
      </ul>

      <h3>Audit Log</h3>
      <ul>
        {item.auditLog.map((event) => (
          <li key={event.id}>
            {event.at} , {event.by} , {event.action}
            {event.note ? ` , ${event.note}` : ""}
          </li>
        ))}
      </ul>

      <DecisionPanel item={item} />
    </div>
  );
}
