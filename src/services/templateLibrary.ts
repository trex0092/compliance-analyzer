/**
 * Template Library — pre-built markdown templates with placeholder
 * substitution for STR/CNMR narratives, EDD questionnaires, customer
 * information request letters, CDD tier checklists, and policy docs.
 *
 * Why this exists:
 *   Operators re-type the same boilerplate for every new case. A
 *   template library ensures consistent wording, keeps regulatory
 *   citations inline, and lets the CO update one file when a
 *   circular changes.
 *
 *   Templates are VERSIONED MARKDOWN with `{{ variable }}` slots.
 *   The renderer substitutes values deterministically, refusing to
 *   render if a required variable is missing.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned documentation)
 *   FDL No.10/2025 Art.26-27 (STR/SAR filing)
 *   Cabinet Res 134/2025 Art.12-14 (EDD mandatory elements)
 *   MoE Circular 08/AML/2021 (DPMS templates)
 *   FATF Rec 10, Rec 20
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateKind =
  | 'str_narrative'
  | 'cnmr_narrative'
  | 'edd_questionnaire'
  | 'cdd_checklist'
  | 'customer_info_request'
  | 'policy_section';

export interface TemplateDefinition {
  id: string;
  kind: TemplateKind;
  version: number;
  /** Human-readable label. */
  label: string;
  /** Markdown body with {{ variable }} placeholders. */
  body: string;
  /** Required variable names. */
  requiredVars: readonly string[];
  /** Regulatory anchor. */
  regulatory: string;
}

