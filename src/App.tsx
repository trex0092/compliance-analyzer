import { useEffect, useState, useCallback } from 'react';
import CasesPage from './ui/cases/CasesPage';
import STRDraftPage from './ui/reports/STRDraftPage';
import KPIDashboard from './ui/dashboard/KPIDashboard';
import { LocalAppStore } from './services/indexedDbStore';
import { calculateKPI } from './domain/kpi';
import { generateAlerts } from './services/alertEngine';
import { createId } from './utils/id';
import { nowIso } from './utils/dates';
import type { ComplianceCase } from './domain/cases';
import type { CustomerProfile } from './domain/customers';
import type { KPIDashboard as KPIData } from './domain/kpi';
import { COMPANY_REGISTRY } from './domain/customers';

const store = new LocalAppStore();

type Page = 'dashboard' | 'cases' | 'str' | 'customers' | 'screening' | 'templates';

// ─── Sidebar Navigation ──────────────────────────────────────────────────────

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'cases', label: 'Cases', icon: '◆' },
  { id: 'str', label: 'STR / SAR', icon: '▲' },
  { id: 'customers', label: 'Customers', icon: '●' },
  { id: 'screening', label: 'Screening', icon: '◈' },
  { id: 'templates', label: 'Templates', icon: '□' },
];

// ─── Seed Data ───────────────────────────────────────────────────────────────

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
      id: createId('case'),
      entityId: 'FINE GOLD LLC',
      caseType: 'transaction-monitoring',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'analyze',
      riskScore: 20,
      riskLevel: 'critical',
      linkedCustomerId: 'company-5',
      redFlags: ['RF011', 'RF067', 'Unexplained third-party payment'],
      findings: ['Missing CDD refresh', 'Potential sanctions proximity'],
      narrative:
        'Customer presented unexplained third-party payment pattern and unresolved source of funds concerns.',
      recommendation: 'str-review',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — FG LLC',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'FINE GOLD (BRANCH)',
      caseType: 'periodic-review',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'onboarding',
      riskScore: 12,
      riskLevel: 'high',
      linkedCustomerId: 'company-6',
      redFlags: ['RF018', 'RF024'],
      findings: ['Complex ownership structure identified', 'E-wallet payments detected'],
      narrative:
        'Branch periodic review flagged complex ownership and alternative payment methods requiring EDD.',
      recommendation: 'edd',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — FG Branch',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'MADISON JEWELLERY TRADING L.L.C',
      caseType: 'onboarding',
      status: 'under-review',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'onboarding',
      riskScore: 8,
      riskLevel: 'medium',
      linkedCustomerId: 'company-1',
      redFlags: ['RF001'],
      findings: ['Increased precious metals supply without documentation'],
      narrative:
        'New onboarding case — unjustified increase in precious metals supply flagged during initial review.',
      recommendation: 'continue',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Madison',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'NAPLES JEWELLERY TRADING L.L.C',
      caseType: 'screening-hit',
      status: 'escalated',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'screening',
      riskScore: 16,
      riskLevel: 'high',
      linkedCustomerId: 'company-2',
      redFlags: ['RF041', 'RF024'],
      findings: ['Certificate of origin under review', 'PayPal payments flagged'],
      narrative:
        'Screening hit on certificates of origin — potential manipulation detected alongside alternative payment methods.',
      recommendation: 'str-review',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Naples',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'GRAMALTIN A.S.',
      caseType: 'sourcing-review',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'analyze',
      riskScore: 10,
      riskLevel: 'medium',
      linkedCustomerId: 'company-3',
      redFlags: ['RF001', 'RF018'],
      findings: ['Supply chain complexity review needed'],
      narrative:
        'Sourcing review triggered for refinery operations — ownership structure and supply volume under assessment.',
      recommendation: 'continue',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Gramaltin',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'ZOE Precious Metals and Jewelery (FZE)',
      caseType: 'periodic-review',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'manual',
      riskScore: 6,
      riskLevel: 'medium',
      linkedCustomerId: 'company-4',
      redFlags: ['RF067'],
      findings: ['Source of funds documentation pending update'],
      narrative:
        'Annual periodic review — source of funds verification requires refresh for continued relationship.',
      recommendation: 'edd',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Zoe FZE',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'MADISON JEWELLERY TRADING L.L.C',
      caseType: 'transaction-monitoring',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'analyze',
      riskScore: 14,
      riskLevel: 'high',
      linkedCustomerId: 'company-1',
      redFlags: ['RF062', 'RF043', 'RF063'],
      findings: [
        'Adverse media linking entity to gold smuggling allegations',
        'Unexplained wealth relative to declared business size',
        'Sudden increase in transaction frequency',
      ],
      narrative:
        'Adverse media screening flagged potential involvement in illicit gold trade. Source of wealth inconsistent with declared jewellery trading volumes. SAR recommended.',
      recommendation: 'sar-review',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Madison SAR',
        },
      ],
    },
    {
      id: createId('case'),
      entityId: 'NAPLES JEWELLERY TRADING L.L.C',
      caseType: 'transaction-monitoring',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'system',
      sourceModule: 'analyze',
      riskScore: 8,
      riskLevel: 'medium',
      linkedCustomerId: 'company-2',
      redFlags: ['RF005'],
      findings: [
        'Cash payment of AED 62,000 for gold bullion',
        'CTR filing required per FDL Art.16',
      ],
      narrative:
        'Single cash transaction of AED 62,000 exceeds DPMS threshold of AED 55,000. CTR must be filed within 15 business days per MoE Circular 08/AML/2021.',
      recommendation: 'ctr-filing',
      auditLog: [
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'system',
          action: 'created',
          note: 'Auto-generated — Naples CTR',
        },
      ],
    },
  ];

  for (const c of demoCases) {
    await store.saveCase(c);
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    background: '#0d1117',
    color: '#e6edf3',
  } as React.CSSProperties,
  sidebar: {
    width: 220,
    background: '#010409',
    borderRight: '1px solid #21262d',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
  } as React.CSSProperties,
  logo: {
    padding: '20px 16px',
    borderBottom: '1px solid #21262d',
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '0.5px',
    color: '#d4a843',
  } as React.CSSProperties,
  navItem: (active: boolean) =>
    ({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      fontSize: '13px',
      fontWeight: active ? 600 : 400,
      color: active ? '#e6edf3' : '#8b949e',
      background: active ? '#161b22' : 'transparent',
      borderLeft: active ? '2px solid #d4a843' : '2px solid transparent',
      cursor: 'pointer',
      transition: 'all 0.15s',
      textDecoration: 'none',
      border: 'none',
      width: '100%',
      textAlign: 'left' as const,
    }) as React.CSSProperties,
  main: {
    flex: 1,
    padding: '24px 32px',
    overflow: 'auto',
    minWidth: 0,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: '1px solid #21262d',
  } as React.CSSProperties,
  pageTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#e6edf3',
    margin: 0,
  } as React.CSSProperties,
  badge: (color: string) =>
    ({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: '11px',
      fontWeight: 600,
      background: color,
      color: '#fff',
    }) as React.CSSProperties,
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    color: '#8b949e',
  } as React.CSSProperties,
  customerCard: {
    background: '#161b22',
    border: '1px solid #21262d',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  } as React.CSSProperties,
  customerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 12,
  } as React.CSSProperties,
  statusDot: (rating: string) => {
    const colors: Record<string, string> = {
      low: '#3DA876',
      medium: '#E8A030',
      high: '#D94F4F',
      critical: '#ff4444',
    };
    return {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: colors[rating] || '#8b949e',
      marginRight: 6,
    } as React.CSSProperties;
  },
} as const;

