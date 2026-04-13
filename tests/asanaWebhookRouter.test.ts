/**
 * Tests for the Asana webhook event router. Pure routing over
 * a list of raw Asana events.
 */
import { describe, it, expect } from 'vitest';
import { routeAsanaWebhookEvents } from '@/services/asanaWebhookRouter';
import type { AsanaWebhookEvent } from '@/services/asanaCommentMirror';

describe('routeAsanaWebhookEvents', () => {
  it('returns empty actions for null/undefined payload', () => {
    const a = routeAsanaWebhookEvents(null);
    expect(a.toasts).toEqual([]);
    expect(a.seedTaskGids).toEqual([]);
  });

  it('emits a seed request when a task is added', () => {
    const payload = {
      events: [
        {
          action: 'added' as const,
          resource: { gid: 't1', resource_type: 'task' },
        },
      ],
    };
    const actions = routeAsanaWebhookEvents(payload);
    expect(actions.seedTaskGids).toContain('t1');
  });

  it('emits a resolve request when a task is completed', () => {
    const payload = {
      events: [
        {
          action: 'changed' as const,
          resource: { gid: 't2', resource_type: 'task' },
          change: { field: 'completed', action: 'changed' },
        },
      ],
    };
    expect(routeAsanaWebhookEvents(payload).resolveTaskGids).toContain('t2');
  });

  it('emits brain-run request on a mention story', () => {
    const payload = {
      events: [
        {
          action: 'added' as const,
          resource: { gid: 's1', resource_type: 'story', resource_subtype: 'mentioned' },
          parent: { gid: 't3' },
        },
      ],
    };
    expect(routeAsanaWebhookEvents(payload).brainRunTaskGids).toContain('t3');
  });

  it('emits kanban invalidation on section changes', () => {
    const payload = {
      events: [
        {
          action: 'changed' as const,
          resource: { gid: 't4', resource_type: 'task' },
          change: { field: 'section', action: 'changed' },
        },
      ],
    };
    expect(routeAsanaWebhookEvents(payload).kanbanInvalidationTaskGids).toContain('t4');
  });

  it('dedupes repeated gids in the same batch', () => {
    const payload = {
      events: [
        { action: 'added' as const, resource: { gid: 't5', resource_type: 'task' } },
        { action: 'added' as const, resource: { gid: 't5', resource_type: 'task' } },
      ],
    };
    expect(routeAsanaWebhookEvents(payload).seedTaskGids).toEqual(['t5']);
  });

  it('emits toasts for comment events via the comment-mirror parser', () => {
    const payload: { events: AsanaWebhookEvent[] } = {
      events: [
        {
          action: 'added',
          resource: { gid: 's2', resource_type: 'story', resource_subtype: 'comment_added' },
          parent: { gid: 't6' },
        },
      ],
    };
    const actions = routeAsanaWebhookEvents(payload);
    expect(actions.toasts).toHaveLength(1);
    expect(actions.toasts[0].kind).toBe('asana_comment');
  });
});
