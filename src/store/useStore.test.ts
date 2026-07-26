import { beforeEach, describe, expect, it } from 'vitest';
import { isDestinationActive, pickLayoutPreferences, useStore, type WorkflowNode } from './useStore';

const fc = (count = 1): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [index, index] },
    properties: { id: index + 1 },
  })),
});

const node = (id: string, tableName?: string): WorkflowNode => ({
  id,
  type: 'input',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    type: 'input',
    config: tableName ? { tableName } : {},
  },
} as WorkflowNode);

describe('layer state', () => {
  beforeEach(() => {
    useStore.getState().resetWorkspace();
    useStore.setState({ toasts: [] });
  });

  it('hydrates added map layers with durable UI metadata and selects them', () => {
    useStore.getState().addMapLayer({
      id: 'roads',
      name: 'Roads',
      geojson: fc(2),
      sourceKind: 'input',
    });

    const state = useStore.getState();
    expect(state.mapLayers[0]).toMatchObject({
      id: 'roads',
      visible: true,
      opacity: 0.8,
      featureCount: 2,
      sourceKind: 'input',
    });
    expect(state.selectedLayerId).toBe('roads');
    expect(state.mapLayers[0].geojson?.features[0].properties?._alur_feature_id).toBe('1');
  });

  it('tracks global loading operations until their map layer is ready', () => {
    const store = useStore.getState();
    store.startLoadingOperation({
      id: 'load-roads',
      title: 'Loading data',
      detail: 'Opening roads.parquet…',
      fileName: 'roads.parquet',
      progress: 25,
    });
    store.updateLoadingOperation('load-roads', {
      detail: 'Drawing features on the map…',
      progress: 92,
      waitForLayerId: 'roads',
    });

    expect(useStore.getState().loadingOperations['load-roads']).toMatchObject({
      progress: 92,
      waitForLayerId: 'roads',
    });

    store.finishLoadingOperation('load-roads');
    expect(useStore.getState().loadingOperations).toEqual({});
  });

  it('replaces repeated execution layers while preserving layer preferences', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'exec-buffer', name: 'Buffer', geojson: fc(1), opacity: 0.5 });
    store.toggleMapLayerVisibility('exec-buffer');
    store.addMapLayer({ id: 'exec-buffer', name: 'Buffer rerun', geojson: fc(3) });

    const layer = useStore.getState().mapLayers[0];
    expect(useStore.getState().mapLayers).toHaveLength(1);
    expect(layer.name).toBe('Buffer rerun');
    expect(layer.featureCount).toBe(3);
    expect(layer.opacity).toBe(0.5);
    expect(layer.visible).toBe(false);
  });

  it('selecting a layer also selects the linked source node', () => {
    useStore.setState({ nodes: [node('input-a', 'a')] });
    useStore.getState().addMapLayer({
      id: 'a',
      name: 'A',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });
    useStore.getState().setSelectedNodeId(null);

    useStore.getState().selectLayer('a');

    expect(useStore.getState().selectedLayerId).toBe('a');
    expect(useStore.getState().selectedNodeId).toBe('input-a');
  });

  it('creates a fresh focus request when zooming to a layer', () => {
    useStore.setState({ nodes: [node('input-a', 'a')] });
    useStore.getState().addMapLayer({
      id: 'a',
      name: 'A',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });

    useStore.getState().focusLayer('a');

    const state = useStore.getState();
    expect(state.selectedLayerId).toBe('a');
    expect(state.selectedNodeId).toBe('input-a');
    expect(state.layerFocusRequest?.layerId).toBe('a');
    expect(state.layerFocusRequest?.requestedAt).toBeGreaterThan(0);
  });

  it('stores layer visualisations and can clear them', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.updateLayerVisualisation('areas', {
      kind: 'categorical',
      field: 'id',
      method: 'categorical_top_n',
      categories: [{ value: '1', color: '#2563eb', count: 1 }],
      otherColor: '#94a3b8',
      nullColor: '#e2e8f0',
      opacity: 0.8,
    }, {
      title: 'id',
      kind: 'categorical',
      items: [{ label: '1', color: '#2563eb' }],
    });

    expect(useStore.getState().mapLayers[0].visualisation?.kind).toBe('categorical');
    expect(useStore.getState().mapLayers[0].legend?.title).toBe('id');

    store.clearLayerVisualisation('areas');

    expect(useStore.getState().mapLayers[0].visualisation).toBeUndefined();
    expect(useStore.getState().mapLayers[0].legend).toBeUndefined();
  });

  it('stores hover and feature selection independently from layer selection', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.setHoveredFeature('areas', '2');
    store.toggleSelectedFeature('areas', '1');
    store.toggleSelectedFeature('areas', '3');

    expect(useStore.getState().visualAnalytics.datasets.areas.hoveredFeatureId).toBe('2');
    expect(useStore.getState().visualAnalytics.datasets.areas.selectedFeatureIds).toEqual(['1', '3']);
    expect(useStore.getState().selectedLayerId).toBe('areas');

    store.toggleSelectedFeature('areas', '1');
    expect(useStore.getState().visualAnalytics.datasets.areas.selectedFeatureIds).toEqual(['3']);

    store.clearFeatureSelection('areas');
    expect(useStore.getState().visualAnalytics.datasets.areas.selectedFeatureIds).toEqual([]);
  });

  it('sets multi-row selection atomically and focuses explicit bounds', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.setFeatureSelection('areas', ['1', '2', '2', '3']);
    expect(useStore.getState().visualAnalytics.datasets.areas.selectedFeatureIds).toEqual(['1', '2', '3']);

    const bounds: [[number, number], [number, number]] = [[-1, 50], [1, 52]];
    store.focusLayerBounds('areas', bounds);
    expect(useStore.getState().layerFocusRequest).toMatchObject({ layerId: 'areas', bounds });
  });

  it('removes visual analytics state when a layer is removed', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(1), sourceKind: 'manual' });
    store.toggleSelectedFeature('areas', '1');
    store.addChart({
      id: 'chart-areas',
      title: 'Areas chart',
      layerId: 'areas',
      type: 'bar',
      dimensionField: 'id',
      aggregation: 'count',
      paletteId: 'categorical',
      maxCategories: 8,
    });

    store.removeMapLayer('areas');

    expect(useStore.getState().visualAnalytics.datasets.areas).toBeUndefined();
    expect(useStore.getState().visualAnalytics.charts).toEqual([]);
  });

  it('stores chart specs and hover highlights alongside layer filters', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.addChart({
      id: 'chart-1',
      title: 'ID distribution',
      layerId: 'areas',
      type: 'bar',
      dimensionField: 'id',
      aggregation: 'count',
      paletteId: 'categorical',
      maxCategories: 8,
    });
    store.updateChart('chart-1', { type: 'donut', title: 'ID share' });
    store.setHighlightedFeatures('areas', ['1', '2']);

    expect(useStore.getState().visualAnalytics.charts[0]).toMatchObject({
      id: 'chart-1',
      title: 'ID share',
      type: 'donut',
    });
    expect(useStore.getState().visualAnalytics.datasets.areas.highlightedFeatureIds).toEqual(['1', '2']);

    store.removeChart('chart-1');
    expect(useStore.getState().visualAnalytics.charts).toEqual([]);
  });

  it('undoes and redoes durable filters without recording hover state', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });

    store.setLayerFilters('areas', [{ kind: 'range', field: 'id', min: 2 }]);
    expect(useStore.getState().analysisHistory.past).toHaveLength(1);

    store.setHoveredFeature('areas', '3');
    expect(useStore.getState().analysisHistory.past).toHaveLength(1);

    store.undoAnalysis();
    expect(useStore.getState().visualAnalytics.datasets.areas.filters).toEqual([]);
    expect(useStore.getState().visualAnalytics.datasets.areas.hoveredFeatureId).toBe('3');
    expect(useStore.getState().analysisHistory.future).toHaveLength(1);

    store.redoAnalysis();
    expect(useStore.getState().visualAnalytics.datasets.areas.filters).toEqual([
      { kind: 'range', field: 'id', min: 2 },
    ]);
  });

  it('restores chart additions and removals through analysis history', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });
    store.addChart({
      id: 'chart-history',
      title: 'Area IDs',
      layerId: 'areas',
      type: 'bar',
      dimensionField: 'id',
      aggregation: 'count',
      paletteId: 'categorical',
      maxCategories: 8,
    });
    store.removeChart('chart-history');

    store.undoAnalysis();
    expect(useStore.getState().visualAnalytics.charts).toHaveLength(1);

    store.undoAnalysis();
    expect(useStore.getState().visualAnalytics.charts).toEqual([]);
  });

  it('adds, reorders, removes, and restores KPI specifications through history', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });
    store.addKpi({ id: 'count', datasetId: 'areas', title: 'Rows', aggregation: 'count', comparison: 'total' });
    store.addKpi({ id: 'mean', datasetId: 'areas', title: 'Mean ID', field: 'id', aggregation: 'avg', comparison: 'none' });
    store.reorderKpi('mean', 0);
    expect(useStore.getState().visualAnalytics.kpis.map((kpi) => kpi.id)).toEqual(['mean', 'count']);
    store.removeKpi('mean');
    expect(useStore.getState().visualAnalytics.kpis.map((kpi) => kpi.id)).toEqual(['count']);
    store.undoAnalysis();
    expect(useStore.getState().visualAnalytics.kpis.map((kpi) => kpi.id)).toEqual(['mean', 'count']);
  });

  it('manages named cohorts and restores a complete analytical bookmark', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual' });
    store.setLayerFilters('areas', [{ kind: 'range', field: 'id', min: 2 }]);
    store.addCohort({ id: 'priority', datasetId: 'areas', name: 'Priority', colour: '#0284c7', createdAt: 1, definition: { kind: 'filters', filters: [{ kind: 'range', field: 'id', min: 2 }] } });
    store.addBookmark({
      id: 'view-1', name: 'Priority view', createdAt: 2, datasetId: 'areas',
      filtersByDataset: { areas: [{ kind: 'range', field: 'id', min: 2 }] },
      cohorts: useStore.getState().visualAnalytics.cohorts,
      mapCamera: { longitude: -1, latitude: 52, zoom: 8, bearing: 0, pitch: 0 },
      charts: [], kpis: [],
    });
    store.clearLayerFilters('areas');
    store.removeCohort('priority');
    store.restoreBookmark('view-1');
    const restored = useStore.getState();
    expect(restored.visualAnalytics.datasets.areas.filters).toEqual([{ kind: 'range', field: 'id', min: 2 }]);
    expect(restored.visualAnalytics.cohorts.map((cohort) => cohort.id)).toEqual(['priority']);
    expect(restored.ui.mapCamera).toMatchObject({ longitude: -1, latitude: 52, zoom: 8 });
  });

  it('rebinds legacy table analytics to a relinked workflow dataset without losing filters', () => {
    const store = useStore.getState();
    store.registerDataset({ id: 'table:sales', name: 'Sales', sourceVersion: 1, source: { kind: 'table', datasetId: 'table:sales', tableName: 'sales', rowIdColumn: '__alur_row_id' }, fields: [], rowIdColumn: '__alur_row_id', rowIdQuality: 'materialised', sourceUpdatedAt: 1, spatial: false, relationName: 'sales' });
    store.setLayerFilters('table:sales', [{ kind: 'category', field: 'region', values: ['North'] }]);
    store.addChart({ id: 'sales-chart', title: 'Sales', layerId: '', tableName: 'sales', type: 'bar', dimensionField: 'region', aggregation: 'count', paletteId: 'categorical', maxCategories: 8 });
    store.rebindDataset('table:sales', { id: 'workflow:input-sales', name: 'Sales', sourceVersion: 1, source: { kind: 'workflow-node', datasetId: 'workflow:input-sales', nodeId: 'input-sales', rowIdColumn: '__alur_row_id' }, fields: [], rowIdColumn: '__alur_row_id', rowIdQuality: 'materialised', sourceUpdatedAt: 2, spatial: false, relationName: '__alur_dataset_sales' });
    const state = useStore.getState();
    expect(state.visualAnalytics.datasets['workflow:input-sales'].filters).toHaveLength(1);
    expect(state.visualAnalytics.datasets['table:sales']).toBeUndefined();
    expect(state.visualAnalytics.charts[0]).toMatchObject({ source: { kind: 'workflow-node', datasetId: 'workflow:input-sales' }, tableName: '__alur_dataset_sales' });
  });

  it('restores layer presentation and bumps its render version', () => {
    const store = useStore.getState();
    store.addMapLayer({ id: 'areas', name: 'Areas', geojson: fc(3), sourceKind: 'manual', opacity: 0.8 });
    const initialVersion = useStore.getState().mapLayers[0].styleVersion;

    store.updateMapLayer('areas', { opacity: 0.35 });
    expect(useStore.getState().mapLayers[0].opacity).toBe(0.35);

    store.undoAnalysis();
    expect(useStore.getState().mapLayers[0].opacity).toBe(0.8);
    expect(useStore.getState().mapLayers[0].styleVersion).toBeGreaterThan(initialVersion);
  });

  it('removing a node cleans up linked layers and active layer selection', () => {
    useStore.setState({
      nodes: [node('input-a', 'roads'), node('input-b', 'parcels')],
      selectedLayerId: 'roads',
    });
    useStore.getState().addMapLayer({
      id: 'roads',
      name: 'Roads',
      geojson: fc(),
      sourceNodeId: 'input-a',
      sourceKind: 'input',
    });
    useStore.getState().addMapLayer({
      id: 'parcels',
      name: 'Parcels',
      geojson: fc(),
      sourceNodeId: 'input-b',
      sourceKind: 'input',
    });
    useStore.getState().selectLayer('roads');

    useStore.getState().removeNode('input-a');

    expect(useStore.getState().mapLayers.map((layer) => layer.id)).toEqual(['parcels']);
    expect(useStore.getState().selectedLayerId).toBeNull();
  });

  it('authors an explanation with editorial context and linked evidence', () => {
    const store = useStore.getState();
    store.updateExplainDocument({ audience: 'Local planners', summary: 'Compare intervention outcomes.' });
    store.updateExplainSection('evidence', { purpose: 'Show only evidence needed to assess the claim.' });
    store.addExplainCard({
      id: 'map-evidence', sectionId: 'evidence', kind: 'map', title: 'Intervention footprint',
      takeaway: 'The intervention is concentrated in the north.', width: 12, height: 'standard', behaviour: 'frozen',
      provenance: { capturedAt: 1, datasetIds: ['areas'], sourceVersions: { areas: 1 }, filtersByDataset: {}, caveats: [] },
    });
    store.addExplainCard({
      id: 'finding', sectionId: 'interpretation', kind: 'finding', claim: 'Northern areas receive most of the intervention.',
      conclusionStatus: 'supported', confidence: 'moderate', evidenceLinks: [{ cardId: 'map-evidence', role: 'supports' }],
      width: 6, height: 'compact', behaviour: 'frozen',
    });
    store.reorderExplainCard('finding', 'conclusion', 0);

    const explain = useStore.getState().visualAnalytics.explain;
    expect(explain).toMatchObject({ audience: 'Local planners', summary: 'Compare intervention outcomes.' });
    expect(explain.sections.find((section) => section.id === 'evidence')?.purpose).toContain('assess the claim');
    expect(explain.cards.find((card) => card.id === 'finding')).toMatchObject({
      sectionId: 'conclusion', confidence: 'moderate', evidenceLinks: [{ cardId: 'map-evidence', role: 'supports' }],
    });

    store.undoAnalysis();
    expect(useStore.getState().visualAnalytics.explain.cards.find((card) => card.id === 'finding')?.sectionId).toBe('interpretation');
  });

  it('saves and resizes dashboard cards independently of presentation mode', () => {
    const store = useStore.getState();
    store.setWorkspaceMode('board');
    store.addDashboardCard({ id: 'note-1', kind: 'note', title: 'Finding', note: 'North is growing.', width: 1, height: 'compact' });
    store.updateDashboardCard('note-1', { width: 2, height: 'tall' });
    store.setPresentationMode(true);
    expect(useStore.getState().visualAnalytics.dashboard?.cards[0]).toMatchObject({ id: 'note-1', width: 2, height: 'tall' });
    expect(useStore.getState().ui).toMatchObject({ workspaceMode: 'board', isPresentationMode: true });
    store.removeDashboardCard('note-1');
    expect(useStore.getState().visualAnalytics.dashboard?.cards).toEqual([]);
  });
});

