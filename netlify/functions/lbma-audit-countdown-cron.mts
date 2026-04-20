/**
 * LBMA Audit Countdown cron — generated from routines.html catalog.
 *
 * Schedule: `0 9 * * *` (09:00 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: lbma-audit-countdown
 * Regulatory basis: LBMA RGG v9 Step 5 · DGD Annual Audit
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
    id: 'lbma-audit-countdown',
    title: 'LBMA Audit Countdown',
    module: 'esg_supply_lbma',
    cadenceHuman: '09:00 UTC daily',
    regulatoryBasis: 'LBMA RGG v9 Step 5 · DGD Annual Audit',
    auditStore: 'lbma-audit-countdown',
    description: 'Daily 12-month LBMA / DGD external audit deadline tracker.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 9 * * *',
};
