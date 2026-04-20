/**
 * Carbon Scope 1-2-3 Rollup cron — generated from routines.html catalog.
 *
 * Schedule: `0 4 * * 1` (Mon 04:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: carbon-audit
 * Regulatory basis: UAE Net-Zero 2050 · GHG Protocol
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
    id: 'carbon-scope-supply-chain',
    title: 'Carbon Scope 1-2-3 Rollup',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Mon 04:00 UTC',
    regulatoryBasis: 'UAE Net-Zero 2050 · GHG Protocol',
    auditStore: 'carbon-audit',
    description: 'Scope 1/2/3 emissions rollup across the DPMS supply chain.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/carbon-scope-supply-chain',
  schedule: '0 4 * * 1',
};
