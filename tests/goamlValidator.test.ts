import { validateSTR, validateCTR } from '@/utils/goamlValidator';

const validSTR = `
<report>
  <reportHeader><reportId>RPT-1234567890-abc123</reportId></reportHeader>
  <reportingEntity>Entity</reportingEntity>
  <suspiciousSubject><subjectName>John Doe</subjectName></suspiciousSubject>
  <groundsForSuspicion>Unusual cash transaction patterns</groundsForSuspicion>
  <transactionDetails>
    <transactionDate>2026-01-15</transactionDate>
    <transactionAmount>60000.00</transactionAmount>
  </transactionDetails>
  <reportFooter>Footer</reportFooter>
</report>`;

const validCTR = `
<report>
  <reportHeader><reportId>RPT-1234567890-abc123</reportId></reportHeader>
  <reportingEntity>Entity</reportingEntity>
  <cashTransaction>Details</cashTransaction>
  <cashAmount>55000.00</cashAmount>
</report>`;

describe('validateSTR', () => {
  it('valid STR passes (valid: true, 0 errors)', () => {
    const result = validateSTR(validSTR);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing reportHeader -> error', () => {
    const xml = validSTR.replace(
      '<reportHeader><reportId>RPT-1234567890-abc123</reportId></reportHeader>',
      '',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'reportHeader')).toBe(true);
  });

  it('missing suspiciousSubject -> error', () => {
    const xml = validSTR.replace(
      '<suspiciousSubject><subjectName>John Doe</subjectName></suspiciousSubject>',
      '',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'suspiciousSubject')).toBe(true);
  });

  it('missing groundsForSuspicion -> error', () => {
    const xml = validSTR.replace(
      '<groundsForSuspicion>Unusual cash transaction patterns</groundsForSuspicion>',
      '',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'groundsForSuspicion')).toBe(true);
  });

  it('missing subjectName -> error', () => {
    const xml = validSTR.replace('<subjectName>John Doe</subjectName>', '');
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'subjectName')).toBe(true);
  });

  it('empty groundsForSuspicion -> error', () => {
    const xml = validSTR.replace(
      '<groundsForSuspicion>Unusual cash transaction patterns</groundsForSuspicion>',
      '<groundsForSuspicion></groundsForSuspicion>',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'groundsForSuspicion')).toBe(true);
  });

  it('invalid report ID -> error', () => {
    const xml = validSTR.replace('RPT-1234567890-abc123', 'INVALID-ID');
    const result = validateSTR(xml);
    expect(result.errors.some((e) => e.field === 'reportId')).toBe(true);
  });

  it('invalid date format (dd/mm/yyyy instead of yyyy-mm-dd) -> error', () => {
    const xml = validSTR.replace(
      '<transactionDate>2026-01-15</transactionDate>',
      '<transactionDate>15/01/2026</transactionDate>',
    );
    const result = validateSTR(xml);
    expect(result.errors.some((e) => e.field === 'date')).toBe(true);
  });

  it('tipping-off: "we have reported" -> error with Art.29 reference', () => {
    const xml = validSTR.replace(
      'Unusual cash transaction patterns',
      'we have reported this activity',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    const tippingError = result.errors.find((e) => e.message.includes('we have reported'));
    expect(tippingError).toBeDefined();
    expect(tippingError!.regulatory).toContain('Art.29');
  });

  it('tipping-off: "filed a report" -> error', () => {
    const xml = validSTR.replace(
      'Unusual cash transaction patterns',
      'We filed a report on this matter',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('filed a report'))).toBe(true);
  });

  it('tipping-off: "notified authorities" -> error', () => {
    const xml = validSTR.replace(
      'Unusual cash transaction patterns',
      'We notified authorities about this',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('notified authorities'))).toBe(true);
  });

  it('tipping-off: "str has been filed" -> error', () => {
    const xml = validSTR.replace(
      'Unusual cash transaction patterns',
      'An str has been filed for this case',
    );
    const result = validateSTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('str has been filed'))).toBe(true);
  });

  it('amount with 3 decimals -> warning', () => {
    const xml = validSTR.replace(
      '<transactionAmount>60000.00</transactionAmount>',
      '<transactionAmount>60000.123</transactionAmount>',
    );
    const result = validateSTR(xml);
    expect(result.warnings.some((w) => w.field === 'amount')).toBe(true);
  });
});

describe('validateCTR', () => {
  it('valid CTR passes', () => {
    const result = validateCTR(validCTR);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing cashTransaction -> error', () => {
    const xml = validCTR.replace('<cashTransaction>Details</cashTransaction>', '');
    const result = validateCTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cashTransaction')).toBe(true);
  });

  it('missing cashAmount -> error', () => {
    const xml = validCTR.replace('<cashAmount>55000.00</cashAmount>', '');
    const result = validateCTR(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cashAmount')).toBe(true);
  });

  it('amount below 55000 -> warning with threshold message', () => {
    const xml = validCTR.replace('<cashAmount>55000.00</cashAmount>', '<cashAmount>40000</cashAmount>');
    const result = validateCTR(xml);
    expect(result.warnings.some((w) => w.field === 'cashAmount' && w.message.includes('below'))).toBe(
      true,
    );
  });

  it('amount at exactly 55000 -> no warning', () => {
    const xml = validCTR.replace('<cashAmount>55000.00</cashAmount>', '<cashAmount>55000</cashAmount>');
    const result = validateCTR(xml);
    expect(result.warnings.filter((w) => w.field === 'cashAmount')).toHaveLength(0);
  });
});
