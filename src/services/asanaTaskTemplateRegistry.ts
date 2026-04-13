/**
 * Asana Task Template Registry — F1.
 *
 * Pre-built task templates for every regulatory event the compliance
 * brain can produce. Each template carries the full DAG of subtasks +
 * dependencies + due-date math so the orchestrator can spawn a complete
 * Asana case folder from a single decision-engine event.
 *
 * Templates are PURE data — no I/O. The orchestrator translates each
 * `TaskTemplateNode` into an Asana create-task payload via the
 * existing `asanaClient.createAsanaTask` helper.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care)
 *   FDL Art.26-27 (STR shape)
 *   Cabinet Res 74/2020 Art.4-7 (EOCN freeze)
 *   Cabinet Res 134/2025 Art.14, Art.19 (CDD/EDD + internal review)
 *   Cabinet Decision 109/2023 (UBO 15 working days)
 *   MoE Circular 08/AML/2021 (DPMS thresholds)
 */

export type TemplateId =
  | 'str_filing'
  | 'sanctions_freeze'
  | 'edd_onboarding'
  | 'ubo_reverify'
  | 'drift_incident'
  | 'breach_response'
  | 'audit_findings'
  | 'red_team_miss'
  | 'policy_update'
  | 'weekly_digest'
  | 'breakglass';

export interface TaskTemplateNode {
  /** Stable identifier within the template, used to express dependencies. */
  id: string;
  /** Human-readable Asana task title. */
  name: string;
  /** Full task description (Markdown). */
  notes: string;
  /** Hours from spawn-time until the Asana due date fires. */
  dueInHours: number;
  /** Suggested role (the orchestrator will resolve to a real GID). */
  assigneeRole: 'mlro' | 'co' | 'senior_mlro' | 'analyst' | 'records_officer' | 'on_call';
  /** Other template node ids that must complete before this one starts. */
  dependsOn: readonly string[];
  /** Severity tag — feeds into the SLA enforcer + custom fields. */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Optional regulatory citation displayed alongside the task. */
  regulatory?: string;
}

