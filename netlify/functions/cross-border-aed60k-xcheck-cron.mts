/**
 * Cross-Border AED 60K Cross-Check cron — generated from routines.html catalog.
 *
 * Schedule: `0 7 * * *` (07:00 UTC daily)
 * Module: transaction_monitoring (Asana board resolved via the 16-project catalog)
 * Audit store: bni-xcheck-audit
 * Regulatory basis: Cabinet Res 134/2025 Art.16
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
    id: 'cross-border-aed60k-xcheck',
    title: 'Cross-Border AED 60K Cross-Check',
    module: 'transaction_monitoring',
    cadenceHuman: '07:00 UTC daily',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.16',
    auditStore: 'bni-xcheck-audit',
    description: 'Reconciles declared AED 60K cross-border movements vs CBUAE/Customs BNI feed.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 7 * * *',
};
