/**
 * Brain Console — Super Brain Mega Weaponized.
 *
 * One page where the MLRO selects a case, sees the brain verdict
 * live, inspects the STR lifecycle DAG and the brain subsystem DAG
 * side by side, and dispatches a fully-enriched Asana fan-out with
 * a single button. The dispatch creates:
 *
 *   - Parent Asana task with brain notes block + custom fields
 *   - STR 7-subtask lifecycle (for flag/escalate/freeze)
 *   - Four-eyes subtasks (for escalate/freeze, if approvers are
 *     supplied)
 *   - Kanban column move to the suggested column
 *   - SPA toast emission
 *   - Retroactive bulk annotation on existing linked tasks
 *
 * The page renders the full SuperBrainDispatchPlan preview before
 * the MLRO commits — nothing is sent to Asana until "Dispatch" is
 * clicked.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO duty of care)
 *   - FDL No.10/2025 Art.29 (no tipping off — case id only,
 *     never entity legal name in any rendered element)
 *   - Cabinet Res 134/2025 Art.19 (four-eyes internal review)
 *   - NIST AI RMF 1.0 MANAGE-2 (AI-assisted decision visibility)
 */

import { useEffect, useMemo, useState } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import { LocalAppStore } from '../../services/indexedDbStore';
import { COMPANY_REGISTRY } from '../../domain/customers';
import {
  buildSuperBrainDispatchPlan,
  dispatchSuperBrainPlan,
  type SuperBrainDispatchPlan,
  type SuperBrainDispatchResult,
} from '../../services/asanaSuperBrainDispatcher';
import { caseToEnrichableBrain } from '../../services/caseToEnrichableBrain';
import { isAsanaConfigured } from '../../services/asanaClient';
import { STR_LIFECYCLE_DEPENDENCIES } from '../../services/asanaWorkflowAutomation';
import { STR_SUBTASK_STAGES } from '../../services/strSubtaskLifecycle';
import DependencyDag, { type DagNode } from '../reasoning/DependencyDag';
import BrainSubsystemDag from '../reasoning/BrainSubsystemDag';
import BrainVerdictBadge from '../reasoning/BrainVerdictBadge';
import {
  runSuperBrainBatch,
  type SuperBrainBatchSummary,
} from '../../services/superBrainBatchDispatcher';
import { isAutoDispatchEnabled, setAutoDispatchEnabled } from '../../services/autoDispatchListener';
import { summarizeAuditLog } from '../../services/dispatchAuditLog';

const store = new LocalAppStore();
const DEFAULT_PROJECT_FALLBACK = '1213759768596515';

function projectGidForCase(caseObj: ComplianceCase): string {
  const customer = caseObj.linkedCustomerId
    ? COMPANY_REGISTRY.find((c) => c.id === caseObj.linkedCustomerId)
    : undefined;
  return (
    customer?.asanaComplianceProjectGid ??
    customer?.asanaWorkflowProjectGid ??
    DEFAULT_PROJECT_FALLBACK
  );
}

