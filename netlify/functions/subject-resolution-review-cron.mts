/**
 * Subject Resolution Review cron — generated from routines.html catalog.
 *
 * Schedule: `30 5 * * *` (05:30 UTC daily)
 * Module: screening_and_watchlist (Asana board resolved via the 16-project catalog)
 * Audit store: subject-resolution-audit
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
    id: 'subject-resolution-review',
    title: 'Subject Resolution Review',
    module: 'screening_and_watchlist',
    cadenceHuman: '05:30 UTC daily',
    regulatoryBasis: 'FATF Rec 10',
    auditStore: 'subject-resolution-audit',
    description: 'Daily digest of pending pin-as-subject decisions.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/subject-resolution-review',
  schedule: '30 5 * * *',
};
