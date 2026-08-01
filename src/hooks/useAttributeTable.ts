import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, type WorkflowNode } from '../store/useStore';
import {
  materializeLayerSelection,
  queryLayerColumnProfile,
  queryLayerFeatureIds,
  queryLayerRows,
  queryLayerSelectionBounds,
} from '../services/visualAnalyticsService';
import { queryNodeColumnProfile, queryNodePreviewRows } from '../services/workflowPreviewService';
import { useDebouncedValue } from './useDebouncedValue';
import type { ColumnProfile, HistogramBin } from '../components/DataTable';
import type { VisualFilter } from '../types/visualAnalytics';
import type { ComputedField } from '../utils/fieldCalculator';
import type { AppliedTableLayout, SavedTableView, TableLayout } from '../types/table';
import { migrateLocalStorageKey } from '../utils/storageMigration';
import { visualFilterKey } from '../utils/visualFilters';

const EMPTY_FILTERS: VisualFilter[] = [];
const EMPTY_FEATURE_IDS: string[] = [];
const EMPTY_COMPUTED_FIELDS: ComputedField[] = [];
const TABLE_VIEWS_STORAGE_KEY = 'alur-table-views';

migrateLocalStorageKey('ymnngis-table-views', TABLE_VIEWS_STORAGE_KEY);

