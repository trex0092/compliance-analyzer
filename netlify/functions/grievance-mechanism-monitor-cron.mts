/**
 * Grievance Mechanism Monitor cron — generated from routines.html catalog.
 *
 * Schedule: `45 5 * * *` (05:45 UTC daily)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: grievance-audit
 * Regulatory basis: UNGPs Principle 31 · LBMA RGG v9 Step 3
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
    id: 'grievance-mechanism-monitor',
    title: 'Grievance Mechanism Monitor',
    module: 'esg_supply_lbma',
    cadenceHuman: '05:45 UTC daily',
    regulatoryBasis: 'UNGPs Principle 31 · LBMA RGG v9 Step 3',
    auditStore: 'grievance-audit',
    description: 'UNGPs Principle 31 remedy-mechanism effectiveness monitor.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/grievance-mechanism-monitor',
  schedule: '45 5 * * *',
};
