import { useStore } from '../store/useStore';
import type { WorkflowMaterialisation } from './layerMaterialization';

/**
 * Makes a completed workflow run addressable by the rest of the app.
 *
 * Every run path — step-through, output preview, whole-workflow — has to do the
 * same three things: put a geometry result on the map, put a non-geometry
 * result in the dataset registry, and tell any variant built on this node which
 * dataset it just produced. Keeping that in one place is what stops the three
 * paths from drifting apart, which is how scenario comparison silently broke
 * the first time.
 *
 * Callers handle their own empty-result messaging before calling this.
 */
export const registerWorkflowResult = (
  result: WorkflowMaterialisation,
  { nodeId, layerName, variantId }: { nodeId?: string; layerName?: string; variantId?: string } = {},
) => {
  const { addMapLayer, registerDataset, registerWorkflowNodeOutput, updateVariant, recordProvenance } = useStore.getState();

  const datasetId = result.kind === 'layer' ? result.layer.id : result.dataset.id;
  if (result.kind === 'layer') {
    addMapLayer(layerName ? { ...result.layer, name: layerName } : result.layer);
  } else {
    registerDataset(result.dataset);
  }
  // A sweep runs one graph for many variants, so every variant on the terminal
  // node would claim every run's output and the last would win for all of them.
  // Naming the variant binds the result to the run that actually produced it.
  if (variantId) updateVariant(variantId, { workflowOutputDatasetId: datasetId });
  else if (nodeId) registerWorkflowNodeOutput(nodeId, datasetId);
  // Recorded here for the same reason the rest of this function lives here:
  // every run path passes through, so the account cannot miss one.
  recordProvenance({
    activity: 'workflow.ran',
    entityId: nodeId ?? datasetId,
    used: nodeId ? [nodeId] : [],
    generated: [datasetId],
    payload: { nodeId, datasetId, rowCount: result.featureCount },
  });
  return datasetId;
};
