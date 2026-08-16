import { duckdbService } from './duckdb';
import { ensureWorkflowDataset } from './datasetService';
import type { DatasetDescriptor } from '../types/datasets';
import type { WorkflowResult, WorkflowVisualisationConfig } from '../utils/workflowEngine';
import { resolveVisualisationForLayer } from '../utils/visualisationResolver';

const safeName = (name: string) => {
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) cleaned = `t_${cleaned}`;
  return cleaned || `layer_${Date.now()}`;
};

type MaterializeOptions = {
  workflow: WorkflowResult;
  layerId: string;
  name: string;
  sourceNodeId?: string;
  sourceKind?: 'workflow' | 'step' | 'output' | 'manual';
  visualisationConfig?: WorkflowVisualisationConfig;
};

type WorkflowLayer = Awaited<ReturnType<typeof buildLayer>>;

/**
 * What a workflow run produced.
 *
 * A run that yields geometry becomes a map layer; one that does not — an
 * aggregate, a join summary, a scored table without a geometry column — is
 * still a first-class result and registers as a dataset. Charts, comparison
 * and the report can all read it; only the map cannot.
 */
export type WorkflowMaterialisation =
  | { kind: 'layer'; tableName: string; featureCount: number; layer: WorkflowLayer }
  | { kind: 'table'; tableName: string; featureCount: number; dataset: DatasetDescriptor };

const buildLayer = async (
  options: MaterializeOptions,
  featureCount: number,
  source: NonNullable<Awaited<ReturnType<typeof duckdbService.prepareLayerSource>>>,
) => {
  const baseLayer = {
    id: options.layerId,
    name: options.name,
    source,
    tileSource: source.tileSource,
    featureCount,
    sourceNodeId: options.sourceNodeId,
    sourceKind: options.sourceKind,
  };
  const resolvedStyle = await resolveVisualisationForLayer(baseLayer, options.visualisationConfig);
  return { ...baseLayer, ...resolvedStyle };
};

/**
 * Runs a workflow and turns its result into something the rest of the app can
 * address — a map layer where geometry allows, a registered dataset otherwise.
 */
export const materializeWorkflowOutput = async (options: MaterializeOptions): Promise<WorkflowMaterialisation> => {
  // H3 nodes resolve through DuckDB's community h3 extension (loaded lazily);
  // the SQL will fail with a missing-function error until it is present.
  if (options.workflow.needsH3) await duckdbService.ensureH3();
  const tableName = safeName(`alur_layer_${options.layerId}`);
  await duckdbService.materializeQueryAsTable(options.workflow.resultSql, tableName);
  const featureCount = await duckdbService.getTableFeatureCount(tableName);
  const source = await duckdbService.prepareLayerSource(tableName, {
    kind: 'duckdb-query',
    originalTableName: tableName,
  });

  if (!source) {
    const nodeId = options.sourceNodeId || options.workflow.terminalNodeId || options.layerId;
    const dataset = await ensureWorkflowDataset(nodeId, tableName, options.name);
    return { kind: 'table', tableName, featureCount, dataset };
  }

  return { kind: 'layer', tableName, featureCount, layer: await buildLayer(options, featureCount, source) };
};

/**
 * @deprecated Prefer `materializeWorkflowOutput`, which does not discard
 * results that have no geometry. Retained for callers that genuinely require a
 * layer and can treat its absence as an error.
 */
export const materializeWorkflowMapLayer = async (options: MaterializeOptions) => {
  const result = await materializeWorkflowOutput(options);
  if (result.kind === 'table') {
    throw new Error('The query result does not contain a renderable geometry column.');
  }
  return result.layer;
};
