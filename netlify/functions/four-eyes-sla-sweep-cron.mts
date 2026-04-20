/**
 * Four-Eyes SLA Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `0 * * * *` (every hour)
 * Module: four_eyes_queue (Asana board resolved via the 16-project catalog)
 * Audit store: four-eyes-sla-audit
 * Regulatory basis: FDL No.10/2025 Art.20-21
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
    id: 'four-eyes-sla-sweep',
    title: 'Four-Eyes SLA Sweep',
    module: 'four_eyes_queue',
    cadenceHuman: 'every hour',
    regulatoryBasis: 'FDL No.10/2025 Art.20-21',
    auditStore: 'four-eyes-sla-audit',
    description: 'Detects partial/confirmed matches left un-cosigned >24h.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 * * * *',
};
