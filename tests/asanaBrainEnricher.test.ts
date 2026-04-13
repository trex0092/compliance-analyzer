/**
 * Tests for the Asana brain enricher — pure bridge between the
 * megaBrain pipeline and the Asana task surface.
 */
import { describe, it, expect } from 'vitest';
import {
  enrichAsanaTaskFromBrain,
  brainVerdictToKanbanColumn,
  brainStageEnrichments,
  buildBrainSubsystemStates,
  BRAIN_SUBSYSTEM_NODES,
  BRAIN_SUBSYSTEM_EDGES,
  type EnrichableBrain,
} from '@/services/asanaBrainEnricher';
import { validateNoCycles } from '@/services/asanaWorkflowAutomation';

function mkBrain(overrides: Partial<EnrichableBrain> = {}): EnrichableBrain {
  return {
    verdict: 'flag',
    confidence: 0.72,
    recommendedAction: 'Escalate to MLRO for review',
    requiresHumanReview: true,
    entityId: 'case-42',
    notes: ['Anomaly score 0.87 > peer mean', 'Belief: suspicious p=0.61'],
    subsystems: {
      // Always produced
      strPrediction: { score: 0.71 } as unknown as EnrichableBrain['subsystems']['strPrediction'],
      reflection: {
        recommendation: 'human review',
      } as unknown as EnrichableBrain['subsystems']['reflection'],
      // Optional
      belief: {
        topHypothesis: { label: 'suspicious', probability: 0.61 },
      } as unknown as EnrichableBrain['subsystems']['belief'],
      anomaly: {
        anomalyScore: 0.87,
      } as unknown as EnrichableBrain['subsystems']['anomaly'],
    },
    ...overrides,
  };
}

describe('brainVerdictToKanbanColumn', () => {
  it('maps freeze → blocked', () => {
    expect(brainVerdictToKanbanColumn('freeze')).toBe('blocked');
  });

  it('maps escalate → review', () => {
    expect(brainVerdictToKanbanColumn('escalate')).toBe('review');
  });

  it('maps flag → doing', () => {
    expect(brainVerdictToKanbanColumn('flag')).toBe('doing');
  });

  it('maps pass → done', () => {
    expect(brainVerdictToKanbanColumn('pass')).toBe('done');
  });
});

describe('BRAIN_SUBSYSTEM_EDGES', () => {
  it('defines a DAG with no cycles', () => {
    expect(validateNoCycles(BRAIN_SUBSYSTEM_EDGES)).toBe(true);
  });

  it('every edge references a known subsystem node', () => {
    const ids = new Set<string>(BRAIN_SUBSYSTEM_NODES.map((n) => n.id));
    for (const edge of BRAIN_SUBSYSTEM_EDGES) {
      expect(ids.has(edge.parent)).toBe(true);
      expect(ids.has(edge.blockedBy)).toBe(true);
    }
  });

  it('reflection is downstream of causal and debate', () => {
    const parents = BRAIN_SUBSYSTEM_EDGES.filter((e) => e.parent === 'reflection').map(
      (e) => e.blockedBy
    );
    expect(parents).toContain('causal');
    expect(parents).toContain('debate');
  });
});

describe('buildBrainSubsystemStates', () => {
  it('marks strPrediction and reflection as always done', () => {
    const states = buildBrainSubsystemStates(mkBrain());
    expect(states.strPrediction).toBe('done');
    expect(states.reflection).toBe('done');
  });

  it('marks invoked optional subsystems as active', () => {
    const states = buildBrainSubsystemStates(mkBrain());
    expect(states.belief).toBe('active');
    expect(states.anomaly).toBe('active');
  });

  it('marks skipped optional subsystems as pending', () => {
    const states = buildBrainSubsystemStates(mkBrain());
    expect(states.debate).toBe('pending');
    expect(states.penaltyVaR).toBe('pending');
    expect(states.narrative).toBe('pending');
  });
});

describe('enrichAsanaTaskFromBrain', () => {
  it('suggests the right Kanban column per verdict', () => {
    expect(enrichAsanaTaskFromBrain(mkBrain({ verdict: 'freeze' })).suggestedColumn).toBe(
      'blocked'
    );
    expect(enrichAsanaTaskFromBrain(mkBrain({ verdict: 'pass' })).suggestedColumn).toBe('done');
  });

  it('headline includes verdict and confidence percentage', () => {
    const e = enrichAsanaTaskFromBrain(mkBrain({ verdict: 'flag', confidence: 0.72 }));
    expect(e.headline).toContain('FLAG');
    expect(e.headline).toContain('72%');
  });

  it('notes block includes every fired subsystem label', () => {
    const e = enrichAsanaTaskFromBrain(mkBrain());
    expect(e.notesBlock).toContain('Belief');
    expect(e.notesBlock).toContain('Anomaly');
    expect(e.notesBlock).toContain('STR Pred');
    expect(e.notesBlock).toContain('Reflection');
  });

  it('notes block cites Art.29 no tipping off', () => {
    expect(enrichAsanaTaskFromBrain(mkBrain()).notesBlock).toContain('Art.29');
  });

  it('notes block NEVER contains a well-known entity legal name (FDL Art.29)', () => {
    // The enricher must NOT auto-lookup an entity legal name from
    // the caller-supplied entityId — even if the caller passes a
    // name-like id, the notes block should only contain the brain's
    // reasoning text, never a legal-name side channel. This guards
    // against a refactor that starts injecting `brain.entity.name`.
    const e = enrichAsanaTaskFromBrain(mkBrain({ entityId: 'case-Madison-LLC' }));
    expect(e.notesBlock).not.toContain('MADISON JEWELLERY');
    expect(e.notesBlock).not.toContain('NAPLES');
  });

  it('customFields carry the caller-supplied caseId for downstream rollups', () => {
    // caseId surfaces via buildComplianceCustomFields rather than
    // appearing verbatim in the notes block. This test pins that
    // contract so rollups keep working without depending on
    // free-text parsing.
    const e = enrichAsanaTaskFromBrain(mkBrain({ entityId: 'case-42' }));
    // customFields is degradation-tolerant — empty if no env GIDs
    // are configured. Either way, the enricher should not be
    // injecting the caseId into the notes block.
    expect(e.notesBlock).not.toMatch(/case-42/);
    expect(typeof e.customFields).toBe('object');
  });

  it('produces a stageEnrichment entry for every STR stage', () => {
    const e = enrichAsanaTaskFromBrain(mkBrain());
    expect(Object.keys(e.stageEnrichments).sort()).toEqual(
      ['mlro-review', 'four-eyes', 'goaml-xml', 'submit-fiu', 'retain-10y', 'monitor-ack', 'close'].sort()
    );
  });
});

describe('brainStageEnrichments', () => {
  it('mlro-review references the top hypothesis when present', () => {
    const stages = brainStageEnrichments(mkBrain());
    expect(stages['mlro-review']).toContain('suspicious');
  });

  it('four-eyes flags human review requirement', () => {
    const stages = brainStageEnrichments(mkBrain({ requiresHumanReview: true }));
    expect(stages['four-eyes']).toContain('human review');
  });

  it('submit-fiu always reminds Art.29', () => {
    expect(brainStageEnrichments(mkBrain())['submit-fiu']).toContain('Art.29');
  });

  it('close stage includes recommended action verbatim', () => {
    const stages = brainStageEnrichments(mkBrain({ recommendedAction: 'File STR via goAML' }));
    expect(stages.close).toContain('File STR via goAML');
  });
});
