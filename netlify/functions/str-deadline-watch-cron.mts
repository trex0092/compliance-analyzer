/**
 * STR Deadline Watch cron — generated from routines.html catalog.
 *
 * Schedule: `*/15 * * * *` (every 15 min)
 * Module: str_cases (Asana board resolved via the 16-project catalog)
 * Audit store: str-deadline-audit
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
    id: 'str-deadline-watch',
    title: 'STR Deadline Watch',
    module: 'str_cases',
    cadenceHuman: 'every 15 min',
    regulatoryBasis: 'FDL No.10/2025 Art.26-27',
    auditStore: 'str-deadline-audit',
    description: 'STR/SAR filing countdown — escalates any case unreviewed for 24h.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/str-deadline-watch',
  schedule: '*/15 * * * *',
};
