import { Copy, Download, FunctionSquare, ScanSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { duckdbService } from '../../services/duckdb';
import { buildNodeTableExportSql } from '../../services/workflowPreviewService';
import { buildLayerExportSql } from '../../services/visualAnalyticsService';
import { DataTable } from '../DataTable';
import { ErrorBoundary } from '../ErrorBoundary';
import type { useAttributeTable } from '../../hooks/useAttributeTable';
import { FieldCalculatorDialog } from '../FieldCalculatorDialog';
import { useAnalyticsCommands } from '../../hooks/useAnalyticsCommands';
import { metadataForLayer, metadataForWorkflowNode } from '../../utils/datasetMetadata';
import { copyText, downloadBlob } from '../../utils/download';

export const TableTab = ({ table }: { table: ReturnType<typeof useAttributeTable> }) => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const nodeSchemas = useStore((s) => s.nodeSchemas);
  const addToast = useStore((s) => s.addToast);
  const setDatasetOverviewLayerId = useStore((s) => s.setDatasetOverviewLayerId);
  const addChart = useStore((s) => s.addChart);
  const addKpi = useStore((s) => s.addKpi);
  const [isCalculatorOpen, setCalculatorOpen] = useState(false);
  const executeAnalyticsCommand = useAnalyticsCommands();
  const datasetMetadata = useMemo(() => {
    if (table.selectedLayer) return metadataForLayer(table.selectedLayer);
    if (table.selectedNode) return metadataForWorkflowNode(table.selectedNode, nodeSchemas[table.selectedNode.id]);
    return undefined;
  }, [table.selectedLayer, table.selectedNode, nodeSchemas]);

  const runQuickCommand = async (command: Parameters<typeof executeAnalyticsCommand>[0]) => {
    const result = await executeAnalyticsCommand(command);
    if (!result.ok) addToast({ type: 'warning', message: result.message });
  };
  const createDatasetChart = (field: string) => {
    const dataset = table.selectedDataset;
    if (!dataset) return;
    const sourceField = dataset.fields.find((item) => item.name === field);
    const numeric = Boolean(sourceField && /int|float|double|decimal|numeric|real/i.test(sourceField.type));
    addChart({
      id: `chart-${Date.now()}`,
      title: `${field} ${numeric ? 'distribution' : 'breakdown'}`,
      layerId: dataset.source.kind === 'layer' ? dataset.source.layerId : '',
      tableName: dataset.source.kind === 'table' ? dataset.source.tableName : dataset.relationName,
      source: dataset.source,
      type: numeric ? 'histogram' : 'bar',
      dimensionField: field,
      aggregation: 'count',
      paletteId: numeric ? 'teal' : 'categorical',
      maxCategories: numeric ? 12 : 8,
    });
    addToast({ type: 'success', message: `Created a linked chart for ${field}` });
  };
  const availableColumns = useMemo(() => {
    const computed = new Set(table.computedFields.map((field) => field.name));
    const names = new Set<string>();
    table.data.slice(0, 20).forEach((row) => Object.keys(row).forEach((key) => {
      if (!computed.has(key) && !['geojson', 'geometry', 'geom', 'wkb_geometry', '__alur_tile_geom', '_alur_feature_id', '__alur_mvt_id'].includes(key.toLowerCase())) names.add(key);
    }));
    return [...names];
  }, [table.computedFields, table.data]);

  const buildCurrentExportSql = async () => {
    if (table.selectedLayer) {
      return buildLayerExportSql({
        layer: table.selectedLayer,
        filters: table.filters,
        search: table.search,
        sortBy: table.sortBy,
        sortDirection: table.sortDirection,
        computedFields: table.computedFields,
      });
    }
    if (selectedNodeId) {
      return buildNodeTableExportSql({
        nodes,
        edges,
        nodeId: selectedNodeId,
        schema: nodeSchemas[selectedNodeId],
        filters: table.filters,
        search: table.search,
        sortBy: table.sortBy,
        sortDirection: table.sortDirection,
        computedFields: table.computedFields,
      });
    }
    throw new Error('Select a layer or workflow node first.');
  };

  const handleCopySql = async () => {
    try {
      await copyText(await buildCurrentExportSql());
      addToast({ type: 'success', message: 'Copied the current filtered table SQL' });
    } catch (err: any) {
      addToast({ type: 'error', message: `Could not copy SQL: ${err?.message || 'Unknown error'}` });
    }
  };

  const handleExport = async (format: 'parquet' | 'csv' | 'json' = 'csv') => {
    try {
      const exportSql = await buildCurrentExportSql();
      const { buffer, fileName } = await duckdbService.exportTable(exportSql, format);
      const blob = new Blob([buffer as BlobPart], { type: 'application/octet-stream' });
      downloadBlob(blob, fileName);
      addToast({ type: 'success', message: `Exported the current filtered table as ${format.toUpperCase()}` });
    } catch (err: any) {
      addToast({ type: 'error', message: `Export failed: ${err.message}` });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-slate-50 px-3">
        <span className="max-w-96 truncate text-xs font-semibold text-slate-600">
          {table.sourceLabel}
          {table.selectedDataset && !table.selectedLayer && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-medium text-slate-500" title={`Stable row identity: ${table.selectedDataset.rowIdColumn} (${table.selectedDataset.rowIdQuality})`}>ID {table.selectedDataset.rowIdQuality === 'validated-unique' ? 'validated' : 'materialised'}</span>}
        </span>
        <div className="flex items-center gap-2">
          {table.selectedLayer && (
            <button type="button" onClick={() => setDatasetOverviewLayerId(table.selectedLayer!.id)} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-700" title="Open dataset overview">
              <ScanSearch className="h-3 w-3" /> Overview
            </button>
          )}
          {table.data.length > 0 && (
            <button
              type="button"
              onClick={() => setCalculatorOpen(true)}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
              title="Add a calculated field"
            >
              <FunctionSquare className="h-3 w-3" /> Calculate
              {table.computedFields.length > 0 && <span className="rounded bg-violet-50 px-1 text-[9px] text-violet-600">{table.computedFields.length}</span>}
            </button>
          )}
          {(selectedNodeId || table.selectedLayer) && (
            <>
              <button
                type="button"
                onClick={() => { void handleCopySql(); }}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                title="Copy SQL for the current filters, search, sorting, and calculated fields"
              >
                <Copy className="h-3 w-3" /> SQL
              </button>
              <button
                type="button"
                onClick={() => { void handleExport('csv'); }}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                title="Export the current filtered table as CSV"
              >
                <Download className="h-3 w-3" /> CSV
              </button>
            </>
          )}
          {table.isLoading && (
            <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary name="DataTable">
          <DataTable
            data={table.data}
            isLoading={table.isLoading}
            pageIndex={table.pageIndex}
            pageSize={table.pageSize}
            totalRows={table.totalRows}
            search={table.search}
            sortBy={table.sortBy}
            sortDirection={table.sortDirection}
            columnProfiles={table.columnProfiles}
            profileLoadingColumns={table.profileLoadingColumns}
            computedFields={table.computedFields}
            selectedFeatureIds={table.selectedFeatureIds}
            featureIdColumn={table.selectedDataset?.rowIdColumn || (table.selectedLayer?.source.kind === 'duckdb-table' || table.selectedLayer?.source.kind === 'duckdb-query'
              ? table.selectedLayer.source.featureIdColumn
              : '_alur_feature_id')}
            onClearSelection={table.selectedDataset ? table.onClearSelection : undefined}
            onToggleSelection={table.selectedDataset ? table.onToggleSelection : undefined}
            onSetSelection={table.selectedDataset ? table.onSetSelection : undefined}
            onZoomSelection={table.selectedLayer ? table.onZoomSelection : undefined}
            isZoomingSelection={table.isZoomingSelection}
            isSelectionActionLoading={table.isSelectionActionLoading}
            onSelectAllFiltered={table.selectedLayer ? table.onSelectAllFiltered : undefined}
            onInvertSelection={table.selectedLayer ? table.onInvertSelection : undefined}
            onCreateSelectionLayer={table.selectedLayer ? table.onCreateSelectionLayer : undefined}
            onCreateSelectionFilterNode={table.selectedLayer ? table.onCreateSelectionFilterNode : undefined}
            hoveredFeatureId={table.hoveredFeatureId}
            onHoverFeature={table.selectedDataset ? table.onHoverFeature : undefined}
            savedViews={table.savedViews}
            appliedLayout={table.appliedLayout}
            onSaveView={table.onSaveTableView}
            onApplyView={table.onApplyTableView}
            onDeleteView={table.onDeleteTableView}
            filters={table.filters}
            activeFilterKeys={table.activeFilterKeys}
            onRemoveFilter={table.selectedLayer || table.selectedNode ? table.onRemoveFilter : undefined}
            onUpdateFilter={table.selectedLayer || table.selectedNode ? table.onUpdateFilter : undefined}
            onClearFilters={table.selectedLayer || table.selectedNode ? table.onClearFilters : undefined}
            onApplyProfileFilter={table.selectedLayer || table.selectedNode ? table.onApplyProfileFilter : undefined}
            datasetMetadata={datasetMetadata}
            onQuickChart={table.selectedLayer ? (field) => { void runQuickCommand({ type: 'create-chart', datasetId: table.selectedLayer!.id, field }); } : table.selectedDataset ? createDatasetChart : undefined}
            onQuickStyle={table.selectedLayer ? (field) => { void runQuickCommand({ type: 'open-layer-style', datasetId: table.selectedLayer!.id, field }); } : undefined}
            onPinMetric={table.selectedLayer ? (field) => { void runQuickCommand({ type: 'pin-kpi', datasetId: table.selectedLayer!.id, field }); } : table.selectedDataset ? (field) => addKpi({ id: `kpi-${Date.now()}`, datasetId: table.selectedDataset!.id, source: table.selectedDataset!.source, title: `${field} mean`, field, aggregation: 'avg', comparison: 'total', format: 'compact' }) : undefined}
            onAddFilter={table.selectedLayer || table.selectedNode ? table.onAddFilter : undefined}
            onSearchChange={table.onSearchChange}
            onSortChange={table.onSortChange}
            onProfileColumn={table.onProfileColumn}
            onPageChange={table.onPageChange}
            onPageSizeChange={table.onPageSizeChange}
          />
        </ErrorBoundary>
      </div>
      {isCalculatorOpen && (
        <FieldCalculatorDialog
          fields={table.computedFields}
          availableColumns={availableColumns}
          sampleRows={table.data}
          onAdd={table.onAddComputedField}
          onUpdate={table.onUpdateComputedField}
          onDelete={table.onDeleteComputedField}
          onClose={() => setCalculatorOpen(false)}
        />
      )}
    </div>
  );
};
