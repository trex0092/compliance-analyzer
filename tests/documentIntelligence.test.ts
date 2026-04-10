import { describe, it, expect } from 'vitest';
import {
  mockExtractor,
  extractDocument,
  runTamperChecks,
  detectDuplicateDocuments,
  type DocumentExtractionResult,
} from '@/services/documentIntelligence';

function mockBuffer(type: string, name: string, dob: string, docNum: string): Uint8Array {
  return new TextEncoder().encode(`MOCK:${type}:${name}:${dob}:${docNum}`);
}

describe('mockExtractor', () => {
  it('returns an empty result for non-MOCK input', async () => {
    const out = await mockExtractor.extract(new TextEncoder().encode('random bytes'));
    expect(out.fields).toHaveLength(0);
    expect(out.overallConfidence).toBe(0);
  });

  it('parses MOCK:passport:Name:DoB:DocNum', async () => {
    const buf = mockBuffer('passport', 'John Smith', '1980-01-01', 'P12345');
    const out = await mockExtractor.extract(buf);
    expect(out.documentType).toBe('passport');
    expect(out.identifiers.fullName).toBe('John Smith');
    expect(out.identifiers.dateOfBirth).toBe('1980-01-01');
    expect(out.identifiers.documentNumber).toBe('P12345');
  });

  it('reports high overall confidence on MOCK input', async () => {
    const buf = mockBuffer('passport', 'x', 'y', 'z');
    const out = await mockExtractor.extract(buf);
    expect(out.overallConfidence).toBeGreaterThan(0.9);
  });
});

describe('extractDocument (default mock)', () => {
  it('uses the mock extractor when no override is registered', async () => {
    const out = await extractDocument(mockBuffer('emirates_id', 'Alice', '1990-05-10', 'EID-1'));
    expect(out.documentType).toBe('emirates_id');
  });
});

describe('runTamperChecks', () => {
  const base: DocumentExtractionResult = {
    documentType: 'passport',
    fields: [],
    identifiers: {},
    tamperSignals: [],
    overallConfidence: 0.95,
  };

  it('flags expired documents', () => {
    const result = runTamperChecks(
      { ...base, identifiers: { expiryDate: '2020-01-01' } },
      '2026-04-10',
    );
    expect(result.tamperSignals.some((s) => s.kind === 'expiry_passed')).toBe(true);
  });

  it('does not flag documents expiring in the future', () => {
    const result = runTamperChecks(
      { ...base, identifiers: { expiryDate: '2099-01-01' } },
      '2026-04-10',
    );
    expect(result.tamperSignals.some((s) => s.kind === 'expiry_passed')).toBe(false);
  });

  it('flags issue dates in the future', () => {
    const result = runTamperChecks(
      { ...base, identifiers: { issueDate: '2099-01-01' } },
      '2026-04-10',
    );
    expect(result.tamperSignals.some((s) => s.kind === 'date_in_future')).toBe(true);
  });

  it('flags DoB in the future', () => {
    const result = runTamperChecks(
      { ...base, identifiers: { dateOfBirth: '2099-01-01' } },
      '2026-04-10',
    );
    expect(result.tamperSignals.some((s) => s.kind === 'date_in_future')).toBe(true);
  });

  it('flags low confidence extractions', () => {
    const result = runTamperChecks({ ...base, overallConfidence: 0.4 });
    expect(result.tamperSignals.some((s) => s.kind === 'unusual_resolution')).toBe(true);
  });

  it('does not flag clean high-confidence documents', () => {
    const result = runTamperChecks({
      ...base,
      identifiers: {
        expiryDate: '2099-01-01',
        issueDate: '2020-01-01',
        dateOfBirth: '1980-01-01',
      },
      overallConfidence: 0.98,
    });
    expect(result.tamperSignals).toHaveLength(0);
  });
});

describe('detectDuplicateDocuments', () => {
  it('flags a duplicate passport number', () => {
    const signal = detectDuplicateDocuments('P12345', ['P99999', 'P12345', 'P00000']);
    expect(signal).not.toBeNull();
    expect(signal?.kind).toBe('duplicate_document_id');
    expect(signal?.severity).toBe('high');
  });

  it('returns null for a unique document', () => {
    const signal = detectDuplicateDocuments('P12345', ['P99999', 'P00000']);
    expect(signal).toBeNull();
  });

  it('returns null for empty input', () => {
    const signal = detectDuplicateDocuments('', ['P99999']);
    expect(signal).toBeNull();
  });
});
