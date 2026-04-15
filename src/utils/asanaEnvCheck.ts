/**
 * Asana Deploy-Readiness Env Validator.
 *
 * Single source of truth for "is this deploy actually going to work?"
 * — checks every env var the autopilot dispatcher and its mirrors
 * depend on and reports a structured result the operator (Luisa) can
 * read at a glance before flipping the deploy switch.
 *
 * Three severity tiers:
 *   - BLOCKER : missing → core feature is broken, deploy WILL fail
 *   - WARNING : missing → an enhancement degrades to a no-op silently
 *   - INFO    : configured → confirmation message
 *
 * The validator is PURE — takes an env map (defaulting to process.env)
 * and returns a result object. No I/O, no side effects, fully testable.
 *
 * Run via:
 *   npm run asana:env:check
 *
 * Wired into:
 *   - skills/deploy-check/SKILL.md  (manual pre-deploy gate)
 *   - scripts/asana-env-check.ts    (CLI entry that exits 1 on blockers)
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — operational
 *     readiness must be verifiable before going live)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review —
 *     configuration drift is itself an inspector finding)
 */

export type CheckSeverity = 'blocker' | 'warning' | 'info';

export interface EnvCheckEntry {
  severity: CheckSeverity;
  category: string;
  /** Short title — appears in the summary table. */
  title: string;
  /** Long-form explanation — appears in the detail report. */
  detail: string;
  /** Env var name (or comma-joined names for multi-key checks). */
  envKey: string;
  /** Hint to the operator on how to fix this. */
  fix?: string;
}

export interface EnvCheckResult {
  ok: boolean;
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  entries: readonly EnvCheckEntry[];
}

type EnvSource = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

interface CheckContext {
  env: EnvSource;
  entries: EnvCheckEntry[];
}

