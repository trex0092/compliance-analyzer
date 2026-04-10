/**
 * ReasoningChainGraph — interactive SVG renderer for a sealed reasoning DAG.
 *
 * Renders a `ReasoningChain` as a layered directed graph so the MLRO
 * can drill into WHY the brain reached a decision. Hovering over a
 * node shows its label + regulatory citation; clicking emits a
 * `onNodeSelect` callback so the parent UI can open a detail panel.
 *
 * Why not use the vendored xyflow library directly?
 *   - xyflow is vendored as a reference submodule, not a runtime
 *     dependency; adding it to `package.json` would bloat the bundle.
 *   - For the moderately-sized reasoning chains the MegaBrain produces
 *     (10–40 nodes), a pure-SVG layered layout is plenty and keeps the
 *     UI build dependency-free.
 *   - If in future the chains grow into the hundreds of nodes, swap
 *     this implementation for `@xyflow/react` — the component prop
 *     surface is deliberately compatible.
 *
 * Used by: NORAD war room, inspector portal UI, decision detail page.
 */

import { useMemo, type ReactElement } from 'react';
import type {
  NodeType,
  ReasoningChain,
  ReasoningEdge,
  ReasoningNode,
} from '../../services/reasoningChain';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReasoningChainGraphProps {
  chain: ReasoningChain;
  /** Optional callback when a node is clicked. */
  onNodeSelect?: (node: ReasoningNode) => void;
  /** Horizontal pixels per column. */
  columnWidth?: number;
  /** Vertical pixels per row. */
  rowHeight?: number;
  /** Highlight this node id (e.g. the currently-selected one). */
  highlightedNodeId?: string | null;
}

// ---------------------------------------------------------------------------
// Layout engine — simple layered topological layout
// ---------------------------------------------------------------------------

interface PositionedNode extends ReasoningNode {
  column: number;
  row: number;
  x: number;
  y: number;
}

function computeLayers(chain: ReasoningChain): Map<string, number> {
  const layer = new Map<string, number>();
  // Nodes with no incoming edges → layer 0.
  const incoming = new Map<string, number>();
  for (const node of chain.nodes) incoming.set(node.id, 0);
  for (const edge of chain.edges) {
    incoming.set(edge.toId, (incoming.get(edge.toId) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, count] of incoming.entries()) {
    if (count === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layer.get(current) ?? 0;
    for (const edge of chain.edges.filter((e) => e.fromId === current)) {
      const existing = layer.get(edge.toId);
      const next = currentLayer + 1;
      if (existing === undefined || next > existing) {
        layer.set(edge.toId, next);
      }
      const remaining = (incoming.get(edge.toId) ?? 0) - 1;
      incoming.set(edge.toId, remaining);
      if (remaining === 0 && !queue.includes(edge.toId)) queue.push(edge.toId);
    }
  }
  // Any unvisited (cycles) default to layer 0.
  for (const node of chain.nodes) if (!layer.has(node.id)) layer.set(node.id, 0);
  return layer;
}

function layoutNodes(
  chain: ReasoningChain,
  columnWidth: number,
  rowHeight: number
): PositionedNode[] {
  const layers = computeLayers(chain);
  const byColumn = new Map<number, ReasoningNode[]>();
  for (const node of chain.nodes) {
    const col = layers.get(node.id) ?? 0;
    const arr = byColumn.get(col) ?? [];
    arr.push(node);
    byColumn.set(col, arr);
  }
  const positioned: PositionedNode[] = [];
  for (const [col, nodes] of byColumn.entries()) {
    nodes.forEach((node, idx) => {
      positioned.push({
        ...node,
        column: col,
        row: idx,
        x: 40 + col * columnWidth,
        y: 40 + idx * rowHeight,
      });
    });
  }
  return positioned;
}

// ---------------------------------------------------------------------------
// Visual styles
// ---------------------------------------------------------------------------

const NODE_FILLS: Record<NodeType, string> = {
  event: '#1e3a8a',
  regulation: '#6d28d9',
  rule: '#be185d',
  evidence: '#047857',
  observation: '#065f46',
  hypothesis: '#b45309',
  action: '#b91c1c',
  decision: '#111827',
};

const EDGE_COLORS: Record<ReasoningEdge['relation'], string> = {
  triggers: '#2563eb',
  implies: '#10b981',
  contradicts: '#ef4444',
  supports: '#16a34a',
  refutes: '#dc2626',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReasoningChainGraph(props: ReasoningChainGraphProps): ReactElement {
  const columnWidth = props.columnWidth ?? 180;
  const rowHeight = props.rowHeight ?? 70;

  const positioned = useMemo(
    () => layoutNodes(props.chain, columnWidth, rowHeight),
    [props.chain, columnWidth, rowHeight]
  );

  const nodeMap = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of positioned) m.set(n.id, n);
    return m;
  }, [positioned]);

  const maxCol = positioned.reduce((m, n) => Math.max(m, n.column), 0);
  const maxRow = positioned.reduce((m, n) => Math.max(m, n.row), 0);
  const width = 80 + (maxCol + 1) * columnWidth;
  const height = 80 + (maxRow + 1) * rowHeight;

  return (
    <figure
      aria-label={`Reasoning chain for ${props.chain.topic}`}
      style={{ margin: 0, overflowX: 'auto' }}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={`chain-${props.chain.id}-title`}
      >
        <title id={`chain-${props.chain.id}-title`}>{props.chain.topic}</title>
        {/* Edges first so nodes render on top */}
        {props.chain.edges.map((edge, i) => {
          const from = nodeMap.get(edge.fromId);
          const to = nodeMap.get(edge.toId);
          if (!from || !to) return null;
          const stroke = EDGE_COLORS[edge.relation];
          return (
            <g key={`edge-${i}`}>
              <line
                x1={from.x + 60}
                y1={from.y + 20}
                x2={to.x}
                y2={to.y + 20}
                stroke={stroke}
                strokeWidth={2}
                markerEnd="url(#arrow)"
              />
              <text
                x={(from.x + 60 + to.x) / 2}
                y={(from.y + 20 + to.y + 20) / 2 - 4}
                fontSize={10}
                fill={stroke}
                textAnchor="middle"
              >
                {edge.relation}
              </text>
            </g>
          );
        })}
        <defs>
          <marker
            id="arrow"
            markerWidth={8}
            markerHeight={8}
            refX={8}
            refY={4}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,8 L8,4 z" fill="#374151" />
          </marker>
        </defs>
        {positioned.map((node) => {
          const highlighted = node.id === props.highlightedNodeId;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: props.onNodeSelect ? 'pointer' : 'default' }}
              onClick={() => props.onNodeSelect?.(node)}
            >
              <rect
                width={150}
                height={40}
                rx={8}
                ry={8}
                fill={NODE_FILLS[node.type]}
                stroke={highlighted ? '#f59e0b' : '#111827'}
                strokeWidth={highlighted ? 3 : 1}
              />
              <text x={8} y={16} fontSize={11} fill="#ffffff" fontWeight="bold">
                {node.type.toUpperCase()}
              </text>
              <text x={8} y={32} fontSize={11} fill="#e5e7eb">
                {truncate(node.label, 22)}
              </text>
              {node.regulatory ? (
                <title>{`${node.label}\n${node.regulatory}`}</title>
              ) : (
                <title>{node.label}</title>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
        {props.chain.nodes.length} nodes, {props.chain.edges.length} edges,{' '}
        {props.chain.sealed ? 'sealed' : 'unsealed'}.
      </figcaption>
    </figure>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
