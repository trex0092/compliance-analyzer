/**
 * Asana Inspector — read-only compliance view.
 *
 * MoE inspectors and LBMA auditors need a safe, tamper-evident view
 * of every Asana task associated with a compliance case — without
 * the ability to complete, reassign, or annotate anything. This page
 * fetches tasks for a selected project and renders them in a
 * locked-down table with an explicit "READ-ONLY — INSPECTOR MODE"
 * banner.
 *
 * Uses the same loadKanbanBoard() + project selector as the Kanban
 * view but strips every mutation affordance. No drag-drop, no drop
 * targets, no action buttons. Breaches still bubble to the top so
 * the inspector can triage at a glance.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.42-44 (MoE inspection powers)
 *   - FDL No.10/2025 Art.24 (10-year retention surfaced as-is)
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow state)
 *   - FDL No.10/2025 Art.29 (no tipping off — inspector view is for
 *     read-only audit, never for external distribution)
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { loadKanbanBoard, KANBAN_COLUMNS, type KanbanBoard } from '../../services/asanaKanbanView';
import { COMPANY_REGISTRY } from '../../domain/customers';
import { isAsanaConfigured } from '../../services/asanaClient';

const DEFAULT_PROJECT_FALLBACK = '1213759768596515';

interface ProjectOption {
  gid: string;
  label: string;
}

function buildProjectOptions(): ProjectOption[] {
  const opts: ProjectOption[] = [];
  const seen = new Set<string>();
  for (const c of COMPANY_REGISTRY) {
    if (c.asanaComplianceProjectGid && !seen.has(c.asanaComplianceProjectGid)) {
      seen.add(c.asanaComplianceProjectGid);
      opts.push({
        gid: c.asanaComplianceProjectGid,
        label: `${c.legalName} (compliance)`,
      });
    }
    if (c.asanaWorkflowProjectGid && !seen.has(c.asanaWorkflowProjectGid)) {
      seen.add(c.asanaWorkflowProjectGid);
      opts.push({
        gid: c.asanaWorkflowProjectGid,
        label: `${c.legalName} (workflow)`,
      });
    }
  }
  if (!seen.has(DEFAULT_PROJECT_FALLBACK)) {
    opts.unshift({ gid: DEFAULT_PROJECT_FALLBACK, label: 'Default Asana project' });
  }
  return opts;
}

export default function AsanaInspectorPage() {
  const projectOptions = useMemo(buildProjectOptions, []);
  const [projectGid, setProjectGid] = useState<string>(
    projectOptions[0]?.gid ?? DEFAULT_PROJECT_FALLBACK
  );
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadKanbanBoard(projectGid);
    if (!result.ok || !result.board) {
      setError(result.error ?? 'Failed to load inspector view');
      setBoard(null);
    } else {
      setBoard(result.board);
    }
    setLoading(false);
  }, [projectGid]);

  useEffect(() => {
    if (!isAsanaConfigured()) {
      setError('Asana not configured — inspector mode requires read-only token.');
      return;
    }
    void refresh();
  }, [refresh]);

  const allCards = useMemo(() => {
    if (!board) return [];
    const rows = [];
    for (const col of KANBAN_COLUMNS) {
      for (const card of board.columns[col]) {
        rows.push({ col, card });
      }
    }
    // Breach-first, then by due date.
    rows.sort((a, b) => {
      if (a.card.breachWarning !== b.card.breachWarning) return a.card.breachWarning ? -1 : 1;
      const ad = a.card.dueOn ? Date.parse(a.card.dueOn) : Number.POSITIVE_INFINITY;
      const bd = b.card.dueOn ? Date.parse(b.card.dueOn) : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
    return rows;
  }, [board]);

  return (
    <div>
      {/* Read-only banner — prominent, unmissable */}
      <div
        style={{
          padding: '12px 16px',
          background: '#2a1012',
          border: '1px solid #D94F4F',
          borderRadius: 6,
          color: '#D94F4F',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.5,
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        READ-ONLY · INSPECTOR MODE · NO MUTATIONS PERMITTED · FDL Art.42-44
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          Project:
          <select
            value={projectGid}
            onChange={(e) => setProjectGid(e.target.value)}
            style={{
              padding: '6px 10px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#e6edf3',
              fontSize: 12,
              minWidth: 260,
            }}
          >
            {projectOptions.map((opt) => (
              <option key={opt.gid} value={opt.gid}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          style={{
            padding: '6px 16px',
            background: '#161b22',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            fontSize: 12,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {board && (
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {board.totalCards} tasks · {board.breachCount} breach
            {board.breachCount === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#161b22',
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

      {board && allCards.length > 0 && (
        <div
          style={{
            background: '#0d1117',
            border: '1px solid #21262d',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#161b22', borderBottom: '1px solid #21262d' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e' }}>
                  Column
                </th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e' }}>Task</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e' }}>
                  Assignee
                </th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e' }}>Due</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {allCards.map(({ col, card }) => (
                <tr
                  key={card.gid}
                  style={{
                    borderBottom: '1px solid #161b22',
                    background: card.breachWarning ? '#2a1012' : 'transparent',
                  }}
                >
                  <td style={{ padding: '8px 12px', color: '#8b949e', textTransform: 'uppercase' }}>
                    {col}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#e6edf3' }}>{card.name}</td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>
                    {card.assigneeName ?? '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      color: card.breachWarning ? '#D94F4F' : '#8b949e',
                      fontWeight: card.breachWarning ? 600 : 400,
                    }}
                  >
                    {card.dueOn ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {card.breachWarning ? (
                      <span
                        style={{
                          padding: '2px 8px',
                          background: '#D94F4F22',
                          color: '#D94F4F',
                          border: '1px solid #D94F4F44',
                          borderRadius: 3,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                        }}
                      >
                        BREACH
                      </span>
                    ) : (
                      <span style={{ color: '#3DA876', fontSize: 10 }}>OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {board && allCards.length === 0 && !error && (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: 60 }}>
          Project is empty. No tasks to inspect. Select a different project from the dropdown.
        </div>
      )}
    </div>
  );
}
