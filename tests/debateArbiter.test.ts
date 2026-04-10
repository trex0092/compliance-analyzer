import { describe, it, expect } from 'vitest';
import { runDebate } from '@/services/debateArbiter';

describe('debateArbiter — basic scoring', () => {
  it('side with more citations wins when weights are equal', () => {
    const v = runDebate({
      topic: 'File STR on Acme?',
      proAction: 'file STR',
      conAction: 'dismiss',
      arguments: [
        {
          position: 'pro',
          claim: 'Structuring pattern observed',
          weight: 0.7,
          citations: ['FDL Art.26', 'MoE Circular 08/AML/2021', 'FATF Rec 20'],
        },
        {
          position: 'con',
          claim: 'Transactions are plausible commercial activity',
          weight: 0.7,
          citations: ['FDL Art.19'],
        },
      ],
    });
    expect(v.winner).toBe('pro');
    expect(v.winningAction).toBe('file STR');
  });

  it('ungrounded arguments are penalised', () => {
    const v = runDebate({
      topic: 'Freeze?',
      proAction: 'freeze',
      conAction: 'monitor',
      arguments: [
        {
          position: 'pro',
          claim: 'Suspected terrorist financing',
          weight: 0.9,
          citations: ['FDL Art.22', 'Cabinet Res 74/2020 Art.4'],
        },
        {
          position: 'con',
          claim: 'Customer has been here a long time',
          weight: 0.9,
          citations: [],
        },
      ],
    });
    expect(v.winner).toBe('pro');
    expect(
      v.arguments.find((a) => a.position === 'con')?.penalties,
    ).toContain('no regulatory citation');
  });
});

describe('debateArbiter — safety guards', () => {
  it('tipping-off claim is heavily penalised', () => {
    const v = runDebate({
      topic: 'Respond to concern?',
      proAction: 'file STR',
      conAction: 'notify subject',
      arguments: [
        {
          position: 'pro',
          claim: 'File STR per FDL Art.26',
          weight: 0.8,
          citations: ['FDL Art.26'],
        },
        {
          position: 'con',
          claim: 'We should tell the customer about the suspicion',
          weight: 0.9,
          citations: ['—'],
        },
      ],
    });
    expect(v.winner).toBe('pro');
    expect(
      v.arguments.find((a) => a.claim.includes('tell the customer'))?.penalties.join(),
    ).toContain('tipping-off');
  });

  it('ties resolve to the stronger (pro) action', () => {
    const v = runDebate({
      topic: 'Close call',
      proAction: 'file STR',
      conAction: 'dismiss',
      conservatismBias: 0.0,
      arguments: [
        {
          position: 'pro',
          claim: 'One mild indicator',
          weight: 0.5,
          citations: ['FDL Art.26'],
        },
        {
          position: 'con',
          claim: 'One mild indicator against',
          weight: 0.5,
          citations: ['FDL Art.19'],
        },
      ],
    });
    expect(['pro', 'tie']).toContain(v.winner);
    expect(v.winningAction).toBe('file STR');
  });
});

describe('debateArbiter — determinism', () => {
  it('same inputs produce the same verdict', () => {
    const input = {
      topic: 'x',
      proAction: 'A',
      conAction: 'B',
      arguments: [
        { position: 'pro' as const, claim: 'p', weight: 0.6, citations: ['r1'] },
        { position: 'con' as const, claim: 'c', weight: 0.6, citations: ['r2'] },
      ],
    };
    const a = runDebate(input);
    const b = runDebate(input);
    expect(a).toEqual(b);
  });
});
