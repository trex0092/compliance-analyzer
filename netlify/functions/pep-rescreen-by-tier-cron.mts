/**
 * PEP Re-screen by Tier cron — generated from routines.html catalog.
 *
 * Schedule: `30 3 * * *` (03:30 UTC daily)
 * Module: screening_and_watchlist (Asana board resolved via the 16-project catalog)
 * Audit store: pep-rescreen-audit
 * Regulatory basis: Cabinet Res 134/2025 Art.14
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
    id: 'pep-rescreen-by-tier',
    title: 'PEP Re-screen by Tier',
    module: 'screening_and_watchlist',
    cadenceHuman: '03:30 UTC daily',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.14',
    auditStore: 'pep-rescreen-audit',
    description: 'Tiered PEP re-screen cadence — EDD daily, CDD weekly, SDD monthly.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 3 * * *',
};