export interface RenderResult {
  ok: boolean;
  body: string | null;
  missingVars: readonly string[];
  substitutedVars: readonly string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'str-v1',
    kind: 'str_narrative',
    version: 1,
    label: 'STR Narrative — UAE FIU goAML',
    requiredVars: ['caseId', 'entityName', 'triggerDate', 'amountAED', 'topFactors', 'verdict'],
    regulatory: 'FDL Art.26-27; FATF Rec 20; MoE Circular 08/AML/2021',
    body: `REASON FOR SUSPICION — Case {{ caseId }}

Reporting institution observed activity by {{ entityName }} on
{{ triggerDate }} that triggered the automated compliance screening
pipeline. The pipeline produced a verdict of "{{ verdict }}" and
recommended filing under FDL No.10/2025 Art.26-27.

TRANSACTION DETAILS
  Amount: AED {{ amountAED }}
  Trigger date: {{ triggerDate }}

TOP CONTRIBUTING FACTORS
{{ topFactors }}

INSTITUTIONAL ASSESSMENT
The institution assesses this activity as inconsistent with the
customer's known profile and is filing this report under:
  - FDL No.10/2025 Art.26-27 (without delay)
  - FDL No.10/2025 Art.29 (no tipping off)
  - FATF Rec 20
  - MoE Circular 08/AML/2021

This report is a structured draft reviewed by the MLRO prior to
submission to the UAE FIU via goAML.
`,
  },
  {
    id: 'cnmr-v1',
    kind: 'cnmr_narrative',
    version: 1,
    label: 'CNMR — Confirmed-Match Notification',
    requiredVars: ['caseId', 'entityName', 'listName', 'matchScore', 'freezeAtIso'],
    regulatory: 'Cabinet Res 74/2020 Art.4-7; FDL Art.35',
    body: `CONFIRMED-MATCH NOTIFICATION — Case {{ caseId }}

Subject: {{ entityName }}
Sanctions list: {{ listName }}
Match score: {{ matchScore }}
Freeze executed at: {{ freezeAtIso }}

Under Cabinet Res 74/2020 Art.4, the institution has executed an
immediate asset freeze on the subject. Under Art.6, this CNMR is
being filed within the 5 business day deadline.

The subject has NOT been notified (FDL Art.29 — no tipping off).

Regulatory basis:
  - Cabinet Res 74/2020 Art.4-7
  - FDL No.10/2025 Art.35
`,
  },
  {
    id: 'edd-v1',
    kind: 'edd_questionnaire',
    version: 1,
    label: 'Enhanced Due Diligence Questionnaire',
    requiredVars: ['entityName', 'riskTier', 'reviewDueDate'],
    regulatory: 'Cabinet Res 134/2025 Art.12-14; FATF Rec 10',
    body: `ENHANCED DUE DILIGENCE — {{ entityName }}

Risk tier: {{ riskTier }}
Review due: {{ reviewDueDate }}

Mandatory questions (Cabinet Res 134/2025 Art.14):
  1. Source of funds — provide documentary evidence
  2. Source of wealth — provide documentary evidence
  3. Ultimate beneficial ownership — full chain disclosure
  4. Purpose of the business relationship
  5. Expected transaction volume + pattern
  6. PEP status + family + close associates
  7. Adverse media — explain any findings
  8. Jurisdiction exposure — list every country

Senior management approval REQUIRED before onboarding.

Regulatory basis:
  - Cabinet Res 134/2025 Art.12-14
  - FATF Rec 10
`,
  },
  {
    id: 'cdd-v1',
    kind: 'cdd_checklist',
    version: 1,
    label: 'Standard CDD Checklist',
    requiredVars: ['entityName', 'onboardingDate'],
    regulatory: 'FDL Art.12-14; Cabinet Res 134/2025 Art.7-10',
    body: `STANDARD CDD — {{ entityName }}

Onboarded: {{ onboardingDate }}

Required evidence:
  [ ] Identity verification (passport / Emirates ID)
  [ ] Address verification (utility bill ≤3 months)
  [ ] UBO verification (≥25% threshold)
  [ ] Source of funds narrative
  [ ] Sanctions screen (UN / OFAC / EU / UK / UAE / EOCN)
  [ ] PEP screen
  [ ] Adverse media screen
  [ ] Risk-tier assignment

Regulatory basis:
  - FDL No.10/2025 Art.12-14
  - Cabinet Res 134/2025 Art.7-10
`,
  },
  {
    id: 'info-request-v1',
    kind: 'customer_info_request',
    version: 1,
    label: 'Customer Information Request Letter',
    requiredVars: ['customerName', 'requestDate', 'deadlineDate'],
    regulatory: 'FDL Art.12-14',
    body: `Dear {{ customerName }},

As part of our periodic review of your account, we are required to
update the records we hold on file. Please provide the documents
listed below by {{ deadlineDate }}.

Required documents:
  - Updated photo identification
  - Recent address verification
  - Source of funds statement for transactions >AED 55,000

If any of this information has changed since your last review,
please flag the change clearly on the form.

This request is routine and applies to every customer of our firm.

Yours sincerely,
Compliance Team
Date of request: {{ requestDate }}
`,
  },
  {
    id: 'policy-risk-appetite-v1',
    kind: 'policy_section',
    version: 1,
    label: 'Risk Appetite Policy Section',
    requiredVars: ['institutionName', 'effectiveFrom'],
    regulatory: 'Cabinet Res 134/2025 Art.5',
    body: `# Risk Appetite — {{ institutionName }}

Effective from: {{ effectiveFrom }}

## 1. Governance
{{ institutionName }} maintains a risk-based approach to AML/CFT/CPF
compliance in line with FDL No.10/2025 and Cabinet Res 134/2025
Art.5.

## 2. Thresholds
- AED 55,000 DPMS cash transaction reporting
- AED 60,000 cross-border cash
- 25% UBO disclosure
- 10-year record retention
`,
  },
];

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  templateId: string,
  variables: Readonly<Record<string, string | number>>
): RenderResult {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return {
      ok: false,
      body: null,
      missingVars: [],
      substitutedVars: [],
      error: `template "${templateId}" not found`,
    };
  }

  const missing: string[] = [];
  for (const required of template.requiredVars) {
    if (variables[required] === undefined) missing.push(required);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      body: null,
      missingVars: missing,
      substitutedVars: [],
      error: `missing required variables: ${missing.join(', ')}`,
    };
  }

  const substituted: string[] = [];
  const rendered = template.body.replace(PLACEHOLDER_RE, (_match, name: string) => {
    substituted.push(name);
    const v = variables[name];
    if (v === undefined || v === null) return '(missing)';
    return String(v);
  });

  return {
    ok: true,
    body: rendered,
    missingVars: [],
    substitutedVars: substituted,
    error: null,
  };
}

export function listTemplatesByKind(kind: TemplateKind): readonly TemplateDefinition[] {
  return TEMPLATES.filter((t) => t.kind === kind);
}

// Exports for tests.
export const __test__ = { PLACEHOLDER_RE };
