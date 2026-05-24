import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Controls, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from './store/useStore';
import { duckdbService } from './services/duckdb';
import { queryLayerColumnProfile, queryLayerRows } from './services/visualAnalyticsService';
import { buildWorkflowSQL, cteAlias } from './utils/workflowEngine';
import {
  Workflow,
  Database,
  Play,
  Settings,
  Terminal,
  Download,
  Layers,
  FileText,
  BarChart3
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { MapView } from './components/Map/MapView';
import { LayerManager } from './components/LayerManager';
import { VisualisationPanel } from './components/Visualisation/VisualisationPanel';
import { SelectionSummary } from './components/Visualisation/SelectionSummary';
import { ChartPanel } from './components/Charts/ChartPanel';
import { InputNode } from './components/Flow/InputNode';
import { AnalysisNode } from './components/Flow/AnalysisNode';
import { AttributeNode } from './components/Flow/AttributeNode';
import { AggregateNode } from './components/Flow/AggregateNode';
import { FilterNode } from './components/Flow/FilterNode';
import { OutputNode } from './components/Flow/OutputNode';
import { VisualisationNode } from './components/Flow/VisualisationNode';
import { DataTable, type ColumnProfile, type HistogramBin } from './components/DataTable';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWorkflowSync } from './hooks/useWorkflowSync';
import { useSchemaFetcher } from './hooks/useSchemaFetcher';
import { cn } from './utils/cn';
import type { VisualFilter } from './types/visualAnalytics';

const nodeTypes = {
  input: InputNode,
  analysis: AnalysisNode,
  attribute: AttributeNode,
  aggregate: AggregateNode,
  filter: FilterNode,
  visualisation: VisualisationNode,
  output: OutputNode,
};

