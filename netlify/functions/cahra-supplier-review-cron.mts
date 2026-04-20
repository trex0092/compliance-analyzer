/**
 * CAHRA Supplier Review cron — generated from routines.html catalog.
 *
 * Schedule: `0 4 * * 2` (Tue 04:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: cahra-audit
 * Regulatory basis: LBMA RGG v9 Step 2 · UAE MoE RSG
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
    id: 'cahra-supplier-review',
    title: 'CAHRA Supplier Review',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Tue 04:00 UTC',
    regulatoryBasis: 'LBMA RGG v9 Step 2 · UAE MoE RSG',
    auditStore: 'cahra-audit',
    description: 'LBMA RGG v9 Step 2 CAHRA sweep across DPMS supplier relationships.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/cahra-supplier-review',
  schedule: '0 4 * * 2',
};
