/**
 * Asana Read-Back Sync — pulls task status from Asana and updates local state.
 *
 * Two sync modes:
 *   1. Event-driven: webhook-receiver fires an event → we process it here
 *   2. Polling: periodically fetch tasks from each customer project and compare
 *
 * Completed tasks are NOT deleted — they are marked with a completion status
 * so they remain visible for audit and compliance purposes.
 */

import type { ComplianceCase, AuditEvent } from '../domain/cases';
import { listProjectTasks, isAsanaConfigured } from './asanaClient';
import {
  findLinkByAsanaGid,
  markLinkCompleted,
  getAllLinks,
  type AsanaTaskLink,
} from './asanaTaskLinks';
import { COMPANY_REGISTRY } from '../domain/customers';
import { createId } from '../utils/id';
import { nowIso } from '../utils/dates';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AsanaEvent {
  id: string;
  source: string;
  type: 'task_completed' | 'task_created' | 'task_updated' | 'comment_added';
  data: {
    gid?: string;
    name?: string;
    text?: string;
    completed?: boolean;
    user?: string;
  };
  timestamp: string;
}

export interface ReadbackResult {
  entityId: string;
  entityType: 'case' | 'alert' | 'approval' | 'review';
  action: 'marked-completed' | 'comment-added' | 'status-updated';
  asanaGid: string;
  detail: string;
  timestamp: string;
}

// ─── Event Processing ────────────────────────────────────────────────────────

/**
 * Process a single Asana webhook event and return what local updates are needed.
 * Does NOT mutate localStorage directly — returns actions for the caller to apply.
 */
export function processAsanaEvent(event: AsanaEvent): ReadbackResult | null {
  if (event.source !== 'asana') return null;

  const gid = event.data?.gid;
  if (!gid) return null;

  const link = findLinkByAsanaGid(gid);
  if (!link) return null; // Not a task we created

  if (event.type === 'task_completed') {
    markLinkCompleted(gid);
    return {
      entityId: link.localId,
      entityType: link.localType,
      action: 'marked-completed',
      asanaGid: gid,
      detail: `Task "${event.data.name || gid}" completed in Asana${event.data.user ? ` by ${event.data.user}` : ''}`,
      timestamp: event.timestamp,
    };
  }

  if (event.type === 'comment_added') {
    return {
      entityId: link.localId,
      entityType: link.localType,
      action: 'comment-added',
      asanaGid: gid,
      detail: event.data.text || 'Comment added in Asana',
      timestamp: event.timestamp,
    };
  }

  if (event.type === 'task_updated') {
    return {
      entityId: link.localId,
      entityType: link.localType,
      action: 'status-updated',
      asanaGid: gid,
      detail: `Task "${event.data.name || gid}" updated in Asana`,
      timestamp: event.timestamp,
    };
  }

  return null;
}

/**
 * Process multiple events from the webhook receiver.
 */
export function processAsanaEvents(events: AsanaEvent[]): ReadbackResult[] {
  const results: ReadbackResult[] = [];
  for (const event of events) {
    const result = processAsanaEvent(event);
    if (result) results.push(result);
  }
  return results;
}

// ─── Case Updaters ───────────────────────────────────────────────────────────

/**
 * Build an audit event for a read-back action (to append to case audit log).
 */
export function buildAuditEventFromReadback(result: ReadbackResult): AuditEvent {
  return {
    id: createId('audit'),
    at: result.timestamp || nowIso(),
    by: 'asana-sync',
    action: 'status-changed',
    note: result.detail,
  };
}

/**
 * Apply a readback result to a case. Returns an updated copy.
 * The case is NOT deleted — only marked with completion info.
 */
export function applyCaseReadback(caseObj: ComplianceCase, result: ReadbackResult): ComplianceCase {
  const auditEvent = buildAuditEventFromReadback(result);
  const updatedCase = {
    ...caseObj,
    updatedAt: nowIso(),
    auditLog: [...caseObj.auditLog, auditEvent],
  };

  // If the task was completed in Asana and the case is still open,
  // mark the case as "under-review" (not closed — user decides final status)
  if (result.action === 'marked-completed' && caseObj.status === 'open') {
    updatedCase.status = 'under-review' as ComplianceCase['status'];
  }

  return updatedCase;
}

// ─── Polling Sync ────────────────────────────────────────────────────────────

/**
 * Poll all customer Asana projects and detect newly completed tasks.
 * Returns readback results for tasks that were completed since last sync.
 */
export async function pollAsanaForCompletions(): Promise<ReadbackResult[]> {
  if (!isAsanaConfigured()) return [];

  const results: ReadbackResult[] = [];
  const links = getAllLinks();
  if (links.length === 0) return [];

  // Group links by project to minimize API calls
  const projectGroups = new Map<string, AsanaTaskLink[]>();
  for (const link of links) {
    if (link.completedInAsana) continue; // Already known completed
    const group = projectGroups.get(link.projectGid) ?? [];
    group.push(link);
    projectGroups.set(link.projectGid, group);
  }

  for (const [projectGid, projectLinks] of projectGroups) {
    const response = await listProjectTasks(projectGid, 'gid,name,completed');
    if (!response.ok || !response.tasks) continue;

    const taskMap = new Map(response.tasks.map((t) => [t.gid, t]));

    for (const link of projectLinks) {
      const task = taskMap.get(link.asanaGid);
      if (task && task.completed && !link.completedInAsana) {
        markLinkCompleted(link.asanaGid);
        results.push({
          entityId: link.localId,
          entityType: link.localType,
          action: 'marked-completed',
          asanaGid: link.asanaGid,
          detail: `Task "${task.name}" completed in Asana (detected via polling)`,
          timestamp: nowIso(),
        });
      }
    }
  }

  return results;
}

/**
 * Get unique project GIDs from the customer registry for polling.
 */
export function getProjectGidsToSync(): string[] {
  const gids = new Set<string>();
  for (const c of COMPANY_REGISTRY) {
    if (c.asanaComplianceProjectGid) gids.add(c.asanaComplianceProjectGid);
    if (c.asanaWorkflowProjectGid) gids.add(c.asanaWorkflowProjectGid);
  }
  return Array.from(gids);
}
