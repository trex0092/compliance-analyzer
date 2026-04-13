/**
 * Brain Verdict Badge — small chip showing a compliance verdict +
 * confidence. Used on the Kanban view, the STR draft page, and the
 * cases list once the brain pipeline has scored an entity.
 *
 * Pure presentational component — no state, no data fetching.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO visibility into brain output)
 *   - NIST AI RMF 1.0 MANAGE-2 (explainability of AI-assisted decisions)
 */

import type { Verdict } from '../../services/asanaCustomFields';

const VERDICT_COLORS: Record<Verdict, { fg: string; bg: string; border: string }> = {
  pass: { fg: '#3DA876', bg: '#0f2a1b', border: '#3DA87644' },
  flag: { fg: '#E8A030', bg: '#1f2933', border: '#E8A03044' },
  escalate: { fg: '#FF8A3D', bg: '#2a1c10', border: '#FF8A3D44' },
  freeze: { fg: '#D94F4F', bg: '#2a1012', border: '#D94F4F44' },
};

const VERDICT_ICON: Record<Verdict, string> = {
  pass: '●',
  flag: '▲',
  escalate: '◆',
  freeze: '■',
};

export interface BrainVerdictBadgeProps {
  verdict: Verdict;
  confidence?: number;
  /** Compact mode — 10px font, no confidence, no icon. */
  compact?: boolean;
  /** Optional tooltip text. */
  title?: string;
}

export default function BrainVerdictBadge({
  verdict,
  confidence,
  compact,
  title,
}: BrainVerdictBadgeProps) {
  const palette = VERDICT_COLORS[verdict];
  const icon = VERDICT_ICON[verdict];
  const pct =
    typeof confidence === 'number' && Number.isFinite(confidence)
      ? ` ${Math.round(confidence * 100)}%`
      : '';

  return (
    <span
      title={title ?? `Brain verdict: ${verdict}${pct ? ` at${pct} confidence` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '1px 6px' : '2px 10px',
        borderRadius: 3,
        fontSize: compact ? 9 : 11,
        fontWeight: 700,
        letterSpacing: 0.5,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {!compact && <span style={{ fontSize: compact ? 8 : 10 }}>{icon}</span>}
      {verdict.toUpperCase()}
      {pct && !compact && <span style={{ opacity: 0.7 }}>{pct}</span>}
    </span>
  );
}
