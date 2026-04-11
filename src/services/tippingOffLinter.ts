/**
 * Tipping-Off Linter — subsystem #39.
 *
 * FDL No.10/2025 Art.29 prohibits tipping off: no communication that
 * could reveal to the subject that a suspicious transaction report
 * has been filed, that their account is under review, or that they
 * are being screened against sanctions lists. Violating this is a
 * criminal offence with both individual and corporate penalties.
 *
 * This module scans a piece of outbound text (email, Asana comment,
 * case note, customer SMS) and flags phrases that could tip off the
 * subject. The default patterns cover the most common failure modes:
 *
 *   - Explicit filing mentions ("we filed an STR", "reported to FIU")
 *   - Screening mentions ("you matched a sanctions list")
 *   - Investigation status ("your account is under investigation")
 *   - Asset freeze mentions ("your funds are frozen")
 *   - Regulatory names to the subject ("MoE", "EOCN", "goAML")
 *
 * Pure-function, runs in <1ms on typical communications. Integration:
 * asanaSync.ts and webhook-receiver.ts should call this on every
 * outbound payload before dispatch.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.29 (no tipping off)
 *   - Cabinet Res 134/2025 Art.19 (internal review before disclosure)
 *   - FATF Rec 21 (tipping off prohibition)
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

interface TippingOffPattern {
  id: string;
  regex: RegExp;
  description: string;
  severity: 'critical' | 'high' | 'medium';
}

const PATTERNS: readonly TippingOffPattern[] = [
  // Critical — explicit STR / SAR / CTR filing mentions
  {
    id: 'TO-01',
    regex:
      /\b(filed|filing|submitted|reported)\s+(a|an|the)?\s*(str|sar|ctr|dpmsr|cnmr|suspicious\s+(transaction|activity)\s+report)\b/i,
    description: 'Explicit mention of filing an STR/SAR/CTR/DPMSR/CNMR',
    severity: 'critical',
  },
  {
    id: 'TO-02',
    regex:
      /\b(reported|disclosed)\s+to\s+(the\s+)?(fiu|financial\s+intelligence\s+unit|goaml|moe|ministry\s+of\s+economy)\b/i,
    description: 'Explicit mention of reporting to FIU / MoE / goAML',
    severity: 'critical',
  },
  {
    id: 'TO-03',
    regex:
      /\b(you|your\s+account|your\s+transaction)\s+.{0,30}\b(matched|flagged|hit)\s+.{0,30}\b(sanctions?|watchlist|blacklist|ofac|un\s+list)\b/i,
    description: 'Telling the subject they matched a sanctions list',
    severity: 'critical',
  },
  {
    id: 'TO-04',
    regex:
      /\b(your\s+(funds|account|assets)\s+(has\s+|have\s+)?been\s+frozen|asset\s+freeze\s+has\s+been\s+executed|we\s+have\s+frozen\s+your)\b/i,
    description: 'Telling the subject their assets have been frozen',
    severity: 'critical',
  },

  // High — investigation / review language
  {
    id: 'TO-05',
    regex:
      /\b(your\s+account|your\s+activity)\s+(is|has\s+been)\s+(under|undergoing)\s+(investigation|review|scrutiny)\b/i,
    description: 'Telling the subject they are under investigation',
    severity: 'high',
  },
  {
    id: 'TO-06',
    regex:
      /\b(compliance\s+(officer|team)|mlro|aml\s+team)\s+.{0,30}\b(reviewing|investigating|looking\s+at)\s+.{0,30}\b(your|you)\b/i,
    description: 'Telling the subject the compliance team is reviewing them',
    severity: 'high',
  },
  {
    id: 'TO-07',
    regex:
      /\b(anti[- ]money[- ]laundering|aml|cft|counter[- ]terrorism[- ]financing)\s+.{0,30}\b(concerns?|suspicious?|alerts?|red[ -]?flags?)\b/i,
    description: 'AML/CFT language paired with concerns/suspicion',
    severity: 'high',
  },

  // Medium — risky but context-dependent
  {
    id: 'TO-08',
    regex: /\b(you\s+are\s+(on|in)\s+(a|our)\s+(watchlist|sanctions|blocklist|blacklist))\b/i,
    description: 'Explicit watchlist disclosure to subject',
    severity: 'critical',
  },
  {
    id: 'TO-09',
    regex:
      /\b(cannot|unable\s+to)\s+.{0,30}\b(process|complete)\s+.{0,30}\b(sanctions?|aml|compliance\s+(reasons?|concerns?))\b/i,
    description: 'Blaming sanctions / AML / compliance directly',
    severity: 'medium',
  },
  {
    id: 'TO-10',
    regex:
      /\b(eocn|executive\s+office\s+of\s+control|financial\s+intelligence\s+unit|goaml|str[- ]filing)\b/i,
    description: 'Naming a regulator or reporting system to the subject',
    severity: 'high',
  },
];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TippingOffFinding {
  patternId: string;
  description: string;
  severity: TippingOffPattern['severity'];
  matchedText: string;
}

export interface TippingOffReport {
  clean: boolean;
  findings: TippingOffFinding[];
  topSeverity: 'critical' | 'high' | 'medium' | 'none';
  narrative: string;
}

// ---------------------------------------------------------------------------
// Linter
// ---------------------------------------------------------------------------

export function lintForTippingOff(text: string): TippingOffReport {
  const findings: TippingOffFinding[] = [];

  for (const pattern of PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      findings.push({
        patternId: pattern.id,
        description: pattern.description,
        severity: pattern.severity,
        matchedText: match[0],
      });
    }
  }

  const topSeverity: TippingOffReport['topSeverity'] = findings.some(
    (f) => f.severity === 'critical'
  )
    ? 'critical'
    : findings.some((f) => f.severity === 'high')
      ? 'high'
      : findings.some((f) => f.severity === 'medium')
        ? 'medium'
        : 'none';

  const clean = findings.length === 0;
  const narrative = clean
    ? 'Tipping-off linter: clean. No prohibited phrases detected.'
    : `Tipping-off linter: ${findings.length} pattern(s) matched, top severity ${topSeverity}. ` +
      `Blocking outbound message per FDL No.10/2025 Art.29.`;

  return { clean, findings, topSeverity, narrative };
}

/**
 * Assertion helper — throws if the linter flags anything critical.
 * Use in hot paths where tipping off would be catastrophic (customer
 * notification emails, Asana comments visible to external users).
 */
export function assertNoTippingOff(text: string): void {
  const report = lintForTippingOff(text);
  if (report.topSeverity === 'critical' || report.topSeverity === 'high') {
    throw new Error(
      `Tipping-off linter blocked outbound text: ${report.findings
        .map((f) => `${f.patternId} (${f.severity})`)
        .join(', ')} — FDL Art.29`
    );
  }
}
