/**
 * Brain Lessons Archive cron — generated from routines.html catalog.
 *
 * Schedule: `0 2 * * *` (02:00 UTC daily)
 * Module: governance_and_retention (Asana board resolved via the 16-project catalog)
 * Audit store: brain-lessons-audit
 * Regulatory basis: EU AI Act Art.15 · FDL No.10/2025 Art.21
 *
 * Thin wrapper — delegates to the shared routineRunner so every
 * routine has a consistent audit shape + resolver-driven Asana
 * dispatch. When bespoke domain logic lands here, extract it into
 * the runner's sampleNote or replace this file with a dedicated
 * handler (FDL Art.24 10-yr audit retention applies either way).
 */
import type { Config } from '@netlify/functions';
import { runRoutine } from '../../src/services/routineRunner';

export default async (): Promise<Response> => {
  const result = await runRoutine({
    id: 'brain-lessons-archive',
    title: 'Brain Lessons Archive',
    module: 'governance_and_retention',
    cadenceHuman: '02:00 UTC daily',
    regulatoryBasis: 'EU AI Act Art.15 · FDL No.10/2025 Art.21',
    auditStore: 'brain-lessons-audit',
    description: 'Daily rollup of deepBrain.lessons across every run in the last 24h.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 2 * * *',
};
