/**
 * Customs Declaration Reconciliation cron — generated from routines.html catalog.
 *
 * Schedule: `30 7 * * *` (07:30 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: customs-recon-audit
 * Regulatory basis: UAE Customs Law · FATF TBML 2020
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
    id: 'customs-declaration-recon',
    title: 'Customs Declaration Reconciliation',
    module: 'esg_supply_lbma',
    cadenceHuman: '07:30 UTC daily',
    regulatoryBasis: 'UAE Customs Law · FATF TBML 2020',
    auditStore: 'customs-recon-audit',
    description: 'Daily reconciliation of Emirates Customs declarations vs internal records.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 7 * * *',
};
