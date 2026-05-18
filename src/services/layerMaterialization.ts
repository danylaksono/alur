import { duckdbService } from './duckdb';
import type { WorkflowResult, WorkflowVisualisationConfig } from '../utils/workflowEngine';
import { resolveVisualisationForLayer } from '../utils/visualisationResolver';

const safeName = (name: string) => {
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) cleaned = `t_${cleaned}`;
  return cleaned || `layer_${Date.now()}`;
};

export const materializeWorkflowMapLayer = async ({
  workflow,
  layerId,
  name,
  sourceNodeId,
  sourceKind,
  visualisationConfig,
}: {
  workflow: WorkflowResult;
  layerId: string;
  name: string;
  sourceNodeId?: string;
  sourceKind?: 'workflow' | 'step' | 'output' | 'manual';
  visualisationConfig?: WorkflowVisualisationConfig;
}) => {
  const tableName = safeName(`ymn_layer_${layerId}`);
  await duckdbService.materializeQueryAsTable(workflow.resultSql, tableName);
  const featureCount = await duckdbService.getTableFeatureCount(tableName);
  const source = await duckdbService.prepareLayerSource(tableName, {
    kind: 'duckdb-query',
    originalTableName: tableName,
  });
  if (!source) {
    throw new Error('The query result does not contain a renderable geometry column.');
  }

  const baseLayer = {
    id: layerId,
    name,
    source,
    tileSource: source.tileSource,
    featureCount,
    sourceNodeId,
    sourceKind,
  };
  const resolvedStyle = await resolveVisualisationForLayer(baseLayer, visualisationConfig);
  return { ...baseLayer, ...resolvedStyle };
};

