import { describe, it, expect } from 'vitest';
import {
  calculateRAG,
  DPMS_KPI_DEFINITIONS,
  CATEGORY_NAMES,
  generateKPIReport,
  type KPIMeasurement,
} from '../src/domain/kpiFramework';

describe('KPI Definitions', () => {
  it('has 40 KPI definitions', () => {
    expect(DPMS_KPI_DEFINITIONS.length).toBe(40);
  });

  it('includes 8 UAE MoE RSG KPIs', () => {
    const rsgKPIs = DPMS_KPI_DEFINITIONS.filter((k) => k.id.startsWith('KPI-RSG'));
    expect(rsgKPIs.length).toBe(8);
    expect(rsgKPIs.every((k) => k.category === 'supply-chain')).toBe(true);
    expect(rsgKPIs.some((k) => k.name.includes('Gold Origin Traceability'))).toBe(true);
    expect(rsgKPIs.some((k) => k.name.includes('ASM'))).toBe(true);
    expect(rsgKPIs.some((k) => k.name.includes('Recycled/Scrap'))).toBe(true);
  });

  it('covers all 8 categories', () => {
    const categories = new Set(DPMS_KPI_DEFINITIONS.map((k) => k.category));
    expect(categories.size).toBe(8);
    for (const cat of Object.keys(CATEGORY_NAMES)) {
      expect(categories.has(cat as any)).toBe(true);
    }
  });

  it('every KPI has a regulatory basis', () => {
    for (const kpi of DPMS_KPI_DEFINITIONS) {
      expect(kpi.regulatoryBasis.length).toBeGreaterThan(0);
    }
  });

  it('every KPI has a unique ID', () => {
    const ids = DPMS_KPI_DEFINITIONS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every KPI has a reporting body', () => {
    const validBodies = ['MoE', 'EOCN', 'FIU', 'LBMA'];
    for (const kpi of DPMS_KPI_DEFINITIONS) {
      expect(validBodies).toContain(kpi.reportingBody);
    }
  });
});

describe('calculateRAG', () => {
  const normalKPI = DPMS_KPI_DEFINITIONS.find((k) => k.id === 'KPI-CDD-001')!;
  const inverseKPI = DPMS_KPI_DEFINITIONS.find((k) => k.id === 'KPI-TFS-002')!;

  it('returns green when value meets target', () => {
    expect(calculateRAG(normalKPI, 100)).toBe('green');
    expect(calculateRAG(normalKPI, 95)).toBe('green');
  });

  it('returns amber when value is between thresholds', () => {
    expect(calculateRAG(normalKPI, 85)).toBe('amber');
  });

  it('returns red when value is below amber threshold', () => {
    expect(calculateRAG(normalKPI, 70)).toBe('red');
  });

  it('handles inverse KPIs (lower is better)', () => {
    expect(calculateRAG(inverseKPI, 1)).toBe('green');
    expect(calculateRAG(inverseKPI, 5)).toBe('amber');
    expect(calculateRAG(inverseKPI, 30)).toBe('red');
  });
});

describe('generateKPIReport', () => {
  it('generates a report with correct structure', () => {
    const measurements: KPIMeasurement[] = [
      { kpiId: 'KPI-CDD-001', value: 98, ragStatus: 'green', period: 'Q1-2026', measuredAt: '2026-04-07' },
      { kpiId: 'KPI-TFS-001', value: 100, ragStatus: 'green', period: 'Q1-2026', measuredAt: '2026-04-07' },
      { kpiId: 'KPI-FIU-001', value: 75, ragStatus: 'red', period: 'Q1-2026', measuredAt: '2026-04-07' },
    ];

    const report = generateKPIReport(measurements, 'FINE GOLD LLC', 'Q1-2026', 'CO');

    expect(report.entity).toBe('FINE GOLD LLC');
    expect(report.period).toBe('Q1-2026');
    expect(report.summary.totalKPIs).toBe(3);
    expect(report.summary.greenCount).toBe(2);
    expect(report.summary.redCount).toBe(1);
    expect(report.summary.criticalFindings.length).toBe(1);
    expect(report.overallScore).toBe(67); // 2/3 green
  });

  it('handles empty measurements', () => {
    const report = generateKPIReport([], 'TEST', 'Q1', 'admin');
    expect(report.overallScore).toBe(0);
    expect(report.summary.totalKPIs).toBe(0);
  });
});
