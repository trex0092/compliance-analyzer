import { useEffect, useState } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import type { SuspicionReport } from '../../domain/reports';
import { LocalAppStore } from '../../services/indexedDbStore';
import { createId } from '../../utils/id';
import { nowIso } from '../../utils/dates';
import { createStrLifecycleTasks, STR_SUBTASK_STAGES } from '../../services/strSubtaskLifecycle';
import { isAsanaConfigured } from '../../services/asanaClient';
import { COMPANY_REGISTRY } from '../../domain/customers';
import { STR_LIFECYCLE_DEPENDENCIES } from '../../services/asanaWorkflowAutomation';
import DependencyDag, { type DagNode } from '../reasoning/DependencyDag';

// CRITICAL: FDL Art.29 — No Tipping Off
// This page must ONLY be accessible to Compliance Officers and MLRO.
// Subject entity names must NEVER be displayed in a context where
// the subject could see them. Case IDs are used as proxy references.

const store = new LocalAppStore();

function buildSuspicionNarrative(caseObj: ComplianceCase): string {
  const flags = caseObj.redFlags.join(', ');
  return [
    `This report is generated from case ${caseObj.id}.`,
    `The case triggered the following red flags: ${flags}.`,
    `The assessed risk score is ${caseObj.riskScore} and the resulting level is ${caseObj.riskLevel}.`,
    `Summary of facts: ${caseObj.narrative}`,
  ].join(' ');
}

function buildTransactionSummaries(caseObj: ComplianceCase): SuspicionReport['transactions'] {
  const transactions: SuspicionReport['transactions'] = [];

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
  const [selectedId, setSelectedId] = useState<string>('');
  const [lifecycleStatus, setLifecycleStatus] = useState<string>('');

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
      id: createId('str'),
      caseId: selected.id,
      reportType: 'STR',
      status: 'draft',
      reasonForSuspicion: buildSuspicionNarrative(selected),
      facts: selected.findings,
      redFlags: selected.redFlags,
      // Parties are populated on final submission by the CO/MLRO, not in the draft.
      // Storing the subject entityId in the draft risks tipping-off (FDL Art.29)
      // if the draft is inadvertently visible outside the compliance team.
      parties: [
        {
          name: selected.id, // use case ID as reference, not entity name
          role: 'subject',
        },
      ],
      transactions: buildTransactionSummaries(selected),
      generatedAt: nowIso(),
    };

    await store.saveReport(report);

    // Fan out to the 7-subtask Asana lifecycle so the draft doesn't
    // rot in local storage. FDL Art.26-27 + Cabinet Res 134/2025
    // Art.19 — MLRO review → four-eyes → goAML XML → submit → retain
    // → monitor → close. If Asana is not configured we keep the draft
    // saved and surface a status hint so the MLRO knows to wire up the
    // token in Settings.
    if (!isAsanaConfigured()) {
      setLifecycleStatus(
        'STR draft saved. Asana not configured — lifecycle fan-out skipped. Wire ASANA_TOKEN in Settings to enable.'
      );
      return;
    }

    setLifecycleStatus('Dispatching 7-subtask lifecycle to Asana…');
    const customer = selected.linkedCustomerId
      ? COMPANY_REGISTRY.find((c) => c.id === selected.linkedCustomerId)
      : undefined;
    const projectGid =
      customer?.asanaComplianceProjectGid ??
      customer?.asanaWorkflowProjectGid ??
      '1213759768596515';

    try {
      const dispatch = await createStrLifecycleTasks({
        strId: report.id,
        caseId: selected.id,
        entityRef: selected.id, // use case id, not entity name (FDL Art.29)
        riskLevel: selected.riskLevel,
        reasonForSuspicion: buildSuspicionNarrative(selected),
        regulatoryBasis: 'FDL No.10/2025 Art.26-27',
        projectGid,
        draftedAtIso: report.generatedAt,
      });
      if (dispatch.ok) {
        setLifecycleStatus(
          `STR lifecycle dispatched — parent ${dispatch.parentGid} + ${dispatch.subtaskGids.length} subtasks.`
        );
      } else {
        setLifecycleStatus(
          `STR draft saved. Lifecycle fan-out failed: ${dispatch.errors.join('; ')}`
        );
      }
    } catch (err) {
      setLifecycleStatus(`STR draft saved. Lifecycle dispatch error: ${(err as Error).message}`);
    }
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
        <div style={{ marginTop: 16, border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
          <p>
            <strong>Case:</strong> {selected.id}
          </p>
          <p>
            <strong>Risk:</strong> {selected.riskLevel} , {selected.riskScore}
          </p>
          <p>
            <strong>Narrative Preview:</strong>
          </p>
          <p>{buildSuspicionNarrative(selected)}</p>
          <button onClick={handleGenerate}>Generate STR Draft</button>
          {lifecycleStatus && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 12,
                color: '#333',
              }}
            >
              {lifecycleStatus}
            </div>
          )}
        </div>
      )}

      {/* 7-stage STR lifecycle DAG — always visible so the MLRO sees
          the gate chain before dispatching the draft. Node state is
          'pending' by default; the dispatcher doesn't round-trip
          live stage state yet (that requires the Asana webhook path
          in asanaCommentMirror to be wired). */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 12, color: '#8b949e', fontWeight: 600, marginBottom: 8 }}>
          STR LIFECYCLE — 7-STAGE GATE CHAIN (FDL Art.26-27; Cabinet Res 134/2025 Art.19)
        </div>
        <DependencyDag
          nodes={STR_SUBTASK_STAGES.map<DagNode>((stage, idx) => ({
            id: stage,
            label: stage.toUpperCase(),
            sublabel: `Stage ${idx + 1}/${STR_SUBTASK_STAGES.length}`,
            state: 'pending',
          }))}
          edges={STR_LIFECYCLE_DEPENDENCIES}
        />
      </div>

      {cases.length === 0 && (
        <div
          style={{
            marginTop: 24,
            padding: 24,
            background: '#161b22',
            border: '1px dashed #30363d',
            borderRadius: 8,
            textAlign: 'center',
            color: '#8b949e',
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8, color: '#e6edf3' }}>
            No cases available for STR drafting
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            STR drafts must link to a source case. Create a case first from the{' '}
            <strong>Cases</strong> page, or run a screening that produces a red-flagged case. Once a
            case exists, it will appear in the dropdown above for drafting.
          </div>
        </div>
      )}
    </div>
  );
}
