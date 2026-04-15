/**
 * Tenant Provisioner tests.
 *
 * Covers:
 *   - tenantProvisioningPlan is deterministic and pure
 *   - Project name + color are stable per tenant id
 *   - Plan includes all 14 standard sections + 15 custom fields
 *   - provisionTenant walks every step via the dispatcher
 *   - Idempotent re-runs (mocked dispatcher returns created=false)
 *   - A single step failure does not abort the run
 *   - ok=true requires every step to succeed
 */
import { describe, it, expect, vi } from 'vitest';

import {
  tenantProvisioningPlan,
  provisionTenant,
  type AsanaProvisionDispatcher,
  __test__,
} from '../src/services/asana/tenantProvisioner';

const { STANDARD_SECTIONS, STANDARD_CUSTOM_FIELDS, colorForTenant } = __test__;

// ---------------------------------------------------------------------------
// Mock dispatcher
// ---------------------------------------------------------------------------

function makeRecordingDispatcher(): AsanaProvisionDispatcher & {
  calls: { ensureProject: number; ensureSection: number; ensureCustomField: number; ensureWebhook: number };
} {
  const calls = { ensureProject: 0, ensureSection: 0, ensureCustomField: 0, ensureWebhook: 0 };
  return {
    calls,
    async ensureProject() {
      calls.ensureProject += 1;
      return { projectGid: 'proj-1', created: true };
    },
    async ensureSection({ name }) {
      calls.ensureSection += 1;
      return { sectionGid: `sec-${name}`, created: true };
    },
    async ensureCustomField({ field }) {
      calls.ensureCustomField += 1;
      return { fieldGid: `cf-${field.name}`, created: true };
    },
    async ensureWebhook() {
      calls.ensureWebhook += 1;
      return { webhookGid: 'wh-1', created: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Plan tests
// ---------------------------------------------------------------------------

describe('tenantProvisioningPlan — pure plan builder', () => {
  it('is deterministic on the same tenantId + workspaceGid', () => {
    const a = tenantProvisioningPlan('tenant-a', { workspaceGid: 'ws-1' });
    const b = tenantProvisioningPlan('tenant-a', { workspaceGid: 'ws-1' });
    expect(a).toEqual(b);
  });

  it('produces the project name in the HAWKEYE — <id> shape', () => {
    const plan = tenantProvisioningPlan('acme', { workspaceGid: 'ws-1' });
    expect(plan.projectName).toBe('HAWKEYE — acme');
  });

  it('assigns a stable color per tenant id', () => {
    expect(colorForTenant('acme')).toBe(colorForTenant('acme'));
    expect(colorForTenant('acme')).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('different tenants on the same workspace get the same plan shape', () => {
    const a = tenantProvisioningPlan('tenant-a', { workspaceGid: 'ws-1' });
    const b = tenantProvisioningPlan('tenant-b', { workspaceGid: 'ws-1' });
    expect(a.sections.length).toBe(b.sections.length);
    expect(a.customFields.length).toBe(b.customFields.length);
  });

  it('includes all 14 standard sections', () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    expect(plan.sections.length).toBe(STANDARD_SECTIONS.length);
    expect(plan.sections.length).toBe(14);
    expect(plan.sections.map((s) => s.name)).toContain('EOCN Freeze Required');
    expect(plan.sections.map((s) => s.name)).toContain('CNMR Filing Required');
    expect(plan.sections.map((s) => s.name)).toContain('STR Filing Required');
  });

  it('includes all 15 standard custom fields', () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    expect(plan.customFields.length).toBe(STANDARD_CUSTOM_FIELDS.length);
    expect(plan.customFields.length).toBe(15);
    expect(plan.customFields.map((f) => f.name)).toContain('Brain Verdict');
    expect(plan.customFields.map((f) => f.name)).toContain('Idempotency Key');
    expect(plan.customFields.map((f) => f.name)).toContain('Four-Eyes Pair');
  });

  it('throws when tenantId or workspaceGid is missing', () => {
    expect(() => tenantProvisioningPlan('', { workspaceGid: 'ws-1' })).toThrow();
    // @ts-expect-error testing missing field
    expect(() => tenantProvisioningPlan('t', {})).toThrow();
  });

  it('carries the regulatory anchors', () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    expect(plan.regulatory).toContain('FDL No.10/2025 Art.20-22');
    expect(plan.regulatory).toContain('Cabinet Res 74/2020 Art.4-7');
    expect(plan.regulatory).toContain('Cabinet Res 134/2025 Art.12-14');
  });
});

// ---------------------------------------------------------------------------
// Provisioner driver tests
// ---------------------------------------------------------------------------

describe('provisionTenant — driver', () => {
  it('walks every plan step exactly once on a fresh run', async () => {
    const plan = tenantProvisioningPlan('tenant-a', { workspaceGid: 'ws-1' });
    const dispatcher = makeRecordingDispatcher();
    const result = await provisionTenant(plan, dispatcher);

    expect(result.ok).toBe(true);
    expect(result.projectGid).toBe('proj-1');
    expect(result.webhookGid).toBe('wh-1');
    expect(dispatcher.calls.ensureProject).toBe(1);
    expect(dispatcher.calls.ensureSection).toBe(plan.sections.length);
    expect(dispatcher.calls.ensureCustomField).toBe(plan.customFields.length);
    expect(dispatcher.calls.ensureWebhook).toBe(1);
  });

  it('records created vs reused steps in the audit trail', async () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    const dispatcher: AsanaProvisionDispatcher = {
      ensureProject: vi.fn(async () => ({ projectGid: 'p', created: false })),
      ensureSection: vi.fn(async ({ name }) => ({ sectionGid: name, created: false })),
      ensureCustomField: vi.fn(async ({ field }) => ({ fieldGid: field.name, created: false })),
      ensureWebhook: vi.fn(async () => ({ webhookGid: 'w', created: false })),
    };
    const result = await provisionTenant(plan, dispatcher);
    expect(result.ok).toBe(true);
    // Every step succeeded but was reused (created=false everywhere).
    expect(result.steps.every((s) => s.ok && !s.created)).toBe(true);
  });

  it('continues after a single section failure — does not abort the run', async () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    const dispatcher: AsanaProvisionDispatcher = {
      ensureProject: async () => ({ projectGid: 'p', created: true }),
      ensureSection: async ({ name }) => {
        if (name === 'Inbox') throw new Error('asana 503');
        return { sectionGid: name, created: true };
      },
      ensureCustomField: async ({ field }) => ({ fieldGid: field.name, created: true }),
      ensureWebhook: async () => ({ webhookGid: 'w', created: true }),
    };
    const result = await provisionTenant(plan, dispatcher);
    // ok must be false because at least one step failed.
    expect(result.ok).toBe(false);
    // But every other step still ran.
    const sectionSteps = result.steps.filter((s) => s.step === 'section');
    expect(sectionSteps.length).toBe(plan.sections.length);
    const failed = sectionSteps.filter((s) => !s.ok);
    expect(failed.length).toBe(1);
    expect(failed[0]!.name).toBe('Inbox');
    // Webhook still attempted.
    const webhookSteps = result.steps.filter((s) => s.step === 'webhook');
    expect(webhookSteps.length).toBe(1);
    expect(webhookSteps[0]!.ok).toBe(true);
  });

  it('aborts section + webhook steps when project creation fails', async () => {
    const plan = tenantProvisioningPlan('t', { workspaceGid: 'ws-1' });
    const dispatcher: AsanaProvisionDispatcher = {
      ensureProject: async () => {
        throw new Error('asana 401');
      },
      ensureSection: async () => ({ sectionGid: 's', created: true }),
      ensureCustomField: async () => ({ fieldGid: 'f', created: true }),
      ensureWebhook: async () => ({ webhookGid: 'w', created: true }),
    };
    const result = await provisionTenant(plan, dispatcher);
    expect(result.ok).toBe(false);
    expect(result.projectGid).toBeNull();
    expect(result.steps.length).toBe(1);
    expect(result.steps[0]!.step).toBe('project');
    expect(result.steps[0]!.ok).toBe(false);
  });
});
