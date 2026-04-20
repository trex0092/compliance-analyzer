/**
 * VASP Wallet Flow Anomaly cron — generated from routines.html catalog.
 *
 * Schedule: `0 * * * *` (every hour)
 * Module: transaction_monitoring (Asana board resolved via the 16-project catalog)
 * Audit store: vasp-flow-audit
 * Regulatory basis: FATF Rec 15 · VARA Rulebook
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
    id: 'vasp-wallet-flow-anomaly',
    title: 'VASP Wallet Flow Anomaly',
    module: 'transaction_monitoring',
    cadenceHuman: 'every hour',
    regulatoryBasis: 'FATF Rec 15 · VARA Rulebook',
    auditStore: 'vasp-flow-audit',
    description: 'Hourly wallet-flow anomaly for VARA-licensed counterparties.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/vasp-wallet-flow-anomaly',
  schedule: '0 * * * *',
};
