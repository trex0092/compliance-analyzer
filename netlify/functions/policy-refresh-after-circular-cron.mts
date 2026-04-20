/**
 * Policy Refresh After Circular cron — generated from routines.html catalog.
 *
 * Schedule: `0 3 * * 3` (Wed 03:00 UTC)
 * Module: governance_and_retention (Asana board resolved via the 16-project catalog)
 * Audit store: policy-refresh-audit
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
    id: 'policy-refresh-after-circular',
    title: 'Policy Refresh After Circular',
    module: 'governance_and_retention',
    cadenceHuman: 'Wed 03:00 UTC',
    regulatoryBasis: 'MoE Circular 08/AML/2021',
    auditStore: 'policy-refresh-audit',
    description: 'Weekly diff of MoE/CBUAE/EOCN/VARA circulars vs shipped constants.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 3 * * 3',
};