const loadSavedViews = (): Record<string, SavedTableView[]> => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(TABLE_VIEWS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const filterKeyOf = visualFilterKey;

/**
 * Owns all attribute-table state for both data sources: a selected map layer
 * (DuckDB-backed via visualAnalyticsService) or a selected workflow node
 * (CTE preview via workflowPreviewService). Output is shaped for DataTable's props.
 */
export function useAttributeTable() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const fragments = useStore((s) => s.fragments);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const datasetRegistry = useStore((s) => s.datasetRegistry);
  const isManualSQL = useStore((s) => s.isManualSQL);
  const setLayerFilters = useStore((s) => s.setLayerFilters);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);
  const toggleSelectedFeature = useStore((s) => s.toggleSelectedFeature);
  const setFeatureSelection = useStore((s) => s.setFeatureSelection);
  const focusLayerBounds = useStore((s) => s.focusLayerBounds);
  const setHoveredFeature = useStore((s) => s.setHoveredFeature);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const addNode = useStore((s) => s.addNode);
  const onConnect = useStore((s) => s.onConnect);
  const addToast = useStore((s) => s.addToast);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnProfiles, setColumnProfiles] = useState<Record<string, ColumnProfile>>({});
  const [profileLoadingColumns, setProfileLoadingColumns] = useState<string[]>([]);
  const [computedFieldsBySource, setComputedFieldsBySource] = useState<Record<string, ComputedField[]>>({});
  const [localFiltersBySource, setLocalFiltersBySource] = useState<Record<string, VisualFilter[]>>({});
  const [nodeRows, setNodeRows] = useState<Record<string, any>[]>([]);
  const [nodeTotal, setNodeTotal] = useState<number | undefined>(undefined);
  const [isNodeLoading, setIsNodeLoading] = useState(false);
  const [layerRows, setLayerRows] = useState<Record<string, any>[]>([]);
  const [layerTotal, setLayerTotal] = useState<number | undefined>(undefined);
  const [isLayerLoading, setIsLayerLoading] = useState(false);
  const [isZoomingSelection, setIsZoomingSelection] = useState(false);
  const [isSelectionActionLoading, setIsSelectionActionLoading] = useState(false);
  const [savedViewsBySource, setSavedViewsBySource] = useState<Record<string, SavedTableView[]>>(loadSavedViews);
  const [appliedLayout, setAppliedLayout] = useState<AppliedTableLayout | null>(null);
  // Manual-SQL results shown when the query produced no map layer (no geometry column).
  const [manualPreview, setManualPreview] = useState<Record<string, any>[] | null>(null);

  useEffect(() => {
    const refreshImportedViews = () => setSavedViewsBySource(loadSavedViews());
    window.addEventListener('alur-table-views-imported', refreshImportedViews);
    return () => window.removeEventListener('alur-table-views-imported', refreshImportedViews);
  }, []);

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedDataset = useMemo(() => {
    if (selectedLayer) return datasetRegistry[selectedLayer.id];
    if (!selectedNode) return undefined;
    const configuredId = selectedNode.data.config?.datasetId;
    if (configuredId && datasetRegistry[configuredId]) return datasetRegistry[configuredId];
    const tableName = selectedNode.data.config?.tableName;
    return Object.values(datasetRegistry).find((dataset) => (
      dataset.source.kind === 'workflow-node' && dataset.source.nodeId === selectedNode.id
    ) || (tableName && (dataset.originTableName === tableName || dataset.relationName === tableName)));
  }, [datasetRegistry, selectedLayer, selectedNode]);
  const linkedDatasetId = selectedDataset?.id;
  const sourceKey = linkedDatasetId ? `dataset:${linkedDatasetId}` : selectedNodeId ? `node:${selectedNodeId}` : 'manual';
  const filters = linkedDatasetId
    ? visualAnalytics.datasets[linkedDatasetId]?.filters || EMPTY_FILTERS
    : localFiltersBySource[sourceKey] || EMPTY_FILTERS;
  const selectedFeatureIds = linkedDatasetId
    ? visualAnalytics.datasets[linkedDatasetId]?.selectedFeatureIds || EMPTY_FEATURE_IDS
    : EMPTY_FEATURE_IDS;
  const hoveredFeatureId = linkedDatasetId
    ? visualAnalytics.datasets[linkedDatasetId]?.hoveredFeatureId
    : undefined;
  const activeFilterKeys = filters.map(filterKeyOf);
  const sourceLabel = selectedLayer
    ? selectedLayer.name
    : selectedNode?.data.label || 'No node or layer selected';
  const computedFields = computedFieldsBySource[sourceKey] || EMPTY_COMPUTED_FIELDS;
  const savedViews = savedViewsBySource[sourceKey] || [];

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TABLE_VIEWS_STORAGE_KEY, JSON.stringify(savedViewsBySource));
    }
  }, [savedViewsBySource]);

  // Reset paging/sort/profile when the inspected source changes or search settles.
  useEffect(() => {
    setPageIndex(0);
    setSearch('');
    setSortBy(null);
    setSortDirection('asc');
    setColumnProfiles({});
    setProfileLoadingColumns([]);
    setAppliedLayout(null);
    setManualPreview(null);
  }, [selectedLayerId, selectedNodeId]);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch]);

  useEffect(() => {
    setColumnProfiles({});
  }, [debouncedSearch, filters, computedFields]);

  // Layer branch — DuckDB-backed filtered rows.
  useEffect(() => {
    let cancelled = false;

    const fetchLayerRows = async () => {
      if (!selectedLayer) {
        setLayerRows([]);
        setLayerTotal(undefined);
        return;
      }
      try {
        setIsLayerLoading(true);
        const result = await queryLayerRows({
          layer: selectedLayer,
          filters,
          search: debouncedSearch,
          sortBy,
          sortDirection,
          pageIndex,
          pageSize,
          computedFields,
        });
        if (cancelled) return;
        setLayerRows(result.rows);
        setLayerTotal(result.total);
      } catch (err: any) {
        if (!cancelled) {
          addToast({ type: 'error', message: `Layer filter failed: ${err.message}` });
          setLayerRows([]);
          setLayerTotal(undefined);
        }
      } finally {
        if (!cancelled) setIsLayerLoading(false);
      }
    };

    fetchLayerRows();
    return () => { cancelled = true; };
  }, [selectedLayer, filters, debouncedSearch, sortBy, sortDirection, pageIndex, pageSize, computedFields, addToast]);

  // Node branch — workflow CTE preview.
  useEffect(() => {
    let cancelled = false;

    const fetchNodePreview = async () => {
      if (!selectedNodeId) {
        setNodeRows([]);
        setNodeTotal(undefined);
        return;
      }
      const node = nodes.find((item) => item.id === selectedNodeId);
      if (node?.data.type === 'input' && !node.data.config?.tableName) {
        setNodeRows([]);
        setNodeTotal(undefined);
        return;
      }
      try {
        setIsNodeLoading(true);
        const result = await queryNodePreviewRows({
          nodes,
          edges,
          fragments,
          nodeId: selectedNodeId,
          schema: nodeSchemas[selectedNodeId],
          search: debouncedSearch,
          sortBy,
          sortDirection,
          pageIndex,
          pageSize,
          filters,
          computedFields,
        });
        if (cancelled) return;
        setNodeRows(result.rows);
        setNodeTotal(result.total);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch node preview:', err);
          setNodeRows([]);
          setNodeTotal(undefined);
        }
      } finally {
        if (!cancelled) setIsNodeLoading(false);
      }
    };

    if (!isManualSQL && selectedNodeId) {
      fetchNodePreview();
    }
    return () => { cancelled = true; };
  }, [selectedNodeId, nodes, edges, isManualSQL, pageIndex, pageSize, debouncedSearch, sortBy, sortDirection, nodeSchemas, filters, computedFields]);

  const data = selectedLayer ? layerRows : selectedNodeId ? nodeRows : manualPreview ?? [];

  const onSortChange = useCallback((column: string) => {
    setPageIndex(0);
    setSortBy((current) => {
      if (current !== column) {
        setSortDirection('asc');
        return column;
      }
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return column;
    });
  }, []);

  const onProfileColumn = useCallback(async (column: string) => {
    if (columnProfiles[column]) {
      return;
    }
    try {
      setProfileLoadingColumns((current) => current.includes(column) ? current : [...current, column]);
      if (selectedLayer) {
        const profile = await queryLayerColumnProfile({
          layer: selectedLayer,
          filters,
          column,
          computedFields,
        });
        setColumnProfiles((current) => ({ ...current, [column]: profile }));
        return;
      }
      if (!selectedNodeId) return;
      const profile = await queryNodeColumnProfile({
        nodes,
        edges,
        nodeId: selectedNodeId,
        schema: nodeSchemas[selectedNodeId],
        search: debouncedSearch,
        column,
        filters,
        computedFields,
      });
      setColumnProfiles((current) => ({ ...current, [column]: profile }));
    } catch (err: any) {
      addToast({ type: 'error', message: `Histogram failed: ${err.message}` });
      setColumnProfiles((current) => ({
        ...current,
        [column]: { column, kind: 'categorical', total: 0, nullCount: 0, bins: [] },
      }));
    } finally {
      setProfileLoadingColumns((current) => current.filter((item) => item !== column));
    }
  }, [columnProfiles, computedFields, selectedLayer, selectedNodeId, filters, nodes, edges, nodeSchemas, debouncedSearch, addToast]);

  const onApplyProfileFilter = useCallback((profile: ColumnProfile, bin: HistogramBin) => {
    const nextFilter: VisualFilter = profile.kind === 'numeric'
      ? { kind: 'range', field: profile.column, min: bin.min, max: bin.max }
      : { kind: 'category', field: profile.column, values: [bin.value ?? bin.label] };
    const nextKey = filterKeyOf(nextFilter);
    const nextFilters = filters.filter((filter) => filterKeyOf(filter) !== nextKey);
    const updatedFilters = nextFilters.length === filters.length ? [...filters, nextFilter] : nextFilters;
    if (linkedDatasetId) setLayerFilters(linkedDatasetId, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [linkedDatasetId, filters, setLayerFilters, sourceKey]);

  const onRemoveFilter = useCallback((index: number) => {
    const updatedFilters = filters.filter((_, filterIndex) => filterIndex !== index);
    if (linkedDatasetId) setLayerFilters(linkedDatasetId, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [linkedDatasetId, filters, setLayerFilters, sourceKey]);

  const onUpdateFilter = useCallback((index: number, filter: VisualFilter) => {
    const updatedFilters = filters.map((current, filterIndex) => filterIndex === index ? filter : current);
    if (linkedDatasetId) setLayerFilters(linkedDatasetId, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [linkedDatasetId, filters, setLayerFilters, sourceKey]);

  const onAddFilter = useCallback((filter: VisualFilter) => {
    const updatedFilters = [...filters.filter((current) => !(current.field === filter.field && current.kind === filter.kind)), filter];
    if (linkedDatasetId) setLayerFilters(linkedDatasetId, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [linkedDatasetId, filters, setLayerFilters, sourceKey]);

  const onClearFilters = useCallback(() => {
    if (linkedDatasetId) clearLayerFilters(linkedDatasetId);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: [] }));
    setPageIndex(0);
  }, [linkedDatasetId, clearLayerFilters, sourceKey]);

  const onClearSelection = useCallback(() => {
    if (!linkedDatasetId) return;
    clearFeatureSelection(linkedDatasetId);
  }, [linkedDatasetId, clearFeatureSelection]);

  const onToggleSelection = useCallback((featureId: string) => {
    if (!linkedDatasetId || !featureId) return;
    toggleSelectedFeature(linkedDatasetId, featureId);
  }, [linkedDatasetId, toggleSelectedFeature]);

  const onSetSelection = useCallback((featureIds: string[]) => {
    if (!linkedDatasetId) return;
    setFeatureSelection(linkedDatasetId, featureIds);
  }, [linkedDatasetId, setFeatureSelection]);

  const onZoomSelection = useCallback(async () => {
    if (!selectedLayer || !selectedFeatureIds.length) return;
    try {
      setIsZoomingSelection(true);
      const bounds = await queryLayerSelectionBounds(selectedLayer, selectedFeatureIds);
      if (!bounds) {
        addToast({ type: 'warning', message: 'The selected rows do not have zoomable geometry.' });
        return;
      }
      focusLayerBounds(selectedLayer.id, bounds);
    } catch (error) {
      addToast({ type: 'error', message: `Zoom to selection failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    } finally {
      setIsZoomingSelection(false);
    }
  }, [addToast, focusLayerBounds, selectedFeatureIds, selectedLayer]);

  const fetchFilteredFeatureIds = useCallback(async () => {
    if (!selectedLayer) return [];
    return queryLayerFeatureIds({
      layer: selectedLayer,
      filters,
      search: debouncedSearch,
      computedFields,
    });
  }, [computedFields, debouncedSearch, filters, selectedLayer]);

  const onSelectAllFiltered = useCallback(async () => {
    if (!selectedLayer) return;
    try {
      setIsSelectionActionLoading(true);
      const featureIds = await fetchFilteredFeatureIds();
      setFeatureSelection(selectedLayer.id, featureIds);
      addToast({ type: 'info', message: `Selected ${featureIds.length.toLocaleString()} filtered rows.` });
    } catch (error) {
      addToast({ type: 'error', message: `Select all failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    } finally {
      setIsSelectionActionLoading(false);
    }
  }, [addToast, fetchFilteredFeatureIds, selectedLayer, setFeatureSelection]);

  const onInvertSelection = useCallback(async () => {
    if (!selectedLayer) return;
    try {
      setIsSelectionActionLoading(true);
      const featureIds = await fetchFilteredFeatureIds();
      const selected = new Set(selectedFeatureIds);
      setFeatureSelection(selectedLayer.id, featureIds.filter((id) => !selected.has(id)));
    } catch (error) {
      addToast({ type: 'error', message: `Invert selection failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    } finally {
      setIsSelectionActionLoading(false);
    }
  }, [addToast, fetchFilteredFeatureIds, selectedFeatureIds, selectedLayer, setFeatureSelection]);

  const onHoverFeature = useCallback((featureId: string | null) => {
    if (linkedDatasetId) setHoveredFeature(linkedDatasetId, featureId);
  }, [linkedDatasetId, setHoveredFeature]);

  const onCreateSelectionLayer = useCallback(async () => {
    if (!selectedLayer || !selectedFeatureIds.length) return;
    const id = `${selectedLayer.id}-selection-${Date.now()}`;
    const name = `${selectedLayer.name} selection`;
    try {
      if (selectedLayer.source.kind === 'legacy-geojson') {
        const selected = new Set(selectedFeatureIds);
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: (selectedLayer.geojson?.features || []).filter((feature) => (
            selected.has(String(feature.properties?._alur_feature_id ?? feature.id ?? ''))
          )),
        };
        addMapLayer({ id, name, geojson, sourceKind: 'manual' });
      } else {
        const result = await materializeLayerSelection({
          layer: selectedLayer,
          featureIds: selectedFeatureIds,
          computedFields,
          outputTableName: `alur_selection_${Date.now()}`,
        });
        if (!result) throw new Error('Could not materialize the selected geometries.');
        addMapLayer({ id, name, source: result.source, tileSource: result.source.tileSource, featureCount: result.featureCount, sourceKind: 'step' });
      }
      addToast({ type: 'success', message: `Created layer “${name}”.` });
    } catch (error) {
      addToast({ type: 'error', message: `Create selection layer failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }, [addMapLayer, addToast, computedFields, selectedFeatureIds, selectedLayer]);

  const onCreateSelectionFilterNode = useCallback(() => {
    if (!selectedLayer?.sourceNodeId || !selectedFeatureIds.length) {
      addToast({ type: 'warning', message: 'This layer is not linked to a workflow node.' });
      return;
    }
    const sourceNode = nodes.find((node) => node.id === selectedLayer.sourceNodeId);
    const nodeId = `selection-filter-${Date.now()}`;
    let config: Record<string, unknown>;
    if (selectedLayer.source.kind === 'legacy-geojson') {
      const selected = new Set(selectedFeatureIds);
      const features = (selectedLayer.geojson?.features || []).filter((feature) => selected.has(String(feature.properties?._alur_feature_id ?? feature.id ?? '')));
      const candidates = ['id', 'ID', 'fid', 'FID', 'gid', 'GID', 'objectid', 'OBJECTID'];
      const idField = candidates.find((field) => features.length > 0 && features.every((feature) => (
        String(feature.properties?.[field] ?? '') === String(feature.properties?._alur_feature_id ?? feature.id ?? '')
      )));
      if (!idField) {
        addToast({ type: 'warning', message: 'These rows do not expose a stable source ID. Create a selection layer instead.' });
        return;
      }
      const values = selectedFeatureIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
      config = { condition: `CAST("${idField.replace(/"/g, '""')}" AS VARCHAR) IN (${values})` };
    } else {
      config = {
        condition: `Selection of ${selectedFeatureIds.length} rows`,
        selectionIds: selectedFeatureIds,
      };
    }
    const filterNode: WorkflowNode = {
      id: nodeId,
      type: 'filter',
      position: { x: (sourceNode?.position.x || 0) + 260, y: sourceNode?.position.y || 0 },
      data: {
        label: `Selected ${selectedFeatureIds.length} rows`,
        type: 'filter',
        config,
      },
    };
    addNode(filterNode);
    onConnect({ source: selectedLayer.sourceNodeId, target: nodeId, sourceHandle: null, targetHandle: 'input-0' });
    addToast({ type: 'success', message: 'Created a workflow filter from the current selection.' });
  }, [addNode, addToast, nodes, onConnect, selectedFeatureIds, selectedLayer]);

  const onSaveTableView = useCallback((name: string, layout: TableLayout) => {
    const view: SavedTableView = {
      id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      layout,
      filters,
      computedFields,
      createdAt: Date.now(),
    };
    setSavedViewsBySource((current) => ({ ...current, [sourceKey]: [...(current[sourceKey] || []), view] }));
  }, [computedFields, filters, sourceKey]);

  const onApplyTableView = useCallback((viewId: string) => {
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;
    if (linkedDatasetId) setLayerFilters(linkedDatasetId, view.filters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: view.filters }));
    setComputedFieldsBySource((current) => ({ ...current, [sourceKey]: view.computedFields }));
    setAppliedLayout({ ...view.layout, revision: Date.now() });
    setPageIndex(0);
  }, [savedViews, linkedDatasetId, setLayerFilters, sourceKey]);

  const onDeleteTableView = useCallback((viewId: string) => {
    setSavedViewsBySource((current) => ({
      ...current,
      [sourceKey]: (current[sourceKey] || []).filter((view) => view.id !== viewId),
    }));
  }, [sourceKey]);

  const onAddComputedField = useCallback((field: Omit<ComputedField, 'id'>) => {
    setComputedFieldsBySource((current) => ({
      ...current,
      [sourceKey]: [...(current[sourceKey] || []), { ...field, id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }],
    }));
    setColumnProfiles({});
  }, [sourceKey]);

  const onUpdateComputedField = useCallback((id: string, field: Omit<ComputedField, 'id'>) => {
    setComputedFieldsBySource((current) => ({
      ...current,
      [sourceKey]: (current[sourceKey] || []).map((item) => item.id === id ? { ...item, ...field } : item),
    }));
    setColumnProfiles({});
  }, [sourceKey]);

  const onDeleteComputedField = useCallback((id: string) => {
    setComputedFieldsBySource((current) => ({
      ...current,
      [sourceKey]: (current[sourceKey] || []).filter((item) => item.id !== id),
    }));
    setColumnProfiles({});
  }, [sourceKey]);

  const onPageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPageIndex(0);
  }, []);

  return {
    selectedLayer,
    selectedNode,
    selectedDataset,
    sourceLabel,
    data,
    totalRows: selectedLayer ? layerTotal : selectedNodeId ? nodeTotal : manualPreview?.length,
    isLoading: selectedLayer ? isLayerLoading : isNodeLoading,
    setManualPreview,
    pageIndex,
    pageSize,
    search,
    sortBy,
    sortDirection,
    columnProfiles,
    profileLoadingColumns,
    filters,
    activeFilterKeys,
    selectedFeatureIds,
    hoveredFeatureId,
    isZoomingSelection,
    isSelectionActionLoading,
    computedFields,
    savedViews,
    appliedLayout,
    onSearchChange: setSearch,
    onSortChange,
    onProfileColumn,
    onPageChange: setPageIndex,
    onPageSizeChange,
    onApplyProfileFilter,
    onRemoveFilter,
    onUpdateFilter,
    onAddFilter,
    onClearFilters,
    onClearSelection,
    onToggleSelection,
    onSetSelection,
    onZoomSelection,
    onSelectAllFiltered,
    onInvertSelection,
    onHoverFeature,
    onCreateSelectionLayer,
    onCreateSelectionFilterNode,
    onSaveTableView,
    onApplyTableView,
    onDeleteTableView,
    onAddComputedField,
    onUpdateComputedField,
    onDeleteComputedField,
  };
}