export interface TaskTemplate {
  id: TemplateId;
  /** Top-of-folder summary used as the parent project name. */
  projectName: string;
  /** Short description shown in the Asana UI. */
  description: string;
  /** Sections to create inside the project, in order. */
  sections: readonly string[];
  /** The actual subtasks. */
  nodes: readonly TaskTemplateNode[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const STR_FILING: TaskTemplate = {
  id: 'str_filing',
  projectName: 'STR Filing',
  description:
    'End-to-end STR pipeline from suspicion → narrative → grader → four-eyes → goAML submission → FIU receipt → close.',
  sections: ['Drafting', 'Four-eyes', 'Submission', 'Closed'],
  nodes: [
    {
      id: 'narrative_draft',
      name: 'Draft suspicion narrative',
      notes:
        'Draft the suspicion narrative covering WHO/WHAT/WHERE/WHEN/WHY/HOW. Minimum 500 characters per EOCN STR Submission Guidelines v3.',
      dueInHours: 4,
      assigneeRole: 'mlro',
      dependsOn: [],
      severity: 'high',
      regulatory: 'FDL Art.26-27; EOCN STR Guidelines v3',
    },
    {
      id: 'narrative_grader',
      name: 'Grade narrative for tipping-off + completeness',
      notes:
        'Run the narrative through the goAML schema validator and the FDL Art.29 tipping-off scanner before progressing to four-eyes.',
      dueInHours: 6,
      assigneeRole: 'mlro',
      dependsOn: ['narrative_draft'],
      severity: 'high',
      regulatory: 'FDL Art.29',
    },
    {
      id: 'four_eyes_primary',
      name: 'Four-eyes review — primary approver',
      notes:
        'First independent review by an authenticated MLRO. Must NOT be the same user as the secondary reviewer.',
      dueInHours: 12,
      assigneeRole: 'mlro',
      dependsOn: ['narrative_grader'],
      severity: 'critical',
      regulatory: 'FDL Art.20-21',
    },
    {
      id: 'four_eyes_secondary',
      name: 'Four-eyes review — secondary approver',
      notes:
        'Second independent review by a different authenticated MLRO. Required before goAML submission.',
      dueInHours: 12,
      assigneeRole: 'senior_mlro',
      dependsOn: ['narrative_grader'],
      severity: 'critical',
      regulatory: 'FDL Art.20-21',
    },
    {
      id: 'fiu_submission',
      name: 'Submit to UAE FIU via goAML',
      notes:
        'Generate the goAML XML, validate against the bundled DOM schema, sign, and submit through the FIU portal.',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: ['four_eyes_primary', 'four_eyes_secondary'],
      severity: 'critical',
      regulatory: 'FDL Art.26-27',
    },
    {
      id: 'fiu_receipt',
      name: 'Capture FIU acknowledgement reference',
      notes: 'Attach the goAML reference number to the case record. Mark the STR as Filed.',
      dueInHours: 48,
      assigneeRole: 'mlro',
      dependsOn: ['fiu_submission'],
      severity: 'medium',
    },
    {
      id: 'case_close',
      name: 'Close case and archive',
      notes:
        'Confirm the audit chain entry was anchored, close the case, archive into the 10-year retention store.',
      dueInHours: 96,
      assigneeRole: 'records_officer',
      dependsOn: ['fiu_receipt'],
      severity: 'low',
      regulatory: 'FDL Art.24',
    },
  ],
};

const SANCTIONS_FREEZE: TaskTemplate = {
  id: 'sanctions_freeze',
  projectName: 'Sanctions Freeze',
  description: '24-hour EOCN freeze protocol with CNMR filing and inspector notification.',
  sections: ['Confirm', 'Freeze', 'Notify', 'Closed'],
  nodes: [
    {
      id: 'confirm_match',
      name: 'Confirm sanctions match (≥0.9 confidence)',
      notes:
        'Validate the match against UN/OFAC/EU/UK/UAE/EOCN before triggering the freeze. Document the basis.',
      dueInHours: 1,
      assigneeRole: 'mlro',
      dependsOn: [],
      severity: 'critical',
      regulatory: 'Cabinet Res 74/2020 Art.4',
    },
    {
      id: 'execute_freeze',
      name: 'Execute asset freeze',
      notes:
        'Freeze all assets and pending transactions within 24 clock hours of confirmation. NEVER notify the subject (FDL Art.29).',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: ['confirm_match'],
      severity: 'critical',
      regulatory: 'Cabinet Res 74/2020 Art.4-7',
    },
    {
      id: 'eocn_notify',
      name: 'Notify EOCN within 24 hours',
      notes:
        'Submit the freeze notification to EOCN. Capture the EOCN reference number on this task.',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: ['execute_freeze'],
      severity: 'critical',
      regulatory: 'Cabinet Res 74/2020 Art.5',
    },
    {
      id: 'cnmr_file',
      name: 'File CNMR within 5 business days',
      notes: 'Generate the goAML CNMR XML and submit. Use businessDays.ts — never calendar days.',
      dueInHours: 5 * 24,
      assigneeRole: 'mlro',
      dependsOn: ['eocn_notify'],
      severity: 'critical',
      regulatory: 'Cabinet Res 74/2020 Art.6',
    },
    {
      id: 'archive',
      name: 'Anchor + archive freeze record (10-year retention)',
      notes: 'Confirm chain anchor, archive the freeze evidence, mark as retained.',
      dueInHours: 120,
      assigneeRole: 'records_officer',
      dependsOn: ['cnmr_file'],
      severity: 'medium',
      regulatory: 'FDL Art.24',
    },
  ],
};

const EDD_ONBOARDING: TaskTemplate = {
  id: 'edd_onboarding',
  projectName: 'EDD Onboarding',
  description: 'Enhanced Due Diligence workflow for high-risk customer onboarding.',
  sections: ['CDD baseline', 'EDD enhanced', 'Senior approval', 'Active'],
  nodes: [
    {
      id: 'cdd_baseline',
      name: 'Complete standard CDD baseline',
      notes: 'Collect ID, address proof, source of funds, UBO disclosure, sanctions screen.',
      dueInHours: 24,
      assigneeRole: 'analyst',
      dependsOn: [],
      severity: 'medium',
      regulatory: 'Cabinet Res 134/2025 Art.7-10',
    },
    {
      id: 'edd_enhanced',
      name: 'Enhanced verification (PEP, adverse media, third-party data)',
      notes:
        'Run World-Check / Refinitiv / Dow Jones screening, document every adverse media hit with source + date.',
      dueInHours: 48,
      assigneeRole: 'mlro',
      dependsOn: ['cdd_baseline'],
      severity: 'high',
      regulatory: 'Cabinet Res 134/2025 Art.14',
    },
    {
      id: 'senior_approval',
      name: 'Senior management approval',
      notes:
        'EDD customers require explicit Senior Management sign-off per Cabinet Res 134/2025 Art.14.',
      dueInHours: 72,
      assigneeRole: 'senior_mlro',
      dependsOn: ['edd_enhanced'],
      severity: 'critical',
      regulatory: 'Cabinet Res 134/2025 Art.14',
    },
    {
      id: 'activate_account',
      name: 'Activate account + schedule 3-month review',
      notes: 'Open the account, set the next review date to today + 3 months, log the activation.',
      dueInHours: 96,
      assigneeRole: 'analyst',
      dependsOn: ['senior_approval'],
      severity: 'medium',
    },
  ],
};

const UBO_REVERIFY: TaskTemplate = {
  id: 'ubo_reverify',
  projectName: 'UBO Re-verification',
  description: '15 working day re-verification window after ownership change.',
  sections: ['Detect', 'Verify', 'Update', 'Closed'],
  nodes: [
    {
      id: 'detect_change',
      name: 'Confirm ownership change',
      notes: 'Validate the new ownership structure against company registry filings.',
      dueInHours: 24,
      assigneeRole: 'analyst',
      dependsOn: [],
      severity: 'medium',
      regulatory: 'Cabinet Decision 109/2023',
    },
    {
      id: 'verify_new_ubo',
      name: 'Verify new beneficial owners (>25%)',
      notes: 'Sanctions screen + adverse media + ID verification on every UBO with >25% control.',
      dueInHours: 7 * 24,
      assigneeRole: 'mlro',
      dependsOn: ['detect_change'],
      severity: 'high',
      regulatory: 'Cabinet Decision 109/2023',
    },
    {
      id: 'update_register',
      name: 'Update UBO register',
      notes: 'Persist the new structure, set nextReview = +15 working days from verifiedDate.',
      dueInHours: 15 * 24,
      assigneeRole: 'records_officer',
      dependsOn: ['verify_new_ubo'],
      severity: 'high',
      regulatory: 'Cabinet Decision 109/2023',
    },
  ],
};

const DRIFT_INCIDENT: TaskTemplate = {
  id: 'drift_incident',
  projectName: 'Drift Incident',
  description: 'Significant portfolio drift detected — review risk model calibration.',
  sections: ['Triage', 'Recalibrate', 'Closed'],
  nodes: [
    {
      id: 'triage',
      name: 'Triage drifted features',
      notes:
        'Open the daily drift report, identify which features drifted, classify as expected vs anomalous.',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: [],
      severity: 'high',
      regulatory: 'Cabinet Res 134/2025 Art.5',
    },
    {
      id: 'recalibrate',
      name: 'Recalibrate risk model',
      notes:
        'If anomalous, recalibrate the risk model and re-seed the drift baseline via scripts/seed-drift-baseline.ts.',
      dueInHours: 72,
      assigneeRole: 'senior_mlro',
      dependsOn: ['triage'],
      severity: 'high',
      regulatory: 'FATF Rec 1',
    },
  ],
};

const BREACH_RESPONSE: TaskTemplate = {
  id: 'breach_response',
  projectName: 'Breach Response',
  description: 'Security breach or evidence chain break response.',
  sections: ['Contain', 'Investigate', 'Notify', 'Closed'],
  nodes: [
    {
      id: 'contain',
      name: 'Contain the incident',
      notes:
        'Isolate the affected system, rotate any potentially-exposed credentials, freeze all related accounts.',
      dueInHours: 1,
      assigneeRole: 'on_call',
      dependsOn: [],
      severity: 'critical',
    },
    {
      id: 'investigate',
      name: 'Forensic investigation',
      notes: 'Establish root cause + scope of impact via the audit chain replay.',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: ['contain'],
      severity: 'critical',
    },
    {
      id: 'regulator_notify',
      name: 'Notify regulator if PII or compliance data affected',
      notes: 'PDPL + FDL Art.24 may require regulator notification within 72 hours.',
      dueInHours: 72,
      assigneeRole: 'co',
      dependsOn: ['investigate'],
      severity: 'critical',
      regulatory: 'PDPL Art.20; FDL Art.24',
    },
  ],
};

const AUDIT_FINDINGS: TaskTemplate = {
  id: 'audit_findings',
  projectName: 'Audit Findings',
  description: 'MoE / EOCN / LBMA inspection finding tracker.',
  sections: ['Open', 'In progress', 'Resolved'],
  nodes: [
    {
      id: 'document_finding',
      name: 'Document the finding',
      notes:
        'Capture the exact wording, severity, and corrective action requested by the inspector.',
      dueInHours: 4,
      assigneeRole: 'mlro',
      dependsOn: [],
      severity: 'high',
    },
    {
      id: 'corrective_action',
      name: 'Implement corrective action',
      notes: 'Execute the corrective action and gather evidence of completion.',
      dueInHours: 14 * 24,
      assigneeRole: 'mlro',
      dependsOn: ['document_finding'],
      severity: 'high',
    },
    {
      id: 'closeout',
      name: 'Close finding with inspector',
      notes: 'Submit corrective action evidence; obtain inspector closeout confirmation.',
      dueInHours: 30 * 24,
      assigneeRole: 'co',
      dependsOn: ['corrective_action'],
      severity: 'medium',
    },
  ],
};

const RED_TEAM_MISS: TaskTemplate = {
  id: 'red_team_miss',
  projectName: 'Red-team Miss',
  description: 'Synthetic adversarial case the brain failed to detect.',
  sections: ['Triage', 'Fixed'],
  nodes: [
    {
      id: 'reproduce',
      name: 'Reproduce the miss',
      notes: 'Run the synthetic case manually through the brain to confirm the regression.',
      dueInHours: 8,
      assigneeRole: 'analyst',
      dependsOn: [],
      severity: 'high',
    },
    {
      id: 'fix',
      name: 'Patch the regression',
      notes: 'Identify which subsystem regressed, patch, add a golden-case test pinning the fix.',
      dueInHours: 48,
      assigneeRole: 'mlro',
      dependsOn: ['reproduce'],
      severity: 'high',
    },
  ],
};

const POLICY_UPDATE: TaskTemplate = {
  id: 'policy_update',
  projectName: 'Policy Update',
  description: 'New regulatory circular detected by the drift watcher.',
  sections: ['Read', 'Impact', 'Implement', 'Closed'],
  nodes: [
    {
      id: 'read',
      name: 'Read the new circular',
      notes:
        'Read the full text and identify every clause that touches DPMS / AML / TFS obligations.',
      dueInHours: 24,
      assigneeRole: 'mlro',
      dependsOn: [],
      severity: 'medium',
    },
    {
      id: 'impact_assessment',
      name: 'Impact assessment',
      notes: 'Map each new clause to existing controls. Identify gaps.',
      dueInHours: 7 * 24,
      assigneeRole: 'mlro',
      dependsOn: ['read'],
      severity: 'medium',
    },
    {
      id: 'implement',
      name: 'Implement updates',
      notes:
        'Update policies, procedures, training. Bump REGULATORY_CONSTANTS_VERSION if a constant changed.',
      dueInHours: 30 * 24,
      assigneeRole: 'co',
      dependsOn: ['impact_assessment'],
      severity: 'medium',
      regulatory: 'CLAUDE.md "30 days: Policy update deadline after new MoE circular"',
    },
  ],
};

const WEEKLY_DIGEST: TaskTemplate = {
  id: 'weekly_digest',
  projectName: 'MLRO Weekly Digest',
  description: 'Auto-posted weekly KPIs from the compliance brain.',
  sections: ['Inbox'],
  nodes: [
    {
      id: 'review_digest',
      name: 'Review weekly compliance KPIs',
      notes:
        'Auto-generated digest with median + p95 latency, four-eyes turnaround, STR turnaround, verdict distribution. Acknowledge after review.',
      dueInHours: 7 * 24,
      assigneeRole: 'co',
      dependsOn: [],
      severity: 'info',
    },
  ],
};

const BREAKGLASS: TaskTemplate = {
  id: 'breakglass',
  projectName: 'Break Glass',
  description: 'Emergency channel for critical compliance events.',
  sections: ['Active', 'Resolved'],
  nodes: [
    {
      id: 'page_oncall',
      name: 'Page on-call MLRO immediately',
      notes: 'Critical event detected. On-call must respond within 15 minutes.',
      dueInHours: 0.25,
      assigneeRole: 'on_call',
      dependsOn: [],
      severity: 'critical',
    },
    {
      id: 'situation_room',
      name: 'Open situation room',
      notes: 'Convene the breakglass response team. Document every decision in the audit chain.',
      dueInHours: 2,
      assigneeRole: 'co',
      dependsOn: ['page_oncall'],
      severity: 'critical',
      regulatory: 'FDL Art.24',
    },
  ],
};

const TEMPLATES: Record<TemplateId, TaskTemplate> = {
  str_filing: STR_FILING,
  sanctions_freeze: SANCTIONS_FREEZE,
  edd_onboarding: EDD_ONBOARDING,
  ubo_reverify: UBO_REVERIFY,
  drift_incident: DRIFT_INCIDENT,
  breach_response: BREACH_RESPONSE,
  audit_findings: AUDIT_FINDINGS,
  red_team_miss: RED_TEAM_MISS,
  policy_update: POLICY_UPDATE,
  weekly_digest: WEEKLY_DIGEST,
  breakglass: BREAKGLASS,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTemplate(id: TemplateId): TaskTemplate {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown task template id: ${id}`);
  return t;
}

export function listTemplates(): readonly TaskTemplate[] {
  return Object.values(TEMPLATES);
}

/**
 * Resolve dependency edges into a concrete topological order.
 * Returns the node ids in execution order, or throws on a cycle.
 */
export function topoSort(template: TaskTemplate): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of template.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const node of template.nodes) {
    for (const dep of node.dependsOn) {
      adj.get(dep)?.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (order.length !== template.nodes.length) {
    throw new Error(`Template ${template.id} has a dependency cycle`);
  }
  return order;
}
