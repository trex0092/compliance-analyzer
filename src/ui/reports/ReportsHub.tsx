import { useEffect, useState, useMemo, useCallback } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';
import type {
  SuspicionReport,
  ReportStatus,
  ReportType,
} from '../../domain/reports';
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_COLORS,
  REPORT_TYPE_LABELS,
} from '../../domain/reports';
import { LocalAppStore } from '../../services/indexedDbStore';
import { buildGoAMLXml, downloadGoAMLXml } from '../../services/goamlBuilder';
import { createId } from '../../utils/id';
import { nowIso, formatDate } from '../../utils/dates';

const store = new LocalAppStore();

// ─── Types ──────────────────────────────────────────────────────────────────

type SortField = 'generatedAt' | 'reportType' | 'status' | 'entityName' | 'amount';
type SortDir = 'asc' | 'desc';
type Tab = 'all' | 'new' | 'submitted' | 'returned';

// ─── Styles ─────────────────────────────────────────────────────────────────

const S = {
  toolbar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    minWidth: 200,
    maxWidth: 360,
    padding: '8px 12px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#e6edf3',
    fontSize: 13,
  },
  select: {
    padding: '8px 10px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#e6edf3',
    fontSize: 12,
  },
  btn: (bg: string) => ({
    padding: '8px 16px',
    background: bg,
    color: bg === '#d4a843' ? '#000' : '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600 as const,
    fontSize: 12,
    cursor: 'pointer',
  }),
  tab: (active: boolean) => ({
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: active ? 600 : (400 as number),
    background: active ? '#161b22' : 'transparent',
    border: `1px solid ${active ? '#d4a843' : '#30363d'}`,
    borderRadius: 6,
    color: '#e6edf3',
    cursor: 'pointer',
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: (sortable: boolean) => ({
    textAlign: 'left' as const,
    padding: '10px 12px',
    color: '#8b949e',
    borderBottom: '2px solid #21262d',
    cursor: sortable ? 'pointer' : 'default',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: 11,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  }),
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #21262d',
    color: '#e6edf3',
    verticalAlign: 'middle' as const,
  },
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    fontWeight: 600 as const,
    background: color,
    color: '#fff',
    whiteSpace: 'nowrap' as const,
  }),
  row: (isHover: boolean) => ({
    background: isHover ? '#161b22' : 'transparent',
    transition: 'background 0.1s',
    cursor: 'pointer',
  }),
  statsCard: {
    background: '#161b22',
    border: '1px solid #21262d',
    borderRadius: 8,
    padding: '12px 16px',
    textAlign: 'center' as const,
    minWidth: 100,
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 20px',
    color: '#8b949e',
  },
  pagination: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    fontSize: 12,
    color: '#8b949e',
  },
  pageBtn: (active: boolean) => ({
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${active ? '#d4a843' : '#30363d'}`,
    background: active ? '#161b22' : 'transparent',
    color: '#e6edf3',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : (400 as number),
  }),
};

// ─── CSV Export ─────────────────────────────────────────────────────────────

function exportReportsCSV(reports: SuspicionReport[]) {
  const headers = [
    'Report ID',
    'Type',
    'Status',
    'Entity',
    'Case ID',
    'Amount',
    'Currency',
    'Severity',
    'Generated',
    'Submitted',
    'FIU Ref',
    'Red Flags',
  ];
  const rows = reports.map((r) => [
    r.id,
    r.reportType,
    REPORT_STATUS_LABELS[r.status] || r.status,
    r.entityName || r.caseId,
    r.caseId,
    r.amount !== null && r.amount !== undefined ? String(r.amount) : '',
    r.currency || '',
    r.severity || '',
    r.generatedAt?.slice(0, 10) || '',
    r.submittedAt?.slice(0, 10) || '',
    r.fiuReferenceNo || '',
    (r.redFlags || []).join('; '),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compliance-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── New Report Modal ───────────────────────────────────────────────────────

function NewReportForm({
  cases,
  customers,
  onSave,
  onCancel,
}: {
  cases: ComplianceCase[];
  customers: CustomerProfile[];
  onSave: (report: SuspicionReport) => void;
  onCancel: () => void;
}) {
  const [caseId, setCaseId] = useState(cases[0]?.id || '');
  const [reportType, setReportType] = useState<ReportType>('STR');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  const selectedCase = cases.find((c) => c.id === caseId);
  const linkedCustomer = selectedCase
    ? customers.find((cu) => cu.id === selectedCase.linkedCustomerId)
    : undefined;

  // Auto-suggest report type based on case recommendation
  useEffect(() => {
    if (!selectedCase) return;
    const rec = selectedCase.recommendation;
    if (rec === 'str-review') setReportType('STR');
    else if (rec === 'sar-review') setReportType('SAR');
    else if (rec === 'ctr-filing') setReportType('CTR');
    else if (rec === 'freeze') setReportType('FFR');

    // Auto-set severity from risk level
    if (selectedCase.riskLevel === 'critical') setSeverity('critical');
    else if (selectedCase.riskLevel === 'high') setSeverity('high');
    else if (selectedCase.riskLevel === 'medium') setSeverity('medium');
    else setSeverity('low');
  }, [selectedCase]);

  const handleCreate = () => {
    if (!selectedCase) return;

    // CRITICAL: FDL Art.29 — No Tipping Off
    // entityName is only stored for CO/MLRO internal use
    const report: SuspicionReport = {
      id: createId('rpt'),
      caseId: selectedCase.id,
      reportType,
      status: 'draft',
      reasonForSuspicion: [
        `Case ${selectedCase.id} triggered red flags: ${selectedCase.redFlags.join(', ')}.`,
        `Risk score: ${selectedCase.riskScore} (${selectedCase.riskLevel}).`,
        selectedCase.narrative,
      ].join(' '),
      facts: selectedCase.findings,
      redFlags: selectedCase.redFlags,
      parties: [
        {
          name: selectedCase.id,
          role: 'subject',
          country: linkedCustomer?.countryOfRegistration,
        },
      ],
      transactions: selectedCase.findings.map((f) => ({
        date: selectedCase.createdAt,
        summary: f,
      })),
      severity,
      entityName: selectedCase.entityId,
      amount: undefined,
      currency: 'AED',
      generatedAt: nowIso(),
      regulatoryBasis:
        reportType === 'CTR'
          ? 'FDL No.10/2025 Art.16, MoE Circular 08/AML/2021 — AED 55K threshold'
          : reportType === 'STR' || reportType === 'SAR'
            ? 'FDL No.10/2025 Art.26-27'
            : reportType === 'FFR'
              ? 'Cabinet Res 74/2020 Art.4-7'
              : 'FDL No.10/2025',
    };

    onSave(report);
  };

  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #21262d',
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e6edf3' }}>
        New Report — Auto-populated from Case
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>
            Source Case
          </label>
          <select
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            style={{ ...S.select, width: '100%' }}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.entityId} ({c.caseType})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>
            Report Type
          </label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            style={{ ...S.select, width: '100%' }}
          >
            {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((t) => (
              <option key={t} value={t}>
                {t} — {REPORT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>
            Severity
          </label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            style={{ ...S.select, width: '100%' }}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      {selectedCase && (
        <div
          style={{
            background: '#0d1117',
            border: '1px solid #21262d',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            lineHeight: 1.8,
          }}
        >
          <div style={{ color: '#d4a843', fontWeight: 600, marginBottom: 4 }}>
            Auto-populated from Case
          </div>
          <div style={{ color: '#8b949e' }}>
            <strong style={{ color: '#e6edf3' }}>Entity:</strong> {selectedCase.entityId}
          </div>
          <div style={{ color: '#8b949e' }}>
            <strong style={{ color: '#e6edf3' }}>Risk:</strong> {selectedCase.riskLevel} ({selectedCase.riskScore})
          </div>
          <div style={{ color: '#8b949e' }}>
            <strong style={{ color: '#e6edf3' }}>Red Flags:</strong> {selectedCase.redFlags.join(', ')}
          </div>
          <div style={{ color: '#8b949e' }}>
            <strong style={{ color: '#e6edf3' }}>Findings:</strong> {selectedCase.findings.join(' | ')}
          </div>
          {linkedCustomer && (
            <div style={{ color: '#8b949e' }}>
              <strong style={{ color: '#e6edf3' }}>Customer:</strong> {linkedCustomer.legalName} —{' '}
              {linkedCustomer.countryOfRegistration || 'N/A'}
            </div>
          )}
          <div
            style={{
              marginTop: 8,
              padding: '6px 10px',
              background: '#1a2332',
              borderRadius: 4,
              fontSize: 11,
              color: '#3DA876',
            }}
          >
            Cost savings: All fields auto-populated from case data. No manual re-entry needed.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleCreate} style={S.btn('#d4a843')}>
          Create Report Draft
        </button>
        <button onClick={onCancel} style={S.btn('#21262d')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Report Detail Panel ────────────────────────────────────────────────────

function ReportDetail({
  report,
  cases,
  customers,
  onStatusChange,
  onClose,
}: {
  report: SuspicionReport;
  cases: ComplianceCase[];
  customers: CustomerProfile[];
  onStatusChange: (id: string, newStatus: ReportStatus, notes?: string) => void;
  onClose: () => void;
}) {
  const [xmlPreview, setXmlPreview] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState('');

  const linkedCase = cases.find((c) => c.id === report.caseId);
  const linkedCustomer = linkedCase
    ? customers.find((cu) => cu.id === linkedCase.linkedCustomerId)
    : undefined;

  const nextActions: Partial<Record<ReportStatus, { label: string; next: ReportStatus; color: string }[]>> = {
    draft: [
      { label: 'Mark Ready for Review', next: 'ready', color: '#3B82F6' },
    ],
    ready: [
      { label: 'Approve', next: 'approved', color: '#238636' },
      { label: 'Return to Draft', next: 'draft', color: '#8b949e' },
    ],
    approved: [
      { label: 'Mark as Exported', next: 'exported', color: '#06B6D4' },
    ],
    exported: [
      { label: 'Mark as Submitted', next: 'submitted', color: '#8B5CF6' },
    ],
    submitted: [
      { label: 'FIU Acknowledged', next: 'acknowledged', color: '#238636' },
      { label: 'Returned by FIU', next: 'returned', color: '#D94F4F' },
    ],
    returned: [
      { label: 'Resubmit', next: 'resubmitted', color: '#E8A030' },
    ],
    resubmitted: [
      { label: 'FIU Acknowledged', next: 'acknowledged', color: '#238636' },
    ],
    acknowledged: [
      { label: 'Close Report', next: 'closed', color: '#484f58' },
    ],
  };

  const actions = nextActions[report.status] || [];

  const handleExportXml = () => {
    downloadGoAMLXml(report, linkedCase, linkedCustomer);
    onStatusChange(report.id, 'exported');
  };

  const handlePreviewXml = () => {
    const xml = buildGoAMLXml(report, linkedCase, linkedCustomer);
    setXmlPreview(xml);
  };

  const handleCopyXml = () => {
    if (xmlPreview) {
      void navigator.clipboard.writeText(xmlPreview).then(() => {
        setCopyMsg('Copied!');
        setTimeout(() => setCopyMsg(''), 2000);
      });
    }
  };

  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #21262d',
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: '#e6edf3' }}>
          {report.reportType} — {report.id}
        </h3>
        <button onClick={onClose} style={{ ...S.btn('#21262d'), padding: '4px 12px' }}>
          Close
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.8 }}>
          <div><strong style={{ color: '#e6edf3' }}>Status:</strong>{' '}
            <span style={S.badge(REPORT_STATUS_COLORS[report.status])}>
              {REPORT_STATUS_LABELS[report.status]}
            </span>
          </div>
          <div><strong style={{ color: '#e6edf3' }}>Entity:</strong> {report.entityName || report.caseId}</div>
          <div><strong style={{ color: '#e6edf3' }}>Case:</strong> {report.caseId}</div>
          <div><strong style={{ color: '#e6edf3' }}>Severity:</strong> {report.severity || 'N/A'}</div>
          <div><strong style={{ color: '#e6edf3' }}>Generated:</strong> {formatDate(report.generatedAt)}</div>
          {report.submittedAt && (
            <div><strong style={{ color: '#e6edf3' }}>Submitted:</strong> {formatDate(report.submittedAt)}</div>
          )}
          {report.fiuReferenceNo && (
            <div><strong style={{ color: '#e6edf3' }}>FIU Ref:</strong> {report.fiuReferenceNo}</div>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.8 }}>
          <div><strong style={{ color: '#e6edf3' }}>Regulatory Basis:</strong> {report.regulatoryBasis || 'N/A'}</div>
          <div><strong style={{ color: '#e6edf3' }}>Red Flags:</strong> {(report.redFlags || []).join(', ') || 'None'}</div>
          {report.amount !== null && report.amount !== undefined && (
            <div><strong style={{ color: '#e6edf3' }}>Amount:</strong> {report.currency || 'AED'} {report.amount.toLocaleString('en-GB')}</div>
          )}
          {report.returnReason && (
            <div style={{ color: '#D94F4F' }}>
              <strong style={{ color: '#D94F4F' }}>Return Reason:</strong> {report.returnReason}
            </div>
          )}
        </div>
      </div>

      <div style={{
        background: '#0d1117',
        border: '1px solid #21262d',
        borderRadius: 6,
        padding: 12,
        marginBottom: 16,
        fontSize: 12,
        color: '#8b949e',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: '#e6edf3' }}>Suspicion Narrative:</strong>
        <div style={{ marginTop: 4 }}>{report.reasonForSuspicion}</div>
      </div>

      {/* goAML XML Actions */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #1a3a2a',
        borderRadius: 6,
        padding: 12,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 12, color: '#3DA876' }}>goAML XML Export</strong>
          <span style={{ fontSize: 10, color: '#484f58' }}>UAE FIU compliant XML — auto-generated from report data</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleExportXml} style={S.btn('#238636')}>
            Download goAML XML
          </button>
          <button onClick={handlePreviewXml} style={S.btn('#1f6feb')}>
            {xmlPreview ? 'Refresh Preview' : 'Preview XML'}
          </button>
          {xmlPreview && (
            <button onClick={handleCopyXml} style={S.btn('#21262d')}>
              {copyMsg || 'Copy XML'}
            </button>
          )}
        </div>

        {xmlPreview && (
          <div style={{ marginTop: 12 }}>
            <pre style={{
              background: '#010409',
              border: '1px solid #21262d',
              borderRadius: 6,
              padding: 12,
              fontSize: 11,
              color: '#8b949e',
              maxHeight: 350,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
              lineHeight: 1.5,
            }}>
              {xmlPreview}
            </pre>
          </div>
        )}
      </div>

      {/* Status Actions */}
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <button
              key={a.next}
              onClick={() => onStatusChange(report.id, a.next)}
              style={S.btn(a.color)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ReportsHub ────────────────────────────────────────────────────────

export default function ReportsHub() {
  const [reports, setReports] = useState<SuspicionReport[]>([]);
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<ReportType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ReportStatus | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('generatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tab, setTab] = useState<Tab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    void Promise.all([
      store.getReports(),
      store.getCases(),
      store.getCustomers(),
    ]).then(([r, c, cu]) => {
      setReports(r);
      setCases(c);
      setCustomers(cu);
    });
  }, []);

  // ── Filtering & Sorting ──
  const filtered = useMemo(() => {
    let list = [...reports];

    // Tab filter
    if (tab === 'new') list = list.filter((r) => r.status === 'draft' || r.status === 'ready');
    else if (tab === 'submitted') list = list.filter((r) => ['submitted', 'acknowledged', 'resubmitted', 'closed'].includes(r.status));
    else if (tab === 'returned') list = list.filter((r) => r.status === 'returned');

    // Type filter
    if (filterType !== 'all') list = list.filter((r) => r.reportType === filterType);

    // Status filter
    if (filterStatus !== 'all') list = list.filter((r) => r.status === filterStatus);

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.reportType.toLowerCase().includes(q) ||
          (r.entityName || '').toLowerCase().includes(q) ||
          r.caseId.toLowerCase().includes(q) ||
          (r.fiuReferenceNo || '').toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      if (sortField === 'generatedAt') {
        va = a.generatedAt || '';
        vb = b.generatedAt || '';
      } else if (sortField === 'reportType') {
        va = a.reportType;
        vb = b.reportType;
      } else if (sortField === 'status') {
        va = a.status;
        vb = b.status;
      } else if (sortField === 'entityName') {
        va = a.entityName || '';
        vb = b.entityName || '';
      } else if (sortField === 'amount') {
        va = a.amount || 0;
        vb = b.amount || 0;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [reports, tab, filterType, filterStatus, search, sortField, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [tab, filterType, filterStatus, search]);

  // ── Stats ──
  const stats = useMemo(() => ({
    total: reports.length,
    drafts: reports.filter((r) => r.status === 'draft' || r.status === 'ready').length,
    submitted: reports.filter((r) => ['submitted', 'acknowledged', 'resubmitted', 'closed'].includes(r.status)).length,
    returned: reports.filter((r) => r.status === 'returned').length,
    str: reports.filter((r) => r.reportType === 'STR').length,
    sar: reports.filter((r) => r.reportType === 'SAR').length,
    ctr: reports.filter((r) => r.reportType === 'CTR').length,
  }), [reports]);

  // ── Handlers ──
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const handleStatusChange = useCallback(async (id: string, newStatus: ReportStatus) => {
    const report = reports.find((r) => r.id === id);
    if (!report) return;

    const updated: SuspicionReport = {
      ...report,
      status: newStatus,
    };

    if (newStatus === 'submitted') {
      updated.submittedAt = nowIso();
      updated.submissionMethod = 'goaml-portal';
    }
    if (newStatus === 'acknowledged') {
      updated.fiuAcknowledgedAt = nowIso();
      updated.followUpStatus = 'acknowledged';
    }
    if (newStatus === 'approved') {
      updated.approvedAt = nowIso();
      updated.approvedBy = 'compliance-officer';
    }

    await store.saveReport(updated);
    setReports((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, [reports]);

  const handleNewReport = useCallback(async (report: SuspicionReport) => {
    await store.saveReport(report);
    setReports((prev) => [report, ...prev]);
    setShowNewForm(false);
  }, []);

  const selectedReport = selectedId ? reports.find((r) => r.id === selectedId) : null;

  return (
    <div>
      {/* Stats Bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Reports', value: stats.total, color: '#d4a843' },
          { label: 'New / Draft', value: stats.drafts, color: '#3B82F6' },
          { label: 'Submitted', value: stats.submitted, color: '#238636' },
          { label: 'Returned', value: stats.returned, color: '#D94F4F' },
          { label: 'STR', value: stats.str, color: '#8B5CF6' },
          { label: 'SAR', value: stats.sar, color: '#E8A030' },
          { label: 'CTR', value: stats.ctr, color: '#06B6D4' },
        ].map((s) => (
          <div key={s.label} style={S.statsCard}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {([
          ['all', `All Reports (${reports.length})`],
          ['new', `New / Draft (${stats.drafts})`],
          ['submitted', `Submitted (${stats.submitted})`],
          ['returned', `Returned (${stats.returned})`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={S.tab(tab === t)}>
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={S.toolbar}>
        <input
          type="text"
          placeholder="Search reports (ID, entity, FIU ref)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={S.searchInput}
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ReportType | 'all')}
          style={S.select}
        >
          <option value="all">All Types</option>
          {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ReportStatus | 'all')}
          style={S.select}
        >
          <option value="all">All Statuses</option>
          {(Object.keys(REPORT_STATUS_LABELS) as ReportStatus[]).map((s) => (
            <option key={s} value={s}>{REPORT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button onClick={() => setShowNewForm(true)} style={S.btn('#d4a843')}>
          + New Report
        </button>
        <button onClick={() => exportReportsCSV(filtered)} style={S.btn('#238636')}>
          Export CSV
        </button>
        <button
          onClick={() => {
            void Promise.all([store.getReports(), store.getCases(), store.getCustomers()]).then(
              ([r, c, cu]) => { setReports(r); setCases(c); setCustomers(cu); }
            );
          }}
          style={S.btn('#21262d')}
        >
          Refresh
        </button>
      </div>

      {/* New Report Form */}
      {showNewForm && (
        <NewReportForm
          cases={cases}
          customers={customers}
          onSave={handleNewReport}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {/* Selected Report Detail */}
      {selectedReport && (
        <ReportDetail
          report={selectedReport}
          cases={cases}
          customers={customers}
          onStatusChange={handleStatusChange}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Data Grid */}
      {filtered.length === 0 ? (
        <div style={S.emptyState}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>No reports match your filters.</p>
          <p style={{ fontSize: 12 }}>
            Create a new report from an existing case, or adjust your filters.
          </p>
        </div>
      ) : (
        <>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th(true)} onClick={() => handleSort('generatedAt')}>
                  Date{sortIndicator('generatedAt')}
                </th>
                <th style={S.th(true)} onClick={() => handleSort('reportType')}>
                  Type{sortIndicator('reportType')}
                </th>
                <th style={S.th(true)} onClick={() => handleSort('status')}>
                  Status{sortIndicator('status')}
                </th>
                <th style={S.th(true)} onClick={() => handleSort('entityName')}>
                  Entity{sortIndicator('entityName')}
                </th>
                <th style={S.th(false)}>Case ID</th>
                <th style={S.th(true)} onClick={() => handleSort('amount')}>
                  Amount{sortIndicator('amount')}
                </th>
                <th style={S.th(false)}>Severity</th>
                <th style={S.th(false)}>FIU Ref</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  onMouseEnter={() => setHoveredRow(r.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={S.row(hoveredRow === r.id || selectedId === r.id)}
                >
                  <td style={S.td}>{formatDate(r.generatedAt)}</td>
                  <td style={S.td}>
                    <span style={S.badge(
                      r.reportType === 'STR' ? '#D94F4F'
                        : r.reportType === 'SAR' ? '#E8A030'
                        : r.reportType === 'CTR' ? '#06B6D4'
                        : r.reportType === 'FFR' ? '#f85149'
                        : '#8B5CF6'
                    )}>
                      {r.reportType}
                    </span>
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(REPORT_STATUS_COLORS[r.status])}>
                      {REPORT_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td style={S.td}>{r.entityName || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#8b949e' }}>{r.caseId}</td>
                  <td style={S.td}>
                    {r.amount !== null && r.amount !== undefined
                      ? `${r.currency || 'AED'} ${r.amount.toLocaleString('en-GB')}`
                      : '—'}
                  </td>
                  <td style={S.td}>
                    {r.severity ? (
                      <span
                        style={S.badge(
                          r.severity === 'critical' ? '#D94F4F'
                            : r.severity === 'high' ? '#E8A030'
                            : r.severity === 'medium' ? '#3B82F6'
                            : '#3DA876'
                        )}
                      >
                        {r.severity}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#8b949e' }}>
                    {r.fiuReferenceNo || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={S.pagination}>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={S.pageBtn(false)}
              >
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const page = i + 1;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    style={S.pageBtn(currentPage === page)}
                  >
                    {page}
                  </button>
                );
              })}
              {totalPages > 7 && <span>...</span>}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={S.pageBtn(false)}
              >
                Next
              </button>
              <span style={{ marginLeft: 8 }}>
                {filtered.length} reports | Page {currentPage} of {totalPages}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
