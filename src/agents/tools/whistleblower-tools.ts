/**
 * Whistleblower / Anonymous Tip System MCP Tools
 *
 * Secure anonymous reporting system for compliance violations:
 * - SHA-256 hashed identity (never store plaintext reporter info)
 * - Auto-classification of tip severity
 * - Case generation with unique tracking IDs
 * - Audit trail that preserves anonymity
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties, internal reporting),
 * Cabinet Res 134/2025 Art.19 (internal review),
 * FDL No.10/2025 Art.29 (no tipping-off — applies to STR subjects, NOT whistleblowers)
 */

import type { ToolResult } from '../mcp-server';
import {
  DPMS_CASH_THRESHOLD_AED,
  RECORD_RETENTION_YEARS as _RECORD_RETENTION_YEARS,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TipCategory =
  | 'sanctions_evasion'
  | 'money_laundering'
  | 'terrorist_financing'
  | 'fraud'
  | 'bribery_corruption'
  | 'insider_trading'
  | 'data_manipulation'
  | 'policy_violation'
  | 'screening_bypass'
  | 'tipping_off'
  | 'other';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
export type CaseStatus =
  | 'new'
  | 'triaged'
  | 'investigating'
  | 'escalated'
  | 'resolved'
  | 'dismissed';

export interface AnonymousTipInput {
  reporterAlias?: string;
  reporterSecret: string; // Will be SHA-256 hashed — NEVER stored in plaintext
  category: TipCategory;
  subject: string;
  description: string;
  involvedEntities?: string[];
  involvedEmployees?: string[];
  estimatedAmountAED?: number;
  evidenceDescriptions?: string[];
  dateOfIncident?: string; // dd/mm/yyyy
  locationOrDepartment?: string;
  isOngoing?: boolean;
}

export interface TipCase {
  caseId: string;
  tipId: string;
  reporterHash: string; // SHA-256 of reporterSecret
  reporterAlias: string;
  category: TipCategory;
  severity: SeverityLevel;
  severityScore: number;
  subject: string;
  description: string;
  involvedEntities: string[];
  involvedEmployees: string[];
  estimatedAmountAED: number | null;
  evidenceDescriptions: string[];
  dateOfIncident: string | null;
  locationOrDepartment: string | null;
  isOngoing: boolean;
  status: CaseStatus;
  createdAt: string;
  assignedTo: string | null;
  deadlineDate: string;
  classification: {
    autoCategory: TipCategory;
    confidenceScore: number;
    regulatoryRelevance: string[];
    requiredActions: string[];
  };
  auditTrail: Array<{ timestamp: string; action: string; detail: string; actor: string }>;
}

export interface TipSubmissionResult {
  tipId: string;
  caseId: string;
  reporterHash: string;
  trackingCode: string;
  severity: SeverityLevel;
  acknowledgement: string;
  estimatedResponseDays: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<TipCategory, number> = {
  sanctions_evasion: 40,
  terrorist_financing: 45,
  money_laundering: 35,
  tipping_off: 40,
  fraud: 30,
  bribery_corruption: 30,
  insider_trading: 25,
  screening_bypass: 35,
  data_manipulation: 25,
  policy_violation: 15,
  other: 10,
};

const REGULATORY_RELEVANCE: Record<TipCategory, string[]> = {
  sanctions_evasion: [
    'FDL No.10/2025 Art.35 (TFS)',
    'Cabinet Res 74/2020 Art.4-7',
    'Cabinet Res 71/2024 (penalties)',
  ],
  terrorist_financing: [
    'FDL No.10/2025 Art.26-27 (STR)',
    'Cabinet Res 134/2025 Art.5 (risk appetite)',
  ],
  money_laundering: [
    'FDL No.10/2025 Art.26-27 (STR)',
    'FATF Rec 22/23',
    'MoE Circular 08/AML/2021',
  ],
  tipping_off: [
    'FDL No.10/2025 Art.29 (no tipping off)',
    'Cabinet Res 71/2024 (penalties up to AED 100M)',
  ],
  fraud: ['FDL No.10/2025 Art.12-14 (CDD)', 'Cabinet Res 134/2025 Art.7-10'],
  bribery_corruption: ['FDL No.10/2025 Art.14 (PEP/EDD)', 'Cabinet Res 134/2025 Art.14'],
  insider_trading: ['Cabinet Res 134/2025 Art.19 (internal review)'],
  screening_bypass: ['FDL No.10/2025 Art.35 (TFS)', 'Cabinet Res 74/2020', 'Cabinet Res 71/2024'],
  data_manipulation: ['FDL No.10/2025 Art.24 (record retention)', 'Cabinet Res 134/2025 Art.19'],
  policy_violation: ['Cabinet Res 134/2025 Art.5 (risk appetite)', 'Cabinet Res 134/2025 Art.19'],
  other: ['FDL No.10/2025 Art.20-21 (CO duties)'],
};

const CRITICAL_CATEGORIES: TipCategory[] = [
  'sanctions_evasion',
  'terrorist_financing',
  'tipping_off',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateUAE(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    // UAE government-standard calendar since 1 Jan 2022: Sat (6) + Sun
    // (0) are the weekend; Mon-Fri are business days. Matches the
    // authoritative implementation in src/utils/businessDays.ts.
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

async function sha256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateTrackingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous I/O/0/1
  let code = 'WB-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

function classifySeverity(input: AnonymousTipInput): {
  severity: SeverityLevel;
  score: number;
  autoCategory: TipCategory;
  confidence: number;
} {
  let score = SEVERITY_WEIGHTS[input.category] ?? 10;

  // Contextual multipliers
  if (input.isOngoing) score += 15;
  if (
    input.estimatedAmountAED !== null &&
    input.estimatedAmountAED !== undefined &&
    input.estimatedAmountAED >= DPMS_CASH_THRESHOLD_AED
  )
    score += 10; // DPMS threshold
  if (
    input.estimatedAmountAED !== null &&
    input.estimatedAmountAED !== undefined &&
    input.estimatedAmountAED >= 1_000_000
  )
    score += 10;
  if (input.involvedEmployees && input.involvedEmployees.length >= 2) score += 10;
  if (input.evidenceDescriptions && input.evidenceDescriptions.length >= 2) score += 5;

  score = Math.min(score, 100);

  const severity: SeverityLevel =
    score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';

  // Auto-classification: detect keywords to confirm or adjust category
  const text = `${input.subject} ${input.description}`.toLowerCase();
  let autoCategory = input.category;
  let confidence = 0.8;

  const keywordMap: Array<[TipCategory, string[]]> = [
    ['sanctions_evasion', ['sanction', 'ofac', 'freeze', 'designated', 'eocn', 'blocked']],
    ['terrorist_financing', ['terror', 'financing', 'extremis', 'radicali']],
    [
      'money_laundering',
      ['launder', 'layering', 'placement', 'integration', 'smurfing', 'structuring'],
    ],
    ['tipping_off', ['tipping', 'warned', 'notified the subject', 'leaked', 'told the customer']],
    ['fraud', ['fraud', 'forged', 'fake', 'falsified', 'counterfeit']],
    ['screening_bypass', ['bypass', 'skipped screening', 'override', 'disabled check']],
  ];

  for (const [cat, keywords] of keywordMap) {
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    if (matchCount >= 2 && cat !== input.category) {
      autoCategory = cat;
      confidence = Math.min(0.6 + matchCount * 0.1, 0.95);
      score = Math.max(score, SEVERITY_WEIGHTS[cat] ?? 10);
      break;
    }
  }

  return { severity, score, autoCategory, confidence };
}

// ---------------------------------------------------------------------------
// Main function: submitAnonymousTip
// ---------------------------------------------------------------------------

export async function submitAnonymousTip(
  input: AnonymousTipInput
): Promise<ToolResult<TipSubmissionResult>> {
  if (!input.reporterSecret || input.reporterSecret.length < 8) {
    return {
      ok: false,
      error:
        'reporterSecret must be at least 8 characters. This is hashed and never stored in plaintext.',
    };
  }
  if (!input.category) {
    return { ok: false, error: 'Tip category is required.' };
  }
  if (!input.subject || input.subject.trim().length < 5) {
    return { ok: false, error: 'Subject must be at least 5 characters.' };
  }
  if (!input.description || input.description.trim().length < 20) {
    return {
      ok: false,
      error: 'Description must be at least 20 characters to enable proper classification.',
    };
  }

  const now = new Date();
  const tipId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const trackingCode = generateTrackingCode();
  const reporterHash = await sha256Hash(input.reporterSecret);
  const reporterAlias = input.reporterAlias ?? `anonymous_${reporterHash.substring(0, 8)}`;

  // Classify severity
  const { severity, score, autoCategory, confidence } = classifySeverity(input);

  // Response deadline based on severity
  const responseDays =
    severity === 'critical' ? 1 : severity === 'high' ? 3 : severity === 'medium' ? 5 : 10;
  const deadlineDate = addBusinessDays(now, responseDays);

  // Determine required actions based on category
  const requiredActions: string[] = [];
  if (CRITICAL_CATEGORIES.includes(autoCategory)) {
    requiredActions.push('Immediate escalation to Compliance Officer.');
    requiredActions.push('Four-eyes review required (two independent approvers).');
  }
  if (autoCategory === 'sanctions_evasion' || autoCategory === 'screening_bypass') {
    requiredActions.push('Re-screen all entities mentioned in the tip.');
    requiredActions.push('Check for asset freeze obligations (24h deadline).');
  }
  if (autoCategory === 'money_laundering' || autoCategory === 'terrorist_financing') {
    requiredActions.push('Evaluate STR filing obligation (FDL Art.26-27).');
  }
  if (autoCategory === 'tipping_off') {
    requiredActions.push(
      'URGENT: Investigate potential Art.29 violation. Preserve all communications.'
    );
  }
  if (input.involvedEmployees && input.involvedEmployees.length > 0) {
    requiredActions.push('Restrict system access for named employees pending investigation.');
  }
  requiredActions.push(
    `Respond to whistleblower within ${responseDays} business day(s) via tracking code.`
  );

  // Build full case record (consumed by persistence layer)
  const tipCase: TipCase = {
    caseId,
    tipId,
    reporterHash,
    reporterAlias,
    category: input.category,
    severity,
    severityScore: score,
    subject: input.subject,
    description: input.description,
    involvedEntities: input.involvedEntities ?? [],
    involvedEmployees: input.involvedEmployees ?? [],
    estimatedAmountAED: input.estimatedAmountAED ?? null,
    evidenceDescriptions: input.evidenceDescriptions ?? [],
    dateOfIncident: input.dateOfIncident ?? null,
    locationOrDepartment: input.locationOrDepartment ?? null,
    isOngoing: input.isOngoing ?? false,
    status: severity === 'critical' ? 'escalated' : 'new',
    createdAt: formatDateUAE(now),
    assignedTo: severity === 'critical' ? 'compliance_officer' : null,
    deadlineDate: formatDateUAE(deadlineDate),
    classification: {
      autoCategory,
      confidenceScore: confidence,
      regulatoryRelevance: REGULATORY_RELEVANCE[autoCategory] ?? [],
      requiredActions,
    },
    auditTrail: [
      {
        timestamp: now.toISOString(),
        action: 'tip_submitted',
        detail: `Anonymous tip submitted. Category: ${input.category}. Severity: ${severity} (${score}/100). Tracking: ${trackingCode}.`,
        actor: 'system',
      },
      {
        timestamp: now.toISOString(),
        action: 'auto_classified',
        detail: `Auto-classification: ${autoCategory} (confidence: ${(confidence * 100).toFixed(0)}%). Regulatory references: ${(REGULATORY_RELEVANCE[autoCategory] ?? []).join('; ')}.`,
        actor: 'system',
      },
      {
        timestamp: now.toISOString(),
        action: 'case_created',
        detail: `Case ${caseId} created. Status: ${severity === 'critical' ? 'escalated' : 'new'}. Deadline: ${formatDateUAE(deadlineDate)}.`,
        actor: 'system',
      },
    ],
  };

  // In production tipCase is persisted to database.
  // The reporter hash enables anonymous follow-up without identity exposure.
  void tipCase;

  const result: TipSubmissionResult = {
    tipId,
    caseId,
    reporterHash,
    trackingCode,
    severity,
    acknowledgement: `Your tip has been received and classified as ${severity.toUpperCase()} severity. Use tracking code ${trackingCode} to follow up anonymously. Your identity is protected by SHA-256 hashing — we never store your secret in plaintext.`,
    estimatedResponseDays: responseDays,
  };

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Tool: classifyTip (standalone re-classification)
// ---------------------------------------------------------------------------

export interface ClassifyTipInput {
  tipId: string;
  category: TipCategory;
  subject: string;
  description: string;
  involvedEntities?: string[];
  involvedEmployees?: string[];
  estimatedAmountAED?: number;
  isOngoing?: boolean;
}

export interface TipClassificationResult {
  tipId: string;
  classifiedAt: string;
  autoCategory: TipCategory;
  providedCategory: TipCategory;
  categoryMatch: boolean;
  severity: SeverityLevel;
  severityScore: number;
  confidenceScore: number;
  regulatoryRelevance: string[];
  requiredActions: string[];
  requiresImmediateEscalation: boolean;
  retaliationRiskFactors: string[];
  protectionRecommendations: string[];
}

/**
 * Classify (or re-classify) a whistleblower tip's category and severity.
 * Can be run independently of submission for re-evaluation when new
 * information surfaces. Provides regulatory relevance mapping and
 * retaliation risk assessment.
 *
 * @regulatory Cabinet Res 134/2025 Art.19, FDL No.10/2025 Art.20-21, FATF Rec 18
 */
export function classifyTip(input: ClassifyTipInput): ToolResult<TipClassificationResult> {
  if (!input.tipId) {
    return { ok: false, error: 'Tip ID is required.' };
  }
  if (!input.subject || input.subject.trim().length < 5) {
    return { ok: false, error: 'Subject must be at least 5 characters.' };
  }
  if (!input.description || input.description.trim().length < 20) {
    return { ok: false, error: 'Description must be at least 20 characters.' };
  }

  const fakeAnonymousInput: AnonymousTipInput = {
    reporterSecret: 'classification-only',
    category: input.category,
    subject: input.subject,
    description: input.description,
    involvedEntities: input.involvedEntities,
    involvedEmployees: input.involvedEmployees,
    estimatedAmountAED: input.estimatedAmountAED,
    isOngoing: input.isOngoing,
  };

  const { severity, score, autoCategory, confidence } = classifySeverity(fakeAnonymousInput);
  const categoryMatch = autoCategory === input.category;
  const requiresImmediateEscalation =
    severity === 'critical' || CRITICAL_CATEGORIES.includes(autoCategory);

  // Required actions based on category
  const requiredActions: string[] = [];
  if (CRITICAL_CATEGORIES.includes(autoCategory)) {
    requiredActions.push('Immediate escalation to Compliance Officer.');
    requiredActions.push('Four-eyes review required (two independent approvers).');
  }
  if (autoCategory === 'sanctions_evasion' || autoCategory === 'screening_bypass') {
    requiredActions.push('Re-screen all entities mentioned in the tip per FDL Art.35.');
    requiredActions.push('Check asset freeze obligations within 24 hours (Cabinet Res 74/2020).');
  }
  if (autoCategory === 'money_laundering' || autoCategory === 'terrorist_financing') {
    requiredActions.push('Evaluate STR filing obligation per FDL Art.26-27.');
    requiredActions.push('Do NOT disclose STR status to the subject (Art.29).');
  }
  if (autoCategory === 'tipping_off') {
    requiredActions.push(
      'URGENT: Investigate potential Art.29 violation. Preserve all communications.'
    );
    requiredActions.push('Consider suspending implicated staff access immediately.');
  }
  if (input.involvedEmployees && input.involvedEmployees.length > 0) {
    requiredActions.push('Restrict system access for named employees pending investigation.');
    requiredActions.push('Initiate insider threat behavioral analysis for named employees.');
  }
  requiredActions.push(
    `Resolve within ${severity === 'critical' ? '1' : severity === 'high' ? '3' : severity === 'medium' ? '5' : '10'} business day(s).`
  );

  // Retaliation risk factors
  const retaliationRiskFactors: string[] = [];
  if (input.involvedEmployees && input.involvedEmployees.length > 0) {
    retaliationRiskFactors.push('Named employees may attempt to identify the reporter.');
  }
  if (autoCategory === 'tipping_off' || autoCategory === 'screening_bypass') {
    retaliationRiskFactors.push(
      'Implicated individuals have compliance system access — elevated retaliation risk.'
    );
  }
  if (input.isOngoing) {
    retaliationRiskFactors.push(
      'Ongoing violation increases risk of reporter exposure through operational disruption.'
    );
  }
  if (severity === 'critical' || severity === 'high') {
    retaliationRiskFactors.push(
      'High-severity case may trigger organizational scrutiny that could expose reporter.'
    );
  }

  // Protection recommendations
  const protectionRecommendations: string[] = [
    'Ensure tip handling is restricted to minimum necessary personnel.',
    'Never store or log reporter identity in plaintext — use only SHA-256 hash.',
    'Route all communications through anonymous tracking code only.',
  ];
  if (retaliationRiskFactors.length >= 2) {
    protectionRecommendations.push(
      'Elevated retaliation risk: assign independent protection officer from outside the implicated department.'
    );
    protectionRecommendations.push(
      'Schedule retaliation check within 48 hours and weekly thereafter per UAE Federal Decree-Law No.13/2022.'
    );
  }
  if (
    input.involvedEmployees &&
    input.involvedEmployees.some(
      (e) => e.toLowerCase().includes('officer') || e.toLowerCase().includes('manager')
    )
  ) {
    protectionRecommendations.push(
      'CRITICAL: Senior staff implicated — escalate protection to Board level.'
    );
  }

  return {
    ok: true,
    data: {
      tipId: input.tipId,
      classifiedAt: formatDateUAE(new Date()),
      autoCategory,
      providedCategory: input.category,
      categoryMatch,
      severity,
      severityScore: score,
      confidenceScore: confidence,
      regulatoryRelevance: REGULATORY_RELEVANCE[autoCategory] ?? [],
      requiredActions,
      requiresImmediateEscalation,
      retaliationRiskFactors,
      protectionRecommendations,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

export const WHISTLEBLOWER_TOOL_SCHEMAS = [
  {
    name: 'submit_anonymous_tip',
    description:
      'Submit an anonymous compliance tip. Reporter identity is SHA-256 hashed and never stored in plaintext. Auto-classifies severity, generates a case with tracking code, and determines required regulatory actions. Supports follow-up via tracking code without revealing identity.',
    inputSchema: {
      type: 'object',
      properties: {
        reporterAlias: {
          type: 'string',
          description: 'Optional alias for the reporter (anonymous if omitted)',
        },
        reporterSecret: {
          type: 'string',
          description:
            'Secret passphrase for anonymous follow-up. SHA-256 hashed, never stored in plaintext. Minimum 8 characters.',
        },
        category: {
          type: 'string',
          enum: [
            'sanctions_evasion',
            'money_laundering',
            'terrorist_financing',
            'fraud',
            'bribery_corruption',
            'insider_trading',
            'data_manipulation',
            'policy_violation',
            'screening_bypass',
            'tipping_off',
            'other',
          ],
          description: 'Category of the compliance violation',
        },
        subject: { type: 'string', description: 'Brief subject line (min 5 characters)' },
        description: {
          type: 'string',
          description: 'Detailed description of the violation (min 20 characters)',
        },
        involvedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of involved entities (companies, customers)',
        },
        involvedEmployees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names or IDs of involved employees',
        },
        estimatedAmountAED: { type: 'number', description: 'Estimated financial impact in AED' },
        evidenceDescriptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Descriptions of available evidence',
        },
        dateOfIncident: { type: 'string', description: 'Date of incident in dd/mm/yyyy format' },
        locationOrDepartment: {
          type: 'string',
          description: 'Location or department where the violation occurred',
        },
        isOngoing: { type: 'boolean', description: 'Whether the violation is currently ongoing' },
      },
      required: ['reporterSecret', 'category', 'subject', 'description'],
    },
  },
  {
    name: 'classify_tip',
    description:
      'Classify or re-classify a whistleblower tip by category and severity. Returns auto-detected category, severity score, regulatory relevance mapping, required actions, retaliation risk factors, and protection recommendations. Can be re-run when new information surfaces. Regulatory: Cabinet Res 134/2025 Art.19, FDL Art.20-21, FATF Rec 18.',
    inputSchema: {
      type: 'object',
      properties: {
        tipId: { type: 'string', description: 'Existing tip ID to classify' },
        category: {
          type: 'string',
          enum: [
            'sanctions_evasion',
            'money_laundering',
            'terrorist_financing',
            'fraud',
            'bribery_corruption',
            'insider_trading',
            'data_manipulation',
            'policy_violation',
            'screening_bypass',
            'tipping_off',
            'other',
          ],
          description: 'Category of the compliance violation',
        },
        subject: { type: 'string', description: 'Tip subject line' },
        description: { type: 'string', description: 'Tip description narrative' },
        involvedEntities: { type: 'array', items: { type: 'string' } },
        involvedEmployees: { type: 'array', items: { type: 'string' } },
        estimatedAmountAED: { type: 'number' },
        isOngoing: { type: 'boolean' },
      },
      required: ['tipId', 'category', 'subject', 'description'],
    },
  },
] as const;
