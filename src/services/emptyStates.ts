/**
 * Empty States — the single source of truth for every "there's no
 * data yet" message in the tool.
 *
 * Why this exists:
 *   On a fresh deploy, every panel in the Brain Console renders an
 *   empty list (or, worse, an error). That's terrifying to a new
 *   operator — the tool looks broken. Real products solve this with
 *   friendly empty states: an icon, one sentence explaining what
 *   WOULD appear here, and a single call-to-action button.
 *
 *   This module centralises the copy + icon + CTA for every panel
 *   so the UI is consistent and every message is reviewable in one
 *   place (for regulatory language, translations, typos).
 *
 *   Pure function — no I/O. The UI renders `<EmptyState panel="..."/>`
 *   and looks up the right copy here.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned messaging)
 *   EU AI Act Art.13         (transparency — user always knows
 *                              why a panel is empty)
 *   EU Accessibility Act     (clear alternative content when there's
 *                              nothing to list)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmptyStatePanel =
  | 'telemetry'
  | 'case_replay'
  | 'evidence_bundle'
  | 'clamp_suggestions'
  | 'outbound_queue'
  | 'break_glass'
  | 'dead_letter'
  | 'graph_risk'
  | 'fuzz_report'
  | 'drift_monitor'
  | 'counterfactuals'
  | 'str_drafts'
  | 'sanctions_delta'
  | 'audit_log'
  | 'tenant_cohort'
  | 'incidents'
  | 'quarterly_kpi'
  | 'feedback_overrides';

export type EmptyStateIcon =
  | 'chart'
  | 'archive'
  | 'shield'
  | 'wrench'
  | 'envelope'
  | 'key'
  | 'alert'
  | 'graph'
  | 'target'
  | 'pulse'
  | 'branch'
  | 'pen'
  | 'list'
  | 'book'
  | 'people'
  | 'incident'
  | 'star'
  | 'thumb';

export interface EmptyStateCopy {
  panel: EmptyStatePanel;
  /** Icon key — UI layer maps to a real icon. */
  icon: EmptyStateIcon;
  /** Short heading (≤ 40 chars). */
  heading: string;
  /** One-sentence explanation (≤ 160 chars). */
  body: string;
  /** Primary call-to-action label. */
  ctaLabel: string;
  /**
   * Primary CTA action key — UI layer dispatches this into its router.
   * Convention: `domain.verb` (e.g. `sample.load`, `import.csv`).
   */
  ctaAction: string;
  /**
   * Optional secondary action. Used when the primary is "load sample
   * data" but the operator might also want to go to docs.
   */
  secondary?: {
    label: string;
    action: string;
  };
  /** Inline citation shown in small print (regulatory anchor). */
  regulatory: string;
}

// ---------------------------------------------------------------------------
// Copy catalogue (single source of truth)
// ---------------------------------------------------------------------------

