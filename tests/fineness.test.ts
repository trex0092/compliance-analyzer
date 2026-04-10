import { describe, it, expect } from 'vitest';
import {
  karatToFineness,
  finenessToKarat,
  pureWeight,
  gramsToTroyOz,
  troyOzToGrams,
  validateGoodDelivery,
  validateAssay,
  classifyInvestmentGold,
  GOOD_DELIVERY_SPECS,
  type AssayCertificate,
} from '@/services/fineness';

describe('karatToFineness / finenessToKarat', () => {
  it('24K = 999.9', () => {
    expect(karatToFineness('24K')).toBe(999.9);
  });

  it('22K = 916', () => {
    expect(karatToFineness('22K')).toBe(916);
  });

  it('18K = 750', () => {
    expect(karatToFineness('18K')).toBe(750);
  });

  it('finenessToKarat(999.9) → 24K', () => {
    expect(finenessToKarat(999.9)).toBe('24K');
  });

  it('finenessToKarat(916) → 22K', () => {
    expect(finenessToKarat(916)).toBe('22K');
  });

  it('finenessToKarat(750) → 18K', () => {
    expect(finenessToKarat(750)).toBe('18K');
  });

  it('finenessToKarat returns null for out-of-range', () => {
    expect(finenessToKarat(-1)).toBeNull();
    expect(finenessToKarat(1001)).toBeNull();
  });
});

describe('pureWeight', () => {
  it('1 kg of 22K gold contains 916g pure', () => {
    expect(pureWeight(1000, 916)).toBe(916);
  });

  it('500g of 18K gold contains 375g pure', () => {
    expect(pureWeight(500, 750)).toBe(375);
  });

  it('throws on negative grams', () => {
    expect(() => pureWeight(-1, 999)).toThrow();
  });

  it('throws on fineness > 1000', () => {
    expect(() => pureWeight(100, 1001)).toThrow();
  });
});

describe('gramsToTroyOz / troyOzToGrams', () => {
  it('round-trip preserves value', () => {
    const grams = 12345.67;
    expect(troyOzToGrams(gramsToTroyOz(grams))).toBeCloseTo(grams, 6);
  });

  it('1 troy oz = 31.1034768 g', () => {
    expect(troyOzToGrams(1)).toBeCloseTo(31.1034768, 6);
  });

  it('400 troy oz ≈ 12.4414 kg', () => {
    expect(troyOzToGrams(400)).toBeCloseTo(12441.39, 1);
  });
});

