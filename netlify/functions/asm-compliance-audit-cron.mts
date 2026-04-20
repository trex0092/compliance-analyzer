/**
 * ASM Compliance Audit cron — generated from routines.html catalog.
 *
 * Schedule: `0 4 * * 3` (Wed 04:00 UTC)
 * Module: esg_supply_lbma (Asana board resolved via the 16-project catalog)
 * Audit store: asm-audit
 * Regulatory basis: LBMA RGG v9 Step 4 · OECD DD Annex II
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
    id: 'asm-compliance-audit',
    title: 'ASM Compliance Audit',
    module: 'esg_supply_lbma',
    cadenceHuman: 'Wed 04:00 UTC',
    regulatoryBasis: 'LBMA RGG v9 Step 4 · OECD DD Annex II',
    auditStore: 'asm-audit',
    description: 'Artisanal & Small-scale Mining supplier audit against LBMA RGG Step 4.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 4 * * 3',
};
