/**
 * Tests for the Asana deploy-readiness env validator. Pure function
 * exercised with explicit env maps so no test ever leaks into
 * process.env.
 */
import { describe, it, expect } from 'vitest';
import {
  checkAsanaDeployReadiness,
  formatEnvCheckReport,
} from '@/utils/asanaEnvCheck';

/**
 * A "fully configured" baseline — every required field set, every
 * mirror destination set, standard dual-MLRO four-eyes. Tests
 * remove or modify fields from this baseline to assert each check
 * fires individually.
 */
function baselineEnv(): Record<string, string> {
  return {
    ASANA_TOKEN: 'tok',
    ASANA_WORKSPACE_GID: 'workspace-1',
    PUBLIC_BASE_URL: 'https://hawkeye-sterling-v2.netlify.app',
    HAWKEYE_APPROVER_KEYS: 'user-mlro:abcdef0123456789,user-deputy:1111222233334444',
    // CFs — risk_level
    ASANA_CF_RISK_LEVEL_GID: 'cf-rl',
    ASANA_CF_RISK_LEVEL_CRITICAL: 'rl-c',
    ASANA_CF_RISK_LEVEL_HIGH: 'rl-h',
    ASANA_CF_RISK_LEVEL_MEDIUM: 'rl-m',
    ASANA_CF_RISK_LEVEL_LOW: 'rl-l',
    // CFs — verdict
    ASANA_CF_VERDICT_GID: 'cf-v',
    ASANA_CF_VERDICT_PASS: 'v-p',
    ASANA_CF_VERDICT_FLAG: 'v-f',
    ASANA_CF_VERDICT_ESCALATE: 'v-e',
    ASANA_CF_VERDICT_FREEZE: 'v-fz',
    // CFs — deadline type
    ASANA_CF_DEADLINE_TYPE_GID: 'cf-dt',
    ASANA_CF_DEADLINE_TYPE_STR: 'dt-str',
    ASANA_CF_DEADLINE_TYPE_CTR: 'dt-ctr',
    ASANA_CF_DEADLINE_TYPE_CNMR: 'dt-cnmr',
    ASANA_CF_DEADLINE_TYPE_DPMSR: 'dt-dpmsr',
    ASANA_CF_DEADLINE_TYPE_EOCN: 'dt-eocn',
    // CFs — PEP
    ASANA_CF_PEP_FLAG_GID: 'cf-pep',
    ASANA_CF_PEP_FLAG_CLEAR: 'pep-c',
    ASANA_CF_PEP_FLAG_POTENTIAL: 'pep-p',
    ASANA_CF_PEP_FLAG_MATCH: 'pep-m',
    // CFs — manual action
    ASANA_CF_MANUAL_ACTION_GID: 'cf-ma',
    ASANA_CF_MANUAL_ACTION_PENDING: 'ma-p',
    ASANA_CF_MANUAL_ACTION_DONE: 'ma-d',
    // CFs — scalars
    ASANA_CF_CASE_ID_GID: 'cf-cid',
    ASANA_CF_DAYS_REMAINING_GID: 'cf-dr',
    ASANA_CF_CONFIDENCE_GID: 'cf-conf',
    ASANA_CF_REGULATION_GID: 'cf-reg',
    // Mirror destinations
    ASANA_CENTRAL_MLRO_PROJECT_GID: 'central-1',
    ASANA_AUDIT_LOG_PROJECT_GID: 'audit-1',
    ASANA_INSPECTOR_PROJECT_GID: 'inspector-1',
  };
}

describe('checkAsanaDeployReadiness — fully configured baseline', () => {
  it('returns ok=true with zero blockers', () => {
    const result = checkAsanaDeployReadiness(baselineEnv());
    expect(result.ok).toBe(true);
    expect(result.blockerCount).toBe(0);
  });

  it('reports zero warnings when everything is configured', () => {
    const result = checkAsanaDeployReadiness(baselineEnv());
    expect(result.warningCount).toBe(0);
  });
});

