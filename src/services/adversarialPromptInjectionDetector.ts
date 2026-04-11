/**
 * Adversarial Prompt Injection Detector — subsystem #68 (Phase 7 Cluster H).
 *
 * Phase 6 shipped `advisorHallucinationDetector` to guard the Opus
 * advisor's OUTPUTS. This module guards its INPUTS: scans user-
 * submitted strings (adverse media text, STR narratives, Asana
 * comments, customer names, transaction memos) for prompt-injection
 * payloads before they reach the advisor.
 *
 * Heuristics:
 *   - Obvious injection markers ("ignore previous instructions",
 *     "you are now", "system prompt", "override", "jailbreak")
 *   - Role-switching attempts ("assistant:", "<system>", "</system>")
 *   - Hidden unicode tricks (zero-width joiners, bidi overrides)
 *   - Excessive repetition (100+ of the same character)
 *   - Encoded payloads (base64 with suspicious length)
 *
 * Returns findings with severity. Callers MAY reject the input
 * (critical findings should be rejected) or sanitise + proceed
 * (medium findings are logged for analyst review).
 *
 * Regulatory basis:
 *   - NIST AI RMF GV-1.6 (security testing for AI systems)
 *   - EU AI Act Art.15 (cybersecurity)
 *   - FDL No.10/2025 Art.20 (CO duty of care — uncompromised reasoning)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectionFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  matchedText?: string;
}

export interface InjectionReport {
  clean: boolean;
  findings: InjectionFinding[];
  topSeverity: 'critical' | 'high' | 'medium' | 'none';
  sanitised: string;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

interface Pattern {
  id: string;
  regex: RegExp;
  severity: InjectionFinding['severity'];
  description: string;
}

const PATTERNS: readonly Pattern[] = [
  {
    id: 'PI-01',
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompt|system)/i,
    severity: 'critical',
    description: 'Classic "ignore previous instructions" override attempt',
  },
  {
    id: 'PI-02',
    regex: /you\s+are\s+now\s+(?!an?\s+(customer|subject|entity|legal))/i,
    severity: 'high',
    description: 'Role-switching attempt ("you are now X")',
  },
  {
    id: 'PI-03',
    regex: /(system\s+prompt|new\s+system\s+message|system:\s*override)/i,
    severity: 'critical',
    description: 'System prompt tampering attempt',
  },
  {
    id: 'PI-04',
    regex: /(?:<\/?(system|assistant|user)>|\[(system|assistant|user)\])/i,
    severity: 'high',
    description: 'Role tag injection',
  },
  {
    id: 'PI-05',
    regex: /\bjailbreak\b/i,
    severity: 'high',
    description: 'Explicit jailbreak mention',
  },
  {
    id: 'PI-06',
    regex: /\b(pretend|roleplay|act\s+as)\s+(you\s+are|if)\b/i,
    severity: 'medium',
    description: 'Roleplay redirection attempt',
  },
  {
    id: 'PI-07',
    regex: /developer\s+mode/i,
    severity: 'high',
    description: 'Developer-mode override attempt',
  },
  {
    id: 'PI-08',
    regex: /[\u200b-\u200f\u202a-\u202e]{2,}/,
    severity: 'high',
    description: 'Hidden zero-width / bidi unicode characters',
  },
  {
    id: 'PI-09',
    regex: /(.)\1{99,}/,
    severity: 'medium',
    description: 'Excessive character repetition (denial of reasoning)',
  },
  {
    id: 'PI-10',
    regex: /\b([A-Za-z0-9+/]{200,}={0,2})\b/,
    severity: 'medium',
    description: 'Large base64-looking payload',
  },
];

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectPromptInjection(input: string): InjectionReport {
  const findings: InjectionFinding[] = [];

  for (const pattern of PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      findings.push({
        id: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
        matchedText: match[0].slice(0, 80),
      });
    }
  }

  const topSeverity: InjectionReport['topSeverity'] = findings.some((f) => f.severity === 'critical')
    ? 'critical'
    : findings.some((f) => f.severity === 'high')
    ? 'high'
    : findings.some((f) => f.severity === 'medium')
    ? 'medium'
    : 'none';

  // Sanitise: strip zero-width / bidi unicode, collapse mega repetition.
  const sanitised = input
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/(.)\1{50,}/g, '$1$1$1')
    .trim();

  const clean = findings.length === 0;
  const narrative = clean
    ? 'Adversarial prompt injection detector: clean input.'
    : `Adversarial prompt injection detector: ${findings.length} finding(s), top severity ${topSeverity}. ` +
      `Critical findings should reject the input before it reaches the advisor.`;

  return { clean, findings, topSeverity, sanitised, narrative };
}

/**
 * Assertion helper. Throws if the input contains critical injection
 * payloads. Use at advisor input boundaries.
 */
export function assertNoPromptInjection(input: string): void {
  const report = detectPromptInjection(input);
  if (report.topSeverity === 'critical') {
    throw new Error(
      `Prompt injection blocked: ${report.findings
        .filter((f) => f.severity === 'critical')
        .map((f) => f.id)
        .join(', ')}`
    );
  }
}
