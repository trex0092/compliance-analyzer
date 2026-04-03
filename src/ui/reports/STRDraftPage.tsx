import { useEffect, useState } from "react";
import type { ComplianceCase } from "../../domain/cases";
import type { SuspicionReport } from "../../domain/reports";
import { LocalAppStore } from "../../services/indexedDbStore";
import { createId } from "../../utils/id";
import { nowIso } from "../../utils/dates";

const store = new LocalAppStore();

function buildSuspicionNarrative(caseObj: ComplianceCase): string {
  const flags = caseObj.redFlags.join(", ");
  return [
    `This report is generated from case ${caseObj.id}.`,
    `The case triggered the following red flags: ${flags}.`,
    `The assessed risk score is ${caseObj.riskScore} and the resulting level is ${caseObj.riskLevel}.`,
    `Summary of facts: ${caseObj.narrative}`,
  ].join(" ");
}

function buildTransactionSummaries(
  caseObj: ComplianceCase
): SuspicionReport["transactions"] {
  const transactions: SuspicionReport["transactions"] = [];

  // Generate transaction entries from case findings and flags
  for (const finding of caseObj.findings) {
    transactions.push({
      date: caseObj.createdAt,
      summary: finding,
    });
  }

  // If the case has linked shipments, reference them
  if (caseObj.linkedShipmentIds && caseObj.linkedShipmentIds.length > 0) {
    for (const shipmentId of caseObj.linkedShipmentIds) {
      transactions.push({
        date: caseObj.createdAt,
        summary: `Linked shipment: ${shipmentId}`,
      });
    }
  }

  // Ensure at least one transaction entry exists
  if (transactions.length === 0) {
    transactions.push({
      date: caseObj.createdAt,
      summary: `Suspicious activity identified — ${caseObj.caseType} case with risk level ${caseObj.riskLevel}.`,
    });
  }

  return transactions;
}

export default function STRDraftPage() {
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    void store.getCases().then((items) => {
      setCases(items);
      if (items.length) setSelectedId(items[0].id);
    });
  }, []);

  const selected = cases.find((c) => c.id === selectedId);

  const handleGenerate = async () => {
    if (!selected) return;

    const report: SuspicionReport = {
      id: createId("str"),
      caseId: selected.id,
      reportType: "STR",
      status: "draft",
      reasonForSuspicion: buildSuspicionNarrative(selected),
      facts: selected.findings,
      redFlags: selected.redFlags,
      parties: [
        {
          name: selected.entityId,
          role: "subject",
        },
      ],
      transactions: buildTransactionSummaries(selected),
      generatedAt: nowIso(),
    };

    await store.saveReport(report);
    alert("STR draft generated.");
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>STR Draft Generator</h2>

      <label>
        Select case:
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ marginLeft: 8 }}
        >
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} , {c.caseType}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div style={{ marginTop: 16, border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          <p><strong>Case:</strong> {selected.id}</p>
          <p><strong>Risk:</strong> {selected.riskLevel} , {selected.riskScore}</p>
          <p><strong>Narrative Preview:</strong></p>
          <p>{buildSuspicionNarrative(selected)}</p>
          <button onClick={handleGenerate}>Generate STR Draft</button>
        </div>
      )}
    </div>
  );
}
