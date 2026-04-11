/**
 * Tests for Asana Phase 5 Ultra.
 */
import { describe, it, expect } from 'vitest';

import {
  buildStixBundle,
  parseStixBundle,
  buildGoamlSubmission,
  ComplianceKnowledgeBase,
  replayWorkflow,
  walkTaskLineage,
  type TaskLineageNode,
} from '@/services/asanaPhase5Ultra';

// ---------------------------------------------------------------------------
// U1 STIX/TAXII bridge
// ---------------------------------------------------------------------------

describe('stixTaxiiBridge', () => {
  it('builds a valid STIX 2.1 bundle', () => {
    const bundle = buildStixBundle(
      [
        {
          kind: 'sanctioned_wallet',
          value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          description: 'OFAC SDN wallet',
          citation: 'OFAC',
        },
      ],
      'UAE-DPMS-01'
    );
    expect(bundle.type).toBe('bundle');
    expect(bundle.objects.length).toBe(1);
    expect(bundle.objects[0].spec_version).toBe('2.1');
    expect(bundle.objects[0].pattern).toContain('cryptocurrency-wallet');
  });

  it('round-trips indicators through buildStixBundle → parseStixBundle', () => {
    const original = [
      {
        kind: 'sanctioned_name' as const,
        value: 'Dirty Actor',
        description: 'sanctioned',
        citation: 'UN',
      },
      {
        kind: 'ip_address' as const,
        value: '10.0.0.1',
        description: 'C2 infrastructure',
        citation: 'EOCN',
      },
    ];
    const bundle = buildStixBundle(original, 'tester');
    const parsed = parseStixBundle(bundle);
    expect(parsed.length).toBe(2);
    expect(parsed[0].value).toBe('Dirty Actor');
    expect(parsed[1].value).toBe('10.0.0.1');
  });

  it('escapes single quotes in STIX patterns', () => {
    const bundle = buildStixBundle(
      [
        {
          kind: 'sanctioned_name',
          value: "O'Brien",
          description: 'test',
          citation: 'test',
        },
      ],
      'tester'
    );
    expect(bundle.objects[0].pattern).toContain("O\\'Brien");
  });

  it('parseStixBundle silently skips unknown patterns', () => {
    const bundle = {
      type: 'bundle' as const,
      id: 'bundle--x',
      objects: [
        {
          type: 'indicator' as const,
          id: 'indicator--a',
          spec_version: '2.1' as const,
          created: '2026-04-11T00:00:00Z',
          modified: '2026-04-11T00:00:00Z',
          pattern: '[unknown-type:foo = "bar"]',
          pattern_type: 'stix' as const,
          valid_from: '2026-04-11T00:00:00Z',
          labels: ['test'],
        },
      ],
    };
    expect(parseStixBundle(bundle)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// U2 goAML webhook dispatcher
// ---------------------------------------------------------------------------

describe('goamlWebhookDispatcher', () => {
  it('builds a POST payload with correct headers', () => {
    const payload = buildGoamlSubmission(
      {
        filingId: 'F-001',
        filingType: 'STR',
        entityName: 'Acme',
        goamlXml: '<?xml version="1.0"?><str/>',
        submittedBy: 'mlro@example.com',
      },
      { fiuEndpoint: 'https://fiu.example.com/submit', bearerToken: 'TOKEN' }
    );
    expect(payload.method).toBe('POST');
    expect(payload.headers['Content-Type']).toBe('application/xml');
    expect(payload.headers['X-Filing-Type']).toBe('STR');
    expect(payload.headers['X-Filing-Id']).toBe('F-001');
    expect(payload.headers['Authorization']).toBe('Bearer TOKEN');
    expect(payload.body).toContain('<str/>');
  });

  it('confirmation template includes tipping-off warning', () => {
    const payload = buildGoamlSubmission(
      {
        filingId: 'F-001',
        filingType: 'STR',
        entityName: 'Acme',
        goamlXml: '<str/>',
        submittedBy: 'mlro',
      },
      { fiuEndpoint: 'x', bearerToken: 'y' }
    );
    expect(payload.confirmationCommentTemplate).toContain('FDL Art.29');
    expect(payload.confirmationCommentTemplate).toContain('FDL No.10/2025 Art.26-27');
  });
});

// ---------------------------------------------------------------------------
// U3 Compliance knowledge base
// ---------------------------------------------------------------------------

describe('complianceKnowledgeBase', () => {
  it('returns empty results when empty', () => {
    const kb = new ComplianceKnowledgeBase();
    expect(kb.search('anything').length).toBe(0);
  });

  it('finds exact keyword matches', () => {
    const kb = new ComplianceKnowledgeBase();
    kb.addCard({
      id: 'Q1',
      question: 'What do we do with structuring in DPMS?',
      answer: 'Structuring below AED 55K threshold is escalated to MLRO.',
      decidedBy: 'mlro',
      decidedAt: '2026-01-01',
      citation: 'MoE Circular 08/AML/2021',
      tags: ['structuring', 'dpms'],
    });
    kb.addCard({
      id: 'Q2',
      question: 'UBO disclosure requirements?',
      answer: 'Beneficial owners holding >25% must be disclosed per Cabinet Decision 109/2023.',
      decidedBy: 'co',
      decidedAt: '2026-01-02',
      citation: 'Cabinet Decision 109/2023',
      tags: ['ubo'],
    });
    const results = kb.search('structuring DPMS');
    expect(results[0].card.id).toBe('Q1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('unrelated queries return no score', () => {
    const kb = new ComplianceKnowledgeBase();
    kb.addCard({
      id: 'Q1',
      question: 'Sanctions screening',
      answer: 'Check all lists',
      decidedBy: 'a',
      decidedAt: 'x',
      citation: 'y',
      tags: [],
    });
    const r = kb.search('completely unrelated');
    expect(r.length).toBe(0);
  });

  it('count reflects added cards', () => {
    const kb = new ComplianceKnowledgeBase();
    kb.addCards([
      {
        id: 'Q1',
        question: 'x',
        answer: 'y',
        decidedBy: 'a',
        decidedAt: 'b',
        citation: 'c',
        tags: [],
      },
      {
        id: 'Q2',
        question: 'x',
        answer: 'y',
        decidedBy: 'a',
        decidedAt: 'b',
        citation: 'c',
        tags: [],
      },
    ]);
    expect(kb.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// U4 Workflow replay
// ---------------------------------------------------------------------------

describe('workflowReplay', () => {
  it('empty transitions returns empty report', () => {
    const r = replayWorkflow([]);
    expect(r.totalTransitions).toBe(0);
    expect(r.finalState).toBe('');
  });

  it('tracks final state + actor counts', () => {
    const r = replayWorkflow([
      {
        at: '2026-04-01T00:00:00Z',
        from: 'open',
        to: 'under_review',
        actor: 'analyst',
      },
      {
        at: '2026-04-02T00:00:00Z',
        from: 'under_review',
        to: 'mlro_decision',
        actor: 'mlro',
      },
      {
        at: '2026-04-03T00:00:00Z',
        from: 'mlro_decision',
        to: 'filed',
        actor: 'mlro',
      },
    ]);
    expect(r.totalTransitions).toBe(3);
    expect(r.finalState).toBe('filed');
    expect(r.actorCounts['mlro']).toBe(2);
    expect(r.actorCounts['analyst']).toBe(1);
  });

  it('sorts transitions chronologically', () => {
    const r = replayWorkflow([
      {
        at: '2026-04-03T00:00:00Z',
        from: 'mlro_decision',
        to: 'filed',
        actor: 'mlro',
      },
      {
        at: '2026-04-01T00:00:00Z',
        from: 'open',
        to: 'under_review',
        actor: 'analyst',
      },
    ]);
    expect(r.transitions[0].to).toBe('under_review');
  });
});

// ---------------------------------------------------------------------------
// U5 Task lineage graph
// ---------------------------------------------------------------------------

describe('taskLineageGraph', () => {
  const index = new Map<string, TaskLineageNode>([
    ['grandparent', { taskGid: 'grandparent', title: 'GP', childGids: ['parent'] }],
    ['parent', { taskGid: 'parent', title: 'P', parentGid: 'grandparent', childGids: ['child1', 'child2'] }],
    ['child1', { taskGid: 'child1', title: 'C1', parentGid: 'parent' }],
    ['child2', { taskGid: 'child2', title: 'C2', parentGid: 'parent', childGids: ['grandchild'] }],
    ['grandchild', { taskGid: 'grandchild', title: 'GC', parentGid: 'child2' }],
  ]);

  it('walks ancestors upward', () => {
    const graph = walkTaskLineage('parent', index);
    expect(graph.ancestors.length).toBe(1);
    expect(graph.ancestors[0].taskGid).toBe('grandparent');
  });

  it('walks descendants downward', () => {
    const graph = walkTaskLineage('parent', index);
    expect(graph.descendants.length).toBe(3); // child1, child2, grandchild
    expect(graph.descendants.some((d) => d.taskGid === 'grandchild')).toBe(true);
  });

  it('respects maxDepth', () => {
    const graph = walkTaskLineage('parent', index, 1);
    expect(graph.descendants.some((d) => d.taskGid === 'grandchild')).toBe(false);
  });

  it('leaf task has no descendants', () => {
    const graph = walkTaskLineage('grandchild', index);
    expect(graph.descendants.length).toBe(0);
  });

  it('root task has no ancestors', () => {
    const graph = walkTaskLineage('grandparent', index);
    expect(graph.ancestors.length).toBe(0);
  });
});