describe('checkAsanaDeployReadiness — core Asana blockers', () => {
  it('blocks when ASANA_TOKEN is missing', () => {
    const env = baselineEnv();
    delete env.ASANA_TOKEN;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some((e) => e.severity === 'blocker' && e.envKey === 'ASANA_TOKEN')
    ).toBe(true);
  });

  it('blocks when ASANA_WORKSPACE_GID is missing', () => {
    const env = baselineEnv();
    delete env.ASANA_WORKSPACE_GID;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some(
        (e) => e.severity === 'blocker' && e.envKey === 'ASANA_WORKSPACE_GID'
      )
    ).toBe(true);
  });

  it('treats whitespace-only values as missing', () => {
    const env = baselineEnv();
    env.ASANA_TOKEN = '   ';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
  });
});

describe('checkAsanaDeployReadiness — custom field warnings', () => {
  it('warns (not blocks) when a CF field GID is unset', () => {
    const env = baselineEnv();
    delete env.ASANA_CF_RISK_LEVEL_GID;
    delete env.ASANA_CF_RISK_LEVEL_CRITICAL;
    delete env.ASANA_CF_RISK_LEVEL_HIGH;
    delete env.ASANA_CF_RISK_LEVEL_MEDIUM;
    delete env.ASANA_CF_RISK_LEVEL_LOW;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('warns when a CF option GID is missing while the field GID is set', () => {
    const env = baselineEnv();
    delete env.ASANA_CF_VERDICT_FREEZE;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    const warning = result.entries.find(
      (e) => e.severity === 'warning' && e.title.includes('Brain verdict option GIDs missing')
    );
    expect(warning).toBeDefined();
  });

  it('warns when the manual-action chip is unconfigured (Tier-4 #13)', () => {
    const env = baselineEnv();
    delete env.ASANA_CF_MANUAL_ACTION_GID;
    delete env.ASANA_CF_MANUAL_ACTION_PENDING;
    delete env.ASANA_CF_MANUAL_ACTION_DONE;
    const result = checkAsanaDeployReadiness(env);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.envKey === 'ASANA_CF_MANUAL_ACTION_GID'
      )
    ).toBe(true);
  });
});

describe('checkAsanaDeployReadiness — mirror destinations', () => {
  it('warns when the central MLRO mirror destination is unset', () => {
    const env = baselineEnv();
    delete env.ASANA_CENTRAL_MLRO_PROJECT_GID;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.envKey === 'ASANA_CENTRAL_MLRO_PROJECT_GID'
      )
    ).toBe(true);
  });

  it('warns when the audit log mirror destination is unset', () => {
    const env = baselineEnv();
    delete env.ASANA_AUDIT_LOG_PROJECT_GID;
    const result = checkAsanaDeployReadiness(env);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.envKey === 'ASANA_AUDIT_LOG_PROJECT_GID'
      )
    ).toBe(true);
  });

  it('warns when the inspector mirror destination is unset', () => {
    const env = baselineEnv();
    delete env.ASANA_INSPECTOR_PROJECT_GID;
    const result = checkAsanaDeployReadiness(env);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.envKey === 'ASANA_INSPECTOR_PROJECT_GID'
      )
    ).toBe(true);
  });
});

