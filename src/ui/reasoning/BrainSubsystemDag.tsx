/**
 * Brain Subsystem DAG — visualize which megaBrain subsystems fired
 * for a given compliance decision. Renders the 12-node pipeline
 * (precedents → anomaly → belief → causal → strPrediction →
 * rulePrediction → plan → doubleCheck → debate → reflection →
 * penaltyVaR → narrative) with state coloring:
 *
 *   'active' (filled)  — subsystem produced output
 *   'done'   (green)   — always-on subsystem that shipped a result
 *   'pending' (grey)   — subsystem was optional and not invoked
 *
 * Uses the generic DependencyDag renderer, so the layout, edge
 * routing, and hover affordances are shared with the STR lifecycle
 * DAG.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (reasoning trail visibility)
 *   - NIST AI RMF 1.0 MAP-3 + MEASURE-2 (provenance of AI decisions)
 *   - ISO/IEC 42001:2023 Clause 7.5 (documented information)
 */

import DependencyDag, { type DagNode } from './DependencyDag';
import {
  BRAIN_SUBSYSTEM_NODES,
  BRAIN_SUBSYSTEM_EDGES,
  buildBrainSubsystemStates,
  type EnrichableBrain,
} from '../../services/asanaBrainEnricher';

export interface BrainSubsystemDagProps {
  brain: EnrichableBrain;
  onNodeClick?: (subsystemId: string) => void;
}

export default function BrainSubsystemDag({ brain, onNodeClick }: BrainSubsystemDagProps) {
  const states = buildBrainSubsystemStates(brain);

  const nodes: DagNode[] = BRAIN_SUBSYSTEM_NODES.map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: n.description,
    state: states[n.id],
  }));

  return <DependencyDag nodes={nodes} edges={BRAIN_SUBSYSTEM_EDGES} onNodeClick={onNodeClick} />;
}
