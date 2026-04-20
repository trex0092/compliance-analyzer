/**
 * Structuring Pattern Sweep cron — generated from routines.html catalog.
 *
 * Schedule: every 30 min (see `schedule` below)
 * Module: transaction_monitoring (Asana board resolved via the 16-project catalog)
 * Audit store: structuring-audit
 * Regulatory basis: MoE Circular 08/AML/2021
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
    id: 'structuring-pattern-sweep',
    title: 'Structuring Pattern Sweep',
    module: 'transaction_monitoring',
    cadenceHuman: 'every 30 min',
    regulatoryBasis: 'MoE Circular 08/AML/2021',
    auditStore: 'structuring-audit',
    description: 'Detects smurfing clusters near the AED 55K DPMS CTR threshold.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '*/30 * * * *',
};
