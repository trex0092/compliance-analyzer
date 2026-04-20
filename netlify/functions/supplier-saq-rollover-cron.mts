/**
 * Supplier SAQ Rollover cron — generated from routines.html catalog.
 *
 * Schedule: `0 7 * * 1` (Mon 07:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: saq-rollover-audit
 * Regulatory basis: LBMA RGG v9 Step 3 · RJC COP
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
    id: 'supplier-saq-rollover',
    title: 'Supplier SAQ Rollover',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Mon 07:00 UTC',
    regulatoryBasis: 'LBMA RGG v9 Step 3 · RJC COP',
    auditStore: 'saq-rollover-audit',
    description: 'Monday annual SAQ refresh cycle — tracks supplier SAQ expiry.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 7 * * 1',
};
