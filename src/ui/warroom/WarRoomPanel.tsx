/**
 * NORAD War Room Panel.
 *
 * Real-time compliance command-centre dashboard. Consumes a
 * `DashboardSnapshot` produced by `buildDashboardSnapshot` and renders
 * KPI tiles, top incidents, upcoming deadlines, and the recent-events
 * stream.
 *
 * The component is INTENTIONALLY presentational — every value comes
 * from the snapshot, never from local state or imperative fetches.
 * The parent owns refresh cadence (typically a 5-second interval that
 * re-snapshots the shared war-room feed).
 *
 * Regulatory alignment:
 *   FDL No.10/2025 Art.20-21 (CO situational awareness)
 *   Cabinet Res 134/2025 Art.19 (continuous monitoring)
 *   EOCN Inspection Manual §9 (real-time visibility on freeze status)
 */

import type { JSX } from 'react';
import type {
  DashboardSnapshot,
  DashboardTile,
  DashboardIncidentCard,
} from '../../services/warRoomDashboard';

interface WarRoomPanelProps {
  snapshot: DashboardSnapshot;
  /** Optional click handler so the parent can drill into an incident. */
  onIncidentClick?: (id: string) => void;
}

const ACCENT_COLORS: Record<DashboardTile['accent'], string> = {
  ok: '#3DA876',
  info: '#4A8FC1',
  warn: '#E8A030',
  critical: '#D94F4F',
};

function TileCard({ tile }: { tile: DashboardTile }): JSX.Element {
  const color = ACCENT_COLORS[tile.accent];
  return (
    <div
      style={{
        background: 'var(--surface2, #1d1d1d)',
        border: `1px solid ${color}44`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 4,
        padding: 12,
        minWidth: 140,
      }}
    >
      <div
        style={{ fontSize: 10, color: '#a8a8a8', letterSpacing: 0.5, textTransform: 'uppercase' }}
      >
        {tile.label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, color, marginTop: 4 }}>{tile.value}</div>
      {tile.sublabel ? (
        <div style={{ fontSize: 10, color: '#7a7870', marginTop: 2 }}>{tile.sublabel}</div>
      ) : null}
    </div>
  );
}

function IncidentRow({
  incident,
  onClick,
}: {
  incident: DashboardIncidentCard;
  onClick?: (id: string) => void;
}): JSX.Element {
  const sevColor =
    incident.severity === 'critical'
      ? '#D94F4F'
      : incident.severity === 'high'
        ? '#E8A030'
        : incident.severity === 'medium'
          ? '#E8A030'
          : '#7a7870';

  const handle = onClick ? () => onClick(incident.id) : undefined;
  return (
    <div
      onClick={handle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderBottom: '1px solid #2a2a2a',
        cursor: handle ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          background: `${sevColor}22`,
          color: sevColor,
          border: `1px solid ${sevColor}44`,
          borderRadius: 3,
          padding: '2px 8px',
          fontSize: 10,
          textTransform: 'uppercase',
          minWidth: 60,
          textAlign: 'center',
        }}
      >
        {incident.severity}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#f5f5f5' }}>{incident.title}</div>
        <div style={{ fontSize: 10, color: '#7a7870' }}>
          {incident.entityId ? `Entity ${incident.entityId} · ` : ''}
          opened {new Date(incident.openedAt).toLocaleString('en-GB')}
        </div>
      </div>
      {typeof incident.minutesRemaining === 'number' ? (
        <div
          style={{
            fontSize: 11,
            color: incident.minutesRemaining < 60 ? '#D94F4F' : '#E8A030',
            fontFamily: 'Montserrat, sans-serif',
          }}
        >
          {incident.minutesRemaining}m left
        </div>
      ) : null}
    </div>
  );
}

export function WarRoomPanel({ snapshot, onIncidentClick }: WarRoomPanelProps): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--surface, #131313)',
        color: '#f5f5f5',
        padding: 16,
        borderRadius: 4,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            🎯 NORAD War Room — Tenant {snapshot.tenantId}
          </div>
          <div style={{ fontSize: 10, color: '#7a7870' }}>
            As of {new Date(snapshot.asOf).toLocaleString('en-GB')}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {snapshot.tiles.map((tile) => (
          <TileCard key={tile.id} tile={tile} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#a8a8a8',
              textTransform: 'uppercase',
              marginBottom: 6,
              letterSpacing: 0.5,
            }}
          >
            Top incidents
          </div>
          <div style={{ background: '#181818', borderRadius: 4 }}>
            {snapshot.topIncidents.length === 0 ? (
              <div style={{ padding: 12, color: '#7a7870', fontSize: 12 }}>
                No active incidents.
              </div>
            ) : (
              snapshot.topIncidents.map((i) => (
                <IncidentRow key={i.id} incident={i} onClick={onIncidentClick} />
              ))
            )}
          </div>
        </section>

        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#a8a8a8',
              textTransform: 'uppercase',
              marginBottom: 6,
              letterSpacing: 0.5,
            }}
          >
            Upcoming regulatory deadlines
          </div>
          <div style={{ background: '#181818', borderRadius: 4 }}>
            {snapshot.upcomingDeadlines.length === 0 ? (
              <div style={{ padding: 12, color: '#7a7870', fontSize: 12 }}>
                No deadlines in window.
              </div>
            ) : (
              snapshot.upcomingDeadlines.map((i) => (
                <IncidentRow key={i.id} incident={i} onClick={onIncidentClick} />
              ))
            )}
          </div>
        </section>
      </div>

      <section style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#a8a8a8',
            textTransform: 'uppercase',
            marginBottom: 6,
            letterSpacing: 0.5,
          }}
        >
          Recent events
        </div>
        <div
          style={{
            background: '#181818',
            borderRadius: 4,
            padding: 12,
            fontSize: 11,
            fontFamily: 'Menlo, ui-monospace, monospace',
            color: '#cdcdcd',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {snapshot.recentEventTitles.length === 0 ? (
            <div style={{ color: '#7a7870' }}>No recent events.</div>
          ) : (
            snapshot.recentEventTitles.map((title, idx) => (
              <div key={idx} style={{ padding: '2px 0' }}>
                {title}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