export default function BrainConsolePage() {
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult] = useState<SuperBrainDispatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSummary, setBatchSummary] = useState<SuperBrainBatchSummary | null>(null);
  const [listenerEnabled, setListenerEnabled] = useState<boolean>(() => isAutoDispatchEnabled());

  useEffect(() => {
    void store.getCases().then((items) => {
      setCases(items);
      if (items.length > 0) setSelectedId(items[0].id);
    });
  }, []);

  const auditSummary = useMemo(() => summarizeAuditLog(), [result, batchSummary]);

  const selected = useMemo(() => cases.find((c) => c.id === selectedId), [cases, selectedId]);

  const plan: SuperBrainDispatchPlan | null = useMemo(() => {
    if (!selected) return null;
    try {
      return buildSuperBrainDispatchPlan({
        case: selected,
        projectGid: projectGidForCase(selected),
        dispatchedAtIso: new Date().toISOString(),
      });
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [selected]);

  const brain = useMemo(() => (selected ? caseToEnrichableBrain(selected) : null), [selected]);

  const handleDispatch = async () => {
    if (!selected) return;
    setDispatching(true);
    setError(null);
    setResult(null);
    try {
      const res = await dispatchSuperBrainPlan({
        case: selected,
        projectGid: projectGidForCase(selected),
      });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDispatching(false);
    }
  };

  const handleBatchDispatch = async () => {
    if (cases.length === 0) return;
    setBatchRunning(true);
    setError(null);
    try {
      const openCases = cases.filter((c) => c.status === 'open');
      const summary = await runSuperBrainBatch(openCases, {
        trigger: 'manual',
        skipAlreadyDispatched: true,
      });
      setBatchSummary(summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBatchRunning(false);
    }
  };

  const handleListenerToggle = () => {
    const next = !listenerEnabled;
    setAutoDispatchEnabled(next);
    setListenerEnabled(next);
  };

  return (
    <div>
      {/* Case selector + dispatch bar */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          padding: 12,
          background: '#161b22',
          border: '1px solid #21262d',
          borderRadius: 8,
        }}
      >
        <label
          style={{
            fontSize: 12,
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          Case:
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              padding: '6px 10px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#e6edf3',
              fontSize: 12,
              minWidth: 360,
            }}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.caseType} · {c.riskLevel}
              </option>
            ))}
          </select>
        </label>
        {plan && (
          <BrainVerdictBadge
            verdict={plan.verdict}
            confidence={plan.enrichment.customFields ? undefined : undefined}
            title={`Verdict derived from case ${selected?.id}`}
          />
        )}
        <button
          onClick={() => void handleDispatch()}
          disabled={!selected || dispatching}
          style={{
            padding: '8px 20px',
            background: '#d4a843',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: dispatching ? 'wait' : 'pointer',
            opacity: dispatching || !selected ? 0.6 : 1,
          }}
        >
          {dispatching ? 'DISPATCHING…' : 'DISPATCH SUPER BRAIN'}
        </button>
        <button
          onClick={() => void handleBatchDispatch()}
          disabled={batchRunning || cases.length === 0}
          style={{
            padding: '8px 20px',
            background: '#1f6feb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: batchRunning ? 'wait' : 'pointer',
            opacity: batchRunning || cases.length === 0 ? 0.6 : 1,
          }}
          title="Run the super brain against every open case that has not been dispatched yet"
        >
          {batchRunning ? 'BATCH RUNNING…' : 'DISPATCH ALL OPEN CASES'}
        </button>
        <label
          style={{
            fontSize: 11,
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: listenerEnabled ? '#0f2a1b' : '#161b22',
            border: `1px solid ${listenerEnabled ? '#3DA87644' : '#30363d'}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={listenerEnabled}
            onChange={handleListenerToggle}
            style={{ margin: 0 }}
          />
          AUTOPILOT
          <span style={{ color: listenerEnabled ? '#3DA876' : '#484f58', fontWeight: 600 }}>
            {listenerEnabled ? 'ON' : 'OFF'}
          </span>
        </label>
        {!isAsanaConfigured() && (
          <span style={{ fontSize: 10, color: '#E8A030' }}>
            Asana not configured — dispatch will preview + emit toast only
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#2a1012',
            border: '1px solid #D94F4F44',
            borderLeft: '3px solid #D94F4F',
            borderRadius: 6,
            color: '#D94F4F',
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {plan && selected && brain && (
        <>
          {/* Summary tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Tile label="Verdict" value={plan.verdict.toUpperCase()} />
            <Tile label="Suggested column" value={plan.suggestedColumn.toUpperCase()} />
            <Tile label="STR lifecycle" value={plan.dispatchStrLifecycle ? 'YES' : 'SKIP'} />
            <Tile label="Four-eyes" value={plan.dispatchFourEyes ? 'REQUIRED' : 'NOT REQUIRED'} />
          </div>

          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <div
              style={{
                padding: 12,
                background: '#1f2933',
                border: '1px solid #E8A03044',
                borderLeft: '3px solid #E8A030',
                borderRadius: 6,
                fontSize: 11,
                color: '#E8A030',
                marginBottom: 16,
              }}
            >
              <strong>Warnings:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Brain notes block preview */}
          <div
            style={{
              padding: 16,
              background: '#0d1117',
              border: '1px solid #21262d',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 11,
              color: '#e6edf3',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {plan.enrichment.notesBlock}
          </div>

          {/* Dual DAG layout */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: '#8b949e',
                  fontWeight: 600,
                  marginBottom: 6,
                  letterSpacing: 0.5,
                }}
              >
                BRAIN SUBSYSTEM PIPELINE
              </div>
              <BrainSubsystemDag brain={brain} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: '#8b949e',
                  fontWeight: 600,
                  marginBottom: 6,
                  letterSpacing: 0.5,
                }}
              >
                STR LIFECYCLE (7-STAGE GATE CHAIN)
              </div>
              <DependencyDag
                nodes={STR_SUBTASK_STAGES.map<DagNode>((stage, idx) => ({
                  id: stage,
                  label: stage.toUpperCase(),
                  sublabel: `Stage ${idx + 1}/${STR_SUBTASK_STAGES.length}`,
                  state: plan.dispatchStrLifecycle ? 'active' : 'pending',
                }))}
                edges={STR_LIFECYCLE_DEPENDENCIES}
              />
            </div>
          </div>
        </>
      )}

      {/* Dispatch result */}
      {result && (
        <div
          style={{
            padding: 16,
            background: result.ok ? '#0f2a1b' : '#2a1012',
            border: `1px solid ${result.ok ? '#3DA87644' : '#D94F4F44'}`,
            borderLeft: `3px solid ${result.ok ? '#3DA876' : '#D94F4F'}`,
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: result.ok ? '#3DA876' : '#D94F4F',
              fontWeight: 700,
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            {result.ok ? 'DISPATCH SUCCEEDED' : 'DISPATCH FAILED'}
          </div>
          <div style={{ fontSize: 11, color: '#e6edf3', lineHeight: 1.7 }}>
            Parent GID: <code>{result.parentGid ?? '—'}</code>
            <br />
            STR subtasks: {result.strLifecycle?.subtaskGids.length ?? 0}
            <br />
            Four-eyes subtasks: {result.fourEyesGids.length}
            <br />
            Kanban moved:{' '}
            {result.kanbanMoveOk === undefined ? '—' : result.kanbanMoveOk ? 'yes' : 'no'}
            <br />
            Annotated tasks: {result.annotatedCount}
          </div>
          {result.errors.length > 0 && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                background: '#161b22',
                borderRadius: 4,
                fontSize: 10,
                color: '#D94F4F',
              }}
            >
              <strong>Errors:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Batch summary panel */}
      {batchSummary && (
        <div
          style={{
            padding: 16,
            background: '#0f0f23',
            border: '1px solid #2a2a4a',
            borderLeft: `3px solid ${batchSummary.aborted ? '#D94F4F' : '#3DA876'}`,
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: '#8b949e',
              fontWeight: 600,
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            BATCH DISPATCH RESULT
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 8,
              fontSize: 11,
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>TOTAL</div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18 }}>
                {batchSummary.total}
              </div>
            </div>
            <div>
              <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>DISPATCHED</div>
              <div style={{ color: '#3DA876', fontWeight: 700, fontSize: 18 }}>
                {batchSummary.dispatched}
              </div>
            </div>
            <div>
              <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>SKIPPED</div>
              <div style={{ color: '#8b949e', fontWeight: 700, fontSize: 18 }}>
                {batchSummary.skipped}
              </div>
            </div>
            <div>
              <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>FAILED</div>
              <div
                style={{
                  color: batchSummary.failed > 0 ? '#D94F4F' : '#e6edf3',
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                {batchSummary.failed}
              </div>
            </div>
            <div>
              <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>DURATION</div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18 }}>
                {(batchSummary.durationMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>
          {batchSummary.aborted && (
            <div style={{ fontSize: 10, color: '#D94F4F' }}>
              <strong>ABORTED:</strong> {batchSummary.aborted}
            </div>
          )}
        </div>
      )}

      {/* Audit log summary — always visible */}
      <div
        style={{
          padding: 12,
          background: '#0d1117',
          border: '1px solid #21262d',
          borderRadius: 6,
          fontSize: 10,
          color: '#8b949e',
          marginBottom: 16,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <strong style={{ color: '#e6edf3' }}>AUDIT LOG</strong> · {auditSummary.total} total
        </span>
        <span>Last 24h: {auditSummary.last24h}</span>
        <span>Last 7d: {auditSummary.last7d}</span>
        <span style={{ color: auditSummary.errorsLast24h > 0 ? '#D94F4F' : '#3DA876' }}>
          Errors 24h: {auditSummary.errorsLast24h}
        </span>
        <span style={{ color: '#3DA876' }}>Pass: {auditSummary.byVerdict.pass}</span>
        <span style={{ color: '#E8A030' }}>Flag: {auditSummary.byVerdict.flag}</span>
        <span style={{ color: '#FF8A3D' }}>Escalate: {auditSummary.byVerdict.escalate}</span>
        <span style={{ color: '#D94F4F' }}>Freeze: {auditSummary.byVerdict.freeze}</span>
      </div>

      {cases.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            color: '#8b949e',
            padding: 60,
            background: '#161b22',
            border: '1px dashed #30363d',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8, color: '#e6edf3' }}>No cases loaded yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            Seed cases from the <strong>Cases</strong> page or run a <strong>Screening</strong> to
            generate them. The brain console dispatches one case at a time.
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#0f0f23',
        border: '1px solid #2a2a4a',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 10, color: '#484f58', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#d4a843' }}>{value}</div>
    </div>
  );
}
