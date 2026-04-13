import { describe, expect, it } from 'vitest';
import {
  buildTraceabilityMatrix,
  extractConstants,
  findImporters,
  renderMatrixMarkdown,
} from '@/services/traceabilityMatrix';

const SAMPLE_CONSTANTS = `/**
 * Sample constants file for testing.
 */

/** AED 55,000 — DPMS cash transaction reporting threshold (FDL Art.16, MoE Circular 08/AML/2021) */
export const DPMS_CASH_THRESHOLD_AED = 55_000;

/** AED 60,000 — Cross-border cash declaration threshold (FDL Art.17, Cabinet Res 134/2025 Art.16) */
export const CROSS_BORDER_CASH_THRESHOLD_AED = 60_000;

/** USD/AED peg — CBUAE rate. Update only on CBUAE change. */
export const USD_TO_AED = 3.6725;
`;

describe('extractConstants', () => {
  it('finds every export const declaration', () => {
    const out = extractConstants(SAMPLE_CONSTANTS);
    expect(out.length).toBe(3);
    expect(out.map((c) => c.name)).toEqual([
      'DPMS_CASH_THRESHOLD_AED',
      'CROSS_BORDER_CASH_THRESHOLD_AED',
      'USD_TO_AED',
    ]);
  });

  it('extracts JSDoc descriptions and regulatory citations', () => {
    const out = extractConstants(SAMPLE_CONSTANTS);
    const dpms = out.find((c) => c.name === 'DPMS_CASH_THRESHOLD_AED')!;
    expect(dpms.description).toContain('DPMS cash transaction');
    expect(dpms.citations.some((c) => /FDL Art\.16/.test(c))).toBe(true);
  });

  it('returns the raw value for each constant', () => {
    const out = extractConstants(SAMPLE_CONSTANTS);
    expect(out.find((c) => c.name === 'USD_TO_AED')!.value).toBe('3.6725');
  });
});

describe('findImporters', () => {
  it('finds files that import a constant from the domain module', () => {
    const files = [
      {
        path: 'src/services/foo.ts',
        content: `import { DPMS_CASH_THRESHOLD_AED } from '@/domain/constants';\n`,
      },
      {
        path: 'src/services/bar.ts',
        content: `import { CROSS_BORDER_CASH_THRESHOLD_AED } from '../domain/constants';\n`,
      },
      {
        path: 'src/services/baz.ts',
        content: `// no constants imports here\n`,
      },
    ];
    const imps = findImporters(files, [
      'DPMS_CASH_THRESHOLD_AED',
      'CROSS_BORDER_CASH_THRESHOLD_AED',
      'USD_TO_AED',
    ]);
    expect(imps.get('DPMS_CASH_THRESHOLD_AED')).toContain('src/services/foo.ts');
    expect(imps.get('CROSS_BORDER_CASH_THRESHOLD_AED')).toContain('src/services/bar.ts');
    expect(imps.get('USD_TO_AED')).toEqual([]);
  });
});

describe('buildTraceabilityMatrix', () => {
  it('produces an entry per constant with citations + readBy + pinnedBy', () => {
    const matrix = buildTraceabilityMatrix({
      constantsSource: SAMPLE_CONSTANTS,
      sourceFiles: [
        {
          path: 'src/services/foo.ts',
          content: `import { DPMS_CASH_THRESHOLD_AED } from '@/domain/constants';\n`,
        },
      ],
      testFiles: [
        {
          path: 'tests/dpms.test.ts',
          content: `import { DPMS_CASH_THRESHOLD_AED } from '@/domain/constants';\n`,
        },
      ],
      generatedAtIso: '2026-04-13T00:00:00.000Z',
    });
    expect(matrix.totalConstants).toBe(3);
    expect(matrix.citedConstants).toBe(2); // USD_TO_AED has no parens citation
    expect(matrix.coveredConstants).toBe(1);
    expect(matrix.pinnedConstants).toBe(1);
    const dpms = matrix.entries.find((e) => e.constantName === 'DPMS_CASH_THRESHOLD_AED')!;
    expect(dpms.readBy).toContain('src/services/foo.ts');
    expect(dpms.pinnedBy).toContain('tests/dpms.test.ts');
  });

  it('renders a markdown table with every constant', () => {
    const matrix = buildTraceabilityMatrix({
      constantsSource: SAMPLE_CONSTANTS,
      sourceFiles: [],
      testFiles: [],
    });
    const md = renderMatrixMarkdown(matrix);
    expect(md).toMatch(/# Regulatory Traceability Matrix/);
    expect(md).toMatch(/DPMS_CASH_THRESHOLD_AED/);
    expect(md).toMatch(/CROSS_BORDER_CASH_THRESHOLD_AED/);
    expect(md).toMatch(/USD_TO_AED/);
  });

  it('handles a real-shaped constants file with multiple JSDoc blocks', () => {
    const real = `/**
 * Centralized regulatory constants.
 */
/** Sample (FDL Art.16, MoE Circular 08/AML/2021) */
export const DPMS = 55_000;
/** UBO 25% (Cabinet Decision 109/2023) */
export const UBO_THRESHOLD_PCT = 0.25;
/** No citation here */
export const HARMLESS = 'literal';
`;
    const matrix = buildTraceabilityMatrix({
      constantsSource: real,
      sourceFiles: [],
      testFiles: [],
    });
    expect(matrix.totalConstants).toBe(3);
    expect(matrix.citedConstants).toBe(2);
  });
});
