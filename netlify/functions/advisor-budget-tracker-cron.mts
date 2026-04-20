/**
 * Advisor Budget Tracker cron — generated from routines.html catalog.
 *
 * Schedule: `0 2 * * *` (02:00 UTC daily)
 * Module: governance_and_retention (Asana board resolved via the 16-project catalog)
 * Audit store: advisor-budget-audit
 * Regulatory basis: NIST AI RMF MANAGE-2 · ISO/IEC 42001 §8.2
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
    id: 'advisor-budget-tracker',
    title: 'Advisor Budget Tracker',
    module: 'governance_and_retention',
    cadenceHuman: '02:00 UTC daily',
    regulatoryBasis: 'NIST AI RMF MANAGE-2 · ISO/IEC 42001 §8.2',
    auditStore: 'advisor-budget-audit',
    description: 'Daily Opus advisor call-count + cost tracker. Enforces 80/20 rule.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 2 * * *',
};
