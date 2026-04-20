/**
 * Records Retention Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `30 1 * * *` (01:30 UTC daily)
 * Module: governance_and_retention (Asana board resolved via the 16-project catalog)
 * Audit store: retention-sweep-audit
 * Regulatory basis: FDL No.10/2025 Art.24
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
    id: 'records-retention-sweep',
    title: 'Records Retention Sweep',
    module: 'governance_and_retention',
    cadenceHuman: '01:30 UTC daily',
    regulatoryBasis: 'FDL No.10/2025 Art.24',
    auditStore: 'retention-sweep-audit',
    description: '10-year retention integrity + expiring-record digest.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/records-retention-sweep',
  schedule: '30 1 * * *',
};
