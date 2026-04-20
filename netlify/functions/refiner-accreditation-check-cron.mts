/**
 * Refiner Accreditation Check cron — generated from routines.html catalog.
 *
 * Schedule: `30 4 * * *` (04:30 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: refiner-accred-audit
 * Regulatory basis: LBMA RGG v9 · DGD Standard
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
    id: 'refiner-accreditation-check',
    title: 'Refiner Accreditation Check',
    module: 'esg_supply_lbma',
    cadenceHuman: '04:30 UTC daily',
    regulatoryBasis: 'LBMA RGG v9 · DGD Standard',
    auditStore: 'refiner-accred-audit',
    description: 'Daily verification of DGD + LBMA Good Delivery accreditation status.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 4 * * *',
};
