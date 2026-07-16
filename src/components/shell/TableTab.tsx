import { Download, FunctionSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { duckdbService } from '../../services/duckdb';
import { buildNodeTableExportSql } from '../../services/workflowPreviewService';
import { buildLayerExportSql } from '../../services/visualAnalyticsService';
import { DataTable } from '../DataTable';
import { ErrorBoundary } from '../ErrorBoundary';
import type { useAttributeTable } from '../../hooks/useAttributeTable';
import { FieldCalculatorDialog } from '../FieldCalculatorDialog';

export const TableTab = ({ table }: { table: ReturnType<typeof useAttributeTable> }) => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const addToast = useStore((s) => s.addToast);
  const [isCalculatorOpen, setCalculatorOpen] = useState(false);
  const availableColumns = useMemo(() => {
    const computed = new Set(table.computedFields.map((field) => field.name));
    const names = new Set<string>();
    table.data.slice(0, 20).forEach((row) => Object.keys(row).forEach((key) => {
      if (!computed.has(key) && !['geojson', 'geometry', 'geom', 'wkb_geometry', '__ymn_tile_geom', '_ymn_feature_id', '__ymn_mvt_id'].includes(key.toLowerCase())) names.add(key);
    }));
    return [...names];
  }, [table.computedFields, table.data]);

  const handleExport = async (format: 'parquet' | 'csv' | 'json' = 'csv') => {
    try {
      let exportSql: string;
      if (table.selectedLayer) {
        exportSql = await buildLayerExportSql({
          layer: table.selectedLayer,
          filters: table.filters,
          search: table.search,
          sortBy: table.sortBy,
          sortDirection: table.sortDirection,
          computedFields: table.computedFields,
        });
      } else if (selectedNodeId) {
        exportSql = buildNodeTableExportSql({
          nodes,
          edges,
          nodeId: selectedNodeId,
          schema: useStore.getState().nodeSchemas[selectedNodeId],
          filters: table.filters,
          search: table.search,
          sortBy: table.sortBy,
          sortDirection: table.sortDirection,
          computedFields: table.computedFields,
        });
      } else {
        return;
      }
      const { buffer, fileName } = await duckdbService.exportTable(exportSql, format);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-slate-50 px-3">
        <span className="max-w-96 truncate text-xs font-semibold text-slate-600">
          {table.sourceLabel}
        </span>
        <div className="flex items-center gap-2">
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
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
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
            featureIdColumn={table.selectedLayer?.source.kind === 'duckdb-table' || table.selectedLayer?.source.kind === 'duckdb-query'
              ? table.selectedLayer.source.featureIdColumn
              : '_ymn_feature_id'}
            onClearSelection={table.selectedLayer ? table.onClearSelection : undefined}
            onToggleSelection={table.selectedLayer ? table.onToggleSelection : undefined}
            onSetSelection={table.selectedLayer ? table.onSetSelection : undefined}
            onZoomSelection={table.selectedLayer ? table.onZoomSelection : undefined}
            isZoomingSelection={table.isZoomingSelection}
            isSelectionActionLoading={table.isSelectionActionLoading}
            onSelectAllFiltered={table.selectedLayer ? table.onSelectAllFiltered : undefined}
            onInvertSelection={table.selectedLayer ? table.onInvertSelection : undefined}
            onCreateSelectionLayer={table.selectedLayer ? table.onCreateSelectionLayer : undefined}
            onCreateSelectionFilterNode={table.selectedLayer ? table.onCreateSelectionFilterNode : undefined}
            hoveredFeatureId={table.hoveredFeatureId}
            onHoverFeature={table.selectedLayer ? table.onHoverFeature : undefined}
            savedViews={table.savedViews}
            appliedLayout={table.appliedLayout}
            onSaveView={table.onSaveTableView}
            onApplyView={table.onApplyTableView}
            onDeleteView={table.onDeleteTableView}
            filters={table.filters}
            activeFilterKeys={table.activeFilterKeys}
            onRemoveFilter={table.selectedLayer || table.selectedNode ? table.onRemoveFilter : undefined}
            onClearFilters={table.selectedLayer || table.selectedNode ? table.onClearFilters : undefined}
            onApplyProfileFilter={table.selectedLayer || table.selectedNode ? table.onApplyProfileFilter : undefined}
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
