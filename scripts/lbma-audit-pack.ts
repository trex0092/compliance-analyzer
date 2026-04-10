#!/usr/bin/env tsx
/**
 * LBMA Audit Pack Generator
 *
 * Reformats the weekly MoE inspection simulator output into the LBMA
 * Responsible Gold Guidance v9 five-step framework:
 *
 *   Step 1 — Establish strong company management systems
 *   Step 2 — Identify and assess risks in the supply chain
 *   Step 3 — Design and implement a strategy to respond to risks
 *   Step 4 — Carry out independent audit of refiner's DD practices
 *   Step 5 — Report on supply chain due diligence
 *
 * Maps the 25 MoE inspection items to the correct LBMA step based on
 * their area (Governance → 1, Risk Assessment → 2, CDD+TFS → 3,
 * Records → 4, DPMS → 5) and produces:
 *
 *   history/lbma/YYYY-MM-DD-lbma-audit-pack.md
 *   history/lbma/YYYY-MM-DD-lbma-audit-pack.json
 *
 * Runs locally (`npm run audit:lbma`) or weekly via GitHub Actions
 * (`.github/workflows/lbma-audit-pack.yml` — Monday 07:00 UTC).
 *
 * Appends a "lbma_audit_pack" entry to the evidence chain so the
 * generation event is auditable.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'history', 'lbma');

// ---------------------------------------------------------------------------
// MoE inspection area → LBMA step mapping
// ---------------------------------------------------------------------------

type LBMAStep = 1 | 2 | 3 | 4 | 5;

interface StepDef {
  step: LBMAStep;
  title: string;
  description: string;
}

const LBMA_STEPS: StepDef[] = [
  {
    step: 1,
    title: 'Establish strong company management systems',
    description:
      'Board-approved AML/CFT policy, CO appointment, independent audit schedule, governance framework.',
  },
  {
    step: 2,
    title: 'Identify and assess risks in the supply chain',
    description:
      'Entity-wide and business-wide risk assessments, risk appetite statement, PEP and adverse media screening.',
  },
  {
    step: 3,
    title: 'Design and implement a strategy to respond to identified risks',
    description:
      'CDD/EDD procedures, UBO identification, ongoing monitoring, sanctions screening, asset freeze capability, goAML filing.',
  },
  {
    step: 4,
    title: "Carry out independent audit of refiner's due diligence practices",
    description:
      'Records retention (5-year minimum), audit trail for all compliance decisions, training records, transaction reconstruction capability.',
  },
  {
    step: 5,
    title: 'Report on supply chain due diligence',
    description:
      'DPMS quarterly reports to MoE, gold origin traceability, annual disclosure of sourcing practices, responsible sourcing report.',
  },
];

const AREA_TO_STEP: Record<string, LBMAStep> = {
  Governance: 1,
  'Risk Assessment': 2,
  CDD: 3,
  STR: 3,
  TFS: 3,
  Records: 4,
  Training: 4,
  DPMS: 5,
};

// ---------------------------------------------------------------------------
// Simulator result shape — we import the simulator dynamically
// ---------------------------------------------------------------------------

interface InspectionItemResult {
  id: string;
  area: string;
  item: string;
  weight: number;
  penalty: number;
  reason?: string;
  evidence?: string;
}

interface InspectionResult {
  score: number;
  grade: string;
  gaps: InspectionItemResult[];
  passed: InspectionItemResult[];
  maxPenalty: number;
}

async function runInspection(): Promise<InspectionResult> {
  // Dynamic import of the existing .mjs simulator.
  const mod: { runInspection: () => Promise<InspectionResult> } = await import(
    '../scripts/moe-inspection-simulator.mjs'
  );
  return await mod.runInspection();
}

// ---------------------------------------------------------------------------
// Pack assembly
// ---------------------------------------------------------------------------

interface StepSummary {
  step: LBMAStep;
  title: string;
  description: string;
  passed: InspectionItemResult[];
  gaps: InspectionItemResult[];
  score: number;
  maxScore: number;
  penaltyExposure: number;
  status: 'compliant' | 'partial' | 'gap' | 'not-tested';
}

function assembleSteps(result: InspectionResult): StepSummary[] {
  const byStep: Record<LBMAStep, StepSummary> = {} as Record<LBMAStep, StepSummary>;
  for (const def of LBMA_STEPS) {
    byStep[def.step] = {
      step: def.step,
      title: def.title,
      description: def.description,
      passed: [],
      gaps: [],
      score: 0,
      maxScore: 0,
      penaltyExposure: 0,
      status: 'not-tested',
    };
  }

  const assign = (item: InspectionItemResult, isPass: boolean): void => {
    const step = AREA_TO_STEP[item.area];
    if (!step) return;
    const s = byStep[step];
    if (isPass) s.passed.push(item);
    else s.gaps.push(item);
    s.maxScore += item.weight;
    if (isPass) s.score += item.weight;
    else s.penaltyExposure += item.penalty;
  };

  for (const p of result.passed) assign(p, true);
  for (const g of result.gaps) assign(g, false);

  for (const s of Object.values(byStep)) {
    if (s.maxScore === 0) s.status = 'not-tested';
    else if (s.gaps.length === 0) s.status = 'compliant';
    else if (s.passed.length === 0) s.status = 'gap';
    else s.status = 'partial';
  }

  return [byStep[1], byStep[2], byStep[3], byStep[4], byStep[5]];
}

function renderMarkdown(
  today: string,
  inspection: InspectionResult,
  steps: StepSummary[],
): string {
  const lines: string[] = [];
  lines.push(`# LBMA Responsible Gold Guidance v9 — Audit Pack`);
  lines.push('');
  lines.push(`**Entity:** Hawkeye Sterling DPMS LLC  `);
  lines.push(`**Generated:** ${today}  `);
  lines.push(`**Classification:** CONFIDENTIAL — MLRO, Board, Independent Auditor only  `);
  lines.push(`**Source:** MoE inspection simulator (25-item checklist)  `);
  lines.push('');

  // Overall
  lines.push(`## Overall compliance posture`);
  lines.push('');
  lines.push(`- **Inspection score:** ${inspection.score}/100 (Grade: ${inspection.grade})`);
  lines.push(`- **Maximum penalty exposure:** AED ${inspection.maxPenalty.toLocaleString()}`);
  lines.push(`- **Gaps identified:** ${inspection.gaps.length}`);
  lines.push(`- **Passed controls:** ${inspection.passed.length}`);
  lines.push('');

  // LBMA 5-step detail
  for (const s of steps) {
    const statusBadge = {
      compliant: '✅ COMPLIANT',
      partial: '⚠️ PARTIAL',
      gap: '❌ GAP',
      'not-tested': '⏸ NOT TESTED',
    }[s.status];
    const pct = s.maxScore === 0 ? 0 : Math.round((s.score / s.maxScore) * 100);

    lines.push(`## Step ${s.step} — ${s.title}`);
    lines.push('');
    lines.push(`_${s.description}_`);
    lines.push('');
    lines.push(`**Status:** ${statusBadge}  `);
    lines.push(`**Score:** ${s.score}/${s.maxScore} (${pct}%)  `);
    lines.push(`**Penalty exposure:** AED ${s.penaltyExposure.toLocaleString()}`);
    lines.push('');

    if (s.passed.length > 0) {
      lines.push(`### Passed controls`);
      lines.push('');
      lines.push(`| ID | Control | Weight |`);
      lines.push(`|---|---|---|`);
      for (const p of s.passed) {
        lines.push(`| \`${p.id}\` | ${p.item} | ${p.weight} |`);
      }
      lines.push('');
    }

    if (s.gaps.length > 0) {
      lines.push(`### Gaps`);
      lines.push('');
      lines.push(`| ID | Control | Reason | Weight | Penalty (AED) |`);
      lines.push(`|---|---|---|---|---|`);
      for (const g of s.gaps) {
        const reason = (g.reason ?? '—').replace(/\|/g, '\\|');
        lines.push(`| \`${g.id}\` | ${g.item} | ${reason} | ${g.weight} | ${g.penalty.toLocaleString()} |`);
      }
      lines.push('');
    }
  }

  // Remediation plan
  const allGaps = steps.flatMap((s) => s.gaps.map((g) => ({ ...g, step: s.step })));
  if (allGaps.length > 0) {
    lines.push(`## Remediation plan`);
    lines.push('');
    lines.push(
      `Addressed in order of penalty exposure (highest first). The MLRO must sign off on each remediation before it is closed.`,
    );
    lines.push('');
    lines.push(`| Priority | LBMA Step | Control | Penalty (AED) | Owner |`);
    lines.push(`|---|---|---|---|---|`);
    allGaps
      .sort((a, b) => b.penalty - a.penalty)
      .forEach((g, idx) => {
        lines.push(`| ${idx + 1} | Step ${g.step} | ${g.item} | ${g.penalty.toLocaleString()} | MLRO |`);
      });
    lines.push('');
  }

  // Sign-off
  lines.push(`## Sign-off`);
  lines.push('');
  lines.push(`- [ ] Reviewed by MLRO  ______________  Date: ____________`);
  lines.push(`- [ ] Approved by Board  ______________  Date: ____________`);
  lines.push(`- [ ] Filed with independent auditor  ______________  Date: ____________`);
  lines.push('');
  lines.push(`---`);
  lines.push(
    `Generated by \`scripts/lbma-audit-pack.ts\`. This pack is an automated snapshot; a full audit still requires an independent reviewer per LBMA RGG v9 Step 4.`,
  );

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Evidence chain append
// ---------------------------------------------------------------------------

async function appendToEvidenceChain(summary: {
  path: string;
  score: number;
  gaps: number;
}): Promise<void> {
  try {
    const mod: {
      appendEvidence: (entry: {
        action: string;
        actor: string;
        subject: string;
        detail: string;
        data: Record<string, unknown>;
      }) => Promise<void>;
    } = await import('../scripts/evidence-chain.mjs');
    await mod.appendEvidence({
      action: 'lbma_audit_pack',
      actor: 'system',
      subject: 'lbma_rgg_v9_pack',
      detail: `LBMA audit pack generated: score ${summary.score}, gaps ${summary.gaps}`,
      data: summary,
    });
  } catch (err) {
    // Non-fatal: the pack still gets written even if the chain is unavailable.
    console.warn(`  warn: evidence chain append failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log('\x1b[36m▸ LBMA Audit Pack Generator\x1b[0m');
  console.log(`  output dir: ${OUTPUT_DIR}`);
  console.log();

  console.log('  running MoE inspection simulator…');
  const inspection = await runInspection();
  console.log(`  score: ${inspection.score}/100 (${inspection.grade})`);
  console.log(`  gaps:  ${inspection.gaps.length}`);
  console.log(`  penalty exposure: AED ${inspection.maxPenalty.toLocaleString()}`);
  console.log();

  const steps = assembleSteps(inspection);
  const md = renderMarkdown(today, inspection, steps);
  const json = {
    generatedAt: new Date().toISOString(),
    entity: 'Hawkeye Sterling DPMS LLC',
    framework: 'LBMA RGG v9',
    inspection: {
      score: inspection.score,
      grade: inspection.grade,
      maxPenalty: inspection.maxPenalty,
      gapCount: inspection.gaps.length,
      passedCount: inspection.passed.length,
    },
    steps,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const mdPath = resolve(OUTPUT_DIR, `${today}-lbma-audit-pack.md`);
  const jsonPath = resolve(OUTPUT_DIR, `${today}-lbma-audit-pack.json`);
  await writeFile(mdPath, md, 'utf8');
  await writeFile(jsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');

  console.log(`  \x1b[32mwrote\x1b[0m ${mdPath}`);
  console.log(`  \x1b[32mwrote\x1b[0m ${jsonPath}`);

  await appendToEvidenceChain({
    path: mdPath,
    score: inspection.score,
    gaps: inspection.gaps.length,
  });

  console.log();
  console.log('\x1b[32m✓ audit pack ready\x1b[0m');
}

// Only run as CLI when invoked directly — not when imported by tests.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err: unknown) => {
    console.error(`fatal: ${(err as Error).message ?? err}`);
    process.exit(1);
  });
}

export { LBMA_STEPS, AREA_TO_STEP, assembleSteps, renderMarkdown };
