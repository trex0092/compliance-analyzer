/**
 * goAML Submission Health cron — generated from routines.html catalog.
 *
 * Schedule: `*/30 * * * *` (every 30 min)
 * Module: str_cases (Asana board resolved via the 16-project catalog)
 * Audit store: goaml-health-audit
 * Regulatory basis: FDL No.10/2025 Art.26-27
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
    id: 'goaml-submission-health',
    title: 'goAML Submission Health',
    module: 'str_cases',
    cadenceHuman: 'every 30 min',
    regulatoryBasis: 'FDL No.10/2025 Art.26-27',
    auditStore: 'goaml-health-audit',
    description: 'Monitors goAML submission success-rate + rejection queue.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/goaml-submission-health',
  schedule: '*/30 * * * *',
};
