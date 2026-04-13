/**
 * Asana Health Tile — single-glance sync status on the dashboard.
 *
 * Surfaces the snapshot from src/services/asanaHealthTelemetry.ts:
 * sync status, retry queue depth, rate-limit usage, last error.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 *   - FDL No.10/2025 Art.24 (retention — sync failures tracked)
 */

import { useEffect, useState } from 'react';
import {
  getAsanaHealthSnapshot,
  type AsanaHealthSnapshot,
} from '../../services/asanaHealthTelemetry';

const STATUS_COLORS: Record<AsanaHealthSnapshot['status'], string> = {
  unconfigured: '#8b949e',
  healthy: '#3DA876',
  degraded: '#E8A030',
  critical: '#D94F4F',
};

const STATUS_LABELS: Record<AsanaHealthSnapshot['status'], string> = {
  unconfigured: 'NOT CONFIGURED',
  healthy: 'HEALTHY',
  degraded: 'DEGRADED',
  critical: 'CRITICAL',
};

export default function AsanaHealthTile() {
  const [snapshot, setSnapshot] = useState<AsanaHealthSnapshot | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        setSnapshot(getAsanaHealthSnapshot());
      } catch (err) {
        console.warn('[AsanaHealthTile] snapshot failed:', err);
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!snapshot) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: '#0f0f23',
          borderRadius: 6,
          border: '1px solid #2a2a4a',
          color: '#8b949e',
          fontSize: 11,
        }}
      >
        Loading Asana health…
      </div>
    );
  }

  const color = STATUS_COLORS[snapshot.status];
  const label = STATUS_LABELS[snapshot.status];

  return (
    <div
      style={{
        padding: '14px 16px',
        background: '#0f0f23',
        borderRadius: 8,
        border: `1px solid ${color}44`,
        borderLeft: `4px solid ${color}`,
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
        <div style={{ fontSize: 12, color: '#8b949e', fontWeight: 600 }}>
          ASANA SYNC
        </div>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            background: `${color}22`,
            color,
            border: `1px solid ${color}44`,
            letterSpacing: 0.5,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#e6edf3', marginBottom: 8 }}>
        {snapshot.summary}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          fontSize: 11,
          color: '#8b949e',
        }}
      >
        <div>
          <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>RETRY</div>
          <div style={{ color: '#e6edf3', fontWeight: 600 }}>
            {snapshot.retryQueuePending}
          </div>
        </div>
        <div>
          <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>FAILED</div>
          <div
            style={{
              color: snapshot.retryQueueFailed > 0 ? '#D94F4F' : '#e6edf3',
              fontWeight: 600,
            }}
          >
            {snapshot.retryQueueFailed}
          </div>
        </div>
        <div>
          <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>ACTIVE</div>
          <div style={{ color: '#e6edf3', fontWeight: 600 }}>{snapshot.linksActive}</div>
        </div>
        <div>
          <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5 }}>DONE</div>
          <div style={{ color: '#3DA876', fontWeight: 600 }}>{snapshot.linksCompleted}</div>
        </div>
      </div>
      {snapshot.lastError && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            background: '#161b22',
            border: '1px solid #D94F4F44',
            borderRadius: 4,
            fontSize: 10,
            color: '#D94F4F',
            lineHeight: 1.4,
          }}
          title={snapshot.lastErrorAtIso}
        >
          <strong>Last error:</strong> {snapshot.lastError}
        </div>
      )}
      {snapshot.lastRateLimitAtIso && !snapshot.lastError && (
        <div
          style={{
            marginTop: 10,
            padding: 6,
            background: '#161b22',
            border: '1px solid #E8A03044',
            borderRadius: 4,
            fontSize: 10,
            color: '#E8A030',
          }}
        >
          Recent 429 rate-limit hit ({snapshot.lastRateLimitAtIso.slice(11, 19)})
        </div>
      )}
    </div>
  );
}
