import { afterEach, describe, expect, it } from 'vitest';
import { createProjectManifest, parseProjectManifest, serialiseProjectManifest } from './projectService';
import { useStore } from '../store/useStore';

describe('projectService', () => {
  afterEach(() => useStore.getState().resetWorkspace());
  it('round-trips an ALUR project without embedding secrets or raw data', () => {
    useStore.setState({
      nodes: [{
        id: 'source',
        type: 'input',
        position: { x: 10, y: 20 },
        data: {
          label: 'Data Source',
          type: 'input',
          config: {
            fileName: 'places.geojson',
            tableName: 'places',
            apiKey: 'do-not-save',
            geojson: { type: 'FeatureCollection', features: [{ id: 'raw' }] },
            sourceFingerprint: { name: 'places.geojson', size: 123, lastModified: 456, format: 'geojson' },
          },
        },
      }],
      edges: [],
      mapLayers: [],
    });

    const manifest = createProjectManifest(useStore.getState(), new Date('2026-07-24T12:00:00Z'));
    const text = serialiseProjectManifest(manifest);
    const restored = parseProjectManifest(text);

    expect(restored.sources).toEqual([{ nodeId: 'source', name: 'places.geojson', tableName: 'places', format: 'geojson', sourceKind: 'file', size: 123, lastModified: 456 }]);
    expect(restored.workflow.nodes[0].data.config.loadStatus).toBe('missing-source');
    expect(text).not.toContain('do-not-save');
    expect(text).not.toContain('FeatureCollection');
    expect(restored.exportedAt).toBe('2026-07-24T12:00:00.000Z');
  });

  it('carries the provenance account through a save and reload', () => {
    useStore.getState().recordProvenance({ activity: 'variant.created', variantId: 'v1', payload: { name: 'Baseline' } });

    const restored = parseProjectManifest(serialiseProjectManifest(createProjectManifest(useStore.getState())));

    expect(restored.provenanceEvents).toHaveLength(1);
    expect(restored.provenanceEvents![0].summary).toBe('Created scenario “Baseline”');
  });

  it('loads a project written before the account existed with an empty one', () => {
    const manifest = createProjectManifest(useStore.getState());
    const withoutAccount = { ...manifest, provenanceEvents: undefined };

    expect(parseProjectManifest(JSON.stringify(withoutAccount)).provenanceEvents).toEqual([]);
  });

  it('drops events from an unreadable log schema rather than refusing the project', () => {
    const manifest = createProjectManifest(useStore.getState());
    const fromTheFuture = { ...manifest, provenanceEvents: [{ schemaVersion: 99, id: 'x', activity: 'unknown.thing' }] };

    expect(parseProjectManifest(JSON.stringify(fromTheFuture)).provenanceEvents).toEqual([]);
  });

  it('rejects projects from a newer manifest version with an actionable message', () => {
    const manifest = createProjectManifest();
    expect(() => parseProjectManifest(JSON.stringify({ ...manifest, version: 99 }))).toThrow(/Update ALUR/);
  });

  it('migrates the pre-manifest version into the current validated shape', () => {
    const restored = parseProjectManifest(JSON.stringify({
      kind: 'alur-project',
      version: 0,
      nodes: [],
      edges: [],
      visualAnalytics: { layers: {}, charts: [], kpis: [] },
    }));
    // Previously this stopped at 1: the v0 branch returned its result instead
    // of chaining, so a v0 file never saw the later migrations at all.
    expect(restored.version).toBe(3);
    expect(restored.workspace.mapCamera.zoom).toBe(1.5);
    expect(restored.visualAnalytics.datasets).toEqual({});
  });

  it('gives a v2 project one line of enquiry holding the variants it already had', () => {
    const current = createProjectManifest();
    const legacy = {
      ...current,
      version: 2,
      name: 'Retrofit study',
      visualAnalytics: {
        ...current.visualAnalytics,
        sessions: undefined,
        activeSessionId: undefined,
        variants: [
          { id: 'v1', name: 'Baseline', baselineDatasetId: 'areas', parameters: {}, assumptions: [], operations: [], createdAt: 1, provenance: { workflowNodeIds: [] } },
          { id: 'v2', name: 'High', baselineDatasetId: 'areas', parentVariantId: 'v1', parameters: {}, assumptions: [], operations: [], createdAt: 2, provenance: { workflowNodeIds: [] } },
        ],
      },
    };

    const migrated = parseProjectManifest(JSON.stringify(legacy));
    const sessions = migrated.visualAnalytics.sessions!;

    expect(migrated.version).toBe(3);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe('Retrofit study');
    expect(sessions[0].baselineDatasetId).toBe('areas');
    expect(migrated.visualAnalytics.activeSessionId).toBe(sessions[0].id);
    expect(migrated.visualAnalytics.variants!.map((variant) => variant.sessionId)).toEqual([sessions[0].id, sessions[0].id]);
    // Branching lineage is untouched: the session groups, it does not re-parent.
    expect(migrated.visualAnalytics.variants![1].parentVariantId).toBe('v1');
  });

  it('does not invent a line of enquiry for a project that never had variants', () => {
    const legacy = { ...createProjectManifest(), version: 2, visualAnalytics: { ...createProjectManifest().visualAnalytics, sessions: undefined, variants: [] } };

    expect(parseProjectManifest(JSON.stringify(legacy)).visualAnalytics.sessions).toEqual([]);
  });

  it('includes cohorts and analytical bookmarks in the portable manifest', () => {
    const cohort = { id: 'north', datasetId: 'areas', name: 'North', colour: '#0284c7', createdAt: 1, definition: { kind: 'filters' as const, filters: [{ kind: 'category' as const, field: 'region', values: ['North'] }] } };
    useStore.setState((state) => ({
      visualAnalytics: {
        ...state.visualAnalytics,
        cohorts: [cohort],
        bookmarks: [{ id: 'view', name: 'North view', createdAt: 2, datasetId: 'areas', filtersByDataset: { areas: cohort.definition.filters }, cohorts: [cohort], mapCamera: { longitude: -1, latitude: 52, zoom: 7, bearing: 0, pitch: 0 }, charts: [], kpis: [] }],
      },
    }));
    const restored = parseProjectManifest(serialiseProjectManifest(createProjectManifest()));
    expect(restored.visualAnalytics.cohorts[0].name).toBe('North');
    expect(restored.visualAnalytics.bookmarks[0]).toMatchObject({ name: 'North view', datasetId: 'areas' });
  });

  it('round-trips the dataset registry and migrated chart source union', () => {
    const store = useStore.getState();
    store.registerDataset({ id: 'table:sales', name: 'Sales', sourceVersion: 1, source: { kind: 'table', datasetId: 'table:sales', tableName: 'sales', rowIdColumn: 'sale_id' }, fields: [{ name: 'sale_id', type: 'VARCHAR' }], rowIdColumn: 'sale_id', rowIdQuality: 'validated-unique', sourceUpdatedAt: 1, spatial: false, relationName: 'sales' });
    store.addChart({ id: 'sales-chart', title: 'Sales', source: { kind: 'table', datasetId: 'table:sales', tableName: 'sales', rowIdColumn: 'sale_id' }, layerId: '', tableName: 'sales', type: 'bar', dimensionField: 'region', aggregation: 'count', paletteId: 'categorical', maxCategories: 8 });
    const restored = parseProjectManifest(serialiseProjectManifest(createProjectManifest()));
    expect(restored.datasets[0]).toMatchObject({ id: 'table:sales', rowIdColumn: 'sale_id', rowIdQuality: 'validated-unique' });
    expect(restored.visualAnalytics.charts[0].source).toEqual({ kind: 'table', datasetId: 'table:sales', tableName: 'sales', rowIdColumn: 'sale_id' });
  });

  it('persists the dashboard layout but never an active presentation session', () => {
    const store = useStore.getState();
    store.setWorkspaceMode('board');
    store.addDashboardCard({ id: 'note-1', kind: 'note', title: 'Decision', note: 'Retain this view.', width: 2, height: 'compact' });
    store.setPresentationMode(true);
    const restored = parseProjectManifest(serialiseProjectManifest(createProjectManifest()));
    expect(restored.workspace.workspaceMode).toBe('board');
    expect(restored.visualAnalytics.dashboard?.cards[0]).toMatchObject({ id: 'note-1', note: 'Retain this view.' });
  });

  it('round-trips the dedicated cohorts rail placement', () => {
    useStore.getState().setActiveRailTab('cohorts');
    const restored = parseProjectManifest(serialiseProjectManifest(createProjectManifest()));
    expect(restored.workspace.activeRailTab).toBe('cohorts');
  });

  it('quietly discards legacy analysis-pattern state', () => {
    const current = createProjectManifest();
    const legacy = { ...current, visualAnalytics: { ...current.visualAnalytics, activePatternId: 'spatial-intervention-loop' } };
    const restored = parseProjectManifest(JSON.stringify(legacy));
    expect(restored.visualAnalytics).not.toHaveProperty('activePatternId');
    expect(serialiseProjectManifest(restored)).not.toContain('spatial-intervention-loop');
  });
});

