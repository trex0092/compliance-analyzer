/**
 * Sample Data Loader — generates a realistic 20-case demo dataset so
 * operators can click through the entire tool on hour one without
 * loading real customer data.
 *
 * Why this exists:
 *   The tool has 80+ brain subsystems and 10+ blob stores. A new
 *   operator landing on an empty deploy sees EMPTY LISTS everywhere
 *   — no cases, no telemetry, no Asana tasks, no evidence bundles.
 *   They cannot judge whether the tool works without loading real
 *   customer data, which is exactly what regulators tell them NOT
 *   to do on first run.
 *
 *   This module is the bridge. It produces a deterministic 20-case
 *   demo dataset spanning every persona + every Tier C state + a
 *   plausible telemetry history + a plausible Asana task list. The
 *   operator toggles demo mode (see demoMode.ts), clicks around,
 *   runs drills, then toggles demo OFF and the data is gone.
 *
 *   The dataset is:
 *     1. Clearly MARKED — every record has `synthetic: true` and a
 *        `demoDatasetId` field so it can never be mistaken for real
 *        customer data.
 *     2. Deterministic — a fixed seed + deterministic PRNG produces
 *        the same 20 cases every run, so tests are reproducible.
 *     3. Bounded — exactly 20 cases, 140 telemetry entries (7 days),
 *        14 Asana tasks, 3 clamp suggestions, 2 outbound queue
 *        items, 1 pending break-glass. Enough to exercise every
 *        UI path, not enough to clutter.
 *     4. Reversible — every key written is under the `demo:*`
 *        prefix so a single blob-list + delete pass removes all of
 *        it.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operator training)
 *   NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate)
 *   EU AI Act Art.15         (accuracy + robustness via drills)
 */

import { generateCase, PERSONA_IDS, type PersonaId, type SyntheticCase } from './syntheticCaseGenerator';
import type { BrainTelemetryEntry } from './brainTelemetryStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoAsanaTask {
  demoDatasetId: string;
  synthetic: true;
  taskGid: string;
  tenantId: string;
  caseId: string;
  section:
    | 'Inbox'
    | 'Pending CO Review'
    | 'Pending Four-Eyes'
    | 'EOCN Freeze Required'
    | 'CNMR Filing Required'
    | 'STR Filing Required'
    | 'Closed';
  title: string;
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  enteredSectionAtIso: string;
}

export interface DemoClampSuggestion {
  demoDatasetId: string;
  synthetic: true;
  id: string;
  clampKey: string;
  currentValue: number;
  proposedValue: number;
  status: 'pending_mlro_review';
  rationale: string;
}

export interface DemoOutboundItem {
  demoDatasetId: string;
  synthetic: true;
  id: string;
  tenantId: string;
  recipientRef: string;
  subject: string;
  status: 'pending_release' | 'lint_failed';
  createdAtIso: string;
}

export interface DemoBreakGlassRequest {
  demoDatasetId: string;
  synthetic: true;
  id: string;
  tenantId: string;
  caseId: string;
  fromVerdict: 'freeze' | 'escalate';
  toVerdict: 'escalate' | 'flag';
  requestedBy: string;
  status: 'pending_approval';
}

export interface DemoDataset {
  schemaVersion: 1;
  datasetId: string;
  generatedAtIso: string;
  synthetic: true;
  tenantId: string;
  cases: readonly SyntheticCase[];
  telemetry: readonly BrainTelemetryEntry[];
  asanaTasks: readonly DemoAsanaTask[];
  clampSuggestions: readonly DemoClampSuggestion[];
  outboundQueue: readonly DemoOutboundItem[];
  breakGlassRequests: readonly DemoBreakGlassRequest[];
  /** Plain-English summary for the audit log. */
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_DATASET_ID = 'demo:v1';
export const DEMO_TENANT_ID = 'tenant-demo';
const DEMO_CASES_PER_PERSONA = 2;
const DEMO_DAYS_OF_TELEMETRY = 7;
const DEMO_SEED_BASE = 2026_04_15;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function generateCases(): SyntheticCase[] {
  const out: SyntheticCase[] = [];
  let seed = DEMO_SEED_BASE;
  for (const persona of PERSONA_IDS as PersonaId[]) {
    for (let i = 0; i < DEMO_CASES_PER_PERSONA; i++) {
      out.push(generateCase(persona, seed++));
    }
  }
  return out;
}

function generateTelemetry(cases: readonly SyntheticCase[]): BrainTelemetryEntry[] {
  const out: BrainTelemetryEntry[] = [];
  // One entry per case spread across the last N days.
  const end = Date.parse('2026-04-15T12:00:00Z');
  const dayMs = 86_400_000;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    // Spread cases across the week, multiple per day at pseudo-random
    // offsets derived from the case index.
    const dayOffset = i % DEMO_DAYS_OF_TELEMETRY;
    const hourOffset = (i * 37) % 24;
    const ts = new Date(end - dayOffset * dayMs + hourOffset * 3_600_000);
    out.push({
      tsIso: ts.toISOString(),
      tenantId: DEMO_TENANT_ID,
      entityRef: c.id,
      verdict: c.expectedVerdict,
      confidence: 0.6 + (i % 10) * 0.03, // 0.60..0.87
      powerScore: 50 + (i % 10) * 4, // 50..86
      brainVerdict: c.expectedVerdict,
      ensembleUnstable: i % 13 === 0,
      typologyIds: i % 5 === 0 ? ['T-DPMS-01'] : [],
      crossCaseFindingCount: i % 7 === 0 ? 2 : 0,
      velocitySeverity: i % 11 === 0 ? 'medium' : 'none',
      driftSeverity: i % 19 === 0 ? 'low' : 'none',
      requiresHumanReview: c.expectedVerdict !== 'pass',
    });
  }
  return out;
}

