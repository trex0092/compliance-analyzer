/**
 * Asana Kanban Page — render compliance tasks as columns inside the SPA.
 *
 * Replaces the old "open Asana in a new tab" flow. The MLRO picks a
 * project from the selector (populated by the customer registry's
 * asanaComplianceProjectGid) and sees tasks grouped into To Do /
 * Doing / Review / Done / Blocked columns. Breach cards bubble to the
 * top of every column with a visible warning badge.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO visibility into work queue)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  loadKanbanBoard,
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABEL,
  type KanbanBoard,
  type KanbanColumn,
  type KanbanCard,
} from '../../services/asanaKanbanView';
import { COMPANY_REGISTRY } from '../../domain/customers';
import { isAsanaConfigured } from '../../services/asanaClient';

const DEFAULT_PROJECT_FALLBACK = '1213759768596515';

const COLUMN_ACCENTS: Record<KanbanColumn, string> = {
  todo: '#3B82F6',
  doing: '#E8A030',
  review: '#8B5CF6',
  done: '#3DA876',
  blocked: '#D94F4F',
};

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

function CardRow({ card }: { card: KanbanCard }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#161b22',
        border: `1px solid ${card.breachWarning ? '#D94F4F' : '#21262d'}`,
        borderLeft: card.breachWarning
          ? '3px solid #D94F4F'
          : `3px solid ${COLUMN_ACCENTS[card.column]}`,
        borderRadius: 6,
        marginBottom: 8,
        cursor: 'grab',
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.gid);
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
        {card.name}
      </div>
      <div style={{ fontSize: 10, color: '#8b949e', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {card.assigneeName && <span>@ {card.assigneeName}</span>}
        {card.dueOn && (
          <span style={{ color: card.breachWarning ? '#D94F4F' : '#8b949e' }}>
            Due {card.dueOn}
          </span>
        )}
        {card.sourceSection && <span style={{ color: '#484f58' }}>§ {card.sourceSection}</span>}
      </div>
      {card.breachWarning && (
        <div
          style={{
            fontSize: 10,
            color: '#D94F4F',
            fontWeight: 700,
            marginTop: 4,
            letterSpacing: 0.5,
          }}
        >
          SLA BREACH
        </div>
      )}
      {card.tagLabels.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {card.tagLabels.map((t) => (
            <span
              key={t}
              style={{
                padding: '1px 6px',
                background: '#0d1117',
                border: '1px solid #21262d',
                borderRadius: 10,
                fontSize: 9,
                color: '#8b949e',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnView({
  column,
  cards,
  onDropCard,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onDropCard: (gid: string, column: KanbanColumn) => void;
}) {
  const accent = COLUMN_ACCENTS[column];
  return (
    <div
      style={{
        flex: '1 1 220px',
        minWidth: 220,
        background: '#0d1117',
        border: '1px solid #21262d',
        borderTop: `3px solid ${accent}`,
        borderRadius: 8,
        padding: 12,
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const gid = e.dataTransfer.getData('text/plain');
        if (gid) onDropCard(gid, column);
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13, color: '#e6edf3' }}>{KANBAN_COLUMN_LABEL[column]}</strong>
        <span
          style={{
            fontSize: 10,
            color: '#8b949e',
            padding: '1px 8px',
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 10,
          }}
        >
          {cards.length}
        </span>
      </div>
      {cards.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            color: '#484f58',
            fontSize: 11,
            padding: '16px 0',
            fontStyle: 'italic',
          }}
        >
          Empty
        </div>
      ) : (
        cards.map((c) => <CardRow key={c.gid} card={c} />)
      )}
    </div>
  );
}

export default function AsanaKanbanPage() {
  const projectOptions = useMemo(buildProjectOptions, []);
  const [projectGid, setProjectGid] = useState<string>(
    projectOptions[0]?.gid ?? DEFAULT_PROJECT_FALLBACK
  );
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localOverride, setLocalOverride] = useState<Record<string, KanbanColumn>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadKanbanBoard(projectGid);
    if (!result.ok || !result.board) {
      setError(result.error ?? 'Failed to load Kanban board');
      setBoard(null);
    } else {
      setBoard(result.board);
      setLocalOverride({});
    }
    setLoading(false);
  }, [projectGid]);

  useEffect(() => {
    if (!isAsanaConfigured()) {
      setError('Asana not configured — set ASANA_TOKEN or proxy URL in Settings.');
      return;
    }
    void refresh();
  }, [refresh]);

  const handleDrop = useCallback((gid: string, column: KanbanColumn) => {
    // Optimistic local move. We do NOT write back to Asana here
    // because that requires section GIDs per project (different per
    // project) — wiring that safely needs a per-project section map
    // which is a separate task. The override lets the MLRO triage
    // the board visually and see what reordering the columns would
    // look like; on refresh we re-fetch from Asana and the override
    // clears.
    setLocalOverride((prev) => ({ ...prev, [gid]: column }));
  }, []);

  const displayBoard = useMemo(() => {
    if (!board) return null;
    if (Object.keys(localOverride).length === 0) return board;
    // Apply local overrides by rebuilding the column map.
    const next: Record<KanbanColumn, KanbanCard[]> = {
      todo: [],
      doing: [],
      review: [],
      done: [],
      blocked: [],
    };
    for (const col of KANBAN_COLUMNS) {
      for (const card of board.columns[col]) {
        const target = localOverride[card.gid] ?? col;
        next[target].push({ ...card, column: target });
      }
    }
    return { ...board, columns: next };
  }, [board, localOverride]);

  return (
    <div>
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
            background: '#d4a843',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {displayBoard && (
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {displayBoard.totalCards} cards · {displayBoard.breachCount} breach
            {displayBoard.breachCount === 1 ? '' : 'es'}
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

      {displayBoard && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 8,
            alignItems: 'flex-start',
          }}
        >
          {KANBAN_COLUMNS.map((col) => (
            <ColumnView
              key={col}
              column={col}
              cards={displayBoard.columns[col]}
              onDropCard={handleDrop}
            />
          ))}
        </div>
      )}

      {!error && !displayBoard && !loading && (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: 60 }}>
          Select a project and click Refresh to load the Kanban board.
        </div>
      )}

      <div
        style={{
          marginTop: 24,
          padding: 12,
          background: '#161b22',
          border: '1px solid #21262d',
          borderRadius: 6,
          fontSize: 11,
          color: '#8b949e',
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: '#e6edf3' }}>Kanban column source of truth:</strong> Asana project
        sections. Supported section names (case-insensitive substring):
        <br />
        <span>
          <code>To Do / Backlog / Queue</code> → <strong>To Do</strong>;{' '}
          <code>In Progress / Doing / WIP</code> → <strong>Doing</strong>;{' '}
          <code>Review / QA / Four-Eyes / Approval</code> → <strong>Review</strong>;{' '}
          <code>Done / Completed / Closed</code> → <strong>Done</strong>; <code>Blocked</code> →{' '}
          <strong>Blocked</strong>.
        </span>
        <br />
        Drag cards between columns to preview a re-ordering locally — write-back to Asana sections
        requires per-project section GIDs and is not wired here.
      </div>
    </div>
  );
}