/**
 * Repeating a calculation from a saved project.
 *
 * This is the whole point of persisting a setup: someone else, with the same
 * data, opens the file and can run the calculation again with the bindings and
 * settings it was run with. It fails silently if it fails at all — the project
 * loads, and the calculation simply cannot be repeated — so it is worth pinning
 * down rather than assuming.
 */
describe('calculation setups in a project', () => {
  afterEach(() => useStore.getState().resetWorkspace());

  const setup = {
    id: 'calculation-1',
    pluginUrl: 'https://example.test/alur.plugin.json',
    calculationId: 'example.visit-order',
    calculationVersion: '1.0.0',
    label: 'Order into a visiting sequence',
    inputs: [{ inputId: 'stops', sources: [{ datasetId: 'dataset-1', fields: { id: 'code' } }] }],
    parameters: { returnToStart: 'yes' },
    createdAt: 1,
    updatedAt: 2,
    lastRunAt: 3,
  };

  it('round-trips everything needed to repeat a run', () => {
    useStore.setState((state) => ({
      visualAnalytics: { ...state.visualAnalytics, calculations: [setup] },
    }));

    const reopened = parseProjectManifest(
      serialiseProjectManifest(createProjectManifest(useStore.getState())),
    );
    const [restored] = reopened.visualAnalytics.calculations ?? [];

    expect(restored).toBeDefined();
    // Named individually rather than by deep equality: each of these is here
    // because without it the run cannot be repeated, and a wholesale match
    // would not say which one went missing.
    expect(restored.pluginUrl).toBe(setup.pluginUrl);
    expect(restored.calculationId).toBe(setup.calculationId);
    expect(restored.calculationVersion).toBe(setup.calculationVersion);
    expect(restored.inputs).toEqual(setup.inputs);
    expect(restored.parameters).toEqual(setup.parameters);
  });

  it('carries the label, so a project reads without the plugin loaded', () => {
    // An open ecosystem means opening work whose calculations you do not have.
    useStore.setState((state) => ({
      visualAnalytics: { ...state.visualAnalytics, calculations: [setup] },
    }));
    const reopened = parseProjectManifest(
      serialiseProjectManifest(createProjectManifest(useStore.getState())),
    );
    expect(reopened.visualAnalytics.calculations?.[0].label).toBe('Order into a visiting sequence');
  });

  it('reads a project written before setups existed', () => {
    // Additive and optional, so no manifest bump — the same contract
    // `provenanceEvents` took. An older project must not become unreadable.
    const manifest = JSON.parse(serialiseProjectManifest(createProjectManifest(useStore.getState())));
    delete manifest.visualAnalytics.calculations;
    expect(parseProjectManifest(JSON.stringify(manifest)).visualAnalytics.calculations).toEqual([]);
  });
});