describe('checkAsanaDeployReadiness — four-eyes / solo-MLRO', () => {
  it('blocks when HAWKEYE_APPROVER_KEYS is empty', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = '';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some(
        (e) => e.severity === 'blocker' && e.title.includes('HAWKEYE_APPROVER_KEYS empty')
      )
    ).toBe(true);
  });

  it('blocks when HAWKEYE_APPROVER_KEYS contains REPLACE_ME placeholders', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = 'user-mlro:REPLACE_ME,user-deputy:REPLACE_ME';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some(
        (e) => e.severity === 'blocker' && e.title.includes('REPLACE_ME placeholder')
      )
    ).toBe(true);
  });

  it('blocks when standard mode has only 1 approver and solo mode is OFF', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = 'user-mlro:abcdef0123456789';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some(
        (e) => e.severity === 'blocker' && e.title.includes('Standard four-eyes mode requires 2')
      )
    ).toBe(true);
  });

  it('accepts solo-MLRO mode with exactly 1 approver', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = 'user-mlro:abcdef0123456789';
    env.HAWKEYE_SOLO_MLRO_MODE = 'true';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(
      result.entries.some(
        (e) => e.severity === 'info' && e.title.includes('Solo-MLRO mode active')
      )
    ).toBe(true);
  });

  it('warns when solo-MLRO is enabled but 2+ approvers configured', () => {
    const env = baselineEnv();
    env.HAWKEYE_SOLO_MLRO_MODE = 'true';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.title.includes('Solo-MLRO mode enabled but')
      )
    ).toBe(true);
  });

  it('reports the configured cooldown hours in the solo-mode info line', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = 'user-mlro:abcdef0123456789';
    env.HAWKEYE_SOLO_MLRO_MODE = 'true';
    env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '12';
    const result = checkAsanaDeployReadiness(env);
    const soloInfo = result.entries.find((e) => e.title.includes('Solo-MLRO mode active'));
    expect(soloInfo?.title).toContain('12h');
  });

  it('clamps an out-of-range cooldown value when reporting', () => {
    const env = baselineEnv();
    env.HAWKEYE_APPROVER_KEYS = 'user-mlro:abcdef0123456789';
    env.HAWKEYE_SOLO_MLRO_MODE = 'true';
    env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '999';
    const result = checkAsanaDeployReadiness(env);
    const soloInfo = result.entries.find((e) => e.title.includes('Solo-MLRO mode active'));
    expect(soloInfo?.title).toContain('168h');
  });
});

describe('checkAsanaDeployReadiness — webhook receiver URL', () => {
  it('warns (not blocks) when PUBLIC_BASE_URL is unset', () => {
    const env = baselineEnv();
    delete env.PUBLIC_BASE_URL;
    delete env.HAWKEYE_BRAIN_URL;
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(
      result.entries.some(
        (e) => e.severity === 'warning' && e.envKey === 'PUBLIC_BASE_URL,HAWKEYE_BRAIN_URL'
      )
    ).toBe(true);
  });

  it('blocks when PUBLIC_BASE_URL is HTTP not HTTPS', () => {
    const env = baselineEnv();
    env.PUBLIC_BASE_URL = 'http://hawkeye-sterling-v2.netlify.app';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(false);
    expect(
      result.entries.some(
        (e) => e.severity === 'blocker' && e.title.includes('not HTTPS')
      )
    ).toBe(true);
  });

  it('falls back to HAWKEYE_BRAIN_URL when PUBLIC_BASE_URL is unset', () => {
    const env = baselineEnv();
    delete env.PUBLIC_BASE_URL;
    env.HAWKEYE_BRAIN_URL = 'https://hawkeye-sterling-v2.netlify.app';
    const result = checkAsanaDeployReadiness(env);
    expect(result.ok).toBe(true);
    expect(
      result.entries.some(
        (e) => e.severity === 'info' && e.envKey === 'HAWKEYE_BRAIN_URL'
      )
    ).toBe(true);
  });
});

describe('formatEnvCheckReport', () => {
  it('reports OK at the top when there are no blockers', () => {
    const result = checkAsanaDeployReadiness(baselineEnv());
    const report = formatEnvCheckReport(result);
    expect(report).toContain('✅ OK');
  });

  it('reports BLOCKED at the top when any blocker exists', () => {
    const env = baselineEnv();
    delete env.ASANA_TOKEN;
    const report = formatEnvCheckReport(checkAsanaDeployReadiness(env));
    expect(report).toContain('❌ BLOCKED');
  });

  it('groups entries by category', () => {
    const result = checkAsanaDeployReadiness(baselineEnv());
    const report = formatEnvCheckReport(result);
    expect(report).toContain('## Core Asana');
    expect(report).toContain('## Custom fields');
    expect(report).toContain('## Mirror destinations');
    expect(report).toContain('## Four-eyes');
    expect(report).toContain('## Webhooks');
  });

  it('includes fix hints for blockers', () => {
    const env = baselineEnv();
    delete env.ASANA_TOKEN;
    const report = formatEnvCheckReport(checkAsanaDeployReadiness(env));
    expect(report).toContain('Fix:');
  });
});
