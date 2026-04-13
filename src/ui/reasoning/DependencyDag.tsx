/**
 * STR Lifecycle DAG — xyflow-style visualization.
 *
 * Renders STR_LIFECYCLE_DEPENDENCIES as a directed graph so the MLRO
 * can see the seven-stage gate chain at a glance. We use a
 * self-contained SVG renderer instead of pulling the real xyflow
 * library because:
 *   (a) vendor/xyflow is currently empty (submodule not initialized)
 *       and adding a new runtime dep to package.json is out of scope
 *   (b) this DAG is tiny (7 nodes, 7 edges) and a dep would be wild
 *       overkill for static graph rendering
 *   (c) we keep the component API compatible with @xyflow/react so a
 *       later swap to the real library is a local change
 *
 * Layout: deterministic longest-path layering (left-to-right) based on
 * a topological sort. Nodes are placed at (rank * columnWidth,
 * rankIndex * rowHeight). Edges route as cubic Bezier curves.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO visibility into the filing chain)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 */

import type { TaskDependencyEdge } from '../../services/asanaWorkflowAutomation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DagNode {
  id: string;
  label: string;
  /** Optional sub-label (e.g. stage index 3/7, due days). */
  sublabel?: string;
  /** Visual state for colour coding. */
  state?: 'pending' | 'active' | 'done' | 'blocked';
}

export interface DagLayoutNode extends DagNode {
  x: number;
  y: number;
  rank: number;
}

export interface DagLayout {
  nodes: DagLayoutNode[];
  edges: TaskDependencyEdge[];
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Layout — pure, unit-testable
// ---------------------------------------------------------------------------

/**
 * Compute the rank (longest path from any root) of every node.
 * Roots (no incoming edges) are rank 0; each downstream node is
 * max(parentRank) + 1. Produces a deterministic left-to-right layout.
 */
export function computeRanks(
  nodes: readonly DagNode[],
  edges: readonly TaskDependencyEdge[]
): Map<string, number> {
  // parent → children (the "blockedBy" field means this node is
  // blocked by the other, so "parent" in the TaskDependencyEdge type
  // is actually the child in DAG-ordering terms).
  const prerequisites = new Map<string, string[]>();
  const allIds = new Set<string>(nodes.map((n) => n.id));
  for (const e of edges) {
    allIds.add(e.parent);
    allIds.add(e.blockedBy);
    const prereqs = prerequisites.get(e.parent) ?? [];
    prereqs.push(e.blockedBy);
    prerequisites.set(e.parent, prereqs);
  }

  const ranks = new Map<string, number>();
  const computing = new Set<string>();

  const rankOf = (id: string): number => {
    const cached = ranks.get(id);
    if (cached !== undefined) return cached;
    if (computing.has(id)) {
      // Cycle — return 0 so layout still produces output. Callers
      // should validateNoCycles first.
      return 0;
    }
    computing.add(id);
    const prereqs = prerequisites.get(id) ?? [];
    let rank = 0;
    for (const prereq of prereqs) {
      rank = Math.max(rank, rankOf(prereq) + 1);
    }
    computing.delete(id);
    ranks.set(id, rank);
    return rank;
  };

  for (const id of allIds) rankOf(id);
  return ranks;
}

/**
 * Lay out a DAG left-to-right. Nodes sharing a rank stack vertically.
 */
export function layoutDag(
  nodes: readonly DagNode[],
  edges: readonly TaskDependencyEdge[],
  options: { columnWidth?: number; rowHeight?: number; margin?: number } = {}
): DagLayout {
  const columnWidth = options.columnWidth ?? 180;
  const rowHeight = options.rowHeight ?? 90;
  const margin = options.margin ?? 20;

  const ranks = computeRanks(nodes, edges);
  // Group by rank.
  const byRank = new Map<number, DagNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const list = byRank.get(rank) ?? [];
    list.push(node);
    byRank.set(rank, list);
  }

  const laidOut: DagLayoutNode[] = [];
  let maxRank = 0;
  let maxRowCount = 0;

  for (const [rank, rankNodes] of byRank) {
    maxRank = Math.max(maxRank, rank);
    maxRowCount = Math.max(maxRowCount, rankNodes.length);
    rankNodes.forEach((node, index) => {
      laidOut.push({
        ...node,
        rank,
        x: margin + rank * columnWidth,
        y: margin + index * rowHeight,
      });
    });
  }

  return {
    nodes: laidOut,
    edges: edges.map((e) => ({ parent: e.parent, blockedBy: e.blockedBy })),
    width: margin * 2 + (maxRank + 1) * columnWidth,
    height: margin * 2 + maxRowCount * rowHeight,
  };
}

// ---------------------------------------------------------------------------
// SVG renderer (React component)
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<NonNullable<DagNode['state']>, { fill: string; stroke: string }> = {
  pending: { fill: '#0d1117', stroke: '#30363d' },
  active: { fill: '#1f2933', stroke: '#E8A030' },
  done: { fill: '#0f2a1b', stroke: '#3DA876' },
  blocked: { fill: '#2a1012', stroke: '#D94F4F' },
};

interface DependencyDagProps {
  nodes: readonly DagNode[];
  edges: readonly TaskDependencyEdge[];
  /** Optional click handler for cards. */
  onNodeClick?: (nodeId: string) => void;
  /** Optional override for column width (px). */
  columnWidth?: number;
}

export default function DependencyDag({
  nodes,
  edges,
  onNodeClick,
  columnWidth = 200,
}: DependencyDagProps) {
  const layout = layoutDag(nodes, edges, { columnWidth, rowHeight: 96, margin: 24 });
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div
      style={{
        overflow: 'auto',
        background: '#0d1117',
        border: '1px solid #21262d',
        borderRadius: 8,
        padding: 8,
      }}
    >
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 Z" fill="#8b949e" />
          </marker>
        </defs>

        {layout.edges.map((edge, i) => {
          const from = nodeById.get(edge.blockedBy);
          const to = nodeById.get(edge.parent);
          if (!from || !to) return null;
          const startX = from.x + 140;
          const startY = from.y + 32;
          const endX = to.x;
          const endY = to.y + 32;
          const midX = (startX + endX) / 2;
          return (
            <path
              key={`${edge.blockedBy}-${edge.parent}-${i}`}
              d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
              fill="none"
              stroke="#8b949e"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          );
        })}

        {layout.nodes.map((node) => {
          const state = node.state ?? 'pending';
          const palette = STATE_COLORS[state];
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onNodeClick?.(node.id)}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              <rect
                width={140}
                height={64}
                rx={6}
                fill={palette.fill}
                stroke={palette.stroke}
                strokeWidth={1.5}
              />
              <text
                x={10}
                y={22}
                fill="#e6edf3"
                fontSize={12}
                fontWeight={600}
                style={{ pointerEvents: 'none' }}
              >
                {truncate(node.label, 18)}
              </text>
              {node.sublabel && (
                <text x={10} y={42} fill="#8b949e" fontSize={10} style={{ pointerEvents: 'none' }}>
                  {truncate(node.sublabel, 22)}
                </text>
              )}
              <text
                x={130}
                y={56}
                textAnchor="end"
                fill={palette.stroke}
                fontSize={9}
                fontWeight={700}
                style={{ pointerEvents: 'none', letterSpacing: 0.5 }}
              >
                {state.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