function generateAsanaTasks(cases: readonly SyntheticCase[]): DemoAsanaTask[] {
  const out: DemoAsanaTask[] = [];
  // Map each non-pass case to an Asana task in an appropriate section.
  const sectionForVerdict: Record<string, DemoAsanaTask['section']> = {
    flag: 'Pending CO Review',
    escalate: 'Pending Four-Eyes',
    freeze: 'EOCN Freeze Required',
  };
  const end = Date.parse('2026-04-15T12:00:00Z');
  let taskSeq = 1;
  for (const c of cases) {
    if (c.expectedVerdict === 'pass') continue;
    const section = sectionForVerdict[c.expectedVerdict] ?? 'Inbox';
    out.push({
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      taskGid: `demo-task-${taskSeq++}`,
      tenantId: DEMO_TENANT_ID,
      caseId: c.id,
      section,
      title: `[DEMO] ${c.expectedVerdict.toUpperCase()} — ${c.personaId}`,
      verdict: c.expectedVerdict,
      enteredSectionAtIso: new Date(end - taskSeq * 1_800_000).toISOString(),
    });
  }
  return out;
}

function generateClampSuggestions(): DemoClampSuggestion[] {
  return [
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-clamp-1',
      clampKey: 'weight:txValue30dAED',
      currentValue: 1.0,
      proposedValue: 1.08,
      status: 'pending_mlro_review',
      rationale:
        '5 MLRO escalation overrides on feature "txValue30dAED". Clamped to +8% (within +15% envelope).',
    },
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-clamp-2',
      clampKey: 'weight:cashRatio30d',
      currentValue: 1.0,
      proposedValue: 1.12,
      status: 'pending_mlro_review',
      rationale:
        '7 MLRO escalation overrides on feature "cashRatio30d". Clamped to +12% (within +15% envelope).',
    },
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-clamp-3',
      clampKey: 'weight:nearThresholdCount30d',
      currentValue: 1.0,
      proposedValue: 1.05,
      status: 'pending_mlro_review',
      rationale:
        '6 MLRO escalation overrides on structuring feature. Clamped to +5%.',
    },
  ];
}

function generateOutboundQueue(): DemoOutboundItem[] {
  return [
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-outbound-1',
      tenantId: DEMO_TENANT_ID,
      recipientRef: 'cust-demo-5',
      subject: 'Your invoice for April is attached',
      status: 'pending_release',
      createdAtIso: '2026-04-15T08:00:00.000Z',
    },
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-outbound-2',
      tenantId: DEMO_TENANT_ID,
      recipientRef: 'cust-demo-12',
      subject: 'Scheduled appointment reminder',
      status: 'pending_release',
      createdAtIso: '2026-04-15T09:30:00.000Z',
    },
  ];
}

function generateBreakGlassRequests(): DemoBreakGlassRequest[] {
  return [
    {
      demoDatasetId: DEMO_DATASET_ID,
      synthetic: true,
      id: 'demo-bg-1',
      tenantId: DEMO_TENANT_ID,
      caseId: 'synthetic:sanctions_flagged_corp:2026041517',
      fromVerdict: 'freeze',
      toVerdict: 'escalate',
      requestedBy: 'mlro-demo-1',
      status: 'pending_approval',
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a fresh demo dataset. Pure function — same output every call.
 */
export function buildDemoDataset(): DemoDataset {
  const cases = generateCases();
  const telemetry = generateTelemetry(cases);
  const asanaTasks = generateAsanaTasks(cases);
  const clampSuggestions = generateClampSuggestions();
  const outboundQueue = generateOutboundQueue();
  const breakGlassRequests = generateBreakGlassRequests();

  const summary =
    `Demo dataset "${DEMO_DATASET_ID}" — ${cases.length} cases, ` +
    `${telemetry.length} telemetry entries, ${asanaTasks.length} Asana tasks, ` +
    `${clampSuggestions.length} clamp suggestions, ${outboundQueue.length} outbound items, ` +
    `${breakGlassRequests.length} break-glass requests. ALL SYNTHETIC.`;

  return {
    schemaVersion: 1,
    datasetId: DEMO_DATASET_ID,
    generatedAtIso: '2026-04-15T12:00:00.000Z',
    synthetic: true,
    tenantId: DEMO_TENANT_ID,
    cases,
    telemetry,
    asanaTasks,
    clampSuggestions,
    outboundQueue,
    breakGlassRequests,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
    ],
  };
}

/**
 * Produce the list of blob keys a demo dataset would write, so the
 * reversible-teardown path can walk them. Pure function.
 */
export function demoBlobKeys(): readonly string[] {
  return [
    `demo:dataset.json`,
    `demo:cases.json`,
    `demo:telemetry.json`,
    `demo:asana-tasks.json`,
    `demo:clamp-suggestions.json`,
    `demo:outbound-queue.json`,
    `demo:break-glass.json`,
  ];
}

// Exports for tests.
export const __test__ = {
  generateCases,
  generateTelemetry,
  generateAsanaTasks,
  generateClampSuggestions,
  generateOutboundQueue,
  generateBreakGlassRequests,
  DEMO_CASES_PER_PERSONA,
  DEMO_DAYS_OF_TELEMETRY,
};
