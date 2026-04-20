/**
 * Chain-of-Custody Verify cron — generated from routines.html catalog.
 *
 * Schedule: `0 8 * * *` (08:00 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: coc-audit
 * Regulatory basis: LBMA RGG v9 Step 3 · OECD DD Guidance
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
    id: 'chain-of-custody-verify',
    title: 'Chain-of-Custody Verify',
    module: 'esg_supply_lbma',
    cadenceHuman: '08:00 UTC daily',
    regulatoryBasis: 'LBMA RGG v9 Step 3 · OECD DD Guidance',
    auditStore: 'coc-audit',
    description: 'LBMA RGG Step 3 full chain-of-custody verification per bullion bar.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 8 * * *',
};
