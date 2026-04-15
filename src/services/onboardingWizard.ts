/**
 * Onboarding Wizard — state machine for the 5-step first-run flow:
 *
 *   1. welcome       — intro screen
 *   2. tenant_setup  — pick tenantId, colour, legal name
 *   3. env_check     — validate every required env var
 *   4. asana_linkage — confirm Asana PAT + webhook handshake
 *   5. sample_data   — optionally load the 20-case demo dataset
 *
 * Why this exists:
 *   A new operator hitting a fresh deploy cannot know which tab to
 *   click first. The wizard walks them through a fixed sequence that
 *   guarantees the tool is in a working state by the time they see
 *   the main dashboard.
 *
 *   This module is the PURE state machine. It has no I/O, no DOM, no
 *   network. It consumes events and emits the next state + a list of
 *   actions the caller should perform. The UI layer wires the events
 *   to button clicks and executes the actions (env-var probes, API
 *   calls, blob writes).
 *
 *   The state machine is deterministic — same event sequence → same
 *   final state → same action list.
 *
 *   The wizard persists its progress per session via an injected
 *   store so an operator who closes the tab mid-wizard resumes where
 *   they left off.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operator guidance)
 *   Cabinet Res 134/2025 Art.19 (reviewable process)
 *   NIST AI RMF 1.0 GOVERN-1 (documented onboarding process)
 *   EU AI Act Art.14         (human oversight — clear entry point)
 *   EU Accessibility Act     (predictable navigation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep =
  | 'welcome'
  | 'tenant_setup'
  | 'env_check'
  | 'asana_linkage'
  | 'sample_data'
  | 'complete';

export interface TenantSetupPayload {
  tenantId: string;
  legalName: string;
  /** Hex color or named colour — UI-only. */
  color: string;
}

export interface AsanaLinkagePayload {
  workspaceGid: string;
  webhookEchoed: boolean;
}

export interface WizardState {
  currentStep: WizardStep;
  completedSteps: readonly WizardStep[];
  tenantSetup: TenantSetupPayload | null;
  envCheckPassed: boolean;
  asanaLinkage: AsanaLinkagePayload | null;
  sampleDataLoaded: boolean;
  /** ISO timestamp of the last state change. */
  lastTransitionAtIso: string;
}

export type WizardEvent =
  | { type: 'start'; now?: Date }
  | { type: 'submit_tenant'; payload: TenantSetupPayload; now?: Date }
  | { type: 'env_check_result'; passed: boolean; now?: Date }
  | { type: 'submit_asana'; payload: AsanaLinkagePayload; now?: Date }
  | { type: 'load_sample_data'; load: boolean; now?: Date }
  | { type: 'back'; now?: Date }
  | { type: 'restart'; now?: Date };

export type WizardAction =
  | { type: 'run_env_check' }
  | { type: 'attempt_asana_handshake'; workspaceGid: string }
  | { type: 'load_demo_dataset' }
  | { type: 'emit_audit'; event: string; detail: string }
  | { type: 'render_step'; step: WizardStep };

