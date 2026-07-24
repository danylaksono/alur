import { describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from './store/useStore';
import { useStore } from './store/useStore';
import { buildWorkflowSQL, buildUpToSQL } from './utils/workflowEngine';
import { resolveVisualisationForGeoJson } from './utils/visualisationResolver';
import {
  buildChoroplethVisualisation,
  buildCategoricalVisualisation,
  buildGraduatedSymbolVisualisation,
  buildHeatmapVisualisation,
  buildLabelVisualisation,
  buildDotDensityVisualisation,
  buildLegend,
  profileGeoJsonField,
} from './utils/classification';
import { compileLayerStyle, geometryKindForLayer } from './utils/mapStyleCompiler';
import { getPalette, fitPaletteToClassCount } from './utils/palettes';
import { compileVisualFiltersWhereClause } from './utils/visualFilterSql';
import {
  registerLayerForAnalytics,
  clearLayerAnalyticsCache,
  __visualAnalyticsCacheSizeForTests,
} from './services/visualAnalyticsService';
import { duckdbService } from './services/duckdb';
import { FEATURE_ID_PROPERTY } from './types/visualAnalytics';
import type { MapLayer } from './store/useStore';

const pointFeature = (props: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [-0.12, 51.5] },
  properties: props,
});

const polygonFeature = (props: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Polygon' as const, coordinates: [[[-0.13, 51.5], [-0.11, 51.5], [-0.11, 51.52], [-0.13, 51.52], [-0.13, 51.5]]] },
  properties: props,
});

const makeLayer = (id: string, features: GeoJSON.Feature[], patch: Partial<MapLayer> = {}): MapLayer => ({
  id,
  name: id,
  geojson: { type: 'FeatureCollection', features },
  source: {
    kind: 'legacy-geojson',
    geometryKind: features.some((feature) => feature.geometry?.type.includes('Line'))
      ? 'line'
      : features.some((feature) => feature.geometry?.type.includes('Polygon'))
        ? 'polygon'
        : 'point',
    fields: Object.keys(features[0]?.properties || {}).map((name) => ({ name, type: 'UNKNOWN' })),
  },
  visible: true,
  opacity: 0.8,
  createdAt: Date.now(),
  featureCount: features.length,
  styleVersion: 1,
  ...patch,
});

const node = (
  id: string,
  type: WorkflowNode['data']['type'],
  config: Record<string, unknown> = {},
  label = id,
): WorkflowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label, type, config },
} as WorkflowNode);

