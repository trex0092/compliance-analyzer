import { describe, expect, it } from 'vitest';
import { validateGoamlSchema } from '@/utils/goamlSchemaValidator';

const VALID_STR = `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>RPT-001</reportId>
    <reportType>STR</reportType>
    <reportDate>2026-04-13</reportDate>
    <reportingCountry>AE</reportingCountry>
    <currency>AED</currency>
  </reportHeader>
  <reportingEntity>
    <entityName>Acme DPMS LLC</entityName>
    <country>AE</country>
  </reportingEntity>
  <suspiciousSubject>
    <subjectType>INDIVIDUAL</subjectType>
    <fullName>John Doe</fullName>
  </suspiciousSubject>
  <transactionDetails>
    <transactionDate>2026-04-12</transactionDate>
    <transactionType>PURCHASE</transactionType>
    <amount>60000.00</amount>
    <currency>AED</currency>
  </transactionDetails>
  <groundsForSuspicion>
    <narrativeDescription>Multiple cash transactions just below the AED 55,000 threshold over a 14-day window.</narrativeDescription>
  </groundsForSuspicion>
</goAMLReport>`;

const VALID_CTR = `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>RPT-002</reportId>
    <reportType>CTR</reportType>
    <reportDate>2026-04-13</reportDate>
    <reportingCountry>AE</reportingCountry>
    <currency>AED</currency>
  </reportHeader>
  <reportingEntity>
    <entityName>Acme DPMS LLC</entityName>
    <country>AE</country>
  </reportingEntity>
  <cashTransaction>
    <transactionDate>2026-04-12</transactionDate>
    <cashAmount>56000.00</cashAmount>
    <currency>AED</currency>
  </cashTransaction>
</goAMLReport>`;

describe('validateGoamlSchema', () => {
  it('accepts a well-formed STR with all required elements', () => {
    const result = validateGoamlSchema(VALID_STR, 'STR');
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a well-formed CTR with cashTransaction', () => {
    const result = validateGoamlSchema(VALID_CTR, 'CTR');
    expect(result.valid).toBe(true);
  });

  it('rejects malformed XML with PARSE_FAILED issues', () => {
    const malformed = '<goAMLReport><reportHeader><reportId>missing-close</reportHeader>';
    const result = validateGoamlSchema(malformed, 'STR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'PARSE_FAILED')).toBe(true);
  });

  it('rejects an STR missing the required suspiciousSubject block', () => {
    const xml = VALID_STR.replace(
      /<suspiciousSubject>[\s\S]*?<\/suspiciousSubject>/,
      ''
    );
    const result = validateGoamlSchema(xml, 'STR');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === 'MISSING_REQUIRED' && i.message.includes('suspiciousSubject')
      )
    ).toBe(true);
  });

  it('rejects a CTR with a malformed transactionDate', () => {
    const xml = VALID_CTR.replace('<transactionDate>2026-04-12</transactionDate>', '<transactionDate>13/04/2026</transactionDate>');
    const result = validateGoamlSchema(xml, 'CTR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'BAD_DATE')).toBe(true);
  });

  it('rejects a CTR with a non-positive cashAmount', () => {
    const xml = VALID_CTR.replace('<cashAmount>56000.00</cashAmount>', '<cashAmount>not-a-number</cashAmount>');
    const result = validateGoamlSchema(xml, 'CTR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'BAD_DECIMAL')).toBe(true);
  });

  it('rejects a CTR with currency that is not 3 uppercase letters', () => {
    const xml = VALID_CTR.replace(/<currency>AED<\/currency>/g, '<currency>aed</currency>');
    const result = validateGoamlSchema(xml, 'CTR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'BAD_PATTERN')).toBe(true);
  });

  it('catches a tipping-off phrase hidden inside a CDATA section', () => {
    const xml = VALID_STR.replace(
      '<narrativeDescription>Multiple cash transactions just below the AED 55,000 threshold over a 14-day window.</narrativeDescription>',
      '<narrativeDescription><![CDATA[We have reported this customer to the FIU already.]]></narrativeDescription>'
    );
    const result = validateGoamlSchema(xml, 'STR');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === 'TIPPING_OFF' && /reported/i.test(i.message)
      )
    ).toBe(true);
  });

  it('catches a tipping-off phrase hidden inside an attribute value', () => {
    const xml = VALID_STR.replace(
      '<reportingEntity>',
      '<reportingEntity contactNote="we have reported this customer">'
    );
    const result = validateGoamlSchema(xml, 'STR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TIPPING_OFF')).toBe(true);
  });

  it('rejects a wrong root element', () => {
    const xml = '<wrongRoot><reportHeader></reportHeader></wrongRoot>';
    const result = validateGoamlSchema(xml, 'STR');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'BAD_ROOT')).toBe(true);
  });
});
