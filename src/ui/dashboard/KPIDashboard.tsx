/**
 * KPI Dashboard Component
 *
 * Displays real-time compliance KPIs using the calculateKPI function.
 * Designed for compliance officers and auditors.
 */

import { useMemo } from 'react';
import type { KPIDashboard as KPIData } from '../../domain/kpi';

interface KPIDashboardProps {
  data: KPIData;
}

function MetricCard({
  label,
  value,
  target,
  unit,
  inverse,
}: {
  label: string;
  value: number;
  target?: number;
  unit?: string;
  inverse?: boolean;
}) {
  const isGood = target !== undefined ? (inverse ? value <= target : value >= target) : true;

  const color = isGood ? '#3DA876' : value === 0 && !inverse ? '#E8A030' : '#D94F4F';
  const displayValue = unit === '%' ? `${value}%` : String(value);

  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#0f0f23',
        borderRadius: '6px',
        border: `1px solid ${color}33`,
        minWidth: '140px',
      }}
    >
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, color }}>{displayValue}</div>
      {target !== undefined && (
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          Target: {inverse ? '≤' : '≥'}
          {target}
          {unit || ''}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'good' | 'warning' | 'critical' }) {
  const colors = { good: '#3DA876', warning: '#E8A030', critical: '#D94F4F' };
  const labels = { good: 'COMPLIANT', warning: 'ATTENTION', critical: 'ACTION REQUIRED' };
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: '3px',
        fontSize: '10px',
        fontWeight: 700,
        background: `${colors[status]}22`,
        color: colors[status],
        border: `1px solid ${colors[status]}44`,
      }}
    >
      {labels[status]}
    </span>
  );
}

export function KPIDashboardView({ data }: KPIDashboardProps) {
  const overallStatus = useMemo(() => {
    if (data.criticalCases > 0 || data.criticalAlerts > 0 || data.auditReadinessPct < 50)
      return 'critical';
    if (data.overdueReviews > 0 || data.strPending > 0 || data.auditReadinessPct < 80)
      return 'warning';
    return 'good';
  }, [data]);

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', color: '#e0e0e0' }}>Compliance Dashboard</h2>
        <StatusBadge status={overallStatus} />
      </div>

      {/* Audit Readiness */}
      <div
        style={{
          padding: '16px',
          background: '#0f0f23',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '1px solid #2a2a4a',
        }}
      >
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
          MOE AUDIT READINESS
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span
            style={{
              fontSize: '36px',
              fontWeight: 700,
              color:
                data.auditReadinessPct >= 80
                  ? '#3DA876'
                  : data.auditReadinessPct >= 50
                    ? '#E8A030'
                    : '#D94F4F',
            }}
          >
            {data.auditReadinessPct}%
          </span>
          <span style={{ fontSize: '12px', color: '#666' }}>/ 100%</span>
        </div>
        <div
          style={{
            width: '100%',
            height: '6px',
            background: '#1a1a2e',
            borderRadius: '3px',
            marginTop: '8px',
          }}
        >
          <div
            style={{
              width: `${data.auditReadinessPct}%`,
              height: '100%',
              background:
                data.auditReadinessPct >= 80
                  ? '#3DA876'
                  : data.auditReadinessPct >= 50
                    ? '#E8A030'
                    : '#D94F4F',
              borderRadius: '3px',
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '10px',
          marginBottom: '16px',
        }}
      >
        <MetricCard label="Open Cases" value={data.openCases} target={10} inverse unit="" />
        <MetricCard label="Critical Cases" value={data.criticalCases} target={0} inverse />
        <MetricCard label="Overdue Reviews" value={data.overdueReviews} target={0} inverse />
        <MetricCard label="CDD On Time" value={data.cddReviewOnTimePct} target={90} unit="%" />
        <MetricCard
          label="STR Filing Rate"
          value={data.strFilingTimelinessPct}
          target={90}
          unit="%"
        />
        <MetricCard
          label="Evidence Complete"
          value={data.evidenceCompletionPct}
          target={80}
          unit="%"
        />
        <MetricCard label="Active Alerts" value={data.activeAlerts} target={5} inverse />
        <MetricCard label="Critical Alerts" value={data.criticalAlerts} target={0} inverse />
        <MetricCard label="Pending Approvals" value={data.pendingApprovals} target={3} inverse />
        <MetricCard label="STR Pending" value={data.strPending} target={0} inverse />
        <MetricCard label="Screening Runs" value={data.screeningRuns} target={1} />
        <MetricCard label="PF Alerts" value={data.pfAlertsGenerated} target={0} inverse />
      </div>

      {/* Filing Summary */}
      <div
        style={{
          padding: '12px 16px',
          background: '#0f0f23',
          borderRadius: '6px',
          border: '1px solid #2a2a4a',
        }}
      >
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>FILING SUMMARY</div>
        <div style={{ display: 'flex', gap: '24px', fontSize: '13px', color: '#e0e0e0' }}>
          <span>
            STR: <strong>{data.strCount}</strong>
          </span>
          <span>
            SAR: <strong>{data.sarCount}</strong>
          </span>
          <span>
            CTR: <strong>{data.ctrCount}</strong>
          </span>
          <span>
            Blocked Shipments: <strong>{data.blockedShipments}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