export interface StepTransition {
  nextState: WizardState;
  actions: readonly WizardAction[];
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function initialWizardState(): WizardState {
  return {
    currentStep: 'welcome',
    completedSteps: [],
    tenantSetup: null,
    envCheckPassed: false,
    asanaLinkage: null,
    sampleDataLoaded: false,
    lastTransitionAtIso: '1970-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markCompleted(state: WizardState, step: WizardStep): readonly WizardStep[] {
  if (state.completedSteps.includes(step)) return state.completedSteps;
  return [...state.completedSteps, step];
}

function stampIso(ev: WizardEvent): string {
  const n = ev.now ?? new Date();
  return n.toISOString();
}

function validateTenant(t: TenantSetupPayload): string | null {
  if (typeof t.tenantId !== 'string' || t.tenantId.length === 0 || t.tenantId.length > 64) {
    return 'tenantId must be 1..64 chars';
  }
  if (!/^[a-z0-9-]+$/.test(t.tenantId)) {
    return 'tenantId must contain only lowercase letters, digits, and hyphens';
  }
  if (typeof t.legalName !== 'string' || t.legalName.length === 0 || t.legalName.length > 256) {
    return 'legalName must be 1..256 chars';
  }
  if (typeof t.color !== 'string' || t.color.length === 0) {
    return 'color required';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduceWizard(state: WizardState, event: WizardEvent): StepTransition {
  const tsIso = stampIso(event);

  switch (event.type) {
    case 'start':
      return {
        nextState: { ...state, currentStep: 'welcome', lastTransitionAtIso: tsIso },
        actions: [
          { type: 'render_step', step: 'welcome' },
          { type: 'emit_audit', event: 'wizard.start', detail: 'Wizard started' },
        ],
      };

    case 'submit_tenant': {
      if (state.currentStep !== 'welcome' && state.currentStep !== 'tenant_setup') {
        return { nextState: state, actions: [] };
      }
      const err = validateTenant(event.payload);
      if (err) {
        return {
          nextState: state,
          actions: [{ type: 'emit_audit', event: 'wizard.tenant_invalid', detail: err }],
        };
      }
      const next: WizardState = {
        ...state,
        currentStep: 'env_check',
        completedSteps: markCompleted(state, 'tenant_setup'),
        tenantSetup: event.payload,
        lastTransitionAtIso: tsIso,
      };
      return {
        nextState: next,
        actions: [
          { type: 'emit_audit', event: 'wizard.tenant_submitted', detail: event.payload.tenantId },
          { type: 'render_step', step: 'env_check' },
          { type: 'run_env_check' },
        ],
      };
    }

    case 'env_check_result': {
      if (state.currentStep !== 'env_check') return { nextState: state, actions: [] };
      const next: WizardState = {
        ...state,
        currentStep: event.passed ? 'asana_linkage' : 'env_check',
        completedSteps: event.passed ? markCompleted(state, 'env_check') : state.completedSteps,
        envCheckPassed: event.passed,
        lastTransitionAtIso: tsIso,
      };
      return {
        nextState: next,
        actions: event.passed
          ? [
              { type: 'emit_audit', event: 'wizard.env_ok', detail: 'Env check passed' },
              { type: 'render_step', step: 'asana_linkage' },
            ]
          : [
              { type: 'emit_audit', event: 'wizard.env_failed', detail: 'Env check failed' },
              { type: 'render_step', step: 'env_check' },
            ],
      };
    }

    case 'submit_asana': {
      if (state.currentStep !== 'asana_linkage') return { nextState: state, actions: [] };
      if (!event.payload.webhookEchoed) {
        return {
          nextState: state,
          actions: [
            {
              type: 'emit_audit',
              event: 'wizard.asana_handshake_failed',
              detail: 'No X-Hook-Secret echoed',
            },
            { type: 'attempt_asana_handshake', workspaceGid: event.payload.workspaceGid },
          ],
        };
      }
      const next: WizardState = {
        ...state,
        currentStep: 'sample_data',
        completedSteps: markCompleted(state, 'asana_linkage'),
        asanaLinkage: event.payload,
        lastTransitionAtIso: tsIso,
      };
      return {
        nextState: next,
        actions: [
          {
            type: 'emit_audit',
            event: 'wizard.asana_ok',
            detail: event.payload.workspaceGid,
          },
          { type: 'render_step', step: 'sample_data' },
        ],
      };
    }

    case 'load_sample_data': {
      if (state.currentStep !== 'sample_data') return { nextState: state, actions: [] };
      const next: WizardState = {
        ...state,
        currentStep: 'complete',
        completedSteps: markCompleted(
          markCompleted(state, 'sample_data').length === state.completedSteps.length + 1
            ? { ...state, completedSteps: [...state.completedSteps, 'sample_data'] }
            : state,
          'complete'
        ),
        sampleDataLoaded: event.load,
        lastTransitionAtIso: tsIso,
      };
      const actions: WizardAction[] = [
        {
          type: 'emit_audit',
          event: event.load ? 'wizard.sample_loaded' : 'wizard.sample_skipped',
          detail: event.load ? 'Loaded 20-case demo dataset' : 'Skipped demo dataset',
        },
        { type: 'render_step', step: 'complete' },
      ];
      if (event.load) {
        actions.unshift({ type: 'load_demo_dataset' });
      }
      return { nextState: next, actions };
    }

    case 'back': {
      const backOrder: WizardStep[] = [
        'welcome',
        'tenant_setup',
        'env_check',
        'asana_linkage',
        'sample_data',
        'complete',
      ];
      const currentIndex = backOrder.indexOf(state.currentStep);
      if (currentIndex <= 0) return { nextState: state, actions: [] };
      const previousStep = backOrder[currentIndex - 1]!;
      return {
        nextState: { ...state, currentStep: previousStep, lastTransitionAtIso: tsIso },
        actions: [{ type: 'render_step', step: previousStep }],
      };
    }

    case 'restart':
      return {
        nextState: { ...initialWizardState(), lastTransitionAtIso: tsIso },
        actions: [
          { type: 'emit_audit', event: 'wizard.restart', detail: 'Restarted from welcome' },
          { type: 'render_step', step: 'welcome' },
        ],
      };

    default:
      return { nextState: state, actions: [] };
  }
}

export function isWizardComplete(state: WizardState): boolean {
  return state.currentStep === 'complete';
}

// Exports for tests.
export const __test__ = { validateTenant, markCompleted };
