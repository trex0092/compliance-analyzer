/**
 * Mercury / Minamata Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `0 4 * * 5` (Fri 04:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: mercury-audit
 * Regulatory basis: Minamata Convention · UAE MoE RSG
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
    id: 'mercury-minamata-sweep',
    title: 'Mercury / Minamata Sweep',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Fri 04:00 UTC',
    regulatoryBasis: 'Minamata Convention · UAE MoE RSG',
    auditStore: 'mercury-audit',
    description: 'Minamata Convention compliance sweep — mercury use in gold processing.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/mercury-minamata-sweep',
  schedule: '0 4 * * 5',
};
