import { Download } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { duckdbService } from '../../services/duckdb';
import { buildNodeSelectSql } from '../../services/workflowPreviewService';
import { DataTable } from '../DataTable';
import { ErrorBoundary } from '../ErrorBoundary';
import type { useAttributeTable } from '../../hooks/useAttributeTable';

export const TableTab = ({ table }: { table: ReturnType<typeof useAttributeTable> }) => {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const addToast = useStore((s) => s.addToast);

  const handleExport = async (format: 'parquet' | 'csv' | 'json' = 'csv') => {
    try {
      if (nodes.length === 0 || !selectedNodeId) return;
      // Export the node being viewed, not the whole workflow.
      const exportSql = buildNodeSelectSql(nodes, edges, selectedNodeId);
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
          {selectedNodeId && (
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
            columnProfile={table.columnProfile}
            isProfileLoading={table.isProfileLoading}
            selectedFeatureIds={table.selectedFeatureIds}
            onClearSelection={table.selectedLayer ? table.onClearSelection : undefined}
            filters={table.filters}
            activeFilterKeys={table.activeFilterKeys}
            onRemoveFilter={table.selectedLayer ? table.onRemoveFilter : undefined}
            onClearFilters={table.selectedLayer ? table.onClearFilters : undefined}
            onApplyProfileFilter={table.selectedLayer ? table.onApplyProfileFilter : undefined}
            onSearchChange={table.onSearchChange}
            onSortChange={table.onSortChange}
            onProfileColumn={table.onProfileColumn}
            onClearProfile={table.onClearProfile}
            onPageChange={table.onPageChange}
            onPageSizeChange={table.onPageSizeChange}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
};
