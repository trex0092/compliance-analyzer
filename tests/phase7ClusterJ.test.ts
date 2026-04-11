/**
 * Tests for Phase 7 Cluster J — long-term memory.
 */
import { describe, it, expect } from 'vitest';
import { replayDecisions } from '@/services/decisionReplayEngine';
import {
  buildNarrativeIndex,
  searchNarratives,
} from '@/services/semanticNarrativeSearch';
import { compactCase, verifyCompactedCase } from '@/services/caseCompactor';
import { generateModelCard } from '@/services/modelCardGenerator';
import { diffInterpretations } from '@/services/regulatoryInterpretationDiff';
import { runAiGovernanceAgent } from '@/agents/definitions/ai-governance-agent';

// ---------------------------------------------------------------------------
// decisionReplayEngine
// ---------------------------------------------------------------------------

describe('decisionReplayEngine', () => {
  const history = [
    { caseId: 'C1', at: '2026-01-01T00:00:00Z', originalVerdict: 'pass' as const, inputs: { score: 3 } },
    { caseId: 'C2', at: '2026-01-02T00:00:00Z', originalVerdict: 'flag' as const, inputs: { score: 7 } },
    { caseId: 'C3', at: '2026-01-03T00:00:00Z', originalVerdict: 'escalate' as const, inputs: { score: 15 } },
  ];

  it('replay with same policy is unchanged', () => {
    const r = replayDecisions(history, (i) => {
      const s = (i as { score: number }).score;
      return s >= 10 ? 'escalate' : s >= 6 ? 'flag' : 'pass';
    });
    expect(r.unchanged).toBe(3);
    expect(r.stricter).toBe(0);
    expect(r.looser).toBe(0);
  });

  it('stricter policy flips cases to higher verdict', () => {
    const r = replayDecisions(history, () => 'freeze' as const);
    expect(r.stricter).toBe(3);
    expect(r.transitions['pass->freeze']).toBe(1);
    expect(r.transitions['flag->freeze']).toBe(1);
    expect(r.transitions['escalate->freeze']).toBe(1);
  });

  it('looser policy flips cases to lower verdict', () => {
    const r = replayDecisions(history, () => 'pass' as const);
    expect(r.looser).toBe(2); // C1 was already pass
    expect(r.transitions['flag->pass']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// semanticNarrativeSearch
// ---------------------------------------------------------------------------

describe('semanticNarrativeSearch', () => {
  const index = buildNarrativeIndex([
    {
      id: 'F1',
      typology: 'STR',
      narrative: 'Customer executed structuring pattern of cash deposits below the AED 55000 DPMS threshold.',
      filedAt: '2026-01-15',
      outcome: 'str_filed',
    },
    {
      id: 'F2',
      typology: 'STR',
      narrative: 'Real estate purchase in Dubai funded through offshore wire transfer with undisclosed UBO.',
      filedAt: '2026-02-10',
      outcome: 'escalated',
    },
  ]);

  it('finds the matching typology narrative', () => {
    const report = searchNarratives(
      index,
      'structuring cash deposits DPMS threshold'
    );
    expect(report.matches[0].doc.id).toBe('F1');
    expect(report.matches[0].similarity).toBeGreaterThan(0);
  });

  it('typology filter restricts results', () => {
    const report = searchNarratives(index, 'anything', { typologyFilter: 'CTR' });
    expect(report.matches.length).toBe(0);
  });

  it('unrelated query returns no matches', () => {
    const report = searchNarratives(index, 'xyz abc def never seen');
    expect(report.matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// caseCompactor
// ---------------------------------------------------------------------------

describe('caseCompactor', () => {
  const events = [
    { at: '2026-01-01T00:00:00Z', actor: 'system', action: 'created', note: 'auto' },
    { at: '2026-01-02T00:00:00Z', actor: 'analyst', action: 'reviewed' },
    { at: '2026-01-03T00:00:00Z', actor: 'analyst', action: 'reviewed' },
    { at: '2026-01-04T00:00:00Z', actor: 'mlro', action: 'approved' },
  ];

  it('compacts to action summary', () => {
    const c = compactCase(events);
    expect(c.totalEvents).toBe(4);
    const reviewed = c.actionSummary.find((a) => a.action === 'reviewed');
    expect(reviewed?.count).toBe(2);
  });

  it('records all actors', () => {
    const c = compactCase(events);
    expect(c.actors).toContain('system');
    expect(c.actors).toContain('analyst');
    expect(c.actors).toContain('mlro');
  });

  it('integrity hash is deterministic', () => {
    const a = compactCase(events);
    const b = compactCase(events);
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it('verifyCompactedCase returns true for original events', () => {
    const c = compactCase(events);
    expect(verifyCompactedCase(events, c)).toBe(true);
  });

  it('verifyCompactedCase returns false when events are tampered', () => {
    const c = compactCase(events);
    const tampered = [...events, { at: '2026-01-05T00:00:00Z', actor: 'hacker', action: 'injected' }];
    expect(verifyCompactedCase(tampered, c)).toBe(false);
  });

  it('empty event list compacts to zero', () => {
    const c = compactCase([]);
    expect(c.totalEvents).toBe(0);
    expect(c.actors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// modelCardGenerator
// ---------------------------------------------------------------------------

describe('modelCardGenerator', () => {
  it('generates markdown + JSON containing EU AI Act references', () => {
    const audit = runAiGovernanceAgent({
      mode: 'self',
      target: 'test',
      auditedBy: 'test-runner',
    });

    const card = generateModelCard({
      modelName: 'WeaponizedBrain',
      version: '7.0',
      owner: 'Compliance Engineering',
      intendedUse: 'UAE AML/CFT/CPF compliance decisioning',
      systemDescription: 'Multi-subsystem deterministic brain with Opus advisor escalation.',
      governanceAudit: audit.audit,
      subsystemScores: [
        {
          subsystem: 'redTeamCritic',
          rubric: { correctness: 20, completeness: 20, edgeCases: 20, efficiency: 20, reusability: 20 },
          total: 100,
          runCount: 5,
          maturity: 'crystallized',
          recommendation: 'crystallize',
          narrative: '',
        },
      ],
      dataSources: ['Internal audit log', 'Asana task mirror'],
      limitations: ['Arabic UI not yet supported'],
      humanOversight: ['MLRO four-eyes approval on escalate/freeze'],
    });
    expect(card.markdown).toContain('# Model Card');
    expect(card.markdown).toContain('EU AI Act tier');
    expect(card.json).toContain('"schema": "eu-ai-act-annex-iv"');
  });
});

// ---------------------------------------------------------------------------
// regulatoryInterpretationDiff
// ---------------------------------------------------------------------------

describe('regulatoryInterpretationDiff', () => {
  const prev = {
    circular: 'MoE Circular 08/AML/2021',
    publishedAt: '2021-03-15',
    sections: [
      {
        heading: 'Section 1',
        body: 'Structuring below threshold is a red flag for DPMS.',
      },
      {
        heading: 'Section 2',
        body: 'Report STR within 10 business days.',
      },
    ],
  };

  it('no changes returns empty diff', () => {
    const r = diffInterpretations(prev, prev);
    expect(r.addedSections).toHaveLength(0);
    expect(r.removedSections).toHaveLength(0);
    expect(r.modifiedSections).toHaveLength(0);
  });

  it('added section is detected', () => {
    const next = {
      ...prev,
      publishedAt: '2026-01-01',
      sections: [
        ...prev.sections,
        { heading: 'Section 3', body: 'New PEP screening requirement.' },
      ],
    };
    const r = diffInterpretations(prev, next);
    expect(r.addedSections).toContain('Section 3');
    // Keyword map should match 'PEP' → pepDatabaseConnector.
    expect(r.affectedSubsystems.some((a) => a.subsystem.includes('pepDatabaseConnector'))).toBe(true);
  });

  it('modified section is detected', () => {
    const next = {
      ...prev,
      publishedAt: '2026-01-01',
      sections: [
        { heading: 'Section 1', body: 'Structuring below threshold AND layering via shell companies.' },
        prev.sections[1],
      ],
    };
    const r = diffInterpretations(prev, next);
    expect(r.modifiedSections).toContain('Section 1');
  });
});
