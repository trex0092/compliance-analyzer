import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeCompliance, getAuditTrail, _resetRateLimit } from '../src/services/geminiComplianceAnalyzer';
import type { ComplianceAnalysisRequest } from '../src/services/geminiComplianceAnalyzer';

function makeRequest(overrides: Partial<ComplianceAnalysisRequest> = {}): ComplianceAnalysisRequest {
  return {
    text: 'All cash transactions above AED 55,000 must be reported via goAML within 15 business days.',
    analysisType: 'regulation-review',
    ...overrides,
  };
}

function mockGeminiResponse(body: Record<string, unknown> = {}) {
  const defaultBody = {
    issues: [],
    summary: 'No issues found.',
    overallRiskLevel: 'low',
    regulatoryReferences: [],
    ...body,
  };
  return {
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify(defaultBody) }],
      },
    }],
  };
}

describe('geminiComplianceAnalyzer', () => {
  beforeEach(() => {
    _resetRateLimit();
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-api-key-for-unit-tests');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('rejects empty text', async () => {
      await expect(analyzeCompliance(makeRequest({ text: '' }))).rejects.toThrow('Validation error');
    });

    it('rejects text exceeding max length', async () => {
      const longText = 'x'.repeat(50_001);
      await expect(analyzeCompliance(makeRequest({ text: longText }))).rejects.toThrow('maximum length');
    });

    it('rejects invalid analysis type', async () => {
      await expect(
        analyzeCompliance(makeRequest({ analysisType: 'invalid' as any }))
      ).rejects.toThrow('Invalid analysis type');
    });

    it('rejects entity name exceeding 500 chars', async () => {
      await expect(
        analyzeCompliance(makeRequest({ entityName: 'x'.repeat(501) }))
      ).rejects.toThrow('Entity name');
    });
  });

  describe('API key requirement', () => {
    it('throws if GOOGLE_AI_API_KEY is not set', async () => {
      vi.stubEnv('GOOGLE_AI_API_KEY', '');
      await expect(analyzeCompliance(makeRequest())).rejects.toThrow('GOOGLE_AI_API_KEY');
    });
  });

  describe('successful analysis', () => {
    it('returns structured result from Gemini response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockGeminiResponse({
          issues: [
            {
              severity: 'high',
              category: 'Threshold',
              description: 'Cash threshold matches AED 55,000 requirement.',
              regulatoryRef: 'MoE Circular 08/AML/2021',
              recommendation: 'No action needed — threshold is correct.',
            },
          ],
          summary: 'Policy text is compliant with minor recommendations.',
          overallRiskLevel: 'low',
          regulatoryReferences: ['MoE Circular 08/AML/2021', 'FDL No.10/2025 Art.16'],
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await analyzeCompliance(makeRequest(), 'test-analyst');

      expect(result.analysisId).toMatch(/^GCA-/);
      expect(result.analysisType).toBe('regulation-review');
      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('high');
      expect(result.overallRiskLevel).toBe('low');
      expect(result.regulatoryReferences).toContain('MoE Circular 08/AML/2021');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);

      fetchSpy.mockRestore();
    });

    it('sends correct request body to Gemini API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockGeminiResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await analyzeCompliance(makeRequest());

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];

      // URL should include model and API key
      expect(url).toContain('gemini-2.5-flash');
      expect(url).toContain('key=test-api-key-for-unit-tests');

      // Body should have correct structure
      const body = JSON.parse(options!.body as string);
      expect(body.systemInstruction).toBeDefined();
      expect(body.contents).toHaveLength(1);
      expect(body.generationConfig.temperature).toBe(0.1);
      expect(body.generationConfig.responseMimeType).toBe('application/json');

      fetchSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('handles Gemini API errors gracefully', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"error": {"message": "Invalid API key"}}', { status: 401 })
      );

      await expect(analyzeCompliance(makeRequest())).rejects.toThrow('Gemini API returned 401');

      fetchSpy.mockRestore();
    });

    it('handles malformed JSON from Gemini', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: 'This is not JSON but a plain text analysis of the regulation.',
              }],
            },
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await analyzeCompliance(makeRequest());

      // Should return a parse-error issue rather than crashing
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].category).toBe('Parse Error');

      fetchSpy.mockRestore();
    });
  });

  describe('rate limiting', () => {
    it('enforces rate limit after max requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(JSON.stringify(mockGeminiResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Fire 10 requests (the rate limit max) — all should succeed
      const requests = Array.from({ length: 10 }, () =>
        analyzeCompliance(makeRequest())
      );
      await Promise.all(requests);

      // The 11th request should be rate-limited
      await expect(analyzeCompliance(makeRequest())).rejects.toThrow('Rate limit exceeded');

      fetchSpy.mockRestore();
    });
  });
});
