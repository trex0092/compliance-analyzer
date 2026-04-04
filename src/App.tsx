import { useEffect, useState } from "react";
import CasesPage from "./ui/cases/CasesPage";
import STRDraftPage from "./ui/reports/STRDraftPage";
import { LocalAppStore } from "./services/indexedDbStore";
import { createId } from "./utils/id";
import { nowIso } from "./utils/dates";
import type { ComplianceCase } from "./domain/cases";
import type { CustomerProfile } from "./domain/customers";
import { COMPANY_REGISTRY } from "./domain/customers";

const store = new LocalAppStore();

async function seedData() {
  const existingCustomers = await store.getCustomers();
  if (existingCustomers.length === 0) {
    for (const entry of COMPANY_REGISTRY) {
      const profile: CustomerProfile = {
        ...entry,
        beneficialOwners: [],
        reviewHistory: [],
      };
      await store.saveCustomer(profile);
    }
  }

  const existingCases = await store.getCases();
  if (existingCases.length > 0) return;

  const demoCases: ComplianceCase[] = [
    {
      id: createId("case"),
      entityId: "FINE GOLD LLC",
      caseType: "transaction-monitoring",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "analyze",
      riskScore: 20,
      riskLevel: "critical",
      linkedCustomerId: "company-5",
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
          note: "Seeded demo case — FG LLC",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "FINE GOLD (BRANCH)",
      caseType: "periodic-review",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "onboarding",
      riskScore: 12,
      riskLevel: "high",
      linkedCustomerId: "company-6",
      redFlags: ["RF018", "RF024"],
      findings: ["Complex ownership structure identified", "E-wallet payments detected"],
      narrative:
        "Branch periodic review flagged complex ownership and alternative payment methods requiring EDD.",
      recommendation: "edd",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — FG Branch",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "MADISON JEWELLERY TRADING L.L.C",
      caseType: "onboarding",
      status: "under-review",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "onboarding",
      riskScore: 8,
      riskLevel: "medium",
      linkedCustomerId: "company-1",
      redFlags: ["RF001"],
      findings: ["Increased precious metals supply without documentation"],
      narrative:
        "New onboarding case — unjustified increase in precious metals supply flagged during initial review.",
      recommendation: "continue",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Madison",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "NAPLES JEWELLERY TRADING L.L.C",
      caseType: "screening-hit",
      status: "escalated",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "screening",
      riskScore: 16,
      riskLevel: "high",
      linkedCustomerId: "company-2",
      redFlags: ["RF041", "RF024"],
      findings: ["Certificate of origin under review", "PayPal payments flagged"],
      narrative:
        "Screening hit on certificates of origin — potential manipulation detected alongside alternative payment methods.",
      recommendation: "str-review",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Naples",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "GRAMALTIN A.S.",
      caseType: "sourcing-review",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "analyze",
      riskScore: 10,
      riskLevel: "medium",
      linkedCustomerId: "company-3",
      redFlags: ["RF001", "RF018"],
      findings: ["Supply chain complexity review needed"],
      narrative:
        "Sourcing review triggered for refinery operations — ownership structure and supply volume under assessment.",
      recommendation: "continue",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Gramaltin",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "ZOE Precious Metals and Jewelery (FZE)",
      caseType: "periodic-review",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "manual",
      riskScore: 6,
      riskLevel: "medium",
      linkedCustomerId: "company-4",
      redFlags: ["RF067"],
      findings: ["Source of funds documentation pending update"],
      narrative:
        "Annual periodic review — source of funds verification requires refresh for continued relationship.",
      recommendation: "edd",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Zoe FZE",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "MADISON JEWELLERY TRADING L.L.C",
      caseType: "transaction-monitoring",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "analyze",
      riskScore: 14,
      riskLevel: "high",
      linkedCustomerId: "company-1",
      redFlags: ["RF062", "RF043", "RF063"],
      findings: ["Adverse media linking entity to gold smuggling allegations", "Unexplained wealth relative to declared business size", "Sudden increase in transaction frequency"],
      narrative:
        "Adverse media screening flagged potential involvement in illicit gold trade. Source of wealth inconsistent with declared jewellery trading volumes. SAR recommended.",
      recommendation: "sar-review",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Madison SAR workflow",
        },
      ],
    },
    {
      id: createId("case"),
      entityId: "NAPLES JEWELLERY TRADING L.L.C",
      caseType: "transaction-monitoring",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: "system",
      sourceModule: "analyze",
      riskScore: 8,
      riskLevel: "medium",
      linkedCustomerId: "company-2",
      redFlags: ["RF005"],
      findings: ["Cash payment of AED 62,000 for gold bullion", "CTR filing required per FDL Art.16"],
      narrative:
        "Single cash transaction of AED 62,000 exceeds DPMS threshold of AED 55,000. CTR must be filed within 15 business days per MoE Circular 08/AML/2021.",
      recommendation: "ctr-filing",
      auditLog: [
        {
          id: createId("audit"),
          at: nowIso(),
          by: "system",
          action: "created",
          note: "Seeded demo case — Naples CTR workflow",
        },
      ],
    },
  ];

  for (const c of demoCases) {
    await store.saveCase(c);
  }
}

export default function App() {
  const [tab, setTab] = useState<"cases" | "str">("cases");

  useEffect(() => {
    void seedData();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
      <h1>Hawkeye Sterling V2</h1>

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
