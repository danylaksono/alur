import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { queryLayerColumnProfile, queryLayerRows } from '../services/visualAnalyticsService';
import { queryNodeColumnProfile, queryNodePreviewRows } from '../services/workflowPreviewService';
import { useDebouncedValue } from './useDebouncedValue';
import type { ColumnProfile, HistogramBin } from '../components/DataTable';
import type { VisualFilter } from '../types/visualAnalytics';

const EMPTY_FILTERS: VisualFilter[] = [];
const EMPTY_FEATURE_IDS: string[] = [];

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
  const addToast = useStore((s) => s.addToast);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnProfile, setColumnProfile] = useState<ColumnProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [nodeRows, setNodeRows] = useState<Record<string, any>[]>([]);
  const [nodeTotal, setNodeTotal] = useState<number | undefined>(undefined);
  const [isNodeLoading, setIsNodeLoading] = useState(false);
  const [layerRows, setLayerRows] = useState<Record<string, any>[]>([]);
  const [layerTotal, setLayerTotal] = useState<number | undefined>(undefined);
  const [isLayerLoading, setIsLayerLoading] = useState(false);
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
  const filters = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.filters || EMPTY_FILTERS
    : EMPTY_FILTERS;
  const selectedFeatureIds = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.selectedFeatureIds || EMPTY_FEATURE_IDS
    : EMPTY_FEATURE_IDS;
  const activeFilterKeys = filters.map(filterKeyOf);
  const sourceLabel = selectedLayer
    ? selectedLayer.name
    : selectedNode?.data.label || 'No node or layer selected';

  // Reset paging/sort/profile when the inspected source changes or search settles.
  useEffect(() => {
    setPageIndex(0);
    setSearch('');
    setSortBy(null);
    setSortDirection('asc');
    setColumnProfile(null);
    setManualPreview(null);
  }, [selectedLayerId, selectedNodeId]);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch]);

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
  }, [selectedLayer, filters, debouncedSearch, sortBy, sortDirection, pageIndex, pageSize, addToast]);

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
          sortBy,
          sortDirection,
          pageIndex,
          pageSize,
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
  }, [selectedNodeId, nodes, edges, isManualSQL, pageIndex, pageSize, debouncedSearch, sortBy, sortDirection, nodeSchemas]);

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
    setColumnProfile(null);
    try {
      setIsProfileLoading(true);
      if (selectedLayer) {
        const profile = await queryLayerColumnProfile({
          layer: selectedLayer,
          filters,
          column,
        });
        setColumnProfile(profile);
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
      });
      setColumnProfile(profile);
    } catch (err: any) {
      addToast({ type: 'error', message: `Histogram failed: ${err.message}` });
    } finally {
      setIsProfileLoading(false);
    }
  }, [selectedLayer, selectedNodeId, filters, nodes, edges, nodeSchemas, debouncedSearch, addToast]);

  const onApplyProfileFilter = useCallback((profile: ColumnProfile, bin: HistogramBin) => {
    if (!selectedLayer) return;
    const nextFilter: VisualFilter = profile.kind === 'numeric'
      ? { kind: 'range', field: profile.column, min: bin.min, max: bin.max }
      : { kind: 'category', field: profile.column, values: [bin.value ?? bin.label] };
    const nextKey = filterKeyOf(nextFilter);
    const nextFilters = filters.filter((filter) => filterKeyOf(filter) !== nextKey);
    setLayerFilters(
      selectedLayer.id,
      nextFilters.length === filters.length ? [...filters, nextFilter] : nextFilters,
    );
    setPageIndex(0);
  }, [selectedLayer, filters, setLayerFilters]);

  const onRemoveFilter = useCallback((index: number) => {
    if (!selectedLayer) return;
    setLayerFilters(selectedLayer.id, filters.filter((_, filterIndex) => filterIndex !== index));
    setPageIndex(0);
  }, [selectedLayer, filters, setLayerFilters]);

  const onClearFilters = useCallback(() => {
    if (!selectedLayer) return;
    clearLayerFilters(selectedLayer.id);
    setPageIndex(0);
  }, [selectedLayer, clearLayerFilters]);

  const onClearSelection = useCallback(() => {
    if (!selectedLayer) return;
    clearFeatureSelection(selectedLayer.id);
  }, [selectedLayer, clearFeatureSelection]);

  const onPageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPageIndex(0);
  }, []);

  return {
    selectedLayer,
    selectedNode,
    sourceLabel,
    data: selectedLayer ? layerRows : selectedNodeId ? nodeRows : manualPreview ?? [],
    totalRows: selectedLayer ? layerTotal : selectedNodeId ? nodeTotal : manualPreview?.length,
    isLoading: selectedLayer ? isLayerLoading : isNodeLoading,
    setManualPreview,
    pageIndex,
    pageSize,
    search,
    sortBy,
    sortDirection,
    columnProfile,
    isProfileLoading,
    filters,
    activeFilterKeys,
    selectedFeatureIds,
    onSearchChange: setSearch,
    onSortChange,
    onProfileColumn,
    onClearProfile: () => setColumnProfile(null),
    onPageChange: setPageIndex,
    onPageSizeChange,
    onApplyProfileFilter,
    onRemoveFilter,
    onClearFilters,
    onClearSelection,
  };
}
