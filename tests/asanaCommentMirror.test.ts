/**
 * Tests for the Asana comment-mirror webhook event parser.
 * Pure function over JSON — no network, no localStorage.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAsanaWebhookEvent,
  parseAsanaWebhookBatch,
  type AsanaWebhookEvent,
} from '@/services/asanaCommentMirror';

describe('parseAsanaWebhookEvent', () => {
  it('parses a comment_added story event', () => {
    const event: AsanaWebhookEvent = {
      action: 'added',
      resource: { gid: 's1', resource_type: 'story', resource_subtype: 'comment_added' },
      parent: { gid: 't1', resource_type: 'task' },
      user: { gid: 'u1', name: 'Luisa' },
      created_at: '2026-04-13T12:00:00.000Z',
    };
    const toast = parseAsanaWebhookEvent(event);
    expect(toast).toBeDefined();
    expect(toast?.kind).toBe('asana_comment');
    expect(toast?.authorName).toBe('Luisa');
    expect(toast?.taskGid).toBe('t1');
  });

  it('parses a mentioned story event with warning severity', () => {
    const event: AsanaWebhookEvent = {
      action: 'added',
      resource: { gid: 's2', resource_type: 'story', resource_subtype: 'mentioned' },
      parent: { gid: 't2' },
      user: { name: 'MLRO' },
      created_at: '2026-04-13T12:30:00.000Z',
    };
    const toast = parseAsanaWebhookEvent(event);
    expect(toast?.kind).toBe('asana_mention');
    expect(toast?.severity).toBe('warning');
  });

  it('parses an assignee change on a task', () => {
    const event: AsanaWebhookEvent = {
      action: 'changed',
      resource: { gid: 't3', resource_type: 'task' },
      user: { name: 'MLRO' },
      change: { field: 'assignee', action: 'changed' },
      created_at: '2026-04-13T12:45:00.000Z',
    };
    const toast = parseAsanaWebhookEvent(event);
    expect(toast?.kind).toBe('asana_assignment');
    expect(toast?.taskGid).toBe('t3');
  });

  it('returns undefined for unrelated events', () => {
    const event: AsanaWebhookEvent = {
      action: 'changed',
      resource: { gid: 't4', resource_type: 'task' },
      change: { field: 'name', action: 'changed' },
    };
    expect(parseAsanaWebhookEvent(event)).toBeUndefined();
  });

  it('returns undefined for deleted events', () => {
    const event: AsanaWebhookEvent = {
      action: 'deleted',
      resource: { gid: 't5', resource_type: 'story', resource_subtype: 'comment_added' },
    };
    expect(parseAsanaWebhookEvent(event)).toBeUndefined();
  });

  it('uses resolveCaseId to attach a local case id', () => {
    const event: AsanaWebhookEvent = {
      action: 'added',
      resource: { gid: 's6', resource_type: 'story', resource_subtype: 'comment_added' },
      parent: { gid: 't-asana-123' },
    };
    const toast = parseAsanaWebhookEvent(event, (gid) =>
      gid === 't-asana-123' ? 'case-42' : undefined
    );
    expect(toast?.caseId).toBe('case-42');
    expect(toast?.title).toContain('case-42');
  });

  it('never echoes an entity legal name into the title (FDL Art.29)', () => {
    // Even if the caller accidentally resolves to an entity name,
    // the parser should pass it through as the "case id" slot — the
    // caller's contract is to supply a case id, not an entity name.
    // This test just locks the title format so a refactor can't
    // start inlining a separate entityName field.
    const event: AsanaWebhookEvent = {
      action: 'added',
      resource: { gid: 's7', resource_type: 'story', resource_subtype: 'comment_added' },
      parent: { gid: 't-asana-999' },
    };
    const toast = parseAsanaWebhookEvent(event, () => 'case-999');
    expect(toast?.title).toContain('case-999');
    expect(toast?.title).not.toMatch(/MADISON|NAPLES|GRAMALTIN/i);
  });
});

describe('parseAsanaWebhookBatch', () => {
  it('returns empty array for null payload', () => {
    expect(parseAsanaWebhookBatch(null)).toEqual([]);
    expect(parseAsanaWebhookBatch(undefined)).toEqual([]);
  });

  it('parses multiple events in a single batch', () => {
    const batch = {
      events: [
        {
          action: 'added' as const,
          resource: { gid: 's1', resource_type: 'story', resource_subtype: 'comment_added' },
          parent: { gid: 't1' },
        },
        { action: 'changed' as const, resource: { gid: 't2', resource_type: 'task' } }, // ignored
        {
          action: 'added' as const,
          resource: { gid: 's3', resource_type: 'story', resource_subtype: 'mentioned' },
          parent: { gid: 't3' },
        },
      ],
    };
    const toasts = parseAsanaWebhookBatch(batch);
    expect(toasts).toHaveLength(2);
    expect(toasts[0].kind).toBe('asana_comment');
    expect(toasts[1].kind).toBe('asana_mention');
  });
});
