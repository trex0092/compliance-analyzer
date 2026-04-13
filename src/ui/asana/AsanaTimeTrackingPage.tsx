/**
 * Asana Time Tracking Rollup — CO hours per compliance area.
 *
 * Wraps the pure rollupTimeByAnalyst() function from asanaOperational
 * and surfaces a per-analyst / per-category breakdown. Time entries
 * come from localStorage (the workflow engine and the four-eyes
 * subtasks log hours there when a task is completed) — there's no
 * live Asana time-tracking API, so this is a best-effort rollup
 * with a clearly labelled data source.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review — CO hours per
 *     compliance area is an operational telemetry requirement)
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care — visible
 *     workload is part of the duty)
 */

import { useEffect, useMemo, useState } from 'react';
import { rollupTimeByAnalyst, type TimeEntry } from '../../services/asanaOperational';

const STORAGE_KEY = 'fgl_time_entries';

const CATEGORY_COLORS: Record<TimeEntry['category'], string> = {
  review: '#3B82F6',
  screening: '#E8A030',
  filing: '#D94F4F',
  meeting: '#8B5CF6',
  other: '#8b949e',
};

function loadEntries(): TimeEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TimeEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Seed a handful of demo entries the first time the page is opened
 * so the chart has something to show. Real deployments overwrite
 * this by logging entries from the workflow engine.
 */
function seedIfEmpty(): TimeEntry[] {
  const existing = loadEntries();
  if (existing.length > 0) return existing;
  const now = new Date().toISOString();
  const demo: TimeEntry[] = [
    { analystGid: 'user-luisa', hours: 6.5, category: 'review', loggedAt: now, taskGid: 't-1' },
    { analystGid: 'user-luisa', hours: 4.0, category: 'filing', loggedAt: now, taskGid: 't-2' },
    {
      analystGid: 'user-luisa',
      hours: 1.5,
      category: 'screening',
      loggedAt: now,
      taskGid: 't-3',
    },
    { analystGid: 'user-mlro', hours: 3.0, category: 'review', loggedAt: now, taskGid: 't-4' },
    { analystGid: 'user-mlro', hours: 2.0, category: 'meeting', loggedAt: now, taskGid: 't-5' },
    {
      analystGid: 'user-analyst-1',
      hours: 5.5,
      category: 'screening',
      loggedAt: now,
      taskGid: 't-6',
    },
    {
      analystGid: 'user-analyst-1',
      hours: 2.0,
      category: 'review',
      loggedAt: now,
      taskGid: 't-7',
    },
  ];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
  } catch {
    /* storage quota */
  }
  return demo;
}

export default function AsanaTimeTrackingPage() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  useEffect(() => {
    setEntries(seedIfEmpty());
  }, []);

  const rollup = useMemo(() => rollupTimeByAnalyst(entries), [entries]);
  const grandTotal = rollup.reduce((sum, r) => sum + r.totalHours, 0);

  const handleReseed = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* empty */
    }
    setEntries(seedIfEmpty());
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#8b949e' }}>
          Source: localStorage <code>fgl_time_entries</code> · {entries.length} entries ·{' '}
          <strong style={{ color: '#e6edf3' }}>{grandTotal.toFixed(1)}h</strong> total
        </div>
        <button
          onClick={handleReseed}
          style={{
            padding: '6px 16px',
            background: '#161b22',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Reset demo data
        </button>
      </div>

      {rollup.length === 0 && (
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
          <div style={{ fontSize: 14, marginBottom: 8, color: '#e6edf3' }}>
            No time entries logged yet
          </div>
          <div style={{ fontSize: 12 }}>
            The workflow engine logs hours here when a task is marked complete. Use the workflow
            scan to populate or click <strong>Reset demo data</strong> above to seed a sample.
          </div>
        </div>
      )}

      {rollup.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rollup.map((row) => {
            const pct = grandTotal > 0 ? (row.totalHours / grandTotal) * 100 : 0;
            return (
              <div
                key={row.analystGid}
                style={{
                  padding: 16,
                  background: '#161b22',
                  border: '1px solid #21262d',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 8,
                  }}
                >
                  <strong style={{ fontSize: 13, color: '#e6edf3' }}>{row.analystGid}</strong>
                  <div style={{ fontSize: 11, color: '#8b949e' }}>
                    <strong style={{ color: '#d4a843', fontSize: 16 }}>
                      {row.totalHours.toFixed(1)}h
                    </strong>{' '}
                    ({pct.toFixed(0)}%)
                  </div>
                </div>
                <div
                  style={{
                    height: 8,
                    background: '#0d1117',
                    borderRadius: 4,
                    overflow: 'hidden',
                    display: 'flex',
                  }}
                >
                  {(Object.entries(row.byCategory) as [TimeEntry['category'], number][]).map(
                    ([cat, hours]) => {
                      if (hours <= 0) return null;
                      const width = row.totalHours > 0 ? (hours / row.totalHours) * 100 : 0;
                      return (
                        <div
                          key={cat}
                          title={`${cat}: ${hours.toFixed(1)}h`}
                          style={{
                            width: `${width}%`,
                            background: CATEGORY_COLORS[cat],
                          }}
                        />
                      );
                    }
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 4,
                    marginTop: 8,
                    fontSize: 10,
                  }}
                >
                  {(Object.entries(row.byCategory) as [TimeEntry['category'], number][]).map(
                    ([cat, hours]) => (
                      <div key={cat} style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            color: CATEGORY_COLORS[cat],
                            fontSize: 9,
                            letterSpacing: 0.5,
                            textTransform: 'uppercase',
                          }}
                        >
                          {cat}
                        </div>
                        <div style={{ color: '#e6edf3', fontWeight: 600 }}>{hours.toFixed(1)}h</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
