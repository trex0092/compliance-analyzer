import { describe, it, expect } from 'vitest';
import { buildIndex, search, tokenise, type Document } from '@/services/semanticSearch';

const corpus: Document[] = [
  {
    id: 'FDL-26',
    title: 'FDL Article 26 — STR filing',
    body: 'Reporting entities must file a Suspicious Transaction Report within 10 business days of detection. Failure to file constitutes a violation under FDL No.10/2025.',
    regulatoryRef: 'FDL Art.26',
  },
  {
    id: 'CABRES-74-4',
    title: 'Cabinet Resolution 74/2020 Article 4 — Asset freeze',
    body: 'Upon confirmation of a sanctions list match, entities must freeze all assets of the listed party within 24 hours. The freeze must be reported to EOCN.',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
  },
  {
    id: 'MOE-08',
    title: 'MoE Circular 08 — DPMS cash thresholds',
    body: 'Dealers in precious metals and stones must report any cash transaction at or above AED 55,000 via the goAML portal within 15 business days.',
    regulatoryRef: 'MoE Circular 08/AML/2021',
  },
  {
    id: 'FATF-DPMS-2022',
    title: 'FATF DPMS Typologies 2022',
    body: 'Structuring below cash reporting thresholds is a red flag for money laundering in the precious metals sector. Structuring involves splitting transactions to avoid detection.',
    tags: ['typology'],
  },
];

describe('semanticSearch — tokenisation', () => {
  it('removes stopwords and short tokens', () => {
    const tokens = tokenise('The quick brown fox jumps over a lazy dog');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('a');
    expect(tokens).toContain('quick');
  });

  it('strips diacritics and punctuation', () => {
    const tokens = tokenise('Façade, co-operation!');
    expect(tokens).toContain('facade');
    expect(tokens).toContain('co-operation');
  });
});

describe('semanticSearch — index + retrieval', () => {
  const index = buildIndex(corpus);

  it('retrieves the most relevant doc for "suspicious transaction"', () => {
    const results = search(index, 'file suspicious transaction report', { topK: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc.id).toBe('FDL-26');
  });

  it('retrieves the freeze article for "freeze sanctions"', () => {
    const results = search(index, 'freeze sanctioned assets within 24 hours', { topK: 3 });
    expect(results[0].doc.id).toBe('CABRES-74-4');
  });

  it('retrieves the DPMS circular for "cash threshold"', () => {
    const results = search(index, 'cash AED 55000 dealers goAML portal', { topK: 3 });
    expect(results[0].doc.id).toBe('MOE-08');
  });

  it('retrieves the typology for "structuring"', () => {
    const results = search(index, 'structuring below thresholds precious metals', { topK: 3 });
    expect(results[0].doc.id).toBe('FATF-DPMS-2022');
  });

  it('returns matched terms and a snippet', () => {
    const results = search(index, 'cash threshold', { topK: 1 });
    expect(results[0].matchedTerms.length).toBeGreaterThan(0);
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  it('empty query returns no results', () => {
    expect(search(index, '')).toEqual([]);
  });

  it('respects topK and minScore', () => {
    const results = search(index, 'suspicious report', { topK: 2, minScore: 0.01 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('semanticSearch — index stats', () => {
  const index = buildIndex(corpus);
  it('vocabularySize > 0', () => {
    expect(index.vocabularySize).toBeGreaterThan(10);
  });
  it('IDF assigned to every term', () => {
    for (const [, v] of index.idf) expect(v).toBeGreaterThan(0);
  });
});
