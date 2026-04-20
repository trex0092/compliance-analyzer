/**
 * EOCN Ingest Retry cron — generated from routines.html catalog.
 *
 * Schedule: `0 * * * *` (every hour)
 * Module: screening_and_watchlist (Asana board resolved via the 16-project catalog)
 * Audit store: eocn-retry-audit
 * Regulatory basis: Cabinet Res 74/2020 Art.35
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
    id: 'eocn-ingest-retry',
    title: 'EOCN Ingest Retry',
    module: 'screening_and_watchlist',
    cadenceHuman: 'every hour',
    regulatoryBasis: 'Cabinet Res 74/2020 Art.35',
    auditStore: 'eocn-retry-audit',
    description: 'Hourly retry of the manual EOCN circular upload queue.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 * * * *',
};