// ─── Customer List Page ──────────────────────────────────────────────────────

function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void store.getCustomers().then(setCustomers);
  }, []);

  const filtered = customers.filter(
    (c) =>
      c.legalName.toLowerCase().includes(filter.toLowerCase()) ||
      c.riskRating.includes(filter.toLowerCase())
  );

  return (
    <div>
      <input
        type="text"
        placeholder="Search customers..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          width: '100%',
          maxWidth: 400,
          padding: '8px 12px',
          marginBottom: 16,
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 6,
          color: '#e6edf3',
          fontSize: 13,
        }}
      />
      <div style={styles.customerGrid}>
        {filtered.map((c) => (
          <div key={c.id} style={styles.customerCard}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: 14 }}>{c.legalName}</strong>
              <span
                style={styles.badge(
                  c.riskRating === 'high'
                    ? '#D94F4F'
                    : c.riskRating === 'medium'
                      ? '#E8A030'
                      : '#3DA876'
                )}
              >
                {c.riskRating.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>
              <div>
                <span style={styles.statusDot(c.pepStatus === 'clear' ? 'low' : 'high')} />
                PEP: {c.pepStatus}
              </div>
              <div>
                <span style={styles.statusDot(c.sanctionsStatus === 'clear' ? 'low' : 'high')} />
                Sanctions: {c.sanctionsStatus}
              </div>
              <div>
                Type: {c.type} | {c.activity || 'N/A'}
              </div>
              <div>Location: {c.location || 'N/A'}</div>
              {c.nextCDDReviewDate && (
                <div>Next CDD Review: {c.nextCDDReviewDate.slice(0, 10)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={styles.emptyState}>No customers match your search.</div>
      )}
    </div>
  );
}

// ─── Templates Page ─────────────────────────────────────────────────────────

function TemplatesPage() {
  const [templates, setTemplates] = useState<
    {
      id: string;
      name: string;
      category: string;
      regulatoryBasis: string;
      fields: { name: string; label: string; type: string; required: boolean }[];
      approvalRequired: string[];
      retentionYears: number;
    }[]
  >([]);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    void import('./domain/complianceTemplates').then((mod) => {
      const all = mod.ALL_TEMPLATES || [];
      setTemplates(all);
      if (all.length > 0) setSelectedId(all[0].id);
    });
  }, []);

  const selected = templates.find((t) => t.id === selectedId);

  const categoryColors: Record<string, string> = {
    'CDD/KYC': '#3B82F6',
    EDD: '#E8A030',
    Reporting: '#D94F4F',
    PEP: '#8B5CF6',
    TFS: '#f85149',
    'Periodic Review': '#06B6D4',
    'Risk Assessment': '#3DA876',
    Training: '#10B981',
    'Supply Chain': '#F59E0B',
  };

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}
    >
      <div style={{ maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              marginBottom: 6,
              padding: '10px 12px',
              border: `1px solid ${selectedId === t.id ? '#d4a843' : '#21262d'}`,
              borderRadius: 6,
              background: selectedId === t.id ? '#161b22' : '#0d1117',
              cursor: 'pointer',
              color: '#e6edf3',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: 8,
                fontSize: 10,
                marginTop: 4,
                background: categoryColors[t.category] || '#21262d',
                color: '#fff',
              }}
            >
              {t.category}
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div
          style={{
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 8,
            padding: 20,
          }}
        >
          <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#e6edf3' }}>{selected.name}</h3>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 16 }}>
            {selected.id} · Retention: {selected.retentionYears} years
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: '#0d1117',
              border: '1px solid #21262d',
              borderRadius: 6,
              fontSize: 12,
              color: '#8b949e',
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: '#e6edf3' }}>Regulatory Basis:</strong>{' '}
            {selected.regulatoryBasis}
            <br />
            <strong style={{ color: '#e6edf3' }}>Approval Required:</strong>{' '}
            {selected.approvalRequired.join(', ')}
          </div>

          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>
            Fields ({selected.fields.length})
          </div>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e' }}>Field</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e' }}>Type</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', color: '#8b949e' }}>
                  Required
                </th>
              </tr>
            </thead>
            <tbody>
              {selected.fields.map((f) => (
                <tr key={f.name} style={{ borderBottom: '1px solid #161b22' }}>
                  <td style={{ padding: '5px 8px', color: '#e6edf3' }}>{f.label}</td>
                  <td style={{ padding: '5px 8px', color: '#8b949e' }}>{f.type}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    {f.required ? (
                      <span style={{ color: '#D94F4F', fontWeight: 600 }}>Yes</span>
                    ) : (
                      <span style={{ color: '#484f58' }}>No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: '#8b949e' }}>
          Select a template to view its fields.
        </div>
      )}
    </div>
  );
}

