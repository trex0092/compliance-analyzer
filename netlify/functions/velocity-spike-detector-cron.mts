/**
 * Velocity Spike Detector cron — generated from routines.html catalog.
 *
 * Schedule: `0 * * * *` (every hour)
 * Module: transaction_monitoring (Asana board resolved via the 16-project catalog)
 * Audit store: velocity-audit
 * Regulatory basis: FATF Rec 10
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
    id: 'velocity-spike-detector',
    title: 'Velocity Spike Detector',
    module: 'transaction_monitoring',
    cadenceHuman: 'every hour',
    regulatoryBasis: 'FATF Rec 10',
    auditStore: 'velocity-audit',
    description: 'Hourly z-score anomaly on transaction volume + frequency.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/velocity-spike-detector',
  schedule: '0 * * * *',
};
