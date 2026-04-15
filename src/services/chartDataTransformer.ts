/**
 * Chart Data Transformer — pure converter from brain telemetry /
 * fuzz / drift / KPI data into a chart-ready `ChartSpec` the UI
 * layer renders with a tiny SVG helper.
 *
 * Why this exists:
 *   Brain Console today renders HTML tables. Tables work but do not
 *   convey trends at a glance. We want line charts for verdict
 *   distribution over time, bar charts for typology counts, heat
 *   maps for drift severity across constants.
 *
 *   This module produces the structured spec — points, labels,
 *   colours, axes — as pure data. A tiny downstream SVG renderer
 *   walks the spec and emits `<svg>` strings. The spec can also
 *   drive any external chart library.
 *
 *   Pure function. No DOM. No external chart library.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   EU AI Act Art.13         (transparent rendering of AI data)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineChartPoint {
  x: string; // ISO date or label
  y: number;
}

export interface LineChartSeries {
  label: string;
  color: string;
  points: readonly LineChartPoint[];
}

export interface LineChartSpec {
  kind: 'line';
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  series: readonly LineChartSeries[];
  /** Lowest y in the whole spec — precomputed for rendering. */
  yMin: number;
  yMax: number;
}

export interface BarChartBar {
  label: string;
  value: number;
  color: string;
}

export interface BarChartSpec {
  kind: 'bar';
  title: string;
  bars: readonly BarChartBar[];
  max: number;
}

export interface HeatMapCell {
  row: string;
  col: string;
  /** Value in [0, 1]. */
  intensity: number;
}

export interface HeatMapSpec {
  kind: 'heatmap';
  title: string;
  rows: readonly string[];
  cols: readonly string[];
  cells: readonly HeatMapCell[];
  /** Legend label (e.g. "drift severity"). */
  legend: string;
}

// ---------------------------------------------------------------------------
// Verdict distribution over time → LineChartSpec
// ---------------------------------------------------------------------------

export interface VerdictTimeseriesInput {
  /** Sorted by tsIso asc. */
  entries: ReadonlyArray<{ tsIso: string; verdict: 'pass' | 'flag' | 'escalate' | 'freeze' }>;
  /** Bucket size: 'day' | 'hour'. Default 'day'. */
  bucket?: 'day' | 'hour';
}

const VERDICT_COLORS: Record<string, string> = {
  pass: '#3DA876',
  flag: '#E8A030',
  escalate: '#D4A843',
  freeze: '#D94F4F',
};

function bucketKey(iso: string, bucket: 'day' | 'hour'): string {
  return bucket === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

export function verdictDistributionChart(input: VerdictTimeseriesInput): LineChartSpec {
  const bucket = input.bucket ?? 'day';
  const perVerdict: Record<string, Map<string, number>> = {
    pass: new Map(),
    flag: new Map(),
    escalate: new Map(),
    freeze: new Map(),
  };
  const buckets = new Set<string>();
  for (const e of input.entries) {
    const k = bucketKey(e.tsIso, bucket);
    buckets.add(k);
    const m = perVerdict[e.verdict]!;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const sortedBuckets = Array.from(buckets).sort();
  const series: LineChartSeries[] = (['pass', 'flag', 'escalate', 'freeze'] as const).map((v) => ({
    label: v,
    color: VERDICT_COLORS[v]!,
    points: sortedBuckets.map((b) => ({ x: b, y: perVerdict[v]!.get(b) ?? 0 })),
  }));
  let yMin = 0;
  let yMax = 0;
  for (const s of series) for (const p of s.points) if (p.y > yMax) yMax = p.y;

  return {
    kind: 'line',
    title: 'Verdict distribution over time',
    xAxisLabel: bucket === 'hour' ? 'Hour' : 'Day',
    yAxisLabel: 'Count',
    series,
    yMin,
    yMax,
  };
}

// ---------------------------------------------------------------------------
// Top typologies → BarChartSpec
// ---------------------------------------------------------------------------

export interface TypologyInput {
  typologies: ReadonlyArray<{ id: string; label: string; count: number }>;
  topN?: number;
}

export function typologyBarChart(input: TypologyInput): BarChartSpec {
  const top = [...input.typologies].sort((a, b) => b.count - a.count).slice(0, input.topN ?? 10);
  const max = top.length > 0 ? top[0]!.count : 0;
  return {
    kind: 'bar',
    title: 'Top FATF typologies observed',
    bars: top.map((t) => ({
      label: `${t.id} — ${t.label}`,
      value: t.count,
      color: '#d4a843',
    })),
    max,
  };
}

// ---------------------------------------------------------------------------
// Drift severity matrix → HeatMapSpec
// ---------------------------------------------------------------------------

export interface DriftMatrixInput {
  /**
   * Rows = days (YYYY-MM-DD), cols = constant key, cell = severity in 0..1.
   */
  records: ReadonlyArray<{ day: string; constantKey: string; severity: number }>;
  title?: string;
}

export function driftHeatMap(input: DriftMatrixInput): HeatMapSpec {
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  for (const r of input.records) {
    rowSet.add(r.day);
    colSet.add(r.constantKey);
  }
  return {
    kind: 'heatmap',
    title: input.title ?? 'Regulatory drift severity',
    rows: Array.from(rowSet).sort(),
    cols: Array.from(colSet).sort(),
    cells: input.records.map((r) => ({
      row: r.day,
      col: r.constantKey,
      intensity: Math.max(0, Math.min(1, r.severity)),
    })),
    legend: 'drift severity (0..1)',
  };
}

// ---------------------------------------------------------------------------
// SVG emitter
// ---------------------------------------------------------------------------

/**
 * Emit a simple inline `<svg>` for a LineChartSpec. Deterministic —
 * same spec → same SVG. No dependency on the DOM.
 */
export function renderLineChartSvg(spec: LineChartSpec, width = 640, height = 240): string {
  const margin = { top: 24, right: 16, bottom: 28, left: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const buckets = spec.series[0]?.points.map((p) => p.x) ?? [];
  const n = buckets.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const yRange = spec.yMax - spec.yMin || 1;

  const polylines = spec.series
    .map((s) => {
      const pts = s.points
        .map((p, i) => {
          const x = margin.left + step * i;
          const y = margin.top + plotH - ((p.y - spec.yMin) / yRange) * plotH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
    })
    .join('\n');

  const xLabels = buckets
    .map((b, i) => {
      const x = margin.left + step * i;
      return `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#8b949e">${b}</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${escapeSvg(spec.title)}</title>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#0d1117"/>
  <text x="${margin.left}" y="16" font-size="12" fill="#e6edf3" font-weight="700">${escapeSvg(spec.title)}</text>
  ${polylines}
  ${xLabels}
</svg>`;
}

function escapeSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Exports for tests.
export const __test__ = { bucketKey, VERDICT_COLORS };