// ─── Screening Page ──────────────────────────────────────────────────────────

function ScreeningPage() {
  const [entityName, setEntityName] = useState('');
  const [screening, setScreening] = useState(false);
  const [result, setResult] = useState<{
    matches: { matchedName: string; listSource: string; confidence: number }[];
    listsChecked: string[];
  } | null>(null);

  const runScreening = async () => {
    if (!entityName.trim()) return;
    setScreening(true);
    setResult(null);
    try {
      const { screenEntityComprehensive } = await import('./services/sanctionsApi');
      const res = await screenEntityComprehensive(entityName.trim());
      setResult({ matches: res.matches, listsChecked: res.listsChecked });
      // Persist screening run to store
      await store.saveScreeningRun({
        id: createId('scr'),
        subjectType: 'entity',
        subjectId: entityName.trim(),
        executedAt: nowIso(),
        systemUsed: 'sanctions-api',
        listsChecked: res.listsChecked,
        result:
          res.matches.length === 0
            ? 'clear'
            : res.matches.some((m) => m.confidence >= 0.9)
              ? 'confirmed-match'
              : 'potential-match',
        analyst: 'compliance-officer',
      });
    } catch (err) {
      setResult({ matches: [], listsChecked: ['Error: ' + String(err)] });
    }
    setScreening(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Enter entity or individual name..."
          value={entityName}
          onChange={(e) => setEntityName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runScreening()}
          style={{
            flex: 1,
            maxWidth: 500,
            padding: '10px 14px',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#e6edf3',
            fontSize: 14,
          }}
        />
        <button
          onClick={runScreening}
          disabled={screening || !entityName.trim()}
          style={{
            padding: '10px 20px',
            background: '#d4a843',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            cursor: screening ? 'wait' : 'pointer',
            opacity: screening ? 0.6 : 1,
          }}
        >
          {screening ? 'Screening...' : 'Screen Entity'}
        </button>
      </div>

      {result && (
        <div>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16 }}>
            Lists checked: {result.listsChecked.join(', ')}
          </div>
          {result.matches.length === 0 ? (
            <div style={{ ...styles.customerCard, borderColor: '#238636' }}>
              <strong style={{ color: '#3DA876' }}>CLEAR</strong> — No matches found across{' '}
              {result.listsChecked.length} sanctions lists.
            </div>
          ) : (
            result.matches.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.customerCard,
                  borderColor: m.confidence >= 0.9 ? '#D94F4F' : '#E8A030',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong>{m.matchedName}</strong>
                  <span style={styles.badge(m.confidence >= 0.9 ? '#D94F4F' : '#E8A030')}>
                    {Math.round(m.confidence * 100)}% match
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#8b949e' }}>Source: {m.listSource}</div>
              </div>
            ))
          )}
        </div>
      )}

      {!result && !screening && (
        <div style={styles.emptyState}>
          <p style={{ fontSize: 14 }}>
            Enter a name to screen against UN, OFAC, and EU sanctions lists.
          </p>
          <p style={{ fontSize: 12 }}>
            Results include fuzzy matching for transliterations and aliases.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [kpiData, setKpiData] = useState<KPIData | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshKPI = useCallback(async () => {
    const [cases, reports, screenings, evidence, alerts, approvals, customers] = await Promise.all([
      store.getCases(),
      store.getReports(),
      store.getScreeningRuns(),
      store.getEvidence(),
      store.getAlerts(),
      store.getApprovals(),
      store.getCustomers(),
    ]);

    // Generate fresh alerts
    const freshAlerts = generateAlerts(cases, customers, evidence, screenings);
    for (const a of freshAlerts) {
      const existing = alerts.find((x) => x.id === a.id);
      if (!existing) await store.saveAlert(a);
    }
    const allAlerts = [...alerts, ...freshAlerts.filter((a) => !alerts.find((x) => x.id === a.id))];

    const kpi = calculateKPI(cases, reports, screenings, evidence, allAlerts, approvals, customers);
    setKpiData(kpi);
  }, []);

  useEffect(() => {
    void seedData().then(() => {
      refreshKPI().then(() => setLoading(false));
    });
  }, [refreshKPI]);

  const pageTitle: Record<Page, string> = {
    dashboard: 'Compliance Dashboard',
    cases: 'Case Management',
    str: 'STR / SAR Filing',
    customers: 'Customer Registry',
    screening: 'Sanctions Screening',
    templates: 'Compliance Templates',
  };

  if (loading) {
    return (
      <div style={{ ...styles.layout, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#d4a843', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            HAWKEYE STERLING
          </div>
          <div style={{ color: '#8b949e', fontSize: 13 }}>Loading compliance data...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <nav style={styles.sidebar}>
        <div style={styles.logo}>HAWKEYE STERLING</div>
        <div style={{ padding: '8px 0', flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={styles.navItem(page === item.id)}
            >
              <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #21262d',
            fontSize: 11,
            color: '#484f58',
          }}
        >
          UAE AML/CFT/CPF Compliance
          <br />
          FDL No.10/2025
        </div>
      </nav>

      {/* Main Content */}
      <main style={styles.main}>
        <div style={styles.header}>
          <h1 style={styles.pageTitle}>{pageTitle[page]}</h1>
          {kpiData && page === 'dashboard' && (
            <span
              style={styles.badge(
                kpiData.auditReadinessPct >= 80
                  ? '#238636'
                  : kpiData.auditReadinessPct >= 50
                    ? '#E8A030'
                    : '#D94F4F'
              )}
            >
              Audit Readiness: {kpiData.auditReadinessPct}%
            </span>
          )}
        </div>

        {page === 'dashboard' && kpiData && <KPIDashboard data={kpiData} />}
        {page === 'cases' && <CasesPage />}
        {page === 'str' && <STRDraftPage />}
        {page === 'customers' && <CustomersPage />}
        {page === 'screening' && <ScreeningPage />}
        {page === 'templates' && <TemplatesPage />}
      </main>
    </div>
  );
}
