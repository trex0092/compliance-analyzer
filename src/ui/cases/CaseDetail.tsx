import { useState } from 'react';
import type { ComplianceCase, CaseStatus, AuditAction } from '../../domain/cases';
import { LocalAppStore } from '../../services/indexedDbStore';
import { createId } from '../../utils/id';
import { nowIso, formatDateDDMMYYYY } from '../../utils/dates';
import DecisionPanel from './DecisionPanel';

const store = new LocalAppStore();

type Props = {
  item: ComplianceCase;
  onCaseUpdated?: (updated: ComplianceCase) => void;
};

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

/** Allowed status transitions per current status */
const TRANSITIONS: Record<string, { status: CaseStatus; label: string; action: AuditAction }[]> = {
  open: [
    { status: 'under-review', label: 'Start Review', action: 'status-changed' },
    { status: 'escalated', label: 'Escalate', action: 'escalated-to-mlro' },
    { status: 'closed', label: 'Close', action: 'status-changed' },
  ],
  'under-review': [
    { status: 'pending-info', label: 'Request Info', action: 'status-changed' },
    { status: 'escalated', label: 'Escalate to MLRO', action: 'escalated-to-mlro' },
    { status: 'approved', label: 'Approve', action: 'approval-approved' },
    { status: 'reported', label: 'Mark as Reported', action: 'str-filed' },
    { status: 'rejected', label: 'Reject', action: 'approval-rejected' },
  ],
  'pending-info': [
    { status: 'under-review', label: 'Info Received', action: 'status-changed' },
    { status: 'closed', label: 'Close (No Response)', action: 'status-changed' },
  ],
  escalated: [
    { status: 'under-review', label: 'Return to Review', action: 'status-changed' },
    { status: 'reported', label: 'File STR/SAR', action: 'str-filed' },
    { status: 'closed', label: 'Close', action: 'status-changed' },
  ],
  approved: [{ status: 'closed', label: 'Close Case', action: 'status-changed' }],
  reported: [{ status: 'closed', label: 'Close After Filing', action: 'status-changed' }],
  closed: [],
  rejected: [{ status: 'open', label: 'Reopen', action: 'status-changed' }],
};

const sectionStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #21262d',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = { fontSize: 11, color: '#8b949e', marginBottom: 2 };
const valueStyle: React.CSSProperties = { fontSize: 13, color: '#e6edf3' };

