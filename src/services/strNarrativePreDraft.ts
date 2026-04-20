/**
 * STR Narrative Pre-Draft — produces an FIU-ready narrative paragraph
 * for every ALERT-severity risk-alert task so the MLRO starts the
 * /goaml filing from a citation-ready draft instead of a blank page.
 *
 * The draft is NEVER auto-filed — it is appended to the Asana task
 * body with a prominent "DRAFT — MLRO MUST REVIEW" banner. goAML
 * submission still routes through the usual four-eyes gate.
 *
 * Design:
 *   - Composed of short, deterministic sentences so auditors can
 *     diff the draft against the final filing.
 *   - No speculation beyond the observed facts (date/jurisdiction/
 *     match/score/pin status). No prose about intent or purpose.
 *   - Cites FDL and Cabinet Res in situ so the MLRO can copy the
 *     paragraph verbatim into the FIU text field.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.26    STR obligation
 *   FDL No.10/2025 Art.27    filing deadline (10 business days)
 *   FDL No.10/2025 Art.29    NO tipping off — draft must not
 *                            imply the subject has been informed
 *   Cabinet Res 74/2020 Art.6  CNMR companion filing (5 business days)
 *   MoE Circular 08/AML/2021  DPMS sector narrative style
 */

import type { WatchlistEntry } from './screeningWatchlist';
import type { RiskAlertMatch, RiskAlertScore } from './riskAlertTemplate';
import type { CalibratedIdentityScore } from './identityScoreBayesian';
import type { SubjectCorroboration } from './multiListCorroboration';
import {
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
} from '../domain/constants';

export interface StrNarrativeInput {
  subject: WatchlistEntry;
  match: RiskAlertMatch;
  score: RiskAlertScore;
  calibrated: CalibratedIdentityScore;
  corroboration: SubjectCorroboration;
  /** ISO timestamp of the alert. */
  generatedAtIso: string;
  /** Cron / run identifier for audit trail. */
  runId: string;
}

export interface StrNarrativeDraft {
  /** The draft paragraph, ready to paste into goAML. */
  paragraph: string;
  /** Short bullet list of the facts cited — for MLRO cross-check. */
  factList: readonly string[];
  /** Deadline reminder the MLRO must meet. */
  filingDeadline: {
    strBusinessDays: number;
    cnmrBusinessDays: number;
  };
}

/**
 * Produce the narrative. Every sentence is deterministic given the
 * inputs — the same subject + match always produces the same draft
 * so the audit trail is stable across re-runs.
 */
export function buildStrNarrativeDraft(input: StrNarrativeInput): StrNarrativeDraft {
  const { subject, match, score, calibrated, corroboration, generatedAtIso } = input;
  const dateStr = generatedAtIso.slice(0, 10); // YYYY-MM-DD
  const pctStr = `${(calibrated.probability * 100).toFixed(1)}%`;
  const compositeStr = score.composite.toFixed(2);
  const ridPin = subject.resolvedIdentity?.listEntryRef;
  const pinFragment = ridPin
    ? `The subject was previously pinned by the MLRO to ${ridPin.list}/${ridPin.reference}.`
    : 'The subject has not been pinned to a specific designation; identification is based on observed identifiers.';

  const corroFragment =
    corroboration.lists.length >= 2
      ? `The same subject is concurrently flagged on ${corroboration.lists.length} sanctions lists (${corroboration.lists.join(', ')}) within the current monitoring window, materially strengthening the match.`
      : `The match was produced against the ${match.list} designation ${match.reference}.`;

  const identityFragment = buildIdentityFragment(subject, match);
  const contradictionFragment =
    calibrated.contradictions.length > 0
      ? `Note for reviewer: the following identifiers were observed on both sides but did not agree — ${calibrated.contradictions.join(', ')}. This does not block filing but should be investigated.`
      : '';

  const paragraph = [
    `On ${dateStr}, automated transaction-monitoring identified a potential sanctions match for customer ${subject.subjectName} (internal id ${subject.id}, risk tier ${subject.riskTier}) against list ${match.list} entry ${match.reference} ("${match.entryName}").`,
    identityFragment,
    pinFragment,
    corroFragment,
    `The composite identity-match score is ${compositeStr} (classification: ${score.classification}) with a calibrated posterior probability of ${pctStr} that this hit is the same natural or legal person as the customer.`,
    contradictionFragment,
    `Filing this STR is required under FDL No.10/2025 Art.26-27. A concurrent freeze/CNMR workflow is required under Cabinet Res 74/2020 Art.4-7. The subject has NOT been notified and MUST NOT be notified (FDL No.10/2025 Art.29 — no tipping off).`,
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  const factList: string[] = [
    `Event date: ${dateStr}`,
    `Customer: ${subject.subjectName} (id ${subject.id})`,
    `Risk tier: ${subject.riskTier}`,
    `List: ${match.list}`,
    `List reference: ${match.reference}`,
    `List entry name: ${match.entryName}`,
    `Composite score: ${compositeStr}`,
    `Classification: ${score.classification}`,
    `Calibrated probability: ${pctStr}`,
    `Pin status: ${ridPin ? `pinned to ${ridPin.list}/${ridPin.reference}` : 'unresolved'}`,
    `Lists corroborating: ${corroboration.lists.length > 0 ? corroboration.lists.join(', ') : match.list}`,
  ];

  if (calibrated.contradictions.length > 0) {
    factList.push(`Contradictions: ${calibrated.contradictions.join(', ')}`);
  }
  if (match.listedOn) factList.push(`Listed on: ${match.listedOn}`);
  if (match.reason) factList.push(`Listing reason: ${match.reason}`);

  return {
    paragraph,
    factList,
    filingDeadline: {
      strBusinessDays: STR_FILING_DEADLINE_BUSINESS_DAYS,
      cnmrBusinessDays: CNMR_FILING_DEADLINE_BUSINESS_DAYS,
    },
  };
}

function buildIdentityFragment(subject: WatchlistEntry, match: RiskAlertMatch): string {
  const rid = subject.resolvedIdentity;
  const facts: string[] = [];
  if (rid?.dob) facts.push(`subject DoB ${rid.dob}`);
  if (rid?.nationality) facts.push(`subject nationality ${rid.nationality}`);
  if (rid?.idNumber) {
    const typ = rid.idType ?? 'id';
    facts.push(`subject ${typ} ${rid.idNumber}`);
  }
  const hitFacts: string[] = [];
  if (match.entryDob) hitFacts.push(`list DoB ${match.entryDob}`);
  if (match.entryNationality) hitFacts.push(`list nationality ${match.entryNationality}`);
  if (match.entryId) hitFacts.push(`list id ${match.entryId}`);
  if (facts.length === 0 && hitFacts.length === 0) return '';
  return `Identity comparison used the following identifiers: ${[...facts, ...hitFacts].join('; ')}.`;
}