describe('integration: visualisation pipeline', () => {
  // ── Style compiler ──

  it('compiles all visualisation kinds to valid MapLibre paint/layout', () => {
    const features = [
      polygonFeature({ need: 65, borough: 'Camden', population: 5000 }),
      polygonFeature({ need: 12, borough: 'Hackney', population: 12000 }),
      polygonFeature({ need: 42, borough: 'Camden', population: 8000 }),
    ];

    const choropleth = buildChoroplethVisualisation({
      field: 'need',
      profile: profileGeoJsonField(features, 'need') as any,
      method: 'quantile',
      classCount: 3,
      palette: getPalette('teal').colors,
    });
    const chCompiled = compileLayerStyle(makeLayer('l', features, { visualisation: choropleth }));
    expect(chCompiled.type).toBe('fill');
    const chColor = chCompiled.paint['fill-color'];
    expect(JSON.stringify(chColor)).toContain('step');

    const categorical = buildCategoricalVisualisation({
      field: 'borough',
      profile: profileGeoJsonField(features, 'borough') as any,
    });
    const catCompiled = compileLayerStyle(makeLayer('l', features, { visualisation: categorical }));
    const catColor = catCompiled.paint['fill-color'];
    expect(JSON.stringify(catColor)).toContain('match');

    const pointFeatures = [
      pointFeature({ incidents: 120 }),
      pointFeature({ incidents: 45 }),
      pointFeature({ incidents: 8 }),
    ];
    const graduated = buildGraduatedSymbolVisualisation({
      field: 'incidents',
      profile: profileGeoJsonField(pointFeatures, 'incidents') as any,
    });
    const gsCompiled = compileLayerStyle(makeLayer('l', pointFeatures, { visualisation: graduated }));
    expect(gsCompiled.type).toBe('circle');
    expect(JSON.stringify(gsCompiled.paint['circle-radius'])).toContain('interpolate');

    const heatmap = buildHeatmapVisualisation({ field: 'incidents', palette: getPalette('magma').colors });
    const hmCompiled = compileLayerStyle(makeLayer('l', pointFeatures, { visualisation: heatmap }));
    expect(hmCompiled.type).toBe('heatmap');
    expect(hmCompiled.paint['heatmap-weight']).toBeDefined();

    const label = buildLabelVisualisation({ field: 'borough' });
    const lbCompiled = compileLayerStyle(makeLayer('l', features, { visualisation: label }));
    expect(lbCompiled.label).toBeDefined();
    expect(lbCompiled.label!.type).toBe('symbol');

    const dotDensity = buildDotDensityVisualisation({ field: 'population' });
    const ddCompiled = compileLayerStyle(makeLayer('l', features, { visualisation: dotDensity }));
    expect(ddCompiled.type).toBe('fill');
  });

  // ── Classification & legend ──

  it('builds classification and legend for all supported types', () => {
    const features = [
      polygonFeature({ need: 10 }),
      polygonFeature({ need: 20 }),
      polygonFeature({ need: 30 }),
      polygonFeature({ need: 40 }),
      polygonFeature({ need: 50 }),
    ];
    const numericProfile = profileGeoJsonField(features, 'need');
    expect(numericProfile.kind).toBe('numeric');

    const choropleth = buildChoroplethVisualisation({
      field: 'need',
      profile: numericProfile as any,
      method: 'quantile',
      classCount: 3,
      palette: getPalette('forest').colors,
    });
    expect(choropleth.breaks.length).toBeGreaterThanOrEqual(2);
    expect(choropleth.palette.length).toBe(choropleth.breaks.length + 1);
    const chLegend = buildLegend(choropleth);
    expect(chLegend.kind).toBe('choropleth');
    expect(chLegend.items.at(-1)?.label).toBe('No data');

    const catFeatures = [
      polygonFeature({ type: 'Residential' }),
      polygonFeature({ type: 'Commercial' }),
      polygonFeature({ type: 'Residential' }),
    ];
    const catProfile = profileGeoJsonField(catFeatures, 'type');
    expect(catProfile.kind).toBe('categorical');
    const categories = buildCategoricalVisualisation({ field: 'type', profile: catProfile as any });
    const catLegend = buildLegend(categories);
    expect(catLegend.items.length).toBeGreaterThan(2);

    const label = buildLabelVisualisation({ field: 'name' });
    const lbLegend = buildLegend(label);
    expect(lbLegend.kind).toBe('simple');

    const dots = buildDotDensityVisualisation({ field: 'need' });
    const ddLegend = buildLegend(dots);
    expect(ddLegend.items[0].label).toContain('dot');
  });

  // ── Workflow engine visualisation propagation ──

  it('passes visualisation config through workflow nodes to output', () => {
    const nodes: WorkflowNode[] = [
      node('src', 'input', { tableName: 'need_london', fileName: 'need_london.parquet' }),
      node('attr', 'attribute', { expression: 'need / 10', resultField: 'need_score' }),
      node('style', 'visualisation', {
        kind: 'choropleth',
        field: 'need_score',
        method: 'quantile',
        classCount: 5,
        paletteId: 'teal',
      }),
      node('out', 'output', { maxFeatures: 5000 }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'src', target: 'attr', type: 'smoothstep' },
      { id: 'e2', source: 'attr', target: 'style', type: 'smoothstep' },
      { id: 'e3', source: 'style', target: 'out', type: 'smoothstep' },
    ];

    const result = buildWorkflowSQL(nodes, edges);
    expect(result.visualisationConfig).toBeDefined();
    expect(result.visualisationConfig!.kind).toBe('choropleth');
    expect(result.visualisationConfig!.field).toBe('need_score');
    expect(result.sql).toContain('need_score');
  });

  it('branches to multiple styled outputs from the same data source', () => {
    const nodes: WorkflowNode[] = [
      node('src', 'input', { tableName: 'need_london', fileName: 'need_london.parquet' }),
      node('style_a', 'visualisation', { kind: 'choropleth', field: 'need', method: 'equal_interval', classCount: 4, paletteId: 'forest' }),
      node('style_b', 'visualisation', { kind: 'categorical', field: 'borough', paletteId: 'teal' }),
      node('out_a', 'output', { maxFeatures: 5000 }),
      node('out_b', 'output', { maxFeatures: 5000 }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'src', target: 'style_a', type: 'smoothstep' },
      { id: 'e2', source: 'src', target: 'style_b', type: 'smoothstep' },
      { id: 'e3', source: 'style_a', target: 'out_a', type: 'smoothstep' },
      { id: 'e4', source: 'style_b', target: 'out_b', type: 'smoothstep' },
    ];

    const resultA = buildUpToSQL(nodes, edges, 'out_a');
    expect(resultA.visualisationConfig?.kind).toBe('choropleth');
    expect((resultA.visualisationConfig as any)?.method).toBe('equal_interval');

    const resultB = buildUpToSQL(nodes, edges, 'out_b');
    expect(resultB.visualisationConfig?.kind).toBe('categorical');
  });

  // ── Visualisation resolver ──

  it('resolves workflow visualisation configs to LayerVisualisation + Legend', () => {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        polygonFeature({ need: 10, borough: 'Camden' }),
        polygonFeature({ need: 25, borough: 'Hackney' }),
        polygonFeature({ need: 40, borough: 'Camden' }),
        polygonFeature({ need: 5, borough: 'Hackney' }),
      ],
    };

    const ch = resolveVisualisationForGeoJson(geojson, { kind: 'choropleth', field: 'need', method: 'quantile', classCount: 3 });
    expect(ch.visualisation?.kind).toBe('choropleth');
    expect(ch.legend).toBeDefined();

    const cat = resolveVisualisationForGeoJson(geojson, { kind: 'categorical', field: 'borough' });
    expect(cat.visualisation?.kind).toBe('categorical');
    expect(cat.legend).toBeDefined();

    const label = resolveVisualisationForGeoJson(geojson, { kind: 'label', field: 'borough' });
    expect(label.visualisation?.kind).toBe('label');
    expect(label.legend).toBeDefined();

    const dots = resolveVisualisationForGeoJson(geojson, { kind: 'dot_density', field: 'need' });
    expect(dots.visualisation?.kind).toBe('dot_density');
  });

  // ── Store visualisation actions ──

  it('applies, updates, and clears layer visualisation through store actions', () => {
    useStore.getState().resetWorkspace();
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        polygonFeature({ need: 10, borough: 'Camden' }),
        polygonFeature({ need: 20, borough: 'Hackney' }),
      ],
    };

    useStore.getState().addMapLayer({
      id: 'test-layer',
      name: 'Test Layer',
      geojson,
    });

    const numericProfile = profileGeoJsonField(geojson.features, 'need');
    const choropleth = buildChoroplethVisualisation({
      field: 'need',
      profile: numericProfile as any,
      method: 'quantile',
      classCount: 3,
      palette: getPalette('teal').colors,
    });
    const legend = buildLegend(choropleth);

    useStore.getState().updateLayerVisualisation('test-layer', choropleth, legend);
    let state = useStore.getState();
    let layer = state.mapLayers.find((l) => l.id === 'test-layer')!;
    expect(layer.visualisation?.kind).toBe('choropleth');
    expect(layer.legend).toBeDefined();
    expect(layer.styleVersion).toBe(2);

    useStore.getState().clearLayerVisualisation('test-layer');
    state = useStore.getState();
    layer = state.mapLayers.find((l) => l.id === 'test-layer')!;
    expect(layer.visualisation).toBeUndefined();
    expect(layer.legend).toBeUndefined();
  });

  // ── Interaction state ──

  it('manages hover, selection, and filter state per layer', () => {
    useStore.getState().resetWorkspace();
    useStore.getState().addMapLayer({
      id: 'int-layer',
      name: 'Interaction',
      geojson: { type: 'FeatureCollection', features: [] },
    });

    useStore.getState().setHoveredFeature('int-layer', 'feat-1');
    expect(useStore.getState().visualAnalytics.datasets['int-layer']?.hoveredFeatureId).toBe('feat-1');

    useStore.getState().toggleSelectedFeature('int-layer', 'feat-1');
    expect(useStore.getState().visualAnalytics.datasets['int-layer']?.selectedFeatureIds).toContain('feat-1');

    useStore.getState().toggleSelectedFeature('int-layer', 'feat-2');
    expect(useStore.getState().visualAnalytics.datasets['int-layer']?.selectedFeatureIds).toHaveLength(2);

    useStore.getState().clearFeatureSelection('int-layer');
    expect(useStore.getState().visualAnalytics.datasets['int-layer']?.selectedFeatureIds).toHaveLength(0);

    useStore.getState().setLayerFilters('int-layer', [
      { kind: 'category', field: 'borough', values: ['Camden'] },
      { kind: 'range', field: 'need', min: 10, max: 50 },
    ]);
    const filters = useStore.getState().visualAnalytics.datasets['int-layer']?.filters || [];
    expect(filters).toHaveLength(2);
    expect(filters[0].kind).toBe('category');
    expect(filters[1].kind).toBe('range');

    useStore.getState().clearLayerFilters('int-layer');
    expect((useStore.getState().visualAnalytics.datasets['int-layer']?.filters || []).length).toBe(0);

    useStore.getState().setHoveredFeature('int-layer', null);
    expect(useStore.getState().visualAnalytics.datasets['int-layer']?.hoveredFeatureId).toBeUndefined();
  });

  // ── Layer management with clustering and companion layers ──

  it('manages cluster props and dot density companion layers', () => {
    useStore.getState().resetWorkspace();
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        pointFeature({ value: 10 }),
        pointFeature({ value: 20 }),
      ],
    };

    useStore.getState().addMapLayer({ id: 'clust-layer', name: 'Points', geojson });
    useStore.getState().updateMapLayer('clust-layer', { clusterRadius: 50, clusterMaxZoom: 16 });
    let layer = useStore.getState().mapLayers.find((l) => l.id === 'clust-layer')!;
    expect(layer.clusterRadius).toBe(50);
    expect(layer.clusterMaxZoom).toBe(16);

    useStore.getState().updateMapLayer('clust-layer', { clusterRadius: undefined, clusterMaxZoom: undefined });
    layer = useStore.getState().mapLayers.find((l) => l.id === 'clust-layer')!;
    expect(layer.clusterRadius).toBeUndefined();

    const polyGeojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [polygonFeature({ pop: 1000 })],
    };
    useStore.getState().addMapLayer({ id: 'poly-layer', name: 'Polygons', geojson: polyGeojson });
    useStore.getState().updateMapLayer('poly-layer', { dotDensityLayerId: 'poly-layer-dots' });
    expect(useStore.getState().mapLayers.find((l) => l.id === 'poly-layer')?.dotDensityLayerId).toBe('poly-layer-dots');

    useStore.getState().removeMapLayer('poly-layer');
    const state = useStore.getState();
    expect(state.mapLayers.find((l) => l.id === 'poly-layer')).toBeUndefined();
    expect(state.mapLayers.find((l) => l.id === 'poly-layer-dots')).toBeUndefined();
    expect(state.visualAnalytics.datasets['poly-layer']).toBeUndefined();
    expect(state.visualAnalytics.datasets['poly-layer-dots']).toBeUndefined();
  });

  // ── Feature identity ──

  it('assigns stable feature IDs to GeoJSON features on layer creation', () => {
    useStore.getState().resetWorkspace();
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 42, name: 'A' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'B' } },
      ],
    };
    useStore.getState().addMapLayer({ id: 'fid-layer', name: 'FIDs', geojson });
    const layer = useStore.getState().mapLayers.find((l) => l.id === 'fid-layer')!;
    const features = layer.geojson?.features || [];
    expect(features[0].properties?._alur_feature_id).toBe('42');
    expect(features[1].properties?._alur_feature_id).toContain('fid-layer:2');
  });

  // ── Palette utility ──

  it('fits palettes to arbitrary class counts', () => {
    const palette = ['#a', '#b', '#c'];
    expect(getPalette('teal').colors.length).toBe(5);
    expect(getPalette('nonexistent').id).toBe('teal');

    expect(fitPaletteToClassCount(palette, 2)).toEqual(['#a', '#b']);
    expect(fitPaletteToClassCount(palette, 5)).toHaveLength(5);
    expect(fitPaletteToClassCount(palette, 5)[3]).toBe('#a');
  });
});

