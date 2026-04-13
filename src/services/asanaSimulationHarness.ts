/**
 * Asana Simulation Harness — F14.
 *
 * Replay synthetic compliance cases into Asana so MLROs can practice
 * the workflow end-to-end without ever touching real customer data.
 * Every task spawned by this harness is tagged `synthetic` and
 * auto-archived after 7 days.
 *
 * Pure compute. The orchestrator handles the actual create-task +
 * `archive_at` API calls.
 *
 * Regulatory basis:
 *   FATF Rec 18 (training)
 *   NIST AI RMF MAP 2.4 (operator competence)
 *   EU AI Act Art.15 (continuous testing)
 */

import { generateSyntheticEvasionCases, type SyntheticCase } from './syntheticEvasionGenerator';

export interface SimulationTaskInput {
  /** Asana task name. */
  name: string;
  /** Markdown description with the typology + expected verdict. */
  notes: string;
  /** Custom-field tag the orchestrator applies — `synthetic`. */
  tag: 'synthetic';
  /** ISO timestamp Asana should archive the task at. */
  archiveAtIso: string;
}

export interface SimulationBatchOptions {
  /** Number of synthetic cases to spawn. Default 10. */
  count?: number;
  /** Deterministic seed for reproducibility. Default 42. */
  seed?: number;
}

/**
 * Build a batch of synthetic compliance cases as Asana task inputs.
 * Each task explicitly states the expected verdict so the trainee
 * can self-grade against the brain's actual output.
 */
export function buildSimulationBatch(options: SimulationBatchOptions = {}): SimulationTaskInput[] {
  const cases = generateSyntheticEvasionCases({
    count: options.count ?? 10,
    seed: options.seed ?? 42,
  });
  const archiveAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return cases.map((c) => buildSimulationTask(c, archiveAtIso));
}

function buildSimulationTask(c: SyntheticCase, archiveAtIso: string): SimulationTaskInput {
  const notes =
    `**SIMULATION — NOT A REAL CASE**\n\n` +
    `- **Typology:** ${c.typology}\n` +
    `- **Case id:** ${c.id}\n` +
    `- **Expected verdict:** ${c.expectedVerdict}\n\n` +
    `${c.summary}\n\n` +
    `Walk through the full compliance workflow as if this were a real case: ` +
    `screen, decide, document, escalate, four-eyes, file. ` +
    `Compare your verdict against the expected verdict at the end. ` +
    `This task auto-archives at ${archiveAtIso}.`;
  return {
    name: `[SYNTHETIC] ${c.typology} — ${c.id}`,
    notes,
    tag: 'synthetic',
    archiveAtIso,
  };
}
