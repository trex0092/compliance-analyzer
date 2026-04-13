/**
 * Kanban Auto-Sort — brain-driven section reassignment.
 *
 * When the MLRO opens the Kanban view, every card should sit in
 * the column the brain thinks it belongs in. Today the columns
 * come from Asana sections — so auto-sorting means:
 *
 *   1. For each card, resolve the linked local case via
 *      asanaTaskLinks
 *   2. Derive a verdict via caseToEnrichableBrain
 *   3. Compute the target column via brainVerdictToKanbanColumn
 *   4. If the card is NOT in the target column, plan a move
 *   5. Execute the moves through moveTaskToKanbanColumn
 *
 * Pure planner (buildAutoSortPlan) that accepts an injected
 * verdict resolver + column resolver so tests can exercise the
 * routing without touching Asana or the local store. A thin
 * applier (applyAutoSortPlan) runs the actual moves.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow state)
 *   - FDL No.10/2025 Art.19-21 (MLRO visibility into work queue)
 */

import type { KanbanBoard, KanbanColumn, KanbanCard } from './asanaKanbanView';
import { moveTaskToKanbanColumn } from './asanaSectionWriteBack';
import { brainVerdictToKanbanColumn } from './asanaBrainEnricher';
import { caseToEnrichableBrain } from './caseToEnrichableBrain';
import type { ComplianceCase } from '../domain/cases';
import { findLinkByAsanaGid } from './asanaTaskLinks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoSortMove {
  taskGid: string;
  fromColumn: KanbanColumn;
  toColumn: KanbanColumn;
  caseId?: string;
  verdict?: string;
  /** True when the plan couldn't resolve a case for this card. */
  unresolved?: boolean;
}

export interface AutoSortPlan {
  moves: AutoSortMove[];
  unchanged: number;
  unresolved: number;
}

export interface AutoSortApplyResult {
  plan: AutoSortPlan;
  succeeded: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

export interface BuildAutoSortOptions {
  /** Injected resolver: taskGid → local ComplianceCase (or undefined). */
  resolveCase: (taskGid: string) => ComplianceCase | undefined;
}

/**
 * Build an auto-sort plan for a Kanban board. Pure — no I/O, no
 * network. Tests inject the resolveCase function.
 *
 * A card is skipped (counted in unresolved) when the resolver
 * can't find its linked case. A card is counted in `unchanged`
 * when the brain verdict already matches its current column.
 */
export function buildAutoSortPlan(board: KanbanBoard, options: BuildAutoSortOptions): AutoSortPlan {
  const moves: AutoSortMove[] = [];
  let unchanged = 0;
  let unresolved = 0;

  const allCards: Array<{ card: KanbanCard; col: KanbanColumn }> = [];
  for (const col of Object.keys(board.columns) as KanbanColumn[]) {
    for (const card of board.columns[col]) {
      allCards.push({ card, col });
    }
  }

  for (const { card, col } of allCards) {
    const caseObj = options.resolveCase(card.gid);
    if (!caseObj) {
      unresolved++;
      moves.push({
        taskGid: card.gid,
        fromColumn: col,
        toColumn: col,
        unresolved: true,
      });
      continue;
    }
    const brain = caseToEnrichableBrain(caseObj);
    const target = brainVerdictToKanbanColumn(brain.verdict);
    if (target === col) {
      unchanged++;
      continue;
    }
    moves.push({
      taskGid: card.gid,
      fromColumn: col,
      toColumn: target,
      caseId: caseObj.id,
      verdict: brain.verdict,
    });
  }

  return { moves, unchanged, unresolved };
}

// ---------------------------------------------------------------------------
// Default resolver using asanaTaskLinks + local case store
// ---------------------------------------------------------------------------

export function makeDefaultResolver(
  cases: readonly ComplianceCase[]
): BuildAutoSortOptions['resolveCase'] {
  const byId = new Map<string, ComplianceCase>(cases.map((c) => [c.id, c]));
  return (taskGid: string) => {
    const link = findLinkByAsanaGid(taskGid);
    if (!link) return undefined;
    return byId.get(link.localId);
  };
}

// ---------------------------------------------------------------------------
// Applier — runs the real moves
// ---------------------------------------------------------------------------

export async function applyAutoSortPlan(
  projectGid: string,
  plan: AutoSortPlan
): Promise<AutoSortApplyResult> {
  const startedAt = Date.now();
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const move of plan.moves) {
    if (move.unresolved || move.fromColumn === move.toColumn) continue;
    const result = await moveTaskToKanbanColumn(projectGid, move.taskGid, move.toColumn);
    if (result.ok) {
      succeeded++;
    } else {
      failed++;
      if (result.error) errors.push(`${move.taskGid}: ${result.error}`);
    }
  }

  return {
    plan,
    succeeded,
    failed,
    errors,
    durationMs: Date.now() - startedAt,
  };
}