describe('integration: map style compiler edge cases', () => {
  it('handles inactive and selected state in compiled styles', () => {
    const features = [polygonFeature({ need: 50 })];
    const layer = makeLayer('l', features, {
      visualisation: buildChoroplethVisualisation({
        field: 'need',
        profile: profileGeoJsonField(features, 'need') as any,
        method: 'quantile',
        classCount: 2,
        palette: getPalette('civic').colors,
      }),
    });

    const inactive = compileLayerStyle(layer, { index: 0, selected: false, inactive: true });
    const inactiveOpacity = inactive.paint['fill-opacity'] as number;
    expect(inactiveOpacity).toBeLessThan(0.3);

    const selected = compileLayerStyle(layer, { index: 0, selected: true, inactive: false });
    const seColor = JSON.stringify(selected.paint['fill-color']);
    expect(seColor).toContain('selected');

    const normal = compileLayerStyle(layer, { index: 0 });
    expect(normal.paint['fill-color']).toBeDefined();
  });

  it('detects geometry kind correctly', () => {
    expect(geometryKindForLayer(makeLayer('l', [pointFeature({})]))).toBe('point');
    expect(geometryKindForLayer(makeLayer('l', [polygonFeature({})]))).toBe('polygon');
    const lineFeature = {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] },
      properties: {},
    };
    expect(geometryKindForLayer(makeLayer('l', [lineFeature]))).toBe('line');
  });

  it('compiles label layers with correct layout for geometry types', () => {
    const pointLayer = makeLayer('l', [pointFeature({ name: 'Site A' })], {
      visualisation: buildLabelVisualisation({ field: 'name' }),
    });
    const pointCompiled = compileLayerStyle(pointLayer);
    expect(pointCompiled.label?.layout['text-offset']).toEqual([0, -1.2]);

    const polyLayer = makeLayer('l', [polygonFeature({ name: 'Area A' })], {
      visualisation: buildLabelVisualisation({ field: 'name' }),
    });
    const polyCompiled = compileLayerStyle(polyLayer);
    expect(polyCompiled.label?.layout['text-offset']).toEqual([0, 0]);
  });
});

describe('integration: DuckDB analytics service', () => {
  it('compiles visual filter SQL predicates correctly', () => {
    expect(compileVisualFiltersWhereClause([])).toBe('');
    expect(compileVisualFiltersWhereClause([
      { kind: 'category', field: 'type', values: ['A'] },
    ])).toContain('WHERE');

    expect(compileVisualFiltersWhereClause([
      { kind: 'range', field: 'value', min: 0, max: 100 },
      { kind: 'category', field: 'type', values: ['B'] },
    ])).toContain('AND');
  });

  it('caches layer registrations based on signature', async () => {
    clearLayerAnalyticsCache();
    const mockRegister = vi.spyOn(duckdbService, 'registerJsonRows').mockResolvedValue(undefined);

    const layer = {
      id: 'test-1',
      geojson: {
        type: 'FeatureCollection' as const,
        features: [
          { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { [FEATURE_ID_PROPERTY]: 'a' } },
        ],
      },
    };

    await registerLayerForAnalytics(layer);
    await registerLayerForAnalytics(layer);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(__visualAnalyticsCacheSizeForTests()).toBe(1);
    mockRegister.mockRestore();
    clearLayerAnalyticsCache();
  });
});