describe('layout preferences', () => {
  it('keeps deliberate layout choices and drops transient or malformed UI state', () => {
    expect(pickLayoutPreferences({
      activeRailTab: 'charts',
      isPanelCollapsed: true,
      drawerMode: 'maximized',
      activeDrawerTab: 'sql',
      drawerHeight: 420,
      isSettingsOpen: true,
      isCommandPaletteOpen: true,
      workspaceMode: 'explain',
      recoverySave: { status: 'saving' },
    })).toEqual({
      activeRailTab: 'charts',
      isPanelCollapsed: true,
      drawerMode: 'maximized',
      activeDrawerTab: 'sql',
      drawerHeight: 420,
    });

    expect(pickLayoutPreferences()).toEqual({});
    expect(pickLayoutPreferences({
      activeRailTab: 'nonsense' as never,
      drawerMode: 'huge' as never,
      drawerHeight: Number.NaN,
    })).toEqual({});
    // Heights from an older, larger window are clamped rather than trusted.
    expect(pickLayoutPreferences({ drawerHeight: 10_000 }).drawerHeight).toBeLessThan(10_000);
  });

  it('resolves each rail destination onto the surface that owns it', () => {
    const store = useStore.getState();
    store.navigate('explain');
    expect(useStore.getState().ui.workspaceMode).toBe('explain');

    // A panel destination returns to Explore and opens the panel.
    store.navigate('charts');
    expect(useStore.getState().ui).toMatchObject({
      workspaceMode: 'explore', activeRailTab: 'charts', isPanelCollapsed: false,
    });

    // A drawer destination opens the drawer without disturbing the panel tab.
    useStore.getState().setDrawerMode('collapsed');
    store.navigate('sql');
    expect(useStore.getState().ui).toMatchObject({
      activeDrawerTab: 'sql', drawerMode: 'open', activeRailTab: 'charts',
    });

    // Workflow is the one paired surface: canvas plus its palette.
    store.navigate('workflow');
    expect(useStore.getState().ui).toMatchObject({
      activeDrawerTab: 'workflow', drawerMode: 'open', activeRailTab: 'nodes', isPanelCollapsed: false,
    });

    // Reaching the canvas any other way keeps the palette in step.
    store.navigate('layers');
    store.openDrawerTab('workflow');
    expect(useStore.getState().ui.activeRailTab).toBe('nodes');

    store.navigate('compare');
    expect(useStore.getState().ui).toMatchObject({ workspaceMode: 'compare', isPresentationMode: false });
  });

  it('treats workflow as active only once both its surfaces are showing', () => {
    const store = useStore.getState();
    store.navigate('layers');
    const ui = () => useStore.getState().ui;

    // Boot state: drawer already open on the workflow tab, palette not showing.
    // Marking workflow active here would make the first click close the canvas.
    expect(ui()).toMatchObject({ activeDrawerTab: 'workflow', drawerMode: 'open', activeRailTab: 'layers' });
    expect(isDestinationActive(ui(), 'workflow')).toBe(false);
    expect(isDestinationActive(ui(), 'layers')).toBe(true);

    store.navigate('workflow');
    expect(isDestinationActive(ui(), 'workflow')).toBe(true);
    expect(isDestinationActive(ui(), 'layers')).toBe(false);

    // Closing either surface drops it out of the active state.
    useStore.getState().togglePanelCollapsed();
    expect(isDestinationActive(ui(), 'workflow')).toBe(false);

    store.navigate('workflow');
    useStore.getState().setDrawerMode('collapsed');
    expect(isDestinationActive(ui(), 'workflow')).toBe(false);

    // Workspace destinations ignore panel and drawer state entirely.
    store.navigate('compare');
    expect(isDestinationActive(ui(), 'compare')).toBe(true);
    expect(isDestinationActive(ui(), 'layers')).toBe(false);
    useStore.getState().setPresentationMode(true);
    expect(isDestinationActive(ui(), 'explain')).toBe(true);
  });

  it('applies layout presets and drops to custom once anything is hand-adjusted', () => {
    const store = useStore.getState();
    const ui = () => useStore.getState().ui;

    store.applyLayoutPreset('side-by-side');
    expect(ui()).toMatchObject({
      layoutPreset: 'side-by-side', dockSide: 'right', drawerMode: 'open',
      activeDrawerTab: 'table', workspaceMode: 'explore',
    });

    // The workflow preset also brings its palette into the panel.
    store.applyLayoutPreset('workflow');
    expect(ui()).toMatchObject({
      layoutPreset: 'workflow', dockSide: 'left', activeDrawerTab: 'workflow',
      activeRailTab: 'nodes', isPanelCollapsed: false,
    });

    store.applyLayoutPreset('map-focus');
    expect(ui()).toMatchObject({ layoutPreset: 'map-focus', dockSide: 'bottom', drawerMode: 'collapsed' });

    store.applyLayoutPreset('map-below');
    expect(ui()).toMatchObject({ layoutPreset: 'map-below', dockSide: 'top', drawerMode: 'open' });

    // Any manual adjustment stops the label claiming a preset it no longer matches.
    store.setDrawerHeight(300);
    expect(ui().layoutPreset).toBe('custom');
    store.applyLayoutPreset('side-by-side');
    store.setDockSide('left');
    expect(ui()).toMatchObject({ layoutPreset: 'custom', dockSide: 'left' });
    store.applyLayoutPreset('side-by-side');
    store.setPanelWidth(420);
    expect(ui()).toMatchObject({ layoutPreset: 'custom', panelWidth: 420 });

    // A preset reached from another workspace returns to Explore.
    store.navigate('compare');
    store.applyLayoutPreset('map-focus');
    expect(ui().workspaceMode).toBe('explore');
  });

  it('clamps every dragged dimension into a usable range', () => {
    const store = useStore.getState();
    const ui = () => useStore.getState().ui;

    store.setDrawerHeight(-500);
    expect(ui().drawerHeight).toBe(160);
    store.setDrawerWidth(-500);
    expect(ui().drawerWidth).toBe(280);
    store.setPanelWidth(-500);
    expect(ui().panelWidth).toBe(240);

    // Dragging past the far edge must still leave the map something to occupy.
    store.setDrawerHeight(100_000);
    store.setDrawerWidth(100_000);
    store.setPanelWidth(100_000);
    expect(ui().drawerHeight).toBeLessThan(100_000);
    expect(ui().drawerWidth).toBeLessThan(100_000);
    expect(ui().panelWidth).toBeLessThan(100_000);

    // The two horizontal panes are clamped against each other: separately
    // valid widths must not add up to squeezing the map out of existence.
    store.applyLayoutPreset('side-by-side');
    store.setDrawerWidth(100_000);
    store.setPanelWidth(100_000);
    const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const railWidth = ui().isRailExpanded ? 176 : 48;
    expect(viewportWidth - railWidth - ui().panelWidth - ui().drawerWidth).toBeGreaterThanOrEqual(0);

    expect(pickLayoutPreferences({ dockSide: 'sideways' as never, layoutPreset: 'fancy' as never })).toEqual({});
    expect(pickLayoutPreferences({ dockSide: 'left', layoutPreset: 'workflow' })).toEqual({
      dockSide: 'left', layoutPreset: 'workflow',
    });
  });

  it('names a project, carries it into a reset, and bounds absurd names', () => {
    const store = useStore.getState();
    store.setProjectName('Rotterdam flood study');
    expect(useStore.getState().project.name).toBe('Rotterdam flood study');
    store.setProjectName('x'.repeat(400));
    expect(useStore.getState().project.name).toHaveLength(120);
    useStore.getState().resetWorkspace();
    expect(useStore.getState().project.name).toBe('');
  });
});
