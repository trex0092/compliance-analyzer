import { describe, it, expect } from 'vitest';
import { doubleCheck, type Opinion } from '@/services/teacherStudent';

const student = (v: Opinion['verdict'], c = 0.8): Opinion => ({
  verdict: v,
  confidence: c,
  rationale: `student says ${v}`,
  model: 'sonnet-fast',
});

const teacher = (v: Opinion['verdict'], c = 0.9): Opinion => ({
  verdict: v,
  confidence: c,
  rationale: `teacher says ${v}`,
  model: 'opus-deliberate',
});

describe('teacherStudent — ratification', () => {
  it('agreement on pass → ratified', () => {
    const r = doubleCheck({ topic: 'x', student: student('pass'), teacher: teacher('pass') });
    expect(r.outcome).toBe('ratified');
    expect(r.finalVerdict).toBe('pass');
    expect(r.requiresHumanReview).toBe(false);
  });

  it('agreement on freeze → ratified', () => {
    const r = doubleCheck({ topic: 'x', student: student('freeze'), teacher: teacher('freeze') });
    expect(r.outcome).toBe('ratified');
    expect(r.finalVerdict).toBe('freeze');
  });
});

describe('teacherStudent — corrections', () => {
  it('teacher upgrades pass → flag', () => {
    const r = doubleCheck({ topic: 'x', student: student('pass'), teacher: teacher('flag') });
    expect(r.outcome).toBe('corrected-upward');
    expect(r.finalVerdict).toBe('flag');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('teacher upgrades flag → freeze with high confidence → auto-execute', () => {
    const r = doubleCheck({
      topic: 'x',
      student: student('flag'),
      teacher: teacher('freeze', 0.95),
    });
    expect(r.outcome).toBe('corrected-upward');
    expect(r.finalVerdict).toBe('freeze');
    expect(r.requiresHumanReview).toBe(false);
  });

  it('teacher upgrades to freeze with low confidence → human review', () => {
    const r = doubleCheck({
      topic: 'x',
      student: student('flag'),
      teacher: teacher('freeze', 0.5),
    });
    expect(r.finalVerdict).toBe('freeze');
    expect(r.requiresHumanReview).toBe(true);
  });
});

describe('teacherStudent — safety invariants', () => {
  it('SAFETY: student freeze cannot be downgraded by teacher', () => {
    const r = doubleCheck({
      topic: 'sanctions',
      student: student('freeze'),
      teacher: teacher('pass'),
    });
    expect(r.outcome).toBe('locked-freeze');
    expect(r.finalVerdict).toBe('freeze');
    expect(r.requiresHumanReview).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Cabinet Res 74\/2020/);
  });

  it('contested flag vs pass → hold at stronger verdict + human review', () => {
    const r = doubleCheck({ topic: 'x', student: student('flag'), teacher: teacher('pass') });
    expect(r.outcome).toBe('contested');
    expect(r.finalVerdict).toBe('flag');
    expect(r.requiresHumanReview).toBe(true);
  });
});

describe('teacherStudent — DAG', () => {
  it('chain is sealed and contains student + teacher + final nodes', () => {
    const r = doubleCheck({ topic: 'x', student: student('pass'), teacher: teacher('flag') });
    expect(r.chain.sealed).toBe(true);
    const ids = r.chain.nodes.map((n) => n.id);
    expect(ids).toContain('student');
    expect(ids).toContain('teacher');
    expect(ids).toContain('final');
  });
});
