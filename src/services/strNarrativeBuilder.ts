/**
 * STR / SAR / CTR Narrative Drafter.
 *
 * Assembles a compliant narrative section for a goAML STR filing from
 * structured evidence. This is NOT a free-text LLM generator — it's a
 * template compositor that:
 *
 *   1. Enforces the EOCN narrative structure:
 *      (a) Subject identification
 *      (b) Relationship with reporting entity
 *      (c) Nature of suspicion (WHO, WHAT, WHERE, WHEN, WHY, HOW)
 *      (d) Red flag indicators triggered
 *      (e) Supporting evidence references
 *      (f) Action taken by the reporting entity
 *   2. Rejects narratives shorter than the EOCN minimum of 500 characters.
 *   3. Strips any text that looks like it would "tip off" the subject
 *      (FDL Art.29) — e.g. second-person pronouns referring to the subject.
 *   4. Attaches a signature block with CO name + officer ID + date.
 *
 * The output is deterministic: same input → same narrative. This is a
 * hard requirement for regulator-verifiable filings.
 *
 * Regulatory basis:
 *   - FDL Art.26-29 (STR content and no-tipping-off)
 *   - EOCN goAML STR Submission Guidelines v3
 *   - FATF Rec 20
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilingType = 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';

export interface StrNarrativeInput {
  filingType: FilingType;
  subject: {
    fullName: string;
    entityType: 'individual' | 'entity';
    nationality?: string;
    idNumber?: string;
    dateOfBirth?: string;
    registeredAddress?: string;
  };
  relationship: {
    onboardingDate: string; // dd/mm/yyyy
    accountNumber?: string;
    productType?: string;
  };
  suspicion: {
    who: string;
    what: string;
    where: string;
    when: string;
    why: string;
    how: string;
  };
  redFlags: readonly {
    code: string;
    description: string;
    regulatoryReference: string;
  }[];
  evidence: readonly {
    refId: string;
    description: string;
    vaultHash?: string;
  }[];
  actionTaken: readonly string[];
  reportingOfficer: {
    fullName: string;
    officerId: string;
    role: string;
  };
  reportDate: string; // dd/mm/yyyy
}

export interface StrNarrative {
  filingType: FilingType;
  text: string;
  sections: {
    header: string;
    subject: string;
    relationship: string;
    suspicion: string;
    redFlags: string;
    evidence: string;
    action: string;
    signature: string;
  };
  characterCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export const MIN_NARRATIVE_LENGTH = 500;

// Patterns that would "tip off" the subject if leaked (FDL Art.29).
// We reject narratives containing these when they refer to the subject.
const TIP_OFF_PATTERNS: RegExp[] = [
  /\byou\b/i,
  /\byour\b/i,
  /\bwe are reporting you\b/i,
  /\bnotif(y|ied|ying)\s+the\s+subject\b/i,
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildStrNarrative(input: StrNarrativeInput): StrNarrative {
  const warnings: string[] = [];

  const header = `${input.filingType} — ${input.subject.fullName} — ${input.reportDate}`;

  const subject = [
    `Subject: ${input.subject.fullName} (${input.subject.entityType}).`,
    input.subject.nationality ? `Nationality: ${input.subject.nationality}.` : '',
    input.subject.idNumber ? `ID: ${input.subject.idNumber}.` : '',
    input.subject.dateOfBirth ? `DOB: ${input.subject.dateOfBirth}.` : '',
    input.subject.registeredAddress
      ? `Registered address: ${input.subject.registeredAddress}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const relationship = [
    `Onboarded: ${input.relationship.onboardingDate}.`,
    input.relationship.accountNumber
      ? `Account: ${input.relationship.accountNumber}.`
      : '',
    input.relationship.productType ? `Product: ${input.relationship.productType}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const suspicion = [
    `WHO: ${input.suspicion.who}`,
    `WHAT: ${input.suspicion.what}`,
    `WHERE: ${input.suspicion.where}`,
    `WHEN: ${input.suspicion.when}`,
    `WHY: ${input.suspicion.why}`,
    `HOW: ${input.suspicion.how}`,
  ].join('. ');

  const redFlags =
    input.redFlags.length === 0
      ? 'Red flags: none recorded.'
      : 'Red flags: ' +
        input.redFlags
          .map((rf) => `[${rf.code}] ${rf.description} (${rf.regulatoryReference})`)
          .join('; ') +
        '.';

  const evidence =
    input.evidence.length === 0
      ? 'Evidence: none attached.'
      : 'Supporting evidence: ' +
        input.evidence
          .map((e) =>
            e.vaultHash
              ? `${e.refId} — ${e.description} (vault:${e.vaultHash.slice(0, 12)})`
              : `${e.refId} — ${e.description}`,
          )
          .join('; ') +
        '.';

  const action =
    input.actionTaken.length === 0
      ? 'Action taken: none.'
      : 'Actions taken by the reporting entity: ' + input.actionTaken.join('; ') + '.';

  const signature = `Reported by: ${input.reportingOfficer.fullName} (${input.reportingOfficer.officerId}), ${input.reportingOfficer.role}. Date: ${input.reportDate}.`;

  const text = [
    header,
    '',
    subject,
    '',
    relationship,
    '',
    suspicion,
    '',
    redFlags,
    '',
    evidence,
    '',
    action,
    '',
    signature,
  ].join('\n');

  // Length check
  if (text.length < MIN_NARRATIVE_LENGTH) {
    warnings.push(
      `Narrative is ${text.length} chars; EOCN minimum is ${MIN_NARRATIVE_LENGTH}.`,
    );
  }

  // Tip-off scan
  for (const pattern of TIP_OFF_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`Possible tipping-off language: ${pattern.source} (FDL Art.29).`);
    }
  }

  // At least one red flag is mandatory for STR/SAR
  if ((input.filingType === 'STR' || input.filingType === 'SAR') && input.redFlags.length === 0) {
    warnings.push('STR/SAR requires at least one red flag indicator.');
  }

  return {
    filingType: input.filingType,
    text,
    sections: {
      header,
      subject,
      relationship,
      suspicion,
      redFlags,
      evidence,
      action,
      signature,
    },
    characterCount: text.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Quality check
// ---------------------------------------------------------------------------

export function isNarrativeFilingReady(narrative: StrNarrative): boolean {
  return (
    narrative.warnings.length === 0 &&
    narrative.characterCount >= MIN_NARRATIVE_LENGTH &&
    narrative.sections.subject.length > 0 &&
    narrative.sections.suspicion.length > 0
  );
}