describe('validateGoodDelivery — gold', () => {
  const minWeightGrams = troyOzToGrams(350);
  const maxWeightGrams = troyOzToGrams(430);

  it('accepts a spec-compliant gold bar', () => {
    const v = validateGoodDelivery('gold', 999.5, minWeightGrams + 100);
    expect(v.ok).toBe(true);
  });

  it('rejects below-minimum fineness', () => {
    const v = validateGoodDelivery('gold', 990, minWeightGrams + 100);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /fineness/i.test(e))).toBe(true);
  });

  it('rejects below-minimum weight', () => {
    const v = validateGoodDelivery('gold', 999.9, troyOzToGrams(100));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /weight/i.test(e))).toBe(true);
  });

  it('rejects above-maximum weight', () => {
    const v = validateGoodDelivery('gold', 999.9, troyOzToGrams(500));
    expect(v.ok).toBe(false);
  });

  it('warns when fineness is just below the floor', () => {
    const v = validateGoodDelivery('gold', 994.5, minWeightGrams + 100);
    expect(v.ok).toBe(false);
    expect(v.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateGoodDelivery — silver, platinum', () => {
  it('silver requires ≥999 fineness', () => {
    const v = validateGoodDelivery('silver', 925, troyOzToGrams(1000));
    expect(v.ok).toBe(false);
  });

  it('silver weight range is 750-1100 troy oz', () => {
    expect(validateGoodDelivery('silver', 999, troyOzToGrams(500)).ok).toBe(false);
    expect(validateGoodDelivery('silver', 999, troyOzToGrams(1200)).ok).toBe(false);
    expect(validateGoodDelivery('silver', 999, troyOzToGrams(900)).ok).toBe(true);
  });

  it('platinum requires ≥999.5 fineness', () => {
    const v = validateGoodDelivery('platinum', 999, troyOzToGrams(50));
    expect(v.ok).toBe(false);
  });
});

describe('validateAssay', () => {
  const baseCert: AssayCertificate = {
    refinerName: 'Emirates Gold Refinery',
    refinerLicense: 'LBMA-GDL-0042',
    barSerial: 'EGR-2026-000123',
    declaredFineness: 999.9,
    measuredFineness: 999.9,
    assayMethod: 'fire_assay',
    assayDate: '2026-01-15',
    assayerName: 'A. Khan',
    assayerAccreditation: 'ISO 17025:2017',
  };

  it('accepts a clean certificate', () => {
    const v = validateAssay(baseCert);
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('flags measured-below-declared as an error (fraud/impurity)', () => {
    const v = validateAssay({ ...baseCert, measuredFineness: 997 });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /BELOW/i.test(e))).toBe(true);
  });

  it('only warns on measured-above-declared', () => {
    const v = validateAssay({ ...baseCert, declaredFineness: 995, measuredFineness: 999 });
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it('rejects invalid declared fineness', () => {
    const v = validateAssay({ ...baseCert, declaredFineness: 1500 });
    expect(v.ok).toBe(false);
  });

  it('rejects assay date in the future', () => {
    const v = validateAssay({ ...baseCert, assayDate: '2099-01-01' });
    expect(v.ok).toBe(false);
  });

  it('rejects missing bar serial', () => {
    const v = validateAssay({ ...baseCert, barSerial: '' });
    expect(v.ok).toBe(false);
  });

  it('warns when assayer is not accredited', () => {
    const { assayerAccreditation, ...rest } = baseCert;
    void assayerAccreditation;
    const v = validateAssay(rest as AssayCertificate);
    expect(v.warnings.some((w) => /accreditation/i.test(w))).toBe(true);
  });

  it('reports the discrepancy in ppt and pct', () => {
    const v = validateAssay({ ...baseCert, measuredFineness: 995 });
    expect(v.discrepancyPpt).toBeCloseTo(4.9, 1);
    expect(v.discrepancyPct).toBeGreaterThan(0);
  });
});

describe('classifyInvestmentGold — UAE VAT Decree-Law 8/2017', () => {
  it('999.9 fineness bar → zero-rated investment gold', () => {
    const c = classifyInvestmentGold({ fineness: 999.9, form: 'bar' });
    expect(c.isInvestmentGold).toBe(true);
    expect(c.vatRate).toBe(0);
  });

  it('995 fineness ingot → zero-rated (at the threshold)', () => {
    const c = classifyInvestmentGold({ fineness: 995, form: 'ingot' });
    expect(c.isInvestmentGold).toBe(true);
  });

  it('994 fineness bar → not investment gold, 5% VAT', () => {
    const c = classifyInvestmentGold({ fineness: 994, form: 'bar' });
    expect(c.isInvestmentGold).toBe(false);
    expect(c.vatRate).toBe(0.05);
  });

  it('jewellery is never investment gold', () => {
    const c = classifyInvestmentGold({ fineness: 999.9, form: 'jewellery' });
    expect(c.isInvestmentGold).toBe(false);
    expect(c.vatRate).toBe(0.05);
  });

  it('scrap and industrial are always 5% VAT', () => {
    expect(classifyInvestmentGold({ fineness: 999, form: 'scrap' }).vatRate).toBe(0.05);
    expect(classifyInvestmentGold({ fineness: 999, form: 'industrial' }).vatRate).toBe(0.05);
  });

  it('legal tender coin ≥ 900 fineness → zero-rated', () => {
    const c = classifyInvestmentGold({ fineness: 916, form: 'coin', isLegalTender: true });
    expect(c.isInvestmentGold).toBe(true);
  });

  it('non-legal-tender coin → 5% VAT even if high fineness', () => {
    const c = classifyInvestmentGold({ fineness: 999, form: 'coin', isLegalTender: false });
    expect(c.isInvestmentGold).toBe(false);
  });

  it('legal tender coin below 900 → 5% VAT', () => {
    const c = classifyInvestmentGold({ fineness: 875, form: 'coin', isLegalTender: true });
    expect(c.isInvestmentGold).toBe(false);
  });
});

describe('GOOD_DELIVERY_SPECS', () => {
  it('includes gold, silver, platinum, palladium', () => {
    expect(GOOD_DELIVERY_SPECS.gold).toBeDefined();
    expect(GOOD_DELIVERY_SPECS.silver).toBeDefined();
    expect(GOOD_DELIVERY_SPECS.platinum).toBeDefined();
    expect(GOOD_DELIVERY_SPECS.palladium).toBeDefined();
  });

  it('gold minimum fineness is 995', () => {
    expect(GOOD_DELIVERY_SPECS.gold.minFineness).toBe(995);
  });

  it('gold weight range is 350-430 troy oz', () => {
    expect(GOOD_DELIVERY_SPECS.gold.minWeightTroyOz).toBe(350);
    expect(GOOD_DELIVERY_SPECS.gold.maxWeightTroyOz).toBe(430);
  });
});