function present(env: EnvSource, key: string): boolean {
  const v = env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

function pushBlocker(ctx: CheckContext, e: Omit<EnvCheckEntry, 'severity'>): void {
  ctx.entries.push({ severity: 'blocker', ...e });
}

function pushWarning(ctx: CheckContext, e: Omit<EnvCheckEntry, 'severity'>): void {
  ctx.entries.push({ severity: 'warning', ...e });
}

function pushInfo(ctx: CheckContext, e: Omit<EnvCheckEntry, 'severity'>): void {
  ctx.entries.push({ severity: 'info', ...e });
}

// ---- Core Asana ----

function checkAsanaCore(ctx: CheckContext): void {
  if (!present(ctx.env, 'ASANA_TOKEN')) {
    pushBlocker(ctx, {
      category: 'Core Asana',
      title: 'ASANA_TOKEN missing',
      envKey: 'ASANA_TOKEN',
      detail:
        'The autopilot dispatcher cannot reach Asana without a personal access token. Every cron and mirror skips silently when this is unset.',
      fix: 'Generate at https://app.asana.com/0/my-apps and set in Netlify env vars.',
    });
  } else {
    pushInfo(ctx, {
      category: 'Core Asana',
      title: 'ASANA_TOKEN configured',
      envKey: 'ASANA_TOKEN',
      detail: 'Asana API access is configured.',
    });
  }

  if (!present(ctx.env, 'ASANA_WORKSPACE_GID')) {
    pushBlocker(ctx, {
      category: 'Core Asana',
      title: 'ASANA_WORKSPACE_GID missing',
      envKey: 'ASANA_WORKSPACE_GID',
      detail:
        'The CF bootstrap, webhook bootstrap, and weekly status cron all need the workspace GID. The dispatcher fails to provision custom fields without it.',
      fix: 'Find at https://app.asana.com/api/1.0/workspaces and set in Netlify env vars.',
    });
  } else {
    pushInfo(ctx, {
      category: 'Core Asana',
      title: 'ASANA_WORKSPACE_GID configured',
      envKey: 'ASANA_WORKSPACE_GID',
      detail: 'Workspace identifier is configured.',
    });
  }
}

// ---- Custom field GIDs ----

interface CfDefinition {
  fieldKey: string;
  optionKeys: readonly string[];
  title: string;
  what: string;
}

const REQUIRED_CFS: readonly CfDefinition[] = [
  {
    fieldKey: 'ASANA_CF_RISK_LEVEL_GID',
    optionKeys: [
      'ASANA_CF_RISK_LEVEL_CRITICAL',
      'ASANA_CF_RISK_LEVEL_HIGH',
      'ASANA_CF_RISK_LEVEL_MEDIUM',
      'ASANA_CF_RISK_LEVEL_LOW',
    ],
    title: 'Risk level',
    what: 'compliance risk rating chip on every dispatched task',
  },
  {
    fieldKey: 'ASANA_CF_VERDICT_GID',
    optionKeys: [
      'ASANA_CF_VERDICT_PASS',
      'ASANA_CF_VERDICT_FLAG',
      'ASANA_CF_VERDICT_ESCALATE',
      'ASANA_CF_VERDICT_FREEZE',
    ],
    title: 'Brain verdict',
    what: 'verdict chip used by the central MLRO mirror + audit log mirror + inspector mirror',
  },
  {
    fieldKey: 'ASANA_CF_DEADLINE_TYPE_GID',
    optionKeys: [
      'ASANA_CF_DEADLINE_TYPE_STR',
      'ASANA_CF_DEADLINE_TYPE_CTR',
      'ASANA_CF_DEADLINE_TYPE_CNMR',
      'ASANA_CF_DEADLINE_TYPE_DPMSR',
      'ASANA_CF_DEADLINE_TYPE_EOCN',
    ],
    title: 'Deadline type',
    what: 'EOCN tag attached to freeze cases for the 24h deadline rollup',
  },
  {
    fieldKey: 'ASANA_CF_PEP_FLAG_GID',
    optionKeys: [
      'ASANA_CF_PEP_FLAG_CLEAR',
      'ASANA_CF_PEP_FLAG_POTENTIAL',
      'ASANA_CF_PEP_FLAG_MATCH',
    ],
    title: 'PEP flag',
    what: 'PEP screening result chip on customer cases',
  },
  {
    fieldKey: 'ASANA_CF_MANUAL_ACTION_GID',
    optionKeys: ['ASANA_CF_MANUAL_ACTION_PENDING', 'ASANA_CF_MANUAL_ACTION_DONE'],
    title: 'Awaiting Manual Action',
    what: 'Tier-4 #13 red chip prompting the MLRO to execute the freeze in the bank portal',
  },
];

const SCALAR_CFS: readonly { key: string; title: string; what: string }[] = [
  {
    key: 'ASANA_CF_CASE_ID_GID',
    title: 'Case / filing ID',
    what: 'machine-readable case id on every dispatched task',
  },
  {
    key: 'ASANA_CF_DAYS_REMAINING_GID',
    title: 'Days remaining',
    what: 'business days remaining until regulatory deadline',
  },
  {
    key: 'ASANA_CF_CONFIDENCE_GID',
    title: 'Brain confidence',
    what: 'verdict confidence percent for inspector traceability',
  },
  {
    key: 'ASANA_CF_REGULATION_GID',
    title: 'Regulation citation',
    what: 'Article / Circular citation on every dispatched task',
  },
];

function checkCustomFields(ctx: CheckContext): void {
  for (const cf of REQUIRED_CFS) {
    const fieldPresent = present(ctx.env, cf.fieldKey);
    const missingOptions = cf.optionKeys.filter((k) => !present(ctx.env, k));

    if (!fieldPresent) {
      pushWarning(ctx, {
        category: 'Custom fields',
        title: `${cf.title} (${cf.fieldKey}) unset`,
        envKey: cf.fieldKey,
        detail: `The ${cf.what} will be silently dropped from every task payload until the field GID is set. Reporting degrades, dispatches still work.`,
        fix: 'Run `npm run asana:bootstrap:cf -- --apply` against your live workspace and paste the printed export lines into Netlify env vars.',
      });
      continue;
    }

    if (missingOptions.length > 0) {
      pushWarning(ctx, {
        category: 'Custom fields',
        title: `${cf.title} option GIDs missing: ${missingOptions.length}/${cf.optionKeys.length}`,
        envKey: missingOptions.join(', '),
        detail: `The ${cf.title} field GID is set but ${missingOptions.length} option GIDs are unset. Tasks that need a missing option will silently skip the field assignment.`,
        fix: 'Re-run `npm run asana:bootstrap:cf -- --apply` — it is idempotent and will print all the option GIDs.',
      });
      continue;
    }

    pushInfo(ctx, {
      category: 'Custom fields',
      title: `${cf.title} fully provisioned`,
      envKey: cf.fieldKey,
      detail: `${cf.title} field + all ${cf.optionKeys.length} option GIDs are configured.`,
    });
  }

  for (const cf of SCALAR_CFS) {
    if (!present(ctx.env, cf.key)) {
      pushWarning(ctx, {
        category: 'Custom fields',
        title: `${cf.title} (${cf.key}) unset`,
        envKey: cf.key,
        detail: `The ${cf.what} will be silently dropped from every task payload until this is set.`,
        fix: 'Run `npm run asana:bootstrap:cf -- --apply` and paste the export line.',
      });
    } else {
      pushInfo(ctx, {
        category: 'Custom fields',
        title: `${cf.title} configured`,
        envKey: cf.key,
        detail: `${cf.title} field GID is set.`,
      });
    }
  }
}

// ---- Cross-project mirror destinations ----

function checkMirrorDestinations(ctx: CheckContext): void {
  const mirrors: Array<{
    key: string;
    title: string;
    what: string;
    fix: string;
  }> = [
    {
      key: 'ASANA_CENTRAL_MLRO_PROJECT_GID',
      title: 'Central MLRO triage project',
      what: 'the cross-project triage queue for freeze + escalate + blocked cases',
      fix: 'Create a project in Asana named "🚨 MLRO Central — Blocked Across Customers", copy its GID, set in Netlify.',
    },
    {
      key: 'ASANA_AUDIT_LOG_PROJECT_GID',
      title: 'Audit log mirror project',
      what: 'the durable mirror of the dispatch audit log (FDL Art.24 10-year retention)',
      fix: 'Create a project in Asana named "📜 Compliance Audit Log — 10-Year Retention", copy its GID, set in Netlify.',
    },
    {
      key: 'ASANA_INSPECTOR_PROJECT_GID',
      title: 'Inspector evidence mirror project',
      what: 'the regulator-facing read-only audit trail (LBMA + MoE inspections)',
      fix: 'Run `npm run asana:bootstrap:inspector -- --apply` then share read-only with inspectors.',
    },
  ];

  for (const m of mirrors) {
    if (!present(ctx.env, m.key)) {
      pushWarning(ctx, {
        category: 'Mirror destinations',
        title: `${m.title} unconfigured`,
        envKey: m.key,
        detail: `${m.what} will not activate. The mirror code is wired but is a no-op until the destination GID is set.`,
        fix: m.fix,
      });
    } else {
      pushInfo(ctx, {
        category: 'Mirror destinations',
        title: `${m.title} configured`,
        envKey: m.key,
        detail: `Mirror destination is set; the post-dispatch hook will fan out matching entries.`,
      });
    }
  }
}

// ---- Four-eyes / solo-MLRO ----

function checkFourEyes(ctx: CheckContext): void {
  const keysRaw = ctx.env.HAWKEYE_APPROVER_KEYS ?? '';
  const soloRaw = ctx.env.HAWKEYE_SOLO_MLRO_MODE ?? '';
  const soloEnabled =
    soloRaw.trim().toLowerCase() === 'true' ||
    soloRaw.trim() === '1' ||
    soloRaw.trim().toLowerCase() === 'yes' ||
    soloRaw.trim().toLowerCase() === 'on';

  // Parse the comma-separated user-id:key pairs.
  const entries = keysRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const placeholderCount = entries.filter((e) => /REPLACE_ME/i.test(e)).length;
  const validEntries = entries.length - placeholderCount;

  if (entries.length === 0) {
    pushBlocker(ctx, {
      category: 'Four-eyes',
      title: 'HAWKEYE_APPROVER_KEYS empty',
      envKey: 'HAWKEYE_APPROVER_KEYS',
      detail:
        'The four-eyes approval API requires at least one approver key. Without it, freeze + escalate decisions cannot be approved at all.',
      fix: 'Generate a key with `openssl rand -hex 16` and set HAWKEYE_APPROVER_KEYS=user-mlro:<key> in Netlify.',
    });
    return;
  }

  if (placeholderCount > 0) {
    pushBlocker(ctx, {
      category: 'Four-eyes',
      title: `HAWKEYE_APPROVER_KEYS contains ${placeholderCount} REPLACE_ME placeholder(s)`,
      envKey: 'HAWKEYE_APPROVER_KEYS',
      detail:
        'Placeholder values from .env.example will be rejected by the auth middleware. Real approvers will be locked out.',
      fix: 'Replace each REPLACE_ME with a key from `openssl rand -hex 16`.',
    });
    return;
  }

  if (soloEnabled) {
    if (validEntries < 1) {
      pushBlocker(ctx, {
        category: 'Four-eyes',
        title: 'Solo-MLRO mode enabled but no approver key set',
        envKey: 'HAWKEYE_SOLO_MLRO_MODE,HAWKEYE_APPROVER_KEYS',
        detail: 'HAWKEYE_SOLO_MLRO_MODE=true requires exactly 1 entry in HAWKEYE_APPROVER_KEYS.',
        fix: 'Set HAWKEYE_APPROVER_KEYS=user-mlro:<32-hex-key>.',
      });
    } else if (validEntries === 1) {
      const cooldownRaw = ctx.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS ?? '24';
      const cooldown = Number.parseFloat(cooldownRaw);
      const cooldownHours =
        Number.isFinite(cooldown) && cooldown > 0 ? Math.max(1, Math.min(168, cooldown)) : 24;
      pushInfo(ctx, {
        category: 'Four-eyes',
        title: `Solo-MLRO mode active (cooldown ${cooldownHours}h)`,
        envKey: 'HAWKEYE_SOLO_MLRO_MODE',
        detail: `The same MLRO can cast both votes on freeze + escalate decisions, with a ${cooldownHours}-hour cooldown between votes enforced server-side.`,
      });
    } else {
      pushWarning(ctx, {
        category: 'Four-eyes',
        title: `Solo-MLRO mode enabled but ${validEntries} approvers configured`,
        envKey: 'HAWKEYE_SOLO_MLRO_MODE,HAWKEYE_APPROVER_KEYS',
        detail:
          'Solo mode is a 1-MLRO fallback. With 2+ approvers configured, the picker will use the standard distinct-approver path and the cooldown will not apply. Consider unsetting HAWKEYE_SOLO_MLRO_MODE.',
        fix: 'Either remove the extra approvers or unset HAWKEYE_SOLO_MLRO_MODE.',
      });
    }
    return;
  }

  // Standard dual-MLRO path.
  if (validEntries < 2) {
    pushBlocker(ctx, {
      category: 'Four-eyes',
      title: `Standard four-eyes mode requires 2 approvers, found ${validEntries}`,
      envKey: 'HAWKEYE_APPROVER_KEYS',
      detail:
        'Cabinet Res 134/2025 Art.19 requires two distinct approvers on freeze + escalate decisions. The dispatcher will reject these decisions until a second approver is added — OR enable solo-MLRO mode.',
      fix: 'Add a second user-id:key pair to HAWKEYE_APPROVER_KEYS, OR set HAWKEYE_SOLO_MLRO_MODE=true.',
    });
  } else {
    pushInfo(ctx, {
      category: 'Four-eyes',
      title: `Standard four-eyes mode (${validEntries} approvers)`,
      envKey: 'HAWKEYE_APPROVER_KEYS',
      detail: `${validEntries} distinct approvers are configured for Cabinet Res 134/2025 Art.19 four-eyes review.`,
    });
  }
}

// ---- Webhook receiver public URL ----

function checkPublicUrl(ctx: CheckContext): void {
  const url = ctx.env.PUBLIC_BASE_URL ?? ctx.env.HAWKEYE_BRAIN_URL;
  if (!url) {
    pushWarning(ctx, {
      category: 'Webhooks',
      title: 'PUBLIC_BASE_URL / HAWKEYE_BRAIN_URL unset',
      envKey: 'PUBLIC_BASE_URL,HAWKEYE_BRAIN_URL',
      detail:
        'The webhook bootstrap script computes the receiver target from this. Without it, `npm run asana:bootstrap:webhooks` cannot subscribe webhooks.',
      fix: 'Set PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app in Netlify env vars.',
    });
    return;
  }
  if (!url.startsWith('https://')) {
    pushBlocker(ctx, {
      category: 'Webhooks',
      title: 'PUBLIC_BASE_URL is not HTTPS',
      envKey: 'PUBLIC_BASE_URL',
      detail:
        'Asana refuses non-HTTPS webhook targets, and CLAUDE.md security guarantees require HTTPS. The webhook bootstrap will fail.',
      fix: 'Set the URL to start with https://.',
    });
    return;
  }
  pushInfo(ctx, {
    category: 'Webhooks',
    title: 'Public base URL configured',
    envKey: ctx.env.PUBLIC_BASE_URL ? 'PUBLIC_BASE_URL' : 'HAWKEYE_BRAIN_URL',
    detail: `Webhook receiver target will be ${url.replace(/\/$/, '')}/api/asana/webhook`,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the full pre-deploy env validation. Pure — defaults to
 * process.env but accepts an explicit map for tests.
 */
export function checkAsanaDeployReadiness(
  env: EnvSource = (typeof process !== 'undefined' && process.env) || {}
): EnvCheckResult {
  const ctx: CheckContext = { env, entries: [] };

  checkAsanaCore(ctx);
  checkCustomFields(ctx);
  checkMirrorDestinations(ctx);
  checkFourEyes(ctx);
  checkPublicUrl(ctx);

  const blockerCount = ctx.entries.filter((e) => e.severity === 'blocker').length;
  const warningCount = ctx.entries.filter((e) => e.severity === 'warning').length;
  const infoCount = ctx.entries.filter((e) => e.severity === 'info').length;

  return {
    ok: blockerCount === 0,
    blockerCount,
    warningCount,
    infoCount,
    entries: ctx.entries,
  };
}

/**
 * Pretty-print a deploy-readiness result as a console-friendly
 * string. Used by the CLI entry point.
 */
export function formatEnvCheckReport(result: EnvCheckResult): string {
  const lines: string[] = [];
  lines.push('# Asana deploy-readiness report');
  lines.push('');
  lines.push(
    `# ${result.ok ? '✅ OK' : '❌ BLOCKED'}: ${result.blockerCount} blocker(s), ${result.warningCount} warning(s), ${result.infoCount} info`
  );
  lines.push('');

  const byCategory = new Map<string, EnvCheckEntry[]>();
  for (const e of result.entries) {
    const arr = byCategory.get(e.category) ?? [];
    arr.push(e);
    byCategory.set(e.category, arr);
  }

  for (const [category, entries] of byCategory.entries()) {
    lines.push(`## ${category}`);
    for (const e of entries) {
      const icon = e.severity === 'blocker' ? '🚫' : e.severity === 'warning' ? '⚠ ' : '✓ ';
      lines.push(`${icon} ${e.title}`);
      if (e.severity !== 'info') {
        lines.push(`    ${e.detail}`);
        if (e.fix) lines.push(`    Fix: ${e.fix}`);
      }
    }
    lines.push('');
  }

  if (!result.ok) {
    lines.push('# Resolve the blockers above before re-deploying.');
  } else if (result.warningCount > 0) {
    lines.push(
      '# Deploy is safe but warnings indicate features that will degrade silently. Address when convenient.'
    );
  } else {
    lines.push('# All checks passed. Safe to deploy.');
  }

  return lines.join('\n');
}
