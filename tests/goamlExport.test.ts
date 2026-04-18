/**
 * Tests for src/services/goamlExport.ts — UAE FIU goAML XML builder.
 *
 * Not a full XSD validator (that's in goamlValidator.ts) — here we
 * just verify the basic shape, XML escaping, and that citations +
 * transactions make it into the output.
 */
import { describe, it, expect } from 'vitest';
import { toGoamlXml, type GoamlReport } from '@/services/goamlExport';

const BASE: GoamlReport = {
  reportType: 'STR',
  reportRef: 'REF-001',
  submittedAt: '2026-04-18',
  reporter: {
    orgName: 'Hawkeye Sterling DMCC',
    licenceNumber: 'DMCC-12345',
    reporterName: 'Luisa Fernanda',
    reporterEmail: 'luisa@example.test',
  },
  subject: {
    subjectId: 'subj-1',
    firstName: 'Ali',
    lastName: 'Hassan',
    nationality: 'AE',
    passportNumber: 'P1234567',
  },
  reasonForSuspicion: 'Structuring of cash deposits below reporting threshold.',
  citations: ['FDL No.10/2025 Art.26-27', 'Cabinet Res 74/2020 Art.4-7'],
};

describe('goamlExport.toGoamlXml', () => {
  it('produces a well-formed XML preamble and root element', () => {
    const xml = toGoamlXml(BASE);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<report>');
    expect(xml).toContain('</report>');
  });

  it('escapes XML special characters in user-supplied fields', () => {
    const dangerous = {
      ...BASE,
      reasonForSuspicion: 'Client said "I <will> & evade tax".',
    };
    const xml = toGoamlXml(dangerous);
    expect(xml).not.toContain('<will>');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&lt;will&gt;');
    expect(xml).toContain('&amp;');
  });

  it('emits report_indiv_person when firstName/lastName present', () => {
    const xml = toGoamlXml(BASE);
    expect(xml).toContain('<report_indiv_person>');
    expect(xml).toContain('<first_name>Ali</first_name>');
    expect(xml).toContain('<last_name>Hassan</last_name>');
  });

  it('emits report_entity when no firstName/lastName but entityName is set', () => {
    const entityReport: GoamlReport = {
      ...BASE,
      subject: {
        subjectId: 'ent-1',
        entityName: 'Dubai Gold Trader LLC',
        idNumber: 'CR-998877',
      },
    };
    const xml = toGoamlXml(entityReport);
    expect(xml).toContain('<report_entity>');
    expect(xml).toContain('<name>Dubai Gold Trader LLC</name>');
    expect(xml).toContain('<incorporation_number>CR-998877</incorporation_number>');
  });

  it('embeds the report reference and submission metadata', () => {
    const xml = toGoamlXml(BASE);
    expect(xml).toContain('<entity_reference>REF-001</entity_reference>');
    expect(xml).toContain('<report_code>STR</report_code>');
    expect(xml).toContain('<rentity_id>DMCC-12345</rentity_id>');
  });

  it('renders every citation inside a <citations> block', () => {
    const xml = toGoamlXml(BASE);
    expect(xml).toContain('<citations>');
    for (const c of BASE.citations) {
      expect(xml).toContain(`<citation>${c}</citation>`);
    }
  });

  it('renders a transactions block when transactions are supplied', () => {
    const withTx: GoamlReport = {
      ...BASE,
      transactions: [
        {
          transactionId: 'TX-1',
          date: '2026-04-10',
          amount: 99_000,
          currency: 'AED',
          description: 'Cash deposit',
        },
      ],
    };
    const xml = toGoamlXml(withTx);
    expect(xml).toContain('<transactions>');
    expect(xml).toContain('<transactionnumber>TX-1</transactionnumber>');
    expect(xml).toContain('<amount_local>99000</amount_local>');
  });
});
