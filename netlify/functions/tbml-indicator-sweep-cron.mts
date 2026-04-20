/**
 * TBML Indicator Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `30 6 * * *` (06:30 UTC daily)
 * Module: transaction_monitoring (Asana board resolved via the 16-project catalog)
 * Audit store: tbml-audit
 * Regulatory basis: FATF TBML Guidance 2020
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
    id: 'tbml-indicator-sweep',
    title: 'TBML Indicator Sweep',
    module: 'transaction_monitoring',
    cadenceHuman: '06:30 UTC daily',
    regulatoryBasis: 'FATF TBML Guidance 2020',
    auditStore: 'tbml-audit',
    description: 'Trade-based money-laundering heuristics sweep.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 6 * * *',
};