export default function CaseDetail({ item, onCaseUpdated }: Props) {
  const [comment, setComment] = useState('');

  const changeStatus = async (newStatus: CaseStatus, auditAction: AuditAction) => {
    const updated: ComplianceCase = {
      ...item,
      status: newStatus,
      updatedAt: nowIso(),
      auditLog: [
        ...item.auditLog,
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'compliance-officer',
          action: auditAction,
          note: `Status changed: ${item.status} → ${newStatus}`,
        },
      ],
    };
    await store.saveCase(updated);
    onCaseUpdated?.(updated);
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    const updated: ComplianceCase = {
      ...item,
      updatedAt: nowIso(),
      auditLog: [
        ...item.auditLog,
        {
          id: createId('audit'),
          at: nowIso(),
          by: 'compliance-officer',
          action: 'comment-added',
          note: comment.trim(),
        },
      ],
    };
    await store.saveCase(updated);
    onCaseUpdated?.(updated);
    setComment('');
  };

  const transitions = TRANSITIONS[item.status] || [];

  return (
    <div style={{ maxHeight: 'calc(100vh - 240px)', overflow: 'auto', paddingRight: 8 }}>
      {/* Header */}
      <div
        style={{
          ...sectionStyle,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, color: '#e6edf3' }}>{item.entityId}</h2>
          <div style={{ fontSize: 12, color: '#8b949e' }}>
            {item.id} · {item.caseType.replace(/-/g, ' ')} · {item.sourceModule}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              background: STATUS_COLORS[item.status] || '#6B7280',
              color: '#fff',
            }}
          >
            {item.status.replace(/-/g, ' ').toUpperCase()}
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              background: RISK_COLORS[item.riskLevel] || '#6B7280',
              color: '#fff',
            }}
          >
            {item.riskLevel.toUpperCase()} ({item.riskScore})
          </span>
        </div>
      </div>

      {/* Workflow Actions */}
      {transitions.length > 0 && (
        <div
          style={{
            ...sectionStyle,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: '#8b949e', marginRight: 4 }}>Actions:</span>
          {transitions.map((t) => (
            <button
              key={t.status}
              onClick={() => changeStatus(t.status, t.action)}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid #30363d',
                borderRadius: 6,
                background:
                  t.status === 'escalated' || t.status === 'rejected' ? '#2d1215' : '#0d1117',
                color:
                  t.status === 'escalated' || t.status === 'rejected'
                    ? '#f85149'
                    : t.status === 'approved' || t.status === 'reported'
                      ? '#3DA876'
                      : '#e6edf3',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Details Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={sectionStyle}>
          <div style={labelStyle}>Narrative</div>
          <div style={{ ...valueStyle, lineHeight: 1.5 }}>{item.narrative}</div>
        </div>
        <div style={sectionStyle}>
          <div style={labelStyle}>Recommendation</div>
          <div style={{ ...valueStyle, fontWeight: 600, color: '#d4a843', marginBottom: 8 }}>
            {item.recommendation.replace(/-/g, ' ').toUpperCase()}
          </div>
          <div style={labelStyle}>Created</div>
          <div style={valueStyle}>
            {formatDateDDMMYYYY(item.createdAt) || item.createdAt.slice(0, 10)}
          </div>
          {item.assignedTo && (
            <>
              <div style={{ ...labelStyle, marginTop: 8 }}>Assigned To</div>
              <div style={valueStyle}>{item.assignedTo}</div>
            </>
          )}
        </div>
      </div>

      {/* Red Flags + Findings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={sectionStyle}>
          <div style={{ ...labelStyle, marginBottom: 8, fontWeight: 600, color: '#e6edf3' }}>
            Red Flags ({item.redFlags.length})
          </div>
          {item.redFlags.map((flag) => (
            <div
              key={flag}
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                margin: '0 4px 4px 0',
                borderRadius: 4,
                fontSize: 11,
                background: '#2d1215',
                color: '#f85149',
                border: '1px solid #3d1d20',
              }}
            >
              {flag}
            </div>
          ))}
        </div>
        <div style={sectionStyle}>
          <div style={{ ...labelStyle, marginBottom: 8, fontWeight: 600, color: '#e6edf3' }}>
            Findings ({item.findings.length})
          </div>
          {item.findings.map((f, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: '#e6edf3',
                marginBottom: 6,
                paddingLeft: 8,
                borderLeft: '2px solid #30363d',
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Decision Panel */}
      <DecisionPanel item={item} />

      {/* Add Comment */}
      <div style={{ ...sectionStyle, marginTop: 12 }}>
        <div style={{ ...labelStyle, marginBottom: 8, fontWeight: 600, color: '#e6edf3' }}>
          Add Comment
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Add a compliance note..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addComment()}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#e6edf3',
              fontSize: 12,
            }}
          />
          <button
            onClick={addComment}
            disabled={!comment.trim()}
            style={{
              padding: '6px 14px',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#e6edf3',
              fontSize: 12,
              cursor: comment.trim() ? 'pointer' : 'default',
              opacity: comment.trim() ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Audit Log */}
      <div style={{ ...sectionStyle, marginTop: 12 }}>
        <div style={{ ...labelStyle, marginBottom: 8, fontWeight: 600, color: '#e6edf3' }}>
          Audit Trail ({item.auditLog.length})
        </div>
        {[...item.auditLog].reverse().map((event) => (
          <div
            key={event.id}
            style={{
              display: 'flex',
              gap: 12,
              padding: '6px 0',
              borderBottom: '1px solid #21262d',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#484f58', minWidth: 130, fontSize: 11 }}>
              {formatDateDDMMYYYY(event.at) || event.at.slice(0, 10)} {event.at.slice(11, 16)}
            </span>
            <span style={{ color: '#8b949e', minWidth: 60 }}>{event.by}</span>
            <span
              style={{
                padding: '0 6px',
                borderRadius: 4,
                fontSize: 10,
                background: '#21262d',
                color: '#8b949e',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {event.action}
            </span>
            {event.note && <span style={{ color: '#e6edf3' }}>{event.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
