import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import type { VisualFilter } from '../types/visualAnalytics';
import { FilterChips } from './Visualisation/FilterChips';

export type HistogramBin = {
  label: string;
  count: number;
  value?: string;
  min?: number;
  max?: number;
};

export type ColumnProfile = {
  column: string;
  kind: 'numeric' | 'categorical';
  total: number;
  nullCount: number;
  min?: number;
  max?: number;
  bins: HistogramBin[];
};

interface DataTableProps {
  data: any[];
  isLoading?: boolean;
  pageIndex: number;
  pageSize: number;
  totalRows?: number;
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  columnProfile: ColumnProfile | null;
  isProfileLoading?: boolean;
  selectedFeatureIds?: string[];
  onClearSelection?: () => void;
  filters?: VisualFilter[];
  activeFilterKeys?: string[];
  onRemoveFilter?: (index: number) => void;
  onClearFilters?: () => void;
  onApplyProfileFilter?: (profile: ColumnProfile, bin: HistogramBin) => void;
  onSearchChange: (search: string) => void;
  onSortChange: (column: string) => void;
  onProfileColumn: (column: string) => void;
  onClearProfile: () => void;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const DataTable = ({
  data,
  isLoading,
  pageIndex,
  pageSize,
  totalRows,
  search,
  sortBy,
  sortDirection,
  columnProfile,
  isProfileLoading,
  selectedFeatureIds = [],
  onClearSelection,
  filters = [],
  activeFilterKeys = [],
  onRemoveFilter,
  onClearFilters,
  onApplyProfileFilter,
  onSearchChange,
  onSortChange,
  onProfileColumn,
  onClearProfile,
  onPageChange,
  onPageSizeChange,
}: DataTableProps) => {
  const columnHelper = createColumnHelper<any>();
  const rowCount = totalRows ?? data.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const selectedFeatureSet = useMemo(() => new Set(selectedFeatureIds), [selectedFeatureIds]);
  const activeFilterSet = useMemo(() => new Set(activeFilterKeys), [activeFilterKeys]);

  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // Get keys from the first row, excluding internal/heavy columns
    const keys = Object.keys(data[0]).filter(key => 
      key !== 'geojson' && key !== 'geometry' && key !== 'geom' && key !== '_ymn_feature_id'
    );

    return keys.map(key => 
      columnHelper.accessor(key, {
        header: () => (
          <div className="flex max-w-[240px] items-center gap-1">
            <button
              type="button"
              onClick={() => onSortChange(key)}
              className="flex min-w-0 items-center gap-1 truncate text-left uppercase tracking-wider"
              title={`Sort by ${key}`}
            >
              <span className="truncate">{key}</span>
              {sortBy === key && (
                <span className="text-[9px] text-slate-400">{sortDirection === 'asc' ? 'ASC' : 'DESC'}</span>
              )}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onProfileColumn(key);
              }}
              className="rounded border border-slate-200 bg-white px-1 text-[8px] font-bold text-slate-400 hover:text-slate-700"
              title={`Profile ${key}`}
            >
              HIST
            </button>
          </div>
        ),
        cell: info => {
          const value = info.getValue();
          if (value === null || value === undefined) return <span className="text-slate-300 italic">null</span>;
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        },
      })
    );
  }, [data, onSortChange, sortBy, sortDirection]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading Data...</span>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-slate-400 text-[11px] italic bg-slate-50">
        No attribute data available for the selected node.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-white px-3">
        <input
          type="search"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
            onPageChange(0);
          }}
          placeholder="Search attributes..."
          className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] outline-none focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
        />
        {sortBy && (
          <button
            type="button"
            onClick={() => onSortChange(sortBy)}
            className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-bold uppercase tracking-wider text-slate-500"
            title="Toggle sort direction"
          >
            {sortBy} · {sortDirection}
          </button>
        )}
        {selectedFeatureIds.length > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="h-7 rounded-md border border-orange-200 bg-orange-50 px-2 text-[9px] font-bold uppercase tracking-wider text-orange-700"
            title="Clear selected map features"
          >
            {selectedFeatureIds.length.toLocaleString()} selected
          </button>
        )}
      </div>

      <FilterChips
        filters={filters}
        onRemove={(index) => onRemoveFilter?.(index)}
        onClear={() => onClearFilters?.()}
      />

      {(columnProfile || isProfileLoading) && (
        <div className="shrink-0 border-b bg-slate-50 px-3 py-2">
          {isProfileLoading ? (
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Profiling column...
            </div>
          ) : columnProfile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    {columnProfile.column} · {columnProfile.kind}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {columnProfile.total.toLocaleString()} rows · {columnProfile.nullCount.toLocaleString()} nulls
                    {columnProfile.kind === 'numeric' && columnProfile.min !== undefined && columnProfile.max !== undefined
                      ? ` · ${columnProfile.min.toLocaleString()} to ${columnProfile.max.toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClearProfile}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold uppercase text-slate-500"
                >
                  Close
                </button>
              </div>
              <div className="flex h-16 items-end gap-1">
                {columnProfile.bins.map((bin) => {
                  const maxCount = Math.max(...columnProfile.bins.map((item) => item.count), 1);
                  const key = columnProfile.kind === 'numeric'
                    ? `${columnProfile.column}:range:${bin.min ?? ''}:${bin.max ?? ''}`
                    : `${columnProfile.column}:category:${bin.value ?? bin.label}`;
                  const isActiveFilter = activeFilterSet.has(key);
                  return (
                    <div key={bin.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onApplyProfileFilter?.(columnProfile, bin)}
                        className={isActiveFilter ? 'w-full rounded-t bg-orange-500 ring-2 ring-orange-200' : 'w-full rounded-t bg-slate-800 hover:bg-slate-600'}
                        style={{ height: `${Math.max(4, (bin.count / maxCount) * 52)}px` }}
                        title={`Filter ${columnProfile.column} by ${bin.label}: ${bin.count.toLocaleString()}`}
                      />
                      <div className="w-full truncate text-center text-[8px] text-slate-400" title={bin.label}>
                        {bin.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="text-left px-3 py-2 border-b border-r border-slate-200 font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map(row => {
              const featureId = String(row.original?._ymn_feature_id ?? '');
              const isSelected = featureId && selectedFeatureSet.has(featureId);
              return (
              <tr key={row.id} className={isSelected ? 'bg-orange-50 hover:bg-orange-100 transition-colors' : 'hover:bg-slate-50 transition-colors'}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-1.5 border-r border-slate-100 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex h-10 shrink-0 items-center justify-between border-t bg-slate-50 px-3 text-[10px] text-slate-500">
        <div className="font-semibold">
          {rowCount.toLocaleString()} rows · page {pageIndex + 1} of {pageCount}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 font-semibold uppercase tracking-wider">
            Rows
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] outline-none"
            >
              {[25, 50, 100, 250].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
            className="rounded border border-slate-200 bg-white px-2 py-1 font-bold disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex >= pageCount - 1}
            className="rounded border border-slate-200 bg-white px-2 py-1 font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
