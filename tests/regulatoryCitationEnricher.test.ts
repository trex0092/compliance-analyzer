/**
 * Tests for regulatoryCitationEnricher.ts — pure compute, so every
 * test sets inputs inline and compares outputs literally.
 */
import { describe, it, expect } from 'vitest';
import {
  appendCitationBlock,
  buildRegulatoryCitationBlock,
} from '@/services/regulatoryCitationEnricher';

describe('buildRegulatoryCitationBlock — verdict-driven anchors', () => {
  it('pass carries only the common set', () => {
    const { anchors } = buildRegulatoryCitationBlock({ verdict: 'pass' });
    expect(anchors.length).toBe(4);
    expect(anchors.join('\n')).toContain('Article 20');
    expect(anchors.join('\n')).toContain('Article 24');
    expect(anchors.join('\n')).toContain('Article 29');
    expect(anchors.join('\n')).toContain('134/2025, Article 19');
  });

  it('flag carries only the common set (no extras)', () => {
    const { anchors } = buildRegulatoryCitationBlock({ verdict: 'flag' });
    expect(anchors.length).toBe(4);
  });

  it('escalate adds the potential-match anchor', () => {
    const { anchors } = buildRegulatoryCitationBlock({ verdict: 'escalate' });
    expect(anchors.length).toBe(5);
    expect(anchors.some((a) => a.includes('74/2020, Article 4'))).toBe(true);
  });

  it('freeze adds the 24-hour freeze, CNMR, and TFS anchors', () => {
    const { anchors } = buildRegulatoryCitationBlock({ verdict: 'freeze' });
    expect(anchors.length).toBe(7);
    expect(anchors.some((a) => a.includes('24-hour freeze'))).toBe(true);
    expect(anchors.some((a) => a.includes('CNMR'))).toBe(true);
    expect(anchors.some((a) => a.includes('Article 35'))).toBe(true);
  });
});

describe('buildRegulatoryCitationBlock — deadline-type anchors', () => {
  it('STR adds the filing citation', () => {
    const { anchors } = buildRegulatoryCitationBlock({
      verdict: 'flag',
      deadlineType: 'STR',
    });
    expect(anchors.some((a) => a.includes('STR filing'))).toBe(true);
  });

  it('DPMSR adds MoE Circular 08/AML/2021', () => {
    const { anchors } = buildRegulatoryCitationBlock({
      verdict: 'flag',
      deadlineType: 'DPMSR',
    });
    expect(anchors.some((a) => a.includes('MoE Circular 08/AML/2021'))).toBe(true);
  });

  it('EOCN adds freeze and Executive Office anchors', () => {
    const { anchors } = buildRegulatoryCitationBlock({
      verdict: 'freeze',
      deadlineType: 'EOCN',
    });
    // freeze + EOCN both cite Article 4; the enricher dedupes so we
    // only see one entry for it.
    const article4 = anchors.filter((a) => a.includes('74/2020, Article 4'));
    expect(article4.length).toBe(1);
    expect(anchors.some((a) => a.includes('Executive Office notification'))).toBe(true);
  });

  it('CNMR deadline does not duplicate with freeze anchor', () => {
    const { anchors } = buildRegulatoryCitationBlock({
      verdict: 'freeze',
      deadlineType: 'CNMR',
    });
    const cnmrEntries = anchors.filter((a) => a.includes('CNMR within 5 business days'));
    expect(cnmrEntries.length).toBe(1);
  });
});

describe('buildRegulatoryCitationBlock — additional citations', () => {
  it('appends brain citations after the canonical set', () => {
    const { text, anchors } = buildRegulatoryCitationBlock({
      verdict: 'flag',
      additionalCitations: ['LBMA RGG v9 Step 2', 'MoE RSG Framework §3'],
    });
    expect(anchors).toContain('LBMA RGG v9 Step 2');
    expect(anchors).toContain('MoE RSG Framework §3');
    expect(text).toContain('Additional citations from the originating decision:');
  });

  it('dedupes additional citations', () => {
    const { anchors } = buildRegulatoryCitationBlock({
      verdict: 'flag',
      additionalCitations: ['LBMA RGG v9 Step 2', 'LBMA RGG v9 Step 2', 'MoE RSG Framework §3'],
    });
    const lbmaCount = anchors.filter((a) => a === 'LBMA RGG v9 Step 2').length;
    expect(lbmaCount).toBe(1);
  });

  it('does not append empty additional citations section when none provided', () => {
    const { text } = buildRegulatoryCitationBlock({ verdict: 'flag' });
    expect(text).not.toContain('Additional citations from the originating decision:');
  });
});

describe('buildRegulatoryCitationBlock — echo fields', () => {
  it('echoes caseId and tenantId when provided', () => {
    const { text } = buildRegulatoryCitationBlock({
      verdict: 'flag',
      caseId: 'C-001',
      tenantId: 'madison-llc',
    });
    expect(text).toContain('Case id: C-001');
    expect(text).toContain('Tenant: madison-llc');
  });

  it('omits caseId and tenantId when not provided', () => {
    const { text } = buildRegulatoryCitationBlock({ verdict: 'flag' });
    expect(text).not.toContain('Case id:');
    expect(text).not.toContain('Tenant:');
  });
});

describe('buildRegulatoryCitationBlock — determinism', () => {
  it('returns the same text for the same inputs across calls', () => {
    const input = {
      verdict: 'freeze' as const,
      deadlineType: 'EOCN' as const,
      additionalCitations: ['LBMA RGG v9 Step 2'] as const,
      caseId: 'C-42',
      tenantId: 'madison-llc',
    };
    const a = buildRegulatoryCitationBlock(input);
    const b = buildRegulatoryCitationBlock(input);
    expect(a.text).toBe(b.text);
    expect(a.anchors).toEqual(b.anchors);
  });
});

describe('appendCitationBlock', () => {
  it('appends to empty notes', () => {
    const out = appendCitationBlock(undefined, { verdict: 'flag' });
    expect(out.startsWith('--- Regulatory citation')).toBe(true);
  });

  it('appends to existing notes with a blank-line separator', () => {
    const out = appendCitationBlock('Original narrative.', {
      verdict: 'flag',
    });
    expect(out.startsWith('Original narrative.\n\n--- Regulatory citation')).toBe(true);
  });

  it('preserves exactly one blank line between notes and block', () => {
    // Existing notes end with a newline. The separator adds one more
    // newline, producing exactly one blank line between the
    // narrative and the block header. If the existing notes already
    // ended with a trailing newline, we only need a single extra
    // newline for the blank-line separation.
    const out = appendCitationBlock('Original narrative.\n', {
      verdict: 'flag',
    });
    expect(out).toMatch(/Original narrative\.\n\n--- Regulatory citation/);
  });

  it('is idempotent — a second append does not double the block', () => {
    const once = appendCitationBlock('Narrative.', { verdict: 'flag' });
    const twice = appendCitationBlock(once, { verdict: 'flag' });
    expect(twice).toBe(once);
  });

  it('is idempotent even if the verdict changed between calls', () => {
    // Because the idempotency guard looks for the literal header,
    // a second call with a different verdict is still a no-op. This
    // is the safe default: do not rewrite a task's citation block
    // just because someone re-ran enrichment with a changed verdict;
    // that path needs a deliberate rewrite, not a silent second pass.
    const once = appendCitationBlock('Narrative.', { verdict: 'flag' });
    const twice = appendCitationBlock(once, { verdict: 'freeze' });
    expect(twice).toBe(once);
  });
});
