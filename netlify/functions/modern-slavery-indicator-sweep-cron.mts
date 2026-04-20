/**
 * Modern Slavery Indicator Sweep cron — generated from routines.html catalog.
 *
 * Schedule: `0 4 * * 4` (Thu 04:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: modern-slavery-audit
 * Regulatory basis: UK Modern Slavery Act 2015 · UNGPs
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
    id: 'modern-slavery-indicator-sweep',
    title: 'Modern Slavery Indicator Sweep',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Thu 04:00 UTC',
    regulatoryBasis: 'UK Modern Slavery Act 2015 · UNGPs',
    auditStore: 'modern-slavery-audit',
    description: 'UK MSA 2015 + UNGPs forced/child-labour indicator sweep.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/modern-slavery-indicator-sweep',
  schedule: '0 4 * * 4',
};
