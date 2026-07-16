import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { queryLayerColumnProfile, queryLayerRows, queryLayerSelectionBounds } from '../services/visualAnalyticsService';
import { queryNodeColumnProfile, queryNodePreviewRows } from '../services/workflowPreviewService';
import { useDebouncedValue } from './useDebouncedValue';
import type { ColumnProfile, HistogramBin } from '../components/DataTable';
import type { VisualFilter } from '../types/visualAnalytics';
import {
  applyComputedFields,
  profileComputedColumn,
  type ComputedField,
} from '../utils/fieldCalculator';

const EMPTY_FILTERS: VisualFilter[] = [];
const EMPTY_FEATURE_IDS: string[] = [];
const EMPTY_COMPUTED_FIELDS: ComputedField[] = [];

const filterKeyOf = (filter: VisualFilter) => {
  if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}`;
  if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`;
  return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
};

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
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const isManualSQL = useStore((s) => s.isManualSQL);
  const setLayerFilters = useStore((s) => s.setLayerFilters);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);
  const toggleSelectedFeature = useStore((s) => s.toggleSelectedFeature);
  const setFeatureSelection = useStore((s) => s.setFeatureSelection);
  const focusLayerBounds = useStore((s) => s.focusLayerBounds);
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
  // Manual-SQL results shown when the query produced no map layer (no geometry column).
  const [manualPreview, setManualPreview] = useState<Record<string, any>[] | null>(null);

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const sourceKey = selectedLayer ? `layer:${selectedLayer.id}` : selectedNodeId ? `node:${selectedNodeId}` : 'manual';
  const filters = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.filters || EMPTY_FILTERS
    : localFiltersBySource[sourceKey] || EMPTY_FILTERS;
  const selectedFeatureIds = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.selectedFeatureIds || EMPTY_FEATURE_IDS
    : EMPTY_FEATURE_IDS;
  const activeFilterKeys = filters.map(filterKeyOf);
  const sourceLabel = selectedLayer
    ? selectedLayer.name
    : selectedNode?.data.label || 'No node or layer selected';
  const computedFields = computedFieldsBySource[sourceKey] || EMPTY_COMPUTED_FIELDS;
  const computedFieldNames = useMemo(() => new Set(computedFields.map((field) => field.name)), [computedFields]);
  const databaseSortBy = sortBy && !computedFieldNames.has(sortBy) ? sortBy : null;

  // Reset paging/sort/profile when the inspected source changes or search settles.
  useEffect(() => {
    setPageIndex(0);
    setSearch('');
    setSortBy(null);
    setSortDirection('asc');
    setColumnProfiles({});
    setProfileLoadingColumns([]);
    setManualPreview(null);
  }, [selectedLayerId, selectedNodeId]);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch]);

  useEffect(() => {
    setColumnProfiles({});
  }, [debouncedSearch, filters]);

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
          sortBy: databaseSortBy,
          sortDirection,
          pageIndex,
          pageSize,
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
  }, [selectedLayer, filters, debouncedSearch, databaseSortBy, sortDirection, pageIndex, pageSize, addToast]);

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
          nodeId: selectedNodeId,
          schema: nodeSchemas[selectedNodeId],
          search: debouncedSearch,
          sortBy: databaseSortBy,
          sortDirection,
          pageIndex,
          pageSize,
          filters,
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
  }, [selectedNodeId, nodes, edges, isManualSQL, pageIndex, pageSize, debouncedSearch, databaseSortBy, sortDirection, nodeSchemas, filters]);

  const rawData = selectedLayer ? layerRows : selectedNodeId ? nodeRows : manualPreview ?? [];
  const data = useMemo(() => {
    const calculated = applyComputedFields(rawData, computedFields);
    if (!sortBy || !computedFieldNames.has(sortBy)) return calculated;
    return [...calculated].sort((left, right) => {
      const a = left[sortBy];
      const b = right[sortBy];
      if (a == null) return 1;
      if (b == null) return -1;
      const order = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true });
      return sortDirection === 'asc' ? order : -order;
    });
  }, [computedFieldNames, computedFields, rawData, sortBy, sortDirection]);

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
      if (computedFieldNames.has(column)) {
        const profile = profileComputedColumn(column, data);
        setColumnProfiles((current) => ({ ...current, [column]: profile }));
        return;
      }
      if (selectedLayer) {
        const profile = await queryLayerColumnProfile({
          layer: selectedLayer,
          filters,
          column,
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
  }, [columnProfiles, computedFieldNames, data, selectedLayer, selectedNodeId, filters, nodes, edges, nodeSchemas, debouncedSearch, addToast]);

  const onApplyProfileFilter = useCallback((profile: ColumnProfile, bin: HistogramBin) => {
    const nextFilter: VisualFilter = profile.kind === 'numeric'
      ? { kind: 'range', field: profile.column, min: bin.min, max: bin.max }
      : { kind: 'category', field: profile.column, values: [bin.value ?? bin.label] };
    const nextKey = filterKeyOf(nextFilter);
    const nextFilters = filters.filter((filter) => filterKeyOf(filter) !== nextKey);
    const updatedFilters = nextFilters.length === filters.length ? [...filters, nextFilter] : nextFilters;
    if (selectedLayer) setLayerFilters(selectedLayer.id, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [selectedLayer, filters, setLayerFilters, sourceKey]);

  const onRemoveFilter = useCallback((index: number) => {
    const updatedFilters = filters.filter((_, filterIndex) => filterIndex !== index);
    if (selectedLayer) setLayerFilters(selectedLayer.id, updatedFilters);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: updatedFilters }));
    setPageIndex(0);
  }, [selectedLayer, filters, setLayerFilters, sourceKey]);

  const onClearFilters = useCallback(() => {
    if (selectedLayer) clearLayerFilters(selectedLayer.id);
    else setLocalFiltersBySource((current) => ({ ...current, [sourceKey]: [] }));
    setPageIndex(0);
  }, [selectedLayer, clearLayerFilters, sourceKey]);

  const onClearSelection = useCallback(() => {
    if (!selectedLayer) return;
    clearFeatureSelection(selectedLayer.id);
  }, [selectedLayer, clearFeatureSelection]);

  const onToggleSelection = useCallback((featureId: string) => {
    if (!selectedLayer || !featureId) return;
    toggleSelectedFeature(selectedLayer.id, featureId);
  }, [selectedLayer, toggleSelectedFeature]);

  const onSetSelection = useCallback((featureIds: string[]) => {
    if (!selectedLayer) return;
    setFeatureSelection(selectedLayer.id, featureIds);
  }, [selectedLayer, setFeatureSelection]);

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
    isZoomingSelection,
    computedFields,
    onSearchChange: setSearch,
    onSortChange,
    onProfileColumn,
    onPageChange: setPageIndex,
    onPageSizeChange,
    onApplyProfileFilter,
    onRemoveFilter,
    onClearFilters,
    onClearSelection,
    onToggleSelection,
    onSetSelection,
    onZoomSelection,
    onAddComputedField,
    onUpdateComputedField,
    onDeleteComputedField,
  };
}
