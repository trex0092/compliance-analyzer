/**
 * Bullion Assay Drift cron — generated from routines.html catalog.
 *
 * Schedule: `30 8 * * *` (08:30 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: assay-drift-audit
 * Regulatory basis: LBMA Good Delivery · DGD Assay Standard
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
    id: 'bullion-assay-drift',
    title: 'Bullion Assay Drift',
    module: 'esg_supply_lbma',
    cadenceHuman: '08:30 UTC daily',
    regulatoryBasis: 'LBMA Good Delivery · DGD Assay Standard',
    auditStore: 'assay-drift-audit',
    description: 'Daily assay-fineness drift detection — cross-checks assayed vs declared.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/bullion-assay-drift',
  schedule: '30 8 * * *',
};
