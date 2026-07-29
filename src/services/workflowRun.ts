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
  { nodeId, layerName }: { nodeId?: string; layerName?: string } = {},
) => {
  const { addMapLayer, registerDataset, registerWorkflowNodeOutput } = useStore.getState();

  const datasetId = result.kind === 'layer' ? result.layer.id : result.dataset.id;
  if (result.kind === 'layer') {
    addMapLayer(layerName ? { ...result.layer, name: layerName } : result.layer);
  } else {
    registerDataset(result.dataset);
  }
  if (nodeId) registerWorkflowNodeOutput(nodeId, datasetId);
  return datasetId;
};
