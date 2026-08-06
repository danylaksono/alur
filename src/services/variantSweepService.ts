import { useStore } from '../store/useStore';
import { buildWorkflowSQL } from '../utils/workflowEngine';
import { MissingParameterError } from '../utils/workflowParameters';
import { materializeWorkflowOutput } from './layerMaterialization';
import { registerWorkflowResult } from './workflowRun';
import type { AnalysisVariant } from '../types/visualAnalytics';

/**
 * Runs one workflow across several variants and collects what each produced.
 *
 * The previous model made a variant a *shape* of graph, so trying five
 * thresholds meant five near-identical graphs and no way to see them together.
 * With `{ $param: … }` references the graph is a specification and the variant
 * supplies the values, which makes this loop possible at all.
 *
 * Sequential on purpose. DuckDB-WASM is single-threaded, so running these in
 * parallel would interleave materialisations without finishing any sooner, and
 * a failure part-way would leave the results it did produce unattributable.
 */

export type SweepOutcome = {
  variantId: string;
  variantName: string;
  status: 'ok' | 'failed';
  datasetId?: string;
  rowCount?: number;
  error?: string;
};

export type SweepReport = {
  outcomes: SweepOutcome[];
  ok: number;
  failed: number;
};

export const sweepVariants = async (variants: AnalysisVariant[]): Promise<SweepReport> => {
  const outcomes: SweepOutcome[] = [];

  for (const variant of variants) {
    // Read fresh each iteration: a run registers datasets and layers, and the
    // next variant compiles against the graph as it now stands.
    const { nodes, edges, fragments } = useStore.getState();
    try {
      const workflow = buildWorkflowSQL(nodes, edges, { fragments, parameters: variant.parameters });
      const result = await materializeWorkflowOutput({
        workflow,
        // Namespaced by variant so runs land in separate tables rather than
        // overwriting each other — the whole point is seeing them side by side.
        layerId: `${workflow.outputLayerName}__${variant.id}`,
        name: variant.name,
        sourceNodeId: workflow.terminalNodeId || undefined,
        sourceKind: 'workflow',
        visualisationConfig: workflow.visualisationConfig,
      });
      const datasetId = registerWorkflowResult(result, {
        nodeId: workflow.terminalNodeId || undefined,
        layerName: `${variant.name} (${result.featureCount.toLocaleString()} features)`,
        // Scoped to this variant. Without it the terminal node's broadcast
        // would hand every variant the last run's dataset.
        variantId: variant.id,
      });
      outcomes.push({ variantId: variant.id, variantName: variant.name, status: 'ok', datasetId, rowCount: result.featureCount });
    } catch (error) {
      // One variant failing is a finding about that variant, not a reason to
      // discard the others — a missing parameter is the common case.
      const message = error instanceof MissingParameterError
        ? error.message
        : error instanceof Error ? error.message : String(error);
      outcomes.push({ variantId: variant.id, variantName: variant.name, status: 'failed', error: message });
    }
  }

  const ok = outcomes.filter((outcome) => outcome.status === 'ok').length;
  const report = { outcomes, ok, failed: outcomes.length - ok };

  useStore.getState().recordProvenance({
    activity: 'sweep.ran',
    used: variants.map((variant) => variant.id),
    generated: outcomes.filter((outcome) => outcome.datasetId).map((outcome) => outcome.datasetId!),
    payload: { variantCount: variants.length, ok, failed: report.failed },
  });

  return report;
};
