import { useEffect, useState, useCallback } from 'react';
import type { ComplianceCase, CaseStatus } from '../../domain/cases';
import { LocalAppStore } from '../../services/indexedDbStore';
import CaseDetail from './CaseDetail';

const store = new LocalAppStore();

const STATUS_COLORS: Record<string, string> = {
  open: '#E8A030',
  'under-review': '#3B82F6',
  'pending-info': '#8B5CF6',
  escalated: '#D94F4F',
  approved: '#3DA876',
  reported: '#06B6D4',
  closed: '#6B7280',
  rejected: '#9CA3AF',
};

const RISK_COLORS: Record<string, string> = {
  low: '#3DA876',
  medium: '#E8A030',
  high: '#D94F4F',
  critical: '#FF2D2D',
};

export default function CasesPage() {
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [selected, setSelected] = useState<ComplianceCase | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const loadCases = useCallback(async () => {
    const items = await store.getCases();
    setCases(items);
    if (items.length > 0 && !selected) setSelected(items[0]);
  }, [selected]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  const onCaseUpdated = useCallback((updated: ComplianceCase) => {
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelected(updated);
  }, []);

  const filtered = cases.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (riskFilter !== 'all' && c.riskLevel !== riskFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.entityId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.caseType.toLowerCase().includes(q) ||
        c.narrative.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCount = cases.filter((c) => c.status === 'open' || c.status === 'under-review').length;
  const criticalCount = cases.filter(
    (c) => c.riskLevel === 'critical' && c.status !== 'closed'
  ).length;
  const escalatedCount = cases.filter((c) => c.status === 'escalated').length;

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {[
          { label: 'Open', value: openCount, color: '#E8A030' },
          { label: 'Critical', value: criticalCount, color: '#D94F4F' },
          { label: 'Escalated', value: escalatedCount, color: '#FF6B6B' },
          { label: 'Total', value: cases.length, color: '#8b949e' },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: '#161b22',
              border: '1px solid #21262d',
              borderRadius: 8,
              padding: '10px 16px',
              minWidth: 80,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search cases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            maxWidth: 300,
            padding: '6px 10px',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#e6edf3',
            fontSize: 12,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CaseStatus | 'all')}
          style={{
            padding: '6px 10px',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#e6edf3',
            fontSize: 12,
          }}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="under-review">Under Review</option>
          <option value="escalated">Escalated</option>
          <option value="pending-info">Pending Info</option>
          <option value="approved">Approved</option>
          <option value="reported">Reported</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          style={{
            padding: '6px 10px',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#e6edf3',
            fontSize: 12,
          }}
        >
          <option value="all">All Risk Levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Case list + detail */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}
      >
        {/* Case List */}
        <div style={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: '#8b949e', fontSize: 13 }}>
              No cases match your filters.
            </div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 8,
                padding: 12,
                border: `1px solid ${selected?.id === c.id ? '#d4a843' : '#21262d'}`,
                borderRadius: 8,
                background: selected?.id === c.id ? '#161b22' : '#0d1117',
                cursor: 'pointer',
                color: '#e6edf3',
                transition: 'border-color 0.15s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <strong style={{ fontSize: 13 }}>{c.entityId}</strong>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 600,
                    background: RISK_COLORS[c.riskLevel] || '#6B7280',
                    color: '#fff',
                  }}
                >
                  {c.riskLevel.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
                {c.caseType.replace(/-/g, ' ')} · Score {c.riskScore}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: STATUS_COLORS[c.status] || '#6B7280',
                  }}
                />
                <span style={{ fontSize: 11, color: '#8b949e' }}>
                  {c.status.replace(/-/g, ' ')}
                </span>
                <span style={{ fontSize: 11, color: '#484f58', marginLeft: 'auto' }}>
                  {c.redFlags.length} flags
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Case Detail */}
        <div>
          {selected ? (
            <CaseDetail item={selected} onCaseUpdated={onCaseUpdated} />
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: '#8b949e' }}>
              Select a case to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
