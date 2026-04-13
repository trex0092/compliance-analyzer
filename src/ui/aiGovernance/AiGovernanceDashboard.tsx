/**
 * AI Governance Dashboard — T4.17.
 *
 * Runs runAiGovernanceAgent('self') on mount and renders the four
 * framework reports (EU AI Act, NIST AI RMF, ISO/IEC 42001, UAE AI
 * Charter) side by side. Highlights the remediation list and the
 * overall score so the MLRO and the Board have a single-glance view
 * of the compliance-analyzer's own AI governance posture.
 *
 * This is the self-audit surface. Customer audits use the same
 * runAiGovernanceAgent entry point with mode: 'customer' and an
 * explicit evidence map — a future UI can layer customer-mode on top
 * of this dashboard by swapping the agent config.
 *
 * Regulatory basis:
 *   - EU Reg 2024/1689 Art.27 (deployer obligations)
 *   - NIST AI RMF 1.0 (Govern, Map, Measure, Manage)
 *   - ISO/IEC 42001:2023 Clause 9 (performance evaluation)
 *   - UAE AI Charter + National AI Strategy 2031
 */

import { useEffect, useState } from 'react';
import { runAiGovernanceAgent } from '../../agents/definitions/ai-governance-agent';
import type { GovernanceAudit, FrameworkReport } from '../../agents/aiGovernance/types';

const FRAMEWORK_LABELS: Record<string, string> = {
  eu_ai_act: 'EU AI Act',
  nist_ai_rmf: 'NIST AI RMF',
  iso_42001: 'ISO/IEC 42001',
  uae_ai_gov: 'UAE AI Charter',
};

const TIER_COLORS: Record<string, string> = {
  unacceptable: '#D94F4F',
  high: '#E8A030',
  limited: '#3B82F6',
  minimal: '#3DA876',
  general_purpose: '#8B5CF6',
};

function scoreColor(score: number): string {
  if (score >= 80) return '#3DA876';
  if (score >= 50) return '#E8A030';
  return '#D94F4F';
}

function FrameworkCard({ report }: { report: FrameworkReport }) {
  const color = scoreColor(report.score);
  return (
    <div
      style={{
        background: '#161b22',
        border: `1px solid ${color}44`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13, color: '#e6edf3' }}>
          {FRAMEWORK_LABELS[report.framework] ?? report.framework}
        </strong>
        {report.hasCriticalFailure && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              background: '#D94F4F22',
              color: '#D94F4F',
              border: '1px solid #D94F4F44',
            }}
          >
            CRITICAL FAIL
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color }}>{report.score}</span>
        <span style={{ fontSize: 11, color: '#8b949e' }}>/ 100</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 4,
          fontSize: 10,
        }}
      >
        {(['pass', 'partial', 'fail', 'unknown', 'not_applicable'] as const).map((key) => (
          <div key={key} style={{ textAlign: 'center' }}>
            <div style={{ color: '#484f58', fontSize: 8, letterSpacing: 0.5 }}>
              {key.toUpperCase().replace('_', ' ')}
            </div>
            <div
              style={{
                color:
                  key === 'pass'
                    ? '#3DA876'
                    : key === 'fail'
                      ? '#D94F4F'
                      : key === 'partial'
                        ? '#E8A030'
                        : '#8b949e',
                fontWeight: 600,
              }}
            >
              {report.summary[key] ?? 0}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AiGovernanceDashboard() {
  const [audit, setAudit] = useState<GovernanceAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const result = runAiGovernanceAgent({
        mode: 'self',
        target: 'compliance-analyzer',
        auditedBy: 'mlro-dashboard',
        euAiActTier: 'high',
      });
      setAudit(result.audit);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div style={{ color: '#8b949e', padding: 24 }}>Running AI governance audit…</div>;
  }

  if (error) {
    return (
      <div
        style={{
          padding: 12,
          background: '#161b22',
          border: '1px solid #D94F4F44',
          borderLeft: '3px solid #D94F4F',
          borderRadius: 6,
          color: '#D94F4F',
          fontSize: 12,
        }}
      >
        AI governance audit failed: {error}
      </div>
    );
  }

  if (!audit) return null;

  const overallColor = scoreColor(audit.overallScore);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          padding: 16,
          background: '#161b22',
          border: `1px solid ${overallColor}44`,
          borderLeft: `4px solid ${overallColor}`,
          borderRadius: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>AUDIT TARGET</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#e6edf3', marginBottom: 8 }}>
            {audit.auditTarget}
          </div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>
            Audited by {audit.auditedBy} · {audit.auditedAt.slice(0, 19).replace('T', ' ')}
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
            EU AI Act tier:{' '}
            <span
              style={{
                padding: '1px 8px',
                background: TIER_COLORS[audit.euAiActTier] + '22',
                color: TIER_COLORS[audit.euAiActTier],
                border: `1px solid ${TIER_COLORS[audit.euAiActTier]}44`,
                borderRadius: 3,
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              {audit.euAiActTier.toUpperCase().replace('_', ' ')}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>OVERALL SCORE</div>
          <div style={{ fontSize: 42, fontWeight: 700, color: overallColor, lineHeight: 1 }}>
            {audit.overallScore}
          </div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>/ 100</div>
        </div>
      </div>

      {/* Framework cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {audit.frameworks.map((report) => (
          <FrameworkCard key={report.framework} report={report} />
        ))}
      </div>

      {/* Remediation */}
      {audit.remediation.length > 0 && (
        <div
          style={{
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: '#8b949e',
              fontWeight: 600,
              marginBottom: 12,
              letterSpacing: 0.5,
            }}
          >
            REMEDIATION ({audit.remediation.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {audit.remediation.slice(0, 30).map((item, i) => (
              <div
                key={`${item.controlId}-${i}`}
                style={{
                  padding: '8px 12px',
                  background: '#0d1117',
                  border: '1px solid #21262d',
                  borderLeft: `3px solid ${
                    item.severity === 'critical'
                      ? '#D94F4F'
                      : item.severity === 'high'
                        ? '#E8A030'
                        : '#3B82F6'
                  }`,
                  borderRadius: 4,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                  <span
                    style={{
                      padding: '1px 6px',
                      background:
                        item.severity === 'critical'
                          ? '#D94F4F22'
                          : item.severity === 'high'
                            ? '#E8A03022'
                            : '#3B82F622',
                      color:
                        item.severity === 'critical'
                          ? '#D94F4F'
                          : item.severity === 'high'
                            ? '#E8A030'
                            : '#3B82F6',
                      borderRadius: 2,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}
                  >
                    {item.severity.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>{item.controlId}</span>
                  <span style={{ fontSize: 10, color: '#484f58' }}>
                    {FRAMEWORK_LABELS[item.framework] ?? item.framework}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#e6edf3', marginBottom: 2 }}>{item.title}</div>
                <div style={{ fontSize: 10, color: '#8b949e' }}>{item.citation}</div>
              </div>
            ))}
            {audit.remediation.length > 30 && (
              <div style={{ fontSize: 11, color: '#484f58', textAlign: 'center', paddingTop: 8 }}>
                …and {audit.remediation.length - 30} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
