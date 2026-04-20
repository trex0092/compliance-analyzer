/**
 * Recycled vs Mined Origin Audit cron — generated from routines.html catalog.
 *
 * Schedule: `0 5 * * 4` (Thu 05:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: origin-audit
 * Regulatory basis: LBMA RGG v9 · UAE MoE RSG Framework
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
    id: 'recycled-vs-mined-origin',
    title: 'Recycled vs Mined Origin Audit',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Thu 05:00 UTC',
    regulatoryBasis: 'LBMA RGG v9 · UAE MoE RSG Framework',
    auditStore: 'origin-audit',
    description: 'LBMA RGG origin-classification audit — verifies recycled/mined/grandfathered.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/recycled-vs-mined-origin',
  schedule: '0 5 * * 4',
};
