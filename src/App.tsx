import { useEffect, useState } from "react";
import CasesPage from "./ui/cases/CasesPage";
import STRDraftPage from "./ui/reports/STRDraftPage";
import { LocalAppStore } from "./services/indexedDbStore";
import { createId } from "./utils/id";
import { nowIso } from "./utils/dates";
import type { ComplianceCase } from "./domain/cases";

const store = new LocalAppStore();

export default function App() {
  const [tab, setTab] = useState<"cases" | "str">("cases");

  useEffect(() => {
    void (async () => {
      const existing = await store.getCases();
      if (existing.length > 0) return;

      const demoCase: ComplianceCase = {
        id: createId("case"),
        entityId: "XYZ Trading LLC",
        caseType: "transaction-monitoring",
        status: "open",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: "system",
        sourceModule: "analyze",
        riskScore: 20,
        riskLevel: "critical",
        redFlags: ["RF011", "RF067", "Unexplained third-party payment"],
        findings: ["Missing CDD refresh", "Potential sanctions proximity"],
        narrative:
          "Customer presented unexplained third-party payment pattern and unresolved source of funds concerns.",
        recommendation: "str-review",
        auditLog: [
          {
            id: createId("audit"),
            at: nowIso(),
            by: "system",
            action: "created",
            note: "Seeded demo case",
          },
        ],
      };

      await store.saveCase(demoCase);
    })();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
      <h1>Compliance Analyzer Starter</h1>

      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setTab("cases")} style={{ marginRight: 8 }}>
          Cases
        </button>
        <button onClick={() => setTab("str")}>STR Drafts</button>
      </div>

      {tab === "cases" ? <CasesPage /> : <STRDraftPage />}
    </div>
  );
}
