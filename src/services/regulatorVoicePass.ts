/**
 * Regulator Voice Pass — "how would an MoE inspector read this?"
 *
 * Phase 2 weaponization subsystem #23.
 *
 * After the brain has committed to a verdict, the regulator voice pass
 * asks the question an MoE / MLRO / LBMA inspector would ask when they
 * review the case file three months later. If the brain's narrative
 * cannot answer any of those questions, the case is escalated to human
 * review so the MLRO can complete the record.
 *
 * This is a static rule-based checker — it doesn't call an LLM. The
 * question list is derived from MoE Circular 08/AML/2021 (DPMS
 * inspection manual) and the LBMA Responsible Gold Guidance annual
 * audit rubric.
 *
 * Regulatory basis:
 *   - MoE Circular 08/AML/2021 (DPMS inspection, quarterly reports)
 *   - LBMA Responsible Gold Guidance v9 (5-step framework annual audit)
 *   - FDL No.10/2025 Art.20-21 (documented reasoning)
 */

import type { Verdict } from './teacherStudent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegulatorVoiceInput {
  verdict: Verdict;
  narrative: string;
  /** Whether the case file contains each of these pieces of evidence. */
  evidence: {
    hasSanctionsScreen?: boolean;
    hasUboAnalysis?: boolean;
    hasTransactionRecord?: boolean;
    hasStrNarrative?: boolean;
    hasAuditChain?: boolean;
    hasFourEyesApproval?: boolean;
    hasRegulatoryCitation?: boolean;
  };
}

export interface RegulatorQuestion {
  id: string;
  question: string;
  /** Which regulation the question is drawn from. */
  citation: string;
  /** Whether the evidence answers the question. */
  answered: boolean;
}

export interface RegulatorVoiceReport {
  questions: RegulatorQuestion[];
  /** Count of unanswered questions. */
  unansweredCount: number;
  /** True if at least one question is unanswered. */
  hasGaps: boolean;
  /** Human-readable narrative for the audit file. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Inspector question bank
// ---------------------------------------------------------------------------

const INSPECTOR_QUESTIONS: ReadonlyArray<{
  id: string;
  question: string;
  citation: string;
  requires: keyof RegulatorVoiceInput['evidence'];
  appliesTo: Verdict[];
}> = [
  {
    id: 'Q1',
    question: 'Did you screen against ALL sanctions lists (UN, OFAC, EU, UK, UAE, EOCN)?',
    citation: 'FATF Rec 6, FDL Art.35',
    requires: 'hasSanctionsScreen',
    appliesTo: ['pass', 'flag', 'escalate', 'freeze'],
  },
  {
    id: 'Q2',
    question: 'Did you analyse the full UBO chain including undisclosed portions?',
    citation: 'Cabinet Decision 109/2023, FATF Rec 10',
    requires: 'hasUboAnalysis',
    appliesTo: ['flag', 'escalate', 'freeze'],
  },
  {
    id: 'Q3',
    question: 'Did you review the transaction record for structuring / velocity / fan-in/out?',
    citation: 'MoE Circular 08/AML/2021',
    requires: 'hasTransactionRecord',
    appliesTo: ['flag', 'escalate', 'freeze'],
  },
  {
    id: 'Q4',
    question: 'Is the STR/SAR narrative present and non-boilerplate?',
    citation: 'FDL No.10/2025 Art.26-27',
    requires: 'hasStrNarrative',
    appliesTo: ['escalate', 'freeze'],
  },
  {
    id: 'Q5',
    question: 'Is the audit chain sealed and tamper-evident?',
    citation: 'FDL No.10/2025 Art.24 (5yr retention)',
    requires: 'hasAuditChain',
    appliesTo: ['pass', 'flag', 'escalate', 'freeze'],
  },
  {
    id: 'Q6',
    question: 'Has the four-eyes approval been recorded for this high-risk decision?',
    citation: 'Cabinet Res 134/2025 Art.19',
    requires: 'hasFourEyesApproval',
    appliesTo: ['escalate', 'freeze'],
  },
  {
    id: 'Q7',
    question: 'Does the decision cite the specific article / circular that justifies it?',
    citation: 'FDL Art.20-21',
    requires: 'hasRegulatoryCitation',
    appliesTo: ['flag', 'escalate', 'freeze'],
  },
];

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export function runRegulatorVoicePass(input: RegulatorVoiceInput): RegulatorVoiceReport {
  const applicable = INSPECTOR_QUESTIONS.filter((q) => q.appliesTo.includes(input.verdict));

  const questions: RegulatorQuestion[] = applicable.map((q) => ({
    id: q.id,
    question: q.question,
    citation: q.citation,
    answered: Boolean(input.evidence[q.requires]),
  }));

  const unansweredCount = questions.filter((q) => !q.answered).length;
  const hasGaps = unansweredCount > 0;

  const narrative = hasGaps
    ? `Regulator voice pass: ${unansweredCount}/${questions.length} questions unanswered.\n` +
      questions
        .filter((q) => !q.answered)
        .map((q) => `  - [${q.id}] ${q.question} (${q.citation})`)
        .join('\n')
    : `Regulator voice pass: all ${questions.length} inspector questions answered.`;

  return { questions, unansweredCount, hasGaps, narrative };
}
