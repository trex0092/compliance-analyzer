/**
 * Tests for Phase 7 Cluster I — DPMS gold domain.
 */
import { describe, it, expect } from 'vitest';
import {
  checkLbmaFixDeviations,
  type LbmaFix,
} from '@/services/lbmaFixPriceChecker';
import { traceGoldOrigin } from '@/services/goldOriginTracer';
import { matchAssayCertificates } from '@/services/assayCertificateMatcher';
import { detectFinenessAnomalies } from '@/services/finenessAnomalyDetector';
import { verifyTrnRegistrations } from '@/services/vatRegistrationVerifier';

// ---------------------------------------------------------------------------
// lbmaFixPriceChecker
// ---------------------------------------------------------------------------

describe('lbmaFixPriceChecker', () => {
  const fix: LbmaFix = { date: '2026-04-11', session: 'AM', usdPerOz: 2100 };
  const lookup = (_at: string) => fix;

  it('within tolerance is within_tolerance', () => {
    const report = checkLbmaFixDeviations(
      [{ tradeId: 'T1', tradeAt: '2026-04-11T11:00:00Z', usdPerOz: 2110, ozTraded: 100 }],
      lookup
    );
    expect(report.results[0].bucket).toBe('within_tolerance');
  });

  it('3% deviation goes to flag bucket', () => {
    const report = checkLbmaFixDeviations(
      [{ tradeId: 'T1', tradeAt: '2026-04-11T11:00:00Z', usdPerOz: 2163, ozTraded: 100 }],
      lookup
    );
    expect(report.results[0].bucket).toBe('flag');
  });

  it('8% deviation goes to freeze bucket', () => {
    const report = checkLbmaFixDeviations(
      [{ tradeId: 'T1', tradeAt: '2026-04-11T11:00:00Z', usdPerOz: 2268, ozTraded: 100 }],
      lookup
    );
    expect(report.results[0].bucket).toBe('freeze');
  });

  it('missing fix returns empty results', () => {
    const report = checkLbmaFixDeviations(
      [{ tradeId: 'T1', tradeAt: '2026-04-11T11:00:00Z', usdPerOz: 2100, ozTraded: 100 }],
      () => undefined
    );
    expect(report.checked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// goldOriginTracer
// ---------------------------------------------------------------------------

describe('goldOriginTracer', () => {
  it('refuses CAHRA country origin (DRC)', () => {
    const report = traceGoldOrigin([
      {
        shipmentId: 'S1',
        ozGross: 100,
        declaredOriginCountry: 'CD',
        refinerLbmaAccredited: true,
        dgdHallmark: true,
        assayCertificateNo: 'A123',
      },
    ]);
    expect(report.results[0].verdict).toBe('refuse');
    expect(report.refuseCount).toBe(1);
  });

  it('DRC-adjacent (Rwanda) escalates', () => {
    const report = traceGoldOrigin([
      {
        shipmentId: 'S1',
        ozGross: 100,
        declaredOriginCountry: 'RW',
        refinerLbmaAccredited: true,
        dgdHallmark: true,
        assayCertificateNo: 'A123',
      },
    ]);
    expect(report.results[0].verdict).toBe('escalate');
  });

  it('missing DGD hallmark → EDD required', () => {
    const report = traceGoldOrigin([
      {
        shipmentId: 'S1',
        ozGross: 100,
        declaredOriginCountry: 'CH',
        refinerLbmaAccredited: true,
        dgdHallmark: false,
        assayCertificateNo: 'A123',
      },
    ]);
    expect(report.results[0].verdict).toBe('edd_required');
  });

  it('clean Swiss origin passes', () => {
    const report = traceGoldOrigin([
      {
        shipmentId: 'S1',
        ozGross: 100,
        declaredOriginCountry: 'CH',
        refinerLbmaAccredited: true,
        dgdHallmark: true,
        assayCertificateNo: 'A123',
      },
    ]);
    expect(report.results[0].verdict).toBe('clean');
  });
});

// ---------------------------------------------------------------------------
// assayCertificateMatcher
// ---------------------------------------------------------------------------

describe('assayCertificateMatcher', () => {
  const lookup = (id: string) => {
    if (id === 'ROYAL_MINT') {
      return {
        id: 'ROYAL_MINT',
        name: 'The Royal Mint',
        country: 'GB',
        accreditation: 'LBMA_GDL' as const,
        certificateNumberPattern: /^RM-[0-9]{6}$/,
      };
    }
    return undefined;
  };

  it('valid certificate number passes', () => {
    const report = matchAssayCertificates(
      [
        {
          shipmentId: 'S1',
          refinerId: 'ROYAL_MINT',
          certificateNumber: 'RM-123456',
          declaredGrossOz: 100,
          declaredFineness: 999.9,
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(true);
  });

  it('malformed certificate number fails', () => {
    const report = matchAssayCertificates(
      [
        {
          shipmentId: 'S1',
          refinerId: 'ROYAL_MINT',
          certificateNumber: 'FAKE-1',
          declaredGrossOz: 100,
          declaredFineness: 999.9,
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(false);
    expect(report.results[0].failures[0]).toContain('format');
  });

  it('unknown refiner fails', () => {
    const report = matchAssayCertificates(
      [
        {
          shipmentId: 'S1',
          refinerId: 'SHADOWY_REFINER',
          certificateNumber: 'RM-123456',
          declaredGrossOz: 100,
          declaredFineness: 999.9,
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(false);
  });

  it('duplicate certificate across shipments fails', () => {
    const report = matchAssayCertificates(
      [
        {
          shipmentId: 'S1',
          refinerId: 'ROYAL_MINT',
          certificateNumber: 'RM-123456',
          declaredGrossOz: 100,
          declaredFineness: 999.9,
        },
        {
          shipmentId: 'S2',
          refinerId: 'ROYAL_MINT',
          certificateNumber: 'RM-123456',
          declaredGrossOz: 100,
          declaredFineness: 999.9,
        },
      ],
      lookup
    );
    expect(report.results[1].ok).toBe(false);
    expect(report.results[1].failures[0]).toContain('Duplicate');
  });
});

// ---------------------------------------------------------------------------
// finenessAnomalyDetector
// ---------------------------------------------------------------------------

describe('finenessAnomalyDetector', () => {
  it('within refiner profile passes', () => {
    const report = detectFinenessAnomalies(
      [{ shipmentId: 'S1', refinerId: 'R1', declaredFineness: 999.9 }],
      [{ refinerId: 'R1', allowedFineness: [999.9, 999.5] }]
    );
    expect(report.mismatches).toBe(0);
  });

  it('mismatch flagged', () => {
    const report = detectFinenessAnomalies(
      [{ shipmentId: 'S1', refinerId: 'R1', declaredFineness: 750 }],
      [{ refinerId: 'R1', allowedFineness: [999.9, 999.5] }]
    );
    expect(report.mismatches).toBe(1);
  });

  it('unknown refiner flagged', () => {
    const report = detectFinenessAnomalies(
      [{ shipmentId: 'S1', refinerId: 'UNKNOWN', declaredFineness: 999.9 }],
      []
    );
    expect(report.mismatches).toBe(1);
    expect(report.findings[0].reason).toContain('no published capability');
  });
});

// ---------------------------------------------------------------------------
// vatRegistrationVerifier
// ---------------------------------------------------------------------------

describe('vatRegistrationVerifier', () => {
  const lookup = (trn: string) => {
    if (trn === '100123456789012') {
      return {
        trn,
        status: 'active' as const,
        registeredName: 'Acme Gold LLC',
        registeredAddress: 'Dubai Gold Souk, UAE',
      };
    }
    return undefined;
  };

  it('matching active TRN passes', () => {
    const report = verifyTrnRegistrations(
      [
        {
          traderId: 'T1',
          declaredTrn: '100123456789012',
          declaredName: 'Acme Gold LLC',
          declaredAddress: 'Dubai Gold Souk, UAE',
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(true);
  });

  it('invalid TRN format fails', () => {
    const report = verifyTrnRegistrations(
      [
        {
          traderId: 'T1',
          declaredTrn: 'NOT_A_TRN',
          declaredName: 'Acme',
          declaredAddress: 'Dubai',
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(false);
    expect(report.results[0].severity).toBe('critical'); // also not in registry
  });

  it('name mismatch is medium severity', () => {
    const report = verifyTrnRegistrations(
      [
        {
          traderId: 'T1',
          declaredTrn: '100123456789012',
          declaredName: 'Different Company',
          declaredAddress: 'Dubai Gold Souk, UAE',
        },
      ],
      lookup
    );
    expect(report.results[0].ok).toBe(false);
    expect(report.results[0].severity).toBe('medium');
  });
});