const EMPTY_FILTERS: VisualFilter[] = [];
const EMPTY_FEATURE_IDS: string[] = [];

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;
const escapeSql = (value: string) => value.replace(/'/g, "''");

const searchableColumnNames = (schema: any[] | undefined) =>
  (schema || [])
    .map((col: any) => col.name || col.column_name)
    .filter((name: unknown): name is string =>
      typeof name === 'string' && !['geojson', 'geometry', 'geom'].includes(name.toLowerCase())
    );

const columnType = (schema: any[] | undefined, column: string) => {
  const found = (schema || []).find((col: any) => (col.name || col.column_name) === column);
  return String(found?.type || found?.column_type || '').toLowerCase();
};

const isNumericType = (type: string) =>
  ['tinyint', 'smallint', 'integer', 'bigint', 'hugeint', 'utinyint', 'usmallint', 'uinteger', 'ubigint', 'float', 'double', 'decimal', 'real']
    .some((item) => type.includes(item));

export default function App() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    duckdbReady,
    setDuckDBReady,
    mapLayers,
    addMapLayer,
    manualSQL,
    setManualSQL,
    isManualSQL,
    setIsManualSQL,
    selectedNodeId,
    selectedLayerId,
    nodeSchemas,
    visualAnalytics,
    setSelectedNodeId,
    setSelectedLayerId,
    addNode,
    removeNode,
    duplicateNode,
    clearFeatureSelection,
    setLayerFilters,
    clearLayerFilters,
    addToast,
  } = useStore();

  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'diagram' | 'attributes'>('diagram');
  const [rightPanelTab, setRightPanelTab] = useState<'layers' | 'charts' | 'details'>('layers');
  const [lastManualSql, setLastManualSql] = useState<string | null>(null);
  const [attributePageIndex, setAttributePageIndex] = useState(0);
  const [attributePageSize, setAttributePageSize] = useState(50);
  const [attributeTotalRows, setAttributeTotalRows] = useState<number | undefined>(undefined);
  const [attributeSearch, setAttributeSearch] = useState('');
  const [attributeSortBy, setAttributeSortBy] = useState<string | null>(null);
  const [attributeSortDirection, setAttributeSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnProfile, setColumnProfile] = useState<ColumnProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [filteredLayerRows, setFilteredLayerRows] = useState<Record<string, any>[]>([]);
  const [filteredLayerTotal, setFilteredLayerTotal] = useState<number | undefined>(undefined);

  useWorkflowSync();
  useSchemaFetcher();

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId]
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedLayerFilters = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.filters || EMPTY_FILTERS
    : EMPTY_FILTERS;
  const layerAttributeResult = useMemo(
    () => {
      const features = selectedLayer?.geojson?.features || [];
      const normalizedSearch = attributeSearch.trim().toLowerCase();
      let rows: Record<string, any>[] = features.map((feature, index) => ({
        _feature: index + 1,
        ...(feature.properties || {}),
      }));

      if (normalizedSearch) {
        rows = rows.filter((row) =>
          Object.values(row).some((value) =>
            String(value ?? '').toLowerCase().includes(normalizedSearch)
          )
        );
      }

      if (attributeSortBy) {
        rows = [...rows].sort((a, b) => {
          const av = a[attributeSortBy];
          const bv = b[attributeSortBy];
          const an = typeof av === 'number' ? av : Number(av);
          const bn = typeof bv === 'number' ? bv : Number(bv);
          const result = !Number.isNaN(an) && !Number.isNaN(bn)
            ? an - bn
            : String(av ?? '').localeCompare(String(bv ?? ''));
          return attributeSortDirection === 'asc' ? result : -result;
        });
      }

      const total = rows.length;
      const start = attributePageIndex * attributePageSize;
      const pageRows = rows.slice(start, start + attributePageSize).map((row, index) => ({
        ...row,
        _feature: start + index + 1,
      }));

      return { rows: pageRows, total };
    },
    [selectedLayer, attributePageIndex, attributePageSize, attributeSearch, attributeSortBy, attributeSortDirection]
  );
  const attributeData = selectedLayer ? filteredLayerRows : previewData;
  const resolvedAttributeTotalRows = selectedLayer ? filteredLayerTotal : attributeTotalRows;
  const attributeSourceLabel = selectedLayer
    ? selectedLayer.name
    : selectedNode?.data.label || 'No node or layer selected';
  const selectedFeatureIds = selectedLayer
    ? visualAnalytics.layers[selectedLayer.id]?.selectedFeatureIds || EMPTY_FEATURE_IDS
    : EMPTY_FEATURE_IDS;
  const activeFilterKeys = selectedLayerFilters.map((filter) => {
    if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}`;
    if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`;
    return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
  });

  useEffect(() => {
    setAttributePageIndex(0);
    setAttributeSearch('');
    setAttributeSortBy(null);
    setAttributeSortDirection('asc');
    setColumnProfile(null);
  }, [selectedLayerId, selectedNodeId]);

  const handleAttributeSortChange = (column: string) => {
    setAttributePageIndex(0);
    setAttributeSortBy((current) => {
      if (current !== column) {
        setAttributeSortDirection('asc');
        return column;
      }
      setAttributeSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return column;
    });
  };

  const toggleProfileFilter = (profile: ColumnProfile, bin: HistogramBin) => {
    if (!selectedLayer) return;
    const nextFilter = profile.kind === 'numeric'
      ? { kind: 'range' as const, field: profile.column, min: bin.min, max: bin.max }
      : { kind: 'category' as const, field: profile.column, values: [bin.value ?? bin.label] };
    const nextKey = nextFilter.kind === 'category'
      ? `${nextFilter.field}:category:${nextFilter.values.join('|')}`
      : `${nextFilter.field}:range:${nextFilter.min ?? ''}:${nextFilter.max ?? ''}`;
    const nextFilters = selectedLayerFilters.filter((filter) => {
      const key = filter.kind === 'category'
        ? `${filter.field}:category:${filter.values.join('|')}`
        : filter.kind === 'temporal'
          ? `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`
        : `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
      return key !== nextKey;
    });
    setLayerFilters(
      selectedLayer.id,
      nextFilters.length === selectedLayerFilters.length ? [...selectedLayerFilters, nextFilter] : nextFilters,
    );
    setAttributePageIndex(0);
  };

  const removeSelectedLayerFilter = (index: number) => {
    if (!selectedLayer) return;
    setLayerFilters(selectedLayer.id, selectedLayerFilters.filter((_, filterIndex) => filterIndex !== index));
    setAttributePageIndex(0);
  };

  const clearSelectedLayerFilters = () => {
    if (!selectedLayer) return;
    clearLayerFilters(selectedLayer.id);
    setAttributePageIndex(0);
  };

  useEffect(() => {
    let cancelled = false;

    const fetchLayerRows = async () => {
      if (!selectedLayer) {
        setFilteredLayerRows([]);
        setFilteredLayerTotal(undefined);
        return;
      }

      try {
        setIsPreviewLoading(true);
        const result = await queryLayerRows({
          layer: selectedLayer,
          filters: selectedLayerFilters,
          search: attributeSearch,
          sortBy: attributeSortBy,
          sortDirection: attributeSortDirection,
          pageIndex: attributePageIndex,
          pageSize: attributePageSize,
        });
        if (cancelled) return;
        setFilteredLayerRows(result.rows);
        setFilteredLayerTotal(result.total);
      } catch (err: any) {
        if (!cancelled) {
          addToast({ type: 'error', message: `Layer filter failed: ${err.message}` });
          setFilteredLayerRows(layerAttributeResult.rows);
          setFilteredLayerTotal(layerAttributeResult.total);
        }
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    };

    fetchLayerRows();
    return () => { cancelled = true; };
  }, [selectedLayer, selectedLayerFilters, attributeSearch, attributeSortBy, attributeSortDirection, attributePageIndex, attributePageSize, layerAttributeResult.rows, layerAttributeResult.total, addToast]);

  const handleProfileColumn = async (column: string) => {
    setColumnProfile(null);
    if (selectedLayer) {
      try {
        setIsProfileLoading(true);
        const profile = await queryLayerColumnProfile({
          layer: selectedLayer,
          filters: selectedLayerFilters,
          column,
        });
        setColumnProfile(profile);
      } catch (err: any) {
        addToast({ type: 'error', message: `Histogram failed: ${err.message}` });
      } finally {
        setIsProfileLoading(false);
      }
      return;
    }
    if (!selectedNodeId) return;

    try {
      setIsProfileLoading(true);
      const { withClause } = buildWorkflowSQL(nodes, edges);
      const targetAlias = cteAlias(selectedNodeId);
      const schema = nodeSchemas[selectedNodeId];
      const type = columnType(schema, column);
      const normalizedSearch = attributeSearch.trim();
      const columns = searchableColumnNames(schema);
      const whereClause = normalizedSearch && columns.length
        ? ` WHERE ${columns.map((name) => `CAST(${qi(name)} AS VARCHAR) ILIKE '%${escapeSql(normalizedSearch)}%'`).join(' OR ')}`
        : '';
      const totalSql = `${withClause} SELECT COUNT(*) AS total, SUM(CASE WHEN ${qi(column)} IS NULL THEN 1 ELSE 0 END) AS null_count FROM ${targetAlias}${whereClause};`;
      const totalResult = await duckdbService.query(totalSql);
      const totalRow = totalResult.toArray()[0];
      const totalRaw = typeof totalRow?.toJSON === 'function' ? totalRow.toJSON() : totalRow;
      const total = Number(totalRaw?.total ?? 0);
      const nullCount = Number(totalRaw?.null_count ?? 0);

      if (isNumericType(type)) {
        const statsSql = `${withClause} SELECT MIN(${qi(column)}) AS min_value, MAX(${qi(column)}) AS max_value FROM ${targetAlias}${whereClause};`;
        const statsResult = await duckdbService.query(statsSql);
        const statsRow = statsResult.toArray()[0];
        const statsRaw = typeof statsRow?.toJSON === 'function' ? statsRow.toJSON() : statsRow;
        const min = Number(statsRaw?.min_value);
        const max = Number(statsRaw?.max_value);
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          setColumnProfile({ column, kind: 'numeric', total, nullCount, bins: [] });
          return;
        }
        const binCount = 12;
        const bucketExpr = max === min
          ? '0'
          : `LEAST(${binCount - 1}, CAST(FLOOR((CAST(${qi(column)} AS DOUBLE) - ${min}) / ${((max - min) / binCount) || 1}) AS INTEGER))`;
        const binsSql = `${withClause} SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM ${targetAlias}${whereClause}${whereClause ? ' AND' : ' WHERE'} ${qi(column)} IS NOT NULL GROUP BY bucket ORDER BY bucket;`;
        const binsResult = await duckdbService.query(binsSql);
        const binMap = new Map<number, number>();
        binsResult.toArray().forEach((row: any) => {
          const raw = typeof row?.toJSON === 'function' ? row.toJSON() : row;
          binMap.set(Number(raw.bucket), Number(raw.count));
        });
        const width = max === min ? 1 : (max - min) / binCount;
        const bins = Array.from({ length: binCount }, (_, index) => ({
          label: `${(min + width * index).toPrecision(3)}-${(min + width * (index + 1)).toPrecision(3)}`,
          min: min + width * index,
          max: min + width * (index + 1),
          count: binMap.get(index) || 0,
        }));
        setColumnProfile({ column, kind: 'numeric', total, nullCount, min, max, bins });
      } else {
        const binsSql = `${withClause} SELECT CAST(${qi(column)} AS VARCHAR) AS label, COUNT(*) AS count FROM ${targetAlias}${whereClause}${whereClause ? ' AND' : ' WHERE'} ${qi(column)} IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT 12;`;
        const binsResult = await duckdbService.query(binsSql);
        const bins = binsResult.toArray().map((row: any) => {
          const raw = typeof row?.toJSON === 'function' ? row.toJSON() : row;
          return { label: String(raw.label), value: String(raw.label), count: Number(raw.count) };
        });
        setColumnProfile({ column, kind: 'categorical', total, nullCount, bins });
      }
    } catch (err: any) {
      addToast({ type: 'error', message: `Histogram failed: ${err.message}` });
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handleRunSQL = async () => {
    if (!manualSQL) return;
    try {
      setIsPreviewLoading(true);
      const layerId = `manual-query-${Date.now()}`;
      const tableName = `ymn_manual_${Date.now()}`;
      await duckdbService.materializeQueryAsTable(manualSQL, tableName);
      const source = await duckdbService.prepareLayerSource(tableName, { kind: 'duckdb-query' });
      const featureCount = await duckdbService.getTableFeatureCount(tableName);
      if (source) {
        addMapLayer({
          id: layerId,
          name: 'Query Result',
          source,
          tileSource: source.tileSource,
          featureCount,
          sourceKind: 'manual',
        });
      }
      setLastManualSql(manualSQL);
      const result = await duckdbService.query(manualSQL);
      setPreviewData(result.toArray().map((r: any) => typeof r.toJSON === 'function' ? r.toJSON() : r));
      setWorkspaceTab('attributes');
    } catch (err: any) {
      addToast({ type: 'error', message: `SQL Error: ${err.message}` });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handlePromoteToNode = () => {
    if (!lastManualSql) return;
    const sqlSnippet = lastManualSql.length > 120 ? lastManualSql.slice(0, 120) + '...' : lastManualSql;
    const nodeId = `sql-node-${Date.now()}`;
    addNode({
      id: nodeId,
      type: 'analysis',
      position: { x: 350, y: 250 },
      data: {
        label: 'Custom SQL',
        type: 'analysis',
        config: { operation: 'ST_Buffer', customSql: lastManualSql },
      },
    });
    addToast({ type: 'success', message: `Created node from SQL` });
    setLastManualSql(null);
  };

  const handleExport = async (format: 'parquet' | 'csv' | 'json' = 'parquet') => {
    try {
      if (nodes.length === 0) return;
      const { resultSql } = buildWorkflowSQL(nodes, edges);
      
      const { buffer, fileName } = await duckdbService.exportTable(resultSql, format);
      
      const blob = new Blob([buffer as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      addToast({ type: 'error', message: `Export failed: ${err.message}` });
    }
  };

  useEffect(() => {
    const fetchNodePreview = async () => {
      if (!selectedNodeId) {
        setPreviewData([]);
        setAttributeTotalRows(undefined);
        return;
      }

      const node = nodes.find((item) => item.id === selectedNodeId);
      if (node?.data.type === 'input' && !node.data.config?.tableName) {
        setPreviewData([]);
        setAttributeTotalRows(undefined);
        return;
      }

      try {
        setIsPreviewLoading(true);
        const { withClause } = buildWorkflowSQL(nodes, edges);
        const targetAlias = cteAlias(selectedNodeId);
        const columns = searchableColumnNames(nodeSchemas[selectedNodeId]);
        const normalizedSearch = attributeSearch.trim();
        const whereClause = normalizedSearch && columns.length
          ? ` WHERE ${columns.map((column) => `CAST(${qi(column)} AS VARCHAR) ILIKE '%${escapeSql(normalizedSearch)}%'`).join(' OR ')}`
          : '';
        const sortClause = attributeSortBy
          ? ` ORDER BY ${qi(attributeSortBy)} ${attributeSortDirection.toUpperCase()} NULLS LAST`
          : '';
        const offset = attributePageIndex * attributePageSize;
        const countSql = `${withClause} SELECT COUNT(*) AS row_count FROM ${targetAlias}${whereClause};`;
        const previewSql = `${withClause} SELECT * FROM ${targetAlias}${whereClause}${sortClause} LIMIT ${attributePageSize} OFFSET ${offset};`;
        
        const [countResult, result] = await Promise.all([
          duckdbService.query(countSql),
          duckdbService.query(previewSql),
        ]);
        const countRow = countResult.toArray()[0];
        const countRaw = typeof countRow?.toJSON === 'function' ? countRow.toJSON() : countRow;
        setAttributeTotalRows(Number(countRaw?.row_count ?? countRaw?.count_star ?? 0));
        setPreviewData(result.toArray().map((r: any) => typeof r.toJSON === 'function' ? r.toJSON() : r));
      } catch (err) {
        console.error('Failed to fetch node preview:', err);
        setPreviewData([]);
        setAttributeTotalRows(undefined);
      } finally {
        setIsPreviewLoading(false);
      }
    };

    if (!isManualSQL && selectedNodeId) {
      fetchNodePreview();
    }
  }, [selectedNodeId, nodes, edges, isManualSQL, attributePageIndex, attributePageSize, attributeSearch, attributeSortBy, attributeSortDirection, nodeSchemas]);

  const [topRatio, setTopRatio] = useState(0.6);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await duckdbService.init();
        setDuckDBReady(true);
      } catch (e) {
        console.error('DuckDB Init failed', e);
      }
    };
    init();
  }, [setDuckDBReady]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Delete/Backspace: remove selected node
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          removeNode(selectedNodeId);
          setSelectedNodeId(null);
          e.preventDefault();
        }
      }

      // Ctrl+D: duplicate selected node
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (selectedNodeId) {
          duplicateNode(selectedNodeId, `node-${Date.now()}`);
          e.preventDefault();
        }
      }

      // Ctrl+Shift+M: toggle manual SQL mode
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'm') {
        setIsManualSQL(!isManualSQL);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, removeNode, duplicateNode, setSelectedNodeId, isManualSQL, setIsManualSQL]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      setTopRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };

    const stopResize = () => setIsResizing(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isResizing]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6 z-50">
        <div className="flex items-center gap-3">
            <img src={new URL('../logo.png', import.meta.url).href} alt="Logo" className="h-10 w-10" />
          <div>
            <h1 className="font-bold text-sm tracking-tight leading-none uppercase">YMNNGIS</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">You Might Not Need A Desktop GIS</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              Dashboard Status: {duckdbReady ? 'ready' : 'initializing...'}
            </span>
          </div>
          <button className="p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <Sidebar className="w-96">
          <ErrorBoundary name="Chat">
            <Chat />
          </ErrorBoundary>
        </Sidebar>

        {/* Main Workspace */}
        <main ref={workspaceRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <ErrorBoundary name="Map" fallback={
            <div className="flex items-center justify-center h-full bg-slate-100 text-slate-400 text-[11px] italic">Map failed to load</div>
          }>
            <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${topRatio * 100}%` }}>
              <MapView />
            </div>
          </ErrorBoundary>

          <div
            className="flex h-2 cursor-row-resize bg-slate-200/80 hover:bg-slate-300 transition-colors"
            onPointerDown={() => setIsResizing(true)}
          />

          <div
            className="flex min-h-0 flex-col overflow-hidden border-t bg-white"
            style={{ flexBasis: `${(1 - topRatio) * 100}%` }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b bg-slate-50 px-3">
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setWorkspaceTab('diagram')}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                    workspaceTab === 'diagram'
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  )}
                >
                  <Workflow className="w-3 h-3" />
                  Node Diagram
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceTab('attributes');
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                    workspaceTab === 'attributes'
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  )}
                >
                  <Database className="w-3 h-3" />
                  Attribute Inspector
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="max-w-64 truncate text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {attributeSourceLabel}
                </span>
                {workspaceTab === 'attributes' && selectedNodeId && (
                  <button
                    onClick={() => handleExport('csv')}
                    className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Download className="w-2.5 h-2.5" /> CSV
                  </button>
                )}
                {workspaceTab === 'attributes' && isPreviewLoading && (
                  <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {workspaceTab === 'diagram' ? (
                <ErrorBoundary name="Workflow" fallback={
                  <div className="flex items-center justify-center h-full bg-slate-100 text-slate-400 text-[11px] italic">Workflow editor error</div>
                }>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => {
                      setSelectedNodeId(node.id);
                      setSelectedLayerId(null);
                    }}
                    onPaneClick={() => {
                      setSelectedNodeId(null);
                      setSelectedLayerId(null);
                    }}
                    nodeTypes={nodeTypes}
                    fitView
                    className="h-full bg-background"
                  >
                    <Background gap={24} size={1} />
                    <Controls />
                  </ReactFlow>
                </ErrorBoundary>
              ) : (
                <ErrorBoundary name="DataTable">
                  <DataTable
                    data={attributeData}
                    isLoading={!selectedLayer && isPreviewLoading}
                    pageIndex={attributePageIndex}
                    pageSize={attributePageSize}
                    totalRows={resolvedAttributeTotalRows}
                    search={attributeSearch}
                    sortBy={attributeSortBy}
                    sortDirection={attributeSortDirection}
                    columnProfile={columnProfile}
                    isProfileLoading={isProfileLoading}
                    selectedFeatureIds={selectedFeatureIds}
                    onClearSelection={selectedLayer ? () => clearFeatureSelection(selectedLayer.id) : undefined}
                    filters={selectedLayerFilters}
                    activeFilterKeys={activeFilterKeys}
                    onRemoveFilter={selectedLayer ? removeSelectedLayerFilter : undefined}
                    onClearFilters={selectedLayer ? clearSelectedLayerFilters : undefined}
                    onApplyProfileFilter={selectedLayer ? toggleProfileFilter : undefined}
                    onSearchChange={setAttributeSearch}
                    onSortChange={handleAttributeSortChange}
                    onProfileColumn={handleProfileColumn}
                    onClearProfile={() => setColumnProfile(null)}
                    onPageChange={setAttributePageIndex}
                    onPageSizeChange={(size) => {
                      setAttributePageSize(size);
                      setAttributePageIndex(0);
                    }}
                  />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </main>

        <aside className="z-40 flex min-h-0 w-96 shrink-0 flex-col border-l bg-white shadow-sm">
          <div className="shrink-0 border-b bg-slate-50 p-2">
            <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setRightPanelTab('layers')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                  rightPanelTab === 'layers'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                )}
              >
                <Layers className="h-3 w-3" />
                Layers
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('charts')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                  rightPanelTab === 'charts'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                )}
              >
                <BarChart3 className="h-3 w-3" />
                Charts
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('details')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                  rightPanelTab === 'details'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                )}
              >
                <FileText className="h-3 w-3" />
                Details
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {rightPanelTab === 'layers' ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 border-b">
                  <ErrorBoundary name="Layer Manager">
                    <LayerManager />
                  </ErrorBoundary>
                </div>

                <div className="min-h-0 flex-1">
                  <ErrorBoundary name="Visualisation Panel">
                    <VisualisationPanel />
                  </ErrorBoundary>
                </div>
              </div>
            ) : rightPanelTab === 'charts' ? (
              <ErrorBoundary name="Chart Panel">
                <ChartPanel />
              </ErrorBoundary>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="max-h-72 shrink-0 overflow-y-auto border-b">
                  <ErrorBoundary name="Selection Summary">
                    <SelectionSummary
                      layer={selectedLayer}
                      filters={selectedLayerFilters}
                      selectedFeatureIds={selectedFeatureIds}
                    />
                  </ErrorBoundary>
                </div>

                <ErrorBoundary name="SQL Panel">
                  <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                      <div className="flex items-center justify-between gap-2 pb-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          SQL Editor & Workflow Preview
                        </h3>
                        <div className="flex items-center gap-2">
                          <label className="flex cursor-pointer items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-slate-400">Manual Mode</span>
                            <div className="relative">
                              <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={isManualSQL}
                                onChange={(e) => setIsManualSQL(e.target.checked)}
                              />
                              <div className="h-4 w-8 rounded-full bg-slate-200 transition-colors peer-checked:bg-primary"></div>
                              <div className="absolute left-1 top-1 h-2 w-2 rounded-full bg-white transition-transform peer-checked:translate-x-4"></div>
                            </div>
                          </label>
                        </div>
                      </div>

                      <div className="relative flex min-h-0 flex-1 flex-col">
                        <textarea
                          value={manualSQL}
                          onChange={(e) => isManualSQL && setManualSQL(e.target.value)}
                          readOnly={!isManualSQL}
                          className={cn(
                            'min-h-0 flex-1 resize-none rounded-2xl border bg-white p-4 font-mono text-[11px] leading-relaxed shadow-inner outline-none transition-all',
                            isManualSQL ? 'border-primary text-slate-800 ring-2 ring-primary/5' : 'border-slate-200 bg-slate-100/50 text-slate-500'
                          )}
                          placeholder="Write your spatial SQL here..."
                        />

                        <div className="absolute bottom-4 right-4 flex flex-col items-end gap-1.5">
                          {isManualSQL && (
                            <>
                              <button
                                onClick={handleRunSQL}
                                className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-[10px] font-bold text-white shadow-lg transition-all hover:bg-slate-800"
                              >
                                <Play className="h-3 w-3 fill-current" /> RUN QUERY
                              </button>
                              {lastManualSql && (
                                <button
                                  onClick={handlePromoteToNode}
                                  className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[9px] font-bold text-indigo-700 transition-all hover:bg-indigo-100"
                                >
                                  <Workflow className="h-3 w-3" /> Promote to Node
                                </button>
                              )}
                            </>
                          )}
                          {!isManualSQL && (
                            <div className="rounded-lg bg-slate-200/50 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur-sm">
                              Synced to Workflow
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </ErrorBoundary>
              </div>
            )}
          </div>
        </aside>
      </div>

      <ToastContainer />
    </div>
  );
}
