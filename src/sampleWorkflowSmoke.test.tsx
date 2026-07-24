import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import App from './App';
import { WorkflowTab } from './components/shell/WorkflowTab';
import { SqlTab } from './components/shell/SqlTab';
import { Chat } from './components/Chat';
import { CohortPanel } from './components/Visualisation/CohortPanel';
import { useStore, type WorkflowNode } from './store/useStore';
import { buildWorkflowSQL } from './utils/workflowEngine';
import { llmToolDefinitions } from './utils/toolDefinitions';

const featureCollection = (name: string, count = 3): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-0.12 + index * 0.01, 51.5 + index * 0.01],
    },
    properties: {
      id: index + 1,
      name: `${name} ${index + 1}`,
      need: 10 + index,
      borough: index % 2 === 0 ? 'Camden' : 'Hackney',
    },
  })),
});

const node = (
  id: string,
  type: WorkflowNode['data']['type'],
  config: Record<string, unknown>,
  label = id,
  position = { x: 0, y: 0 },
): WorkflowNode => ({
  id,
  type,
  position,
  data: { label, type, config },
} as WorkflowNode);

describe('sample visual analytics workflow smoke test', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    useStore.setState({ duckdbReady: true, toasts: [] });
  });

  it('builds a sample-data node sequence into SQL that can back the SQL preview', () => {
    const nodes: WorkflowNode[] = [
      node('sample_need', 'input', { tableName: 'need_london', fileName: 'need_london.parquet' }, 'London NEED sample'),
      node('need_filter', 'filter', { condition: 'need >= 10' }, 'High need filter', { x: 260, y: 0 }),
      node('need_buffer', 'analysis', { operation: 'ST_Buffer', distance: 500 }, '500m buffer', { x: 520, y: 0 }),
      node('buffer_area', 'analysis', { operation: 'ST_Area', resultField: 'buffer_area' }, 'Buffer area', { x: 780, y: 0 }),
      node('borough_dissolve', 'aggregate', { operation: 'ST_Union_Agg', groupBy: 'borough' }, 'Dissolve by borough', { x: 1040, y: 0 }),
      node('map_output', 'output', { maxFeatures: 5000 }, 'Map output', { x: 1300, y: 0 }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'sample_need', target: 'need_filter', type: 'smoothstep' },
      { id: 'e2', source: 'need_filter', target: 'need_buffer', type: 'smoothstep' },
      { id: 'e3', source: 'need_buffer', target: 'buffer_area', type: 'smoothstep' },
      { id: 'e4', source: 'buffer_area', target: 'borough_dissolve', type: 'smoothstep' },
      { id: 'e5', source: 'borough_dissolve', target: 'map_output', type: 'smoothstep' },
    ];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.sql).toContain('SELECT * FROM "need_london"');
    expect(result.sql).toContain('WHERE need >= 10');
    expect(result.sql).toContain('ST_Buffer("geometry", 500) AS geom_buffered');
    expect(result.sql).toContain('ST_Area("geom_buffered") AS "buffer_area"');
    expect(result.sql).toContain('ST_Union_Agg("geom_buffered") AS geom_agg');
    expect(result.withClause).toContain('map_output AS');
    expect(result.sql).toContain('FROM map_output');
    expect(result.outputLayerName).toBe('workflow_map_output');
  });

  it('models adding sample inputs and analysis results as independently managed map layers', () => {
    useStore.setState({
      nodes: [
        node('sample_need', 'input', { tableName: 'need_london', fileName: 'need_london.parquet' }, 'London NEED sample'),
        node('need_buffer', 'analysis', { operation: 'ST_Buffer', distance: 500 }, '500m buffer'),
      ],
    });

    const store = useStore.getState();
    store.addMapLayer({
      id: 'need_london',
      name: 'need_london.parquet',
      geojson: featureCollection('need', 4),
      sourceNodeId: 'sample_need',
      sourceKind: 'input',
    });
    store.addMapLayer({
      id: 'exec-need_buffer',
      name: 'Step: 500m buffer',
      geojson: featureCollection('buffer', 2),
      sourceNodeId: 'need_buffer',
      sourceKind: 'step',
      opacity: 0.55,
    });
    store.toggleMapLayerVisibility('need_london');
    store.selectLayer('exec-need_buffer');

    const state = useStore.getState();
    expect(state.mapLayers.map((layer) => layer.id)).toEqual(['need_london', 'exec-need_buffer']);
    expect(state.mapLayers.find((layer) => layer.id === 'need_london')?.visible).toBe(false);
    expect(state.mapLayers.find((layer) => layer.id === 'exec-need_buffer')?.featureCount).toBe(2);
    expect(state.mapLayers.find((layer) => layer.id === 'exec-need_buffer')?.opacity).toBe(0.55);
    expect(state.selectedLayerId).toBe('exec-need_buffer');
    expect(state.selectedNodeId).toBe('need_buffer');
  });

  it('keeps chat tools, workflow drawer, SQL preview, layer manager, and basemap UI mounted', () => {
    // Note: SSR renders zustand's *initial* state, so each surface is rendered
    // directly and asserted on its default-visible content.
    const toolNames = llmToolDefinitions.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      'add_node',
      'connect_nodes',
      'run_spatial_query',
      'add_visualisation_node',
      'filter_layer_rows',
      'select_layer_features',
      'clear_layer_filters',
      'clear_layer_selection',
      'zoom_to_selection',
    ]));

    const shellHtml = renderToString(<App />);
    expect(shellHtml).toContain('Add data');
    expect(shellHtml).toContain('New project');
    expect(shellHtml).toContain('Data Layers');
    // The style editor is gated behind a per-layer action; the list view shows by default.
    expect(shellHtml).toContain('Add data or run a workflow');
    expect(shellHtml).toContain('Basemap');
    expect(shellHtml).toContain('About');
    expect(shellHtml).toContain('aria-label="Cohorts"');
    expect(shellHtml).toContain('Workflow');
    expect(shellHtml).toContain('Table');
    expect(shellHtml).toContain('SQL');
    expect(shellHtml).toContain('Loading workflow editor');

    const cohortsHtml = renderToString(<CohortPanel />);
    expect(cohortsHtml).toContain('Save subsets, compare groups, and revisit analytical states.');

    const workflowHtml = renderToString(<WorkflowTab />);
    expect(workflowHtml).toContain('Data Input');
    expect(workflowHtml).toContain('Layer Output');
    expect(workflowHtml).toContain('Spatial Functions');
    expect(workflowHtml).toContain('Execute Workflow');

    const chatHtml = renderToString(<Chat />);
    expect(chatHtml).toContain('ALUR Copilot');
    expect(chatHtml).toContain('Bring your own key');

    const sqlHtml = renderToString(<SqlTab setManualPreview={() => {}} />);
    expect(sqlHtml).toContain('Workflow SQL Preview');
    expect(sqlHtml).toContain('Manual mode');
  });

  it('exposes output node configuration for map preview and file export modes', () => {
    const outputTool = llmToolDefinitions.find((tool) => tool.name === 'add_node');
    const configProperties = outputTool?.parameters.properties.config?.properties;

    expect(configProperties).toBeDefined();
    if (!configProperties) throw new Error('add_node config schema is missing');
    expect(configProperties.outputMode.enum).toEqual(['visualize', 'export']);
    expect(configProperties.exportFormat.enum).toEqual(['geojson', 'csv', 'json', 'parquet']);
    expect(configProperties.kind.enum).toEqual(['choropleth', 'categorical', 'graduated_symbol', 'heatmap', 'label', 'dot_density']);

    const nodes: WorkflowNode[] = [
      node('sample_need', 'input', { tableName: 'need_london', fileName: 'need_london.parquet' }),
      node('export_output', 'output', { outputMode: 'export', exportFormat: 'parquet', maxFeatures: 5000 }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'sample_need', target: 'export_output', type: 'smoothstep' }];

    const result = buildWorkflowSQL(nodes, edges);

    expect(result.withClause).toContain('export_output AS');
    expect(result.sql).toContain('FROM export_output');
  });
});
