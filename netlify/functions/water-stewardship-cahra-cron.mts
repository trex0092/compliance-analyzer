/**
 * Water Stewardship (CAHRA) cron — generated from routines.html catalog.
 *
 * Schedule: `30 4 * * 5` (Fri 04:30 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: water-audit
 * Regulatory basis: CDP Water · UNGPs · OECD DD Annex II
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
    id: 'water-stewardship-cahra',
    title: 'Water Stewardship (CAHRA)',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Fri 04:30 UTC',
    regulatoryBasis: 'CDP Water · UNGPs · OECD DD Annex II',
    auditStore: 'water-audit',
    description: 'Water-risk scan in CAHRA + water-stressed jurisdictions.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '30 4 * * 5',
};
