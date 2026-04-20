/**
 * Dual-Use Export Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `30 5 * * *` (05:30 UTC daily)
 * Module: dual_use_export_control (Asana board resolved via the 16-project catalog)
 * Audit store: dual-use-audit
 * Regulatory basis: Cabinet Res 156/2025 · UAE STC
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
    id: 'dual-use-export-sweep',
    title: 'Dual-Use Export Sweep',
    module: 'dual_use_export_control',
    cadenceHuman: '05:30 UTC daily',
    regulatoryBasis: 'Cabinet Res 156/2025 · UAE STC',
    auditStore: 'dual-use-audit',
    description: 'Cabinet Res 156/2025 + Wassenaar + UAE STC scan of outbound flows.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/dual-use-export-sweep',
  schedule: '30 5 * * *',
};