const CATALOGUE: Readonly<Record<EmptyStatePanel, EmptyStateCopy>> = {
  telemetry: {
    panel: 'telemetry',
    icon: 'chart',
    heading: 'No decisions yet',
    body:
      'Run your first /api/brain/analyze call to see the trend view. ' +
      'Or load the 20-case sample dataset to click around.',
    ctaLabel: 'Load sample data',
    ctaAction: 'sample.load',
    secondary: { label: 'Read the quickstart', action: 'docs.open:quickstart' },
    regulatory: 'FDL Art.20-22; NIST AI RMF MEASURE-2',
  },
  case_replay: {
    panel: 'case_replay',
    icon: 'archive',
    heading: 'No cases to replay',
    body:
      'Replay re-validates a historical case against the current regulatory ' +
      'baseline. Cases appear here after their first brain dispatch.',
    ctaLabel: 'Load sample data',
    ctaAction: 'sample.load',
    regulatory: 'FDL Art.20; Cabinet Res 134/2025 Art.19',
  },
  evidence_bundle: {
    panel: 'evidence_bundle',
    icon: 'shield',
    heading: 'No case selected',
    body:
      'Paste a case id above or pick one from the recent-cases list to ' +
      'generate a SHA3-512-sealed evidence bundle for audit.',
    ctaLabel: 'Pick recent case',
    ctaAction: 'case.pickRecent',
    regulatory: 'FDL Art.24; FATF Rec 11',
  },
  clamp_suggestions: {
    panel: 'clamp_suggestions',
    icon: 'wrench',
    heading: 'No clamp suggestions pending',
    body:
      'The hourly clamp cron proposes weight tunings from telemetry. ' +
      'Accepted suggestions still require a human PR to constants.ts.',
    ctaLabel: 'Run clamp cron now',
    ctaAction: 'cron.clamp.runNow',
    regulatory: 'NIST AI RMF GOVERN-4',
  },
  outbound_queue: {
    panel: 'outbound_queue',
    icon: 'envelope',
    heading: 'Outbound queue is empty',
    body:
      'Customer-facing messages queue here pending CO release. ' +
      'Tipping-off linter runs on every enqueued message (FDL Art.29).',
    ctaLabel: 'Enqueue a test message',
    ctaAction: 'outbound.testEnqueue',
    regulatory: 'FDL Art.29',
  },
  break_glass: {
    panel: 'break_glass',
    icon: 'key',
    heading: 'No break-glass requests',
    body:
      'Two-person approval queue for brain verdict overrides. ' +
      'Self-approval is rejected by construction.',
    ctaLabel: 'Read the runbook',
    ctaAction: 'docs.open:runbooks/break-glass',
    regulatory: 'Cabinet Res 134/2025 Art.12-14',
  },
  dead_letter: {
    panel: 'dead_letter',
    icon: 'alert',
    heading: 'Dead-letter queue is empty',
    body:
      'Asana dispatch is healthy. Dead-letter entries land here when retries ' +
      'are exhausted — drain cron runs every 15 minutes.',
    ctaLabel: 'Check cron status',
    ctaAction: 'cron.status',
    regulatory: 'Cabinet Res 134/2025 Art.19',
  },
  graph_risk: {
    panel: 'graph_risk',
    icon: 'graph',
    heading: 'No transaction graph loaded',
    body:
      'Upload a transaction edge list (CSV or JSON) to detect mule / ring / ' +
      'hub / bridge / self-loop patterns invisible to per-customer scoring.',
    ctaLabel: 'Upload transaction CSV',
    ctaAction: 'import.csv:transactions',
    regulatory: 'FATF Rec 11; FATF Rec 20',
  },
  fuzz_report: {
    panel: 'fuzz_report',
    icon: 'target',
    heading: 'No fuzz report yet',
    body:
      'The nightly fuzzer cron probes every threshold edge and every ±5% ' +
      'perturbation. First report appears after the first run.',
    ctaLabel: 'Run fuzzer now',
    ctaAction: 'cron.fuzz.runNow',
    regulatory: 'EU AI Act Art.15; NIST AI RMF MEASURE-4',
  },
  drift_monitor: {
    panel: 'drift_monitor',
    icon: 'pulse',
    heading: 'Not enough telemetry',
    body:
      'Drift detection needs ≥30 decisions on both sides of the comparison. ' +
      'Load the sample dataset or wait for live traffic.',
    ctaLabel: 'Load sample data',
    ctaAction: 'sample.load',
    regulatory: 'NIST AI RMF MEASURE-4',
  },
  counterfactuals: {
    panel: 'counterfactuals',
    icon: 'branch',
    heading: 'No case selected',
    body:
      'Counterfactuals show the smallest feature change that would flip a ' +
      'verdict. Pick a case to compute them.',
    ctaLabel: 'Pick a case',
    ctaAction: 'case.pickRecent',
    regulatory: 'EU AI Act Art.13; NIST AI RMF MANAGE-2',
  },
  str_drafts: {
    panel: 'str_drafts',
    icon: 'pen',
    heading: 'No STR drafts yet',
    body:
      'Drafts appear after a flag/escalate/freeze verdict. MLRO reviews ' +
      'and signs every draft before goAML submission.',
    ctaLabel: 'Load sample data',
    ctaAction: 'sample.load',
    regulatory: 'FDL Art.26-27; FATF Rec 20',
  },
  sanctions_delta: {
    panel: 'sanctions_delta',
    icon: 'list',
    heading: 'No sanctions delta loaded',
    body:
      'Sanctions delta cron runs every 4 hours and re-screens the cohort ' +
      'against new / modified list entries.',
    ctaLabel: 'Run delta screen now',
    ctaAction: 'cron.delta.runNow',
    regulatory: 'Cabinet Res 74/2020 Art.4; FATF Rec 6',
  },
  audit_log: {
    panel: 'audit_log',
    icon: 'book',
    heading: 'Audit log is empty',
    body:
      'Every compliance action writes an audit entry. The log populates ' +
      'as operators use the tool.',
    ctaLabel: 'Run a test action',
    ctaAction: 'sample.load',
    regulatory: 'FDL Art.24; FATF Rec 11',
  },
  tenant_cohort: {
    panel: 'tenant_cohort',
    icon: 'people',
    heading: 'No customers loaded',
    body:
      'Upload your customer cohort CSV to enable sanctions delta screening, ' +
      'periodic CDD review, and graph risk analysis.',
    ctaLabel: 'Import customer CSV',
    ctaAction: 'import.csv:cohort',
    secondary: { label: 'Load sample data', action: 'sample.load' },
    regulatory: 'FDL Art.12-14; FATF Rec 10',
  },
  incidents: {
    panel: 'incidents',
    icon: 'incident',
    heading: 'No open incidents',
    body:
      'Incidents appear here on freeze triggers, SLA breaches, and drift ' +
      'alerts. Empty = healthy.',
    ctaLabel: 'View incident history',
    ctaAction: 'incidents.history',
    regulatory: 'Cabinet Res 74/2020 Art.4-7',
  },
  quarterly_kpi: {
    panel: 'quarterly_kpi',
    icon: 'star',
    heading: 'No quarterly report yet',
    body:
      'The /kpi-report skill generates the 30-KPI DPMS quarterly report. ' +
      'Run it after the first full quarter of telemetry.',
    ctaLabel: 'Generate sample report',
    ctaAction: 'kpi.generateSample',
    regulatory: 'MoE Circular 08/AML/2021',
  },
  feedback_overrides: {
    panel: 'feedback_overrides',
    icon: 'thumb',
    heading: 'No MLRO overrides recorded',
    body:
      'Every override is captured for audit and fed into the active learning ' +
      'loop. Empty means the brain has been perfect — or not used yet.',
    ctaLabel: 'Read the feedback-loop docs',
    ctaAction: 'docs.open:feedback-loop',
    regulatory: 'FDL Art.19-21; NIST AI RMF GOVERN-4',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getEmptyState(panel: EmptyStatePanel): EmptyStateCopy {
  return CATALOGUE[panel];
}

export function listEmptyStates(): readonly EmptyStateCopy[] {
  return Object.values(CATALOGUE);
}

export const PANEL_IDS = Object.keys(CATALOGUE) as readonly EmptyStatePanel[];

// Exports for tests.
export const __test__ = { CATALOGUE };
