/**
 * Adverse Media Hot Sweep cron — generated from routines.html catalog.
 *
 * Schedule: every 6 hours (see `schedule` below)
 * Module: screening_and_watchlist (Asana board resolved via the 16-project catalog)
 * Audit store: am-hot-audit
 * Regulatory basis: FATF Rec 10 · FDL Art.29
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
    id: 'adverse-media-hot-sweep',
    title: 'Adverse Media Hot Sweep',
    module: 'screening_and_watchlist',
    cadenceHuman: 'every 6 hours',
    regulatoryBasis: 'FATF Rec 10 · FDL Art.29',
    auditStore: 'am-hot-audit',
    description: 'Production run of runAdverseMediaHotIngest — 4x/day across 13K+ sources.',
  });
  return Response.json(result);
};

export const config: Config = {
  path: '/api/routines/adverse-media-hot-sweep',
  schedule: '0 */6 * * *',
};
