/**
 * Clamp Reason Weekly Digest cron — generated from routines.html catalog.
 *
 * Schedule: `0 6 * * 1` (Mon 06:00 UTC)
 * Module: governance_and_retention (Asana board resolved via the 16-project catalog)
 * Audit store: clamp-digest-audit
 * Regulatory basis: EU AI Act Art.9 · FDL No.10/2025 Art.21
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
    id: 'clamp-reason-weekly-digest',
    title: 'Clamp Reason Weekly Digest',
    module: 'governance_and_retention',
    cadenceHuman: 'Mon 06:00 UTC',
    regulatoryBasis: 'EU AI Act Art.9 · FDL No.10/2025 Art.21',
    auditStore: 'clamp-digest-audit',
    description: 'Monday digest of weaponized-brain clampReasons from the prior 7 days.',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 6 * * 1',
};
