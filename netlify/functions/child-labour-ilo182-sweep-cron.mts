/**
 * Child Labour (ILO C-182) Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `30 4 * * 2` (Tue 04:30 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: child-labour-audit
 * Regulatory basis: ILO Convention 182 · UNCRC
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
    id: 'child-labour-ilo182-sweep',
    title: 'Child Labour (ILO C-182) Sweep',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Tue 04:30 UTC',
    regulatoryBasis: 'ILO Convention 182 · UNCRC',
    auditStore: 'child-labour-audit',
    description: 'ILO C-182 worst-forms-of-child-labour indicator sweep.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 4 * * 2',
};
