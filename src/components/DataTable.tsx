import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bookmark,
  Columns3,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  ListChecks,
  LocateFixed,
  RotateCcw,
  Save,
  Search,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VisualFilter } from '../types/visualAnalytics';
import type { DatasetMetadata } from '../types/datasets';
import type { ComputedField } from '../utils/fieldCalculator';
import type { AppliedTableLayout, SavedTableView, TableLayout } from '../types/table';
import { cn } from '../utils/cn';
import { FilterChips } from './Visualisation/FilterChips';
import { FilterEditorDialog } from './Visualisation/FilterEditorDialog';
import { FieldQuickExploreMenu } from './Visualisation/FieldQuickExploreMenu';
import { visualFilterKey } from '../utils/visualFilters';

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

type RowData = Record<string, unknown>;

interface DataTableProps {
  data: RowData[];
  isLoading?: boolean;
  pageIndex: number;
  pageSize: number;
  totalRows?: number;
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  columnProfiles?: Record<string, ColumnProfile>;
  profileLoadingColumns?: string[];
  computedFields?: ComputedField[];
  selectedFeatureIds?: string[];
  featureIdColumn?: string;
  onClearSelection?: () => void;
  onToggleSelection?: (featureId: string) => void;
  onSetSelection?: (featureIds: string[]) => void;
  onZoomSelection?: () => void;
  isZoomingSelection?: boolean;
  isSelectionActionLoading?: boolean;
  onSelectAllFiltered?: () => void;
  onInvertSelection?: () => void;
  onCreateSelectionLayer?: () => void;
  onCreateSelectionFilterNode?: () => void;
  hoveredFeatureId?: string;
  onHoverFeature?: (featureId: string | null) => void;
  savedViews?: SavedTableView[];
  appliedLayout?: AppliedTableLayout | null;
  onSaveView?: (name: string, layout: TableLayout) => void;
  onApplyView?: (viewId: string) => void;
  onDeleteView?: (viewId: string) => void;
  filters?: VisualFilter[];
  activeFilterKeys?: string[];
  onRemoveFilter?: (index: number) => void;
  onUpdateFilter?: (index: number, filter: VisualFilter) => void;
  onClearFilters?: () => void;
  onApplyProfileFilter?: (profile: ColumnProfile, bin: HistogramBin) => void;
  datasetMetadata?: DatasetMetadata;
  onQuickChart?: (field: string) => void;
  onQuickStyle?: (field: string) => void;
  onPinMetric?: (field: string) => void;
  onAddFilter?: (filter: VisualFilter) => void;
  onSearchChange: (search: string) => void;
  onSortChange: (column: string) => void;
  onProfileColumn: (column: string) => void;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const INTERNAL_COLUMNS = new Set(['geojson', 'geometry', 'geom', 'wkb_geometry', '__alur_tile_geom', '_feature']);
const columnHelper = createColumnHelper<RowData>();

const formatCellValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 5 : 2,
      notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard',
    });
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const profileFilterKey = (profile: ColumnProfile, bin: HistogramBin) => visualFilterKey(
  profile.kind === 'numeric'
    ? { kind: 'range', field: profile.column, min: bin.min, max: bin.max }
    : { kind: 'category', field: profile.column, values: [bin.value ?? bin.label] },
);

const MiniHistogram = ({
  profile,
  activeFilterKeys,
  canFilter,
  onSelect,
}: {
  profile: ColumnProfile;
  activeFilterKeys: Set<string>;
  canFilter: boolean;
  onSelect?: (bin: HistogramBin) => void;
}) => {
  const maxCount = Math.max(1, ...profile.bins.map((bin) => bin.count));
  if (!profile.bins.length) {
    return <div className="flex h-[72px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-white text-[10px] font-medium text-slate-400">No distribution</div>;
  }

  return (
    <div className="flex h-[72px] items-end gap-0.5 rounded-md border border-slate-200 bg-white p-1" aria-label={`Histogram for ${profile.column}`}>
      {profile.bins.map((bin, index) => {
        const active = activeFilterKeys.has(profileFilterKey(profile, bin));
        return (
          <button
            key={`${bin.label}-${index}`}
            type="button"
            disabled={!canFilter}
            onClick={(event) => { event.stopPropagation(); onSelect?.(bin); }}
            className={cn(
              'pressable group flex h-full min-w-0 flex-1 items-end rounded-sm px-px outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
              canFilter ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default',
              active && 'bg-orange-100 ring-1 ring-orange-400',
            )}
            title={`${bin.label}: ${bin.count.toLocaleString()}${canFilter ? ' · click to filter' : ''}`}
          >
            <span
              className={cn('block w-full rounded-t-sm bg-slate-400 transition-colors group-hover:bg-slate-600', active && 'bg-orange-500 group-hover:bg-orange-600')}
              style={{ height: `${Math.max(3, (bin.count / maxCount) * 58)}px` }}
            />
          </button>
        );
      })}
    </div>
  );
};

export const DataTable = ({
  data,
  isLoading,
  pageIndex,
  pageSize,
  totalRows,
  search,
  sortBy,
  sortDirection,
  columnProfiles = {},
  profileLoadingColumns = [],
  computedFields = [],
  selectedFeatureIds = [],
  featureIdColumn,
  onClearSelection,
  onToggleSelection,
  onSetSelection,
  onZoomSelection,
  isZoomingSelection,
  isSelectionActionLoading,
  onSelectAllFiltered,
  onInvertSelection,
  onCreateSelectionLayer,
  onCreateSelectionFilterNode,
  hoveredFeatureId,
  onHoverFeature,
  savedViews = [],
  appliedLayout,
  onSaveView,
  onApplyView,
  onDeleteView,
  filters = [],
  activeFilterKeys = [],
  onRemoveFilter,
  onUpdateFilter,
  onClearFilters,
  onApplyProfileFilter,
  datasetMetadata,
  onQuickChart,
  onQuickStyle,
  onPinMetric,
  onAddFilter,
  onSearchChange,
  onSortChange,
  onProfileColumn,
  onPageChange,
  onPageSizeChange,
}: DataTableProps) => {
  const [showHistograms, setShowHistograms] = useState(true);
  const [showFieldMenu, setShowFieldMenu] = useState(false);
  const [showSelectionMenu, setShowSelectionMenu] = useState(false);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [viewName, setViewName] = useState('');
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ column: string; startX: number; startWidth: number } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [newFilter, setNewFilter] = useState<VisualFilter | null>(null);
  const keys = useMemo(() => {
    const names = new Set<string>();
    data.slice(0, 20).forEach((row) => Object.keys(row).forEach((key) => {
      if (!INTERNAL_COLUMNS.has(key.toLowerCase()) && key !== '_alur_feature_id' && key !== '__alur_mvt_id') names.add(key);
    }));
    return [...names];
  }, [data]);
  const signature = keys.join('\u001f');

  useEffect(() => {
    setColumnOrder((current) => [
      ...current.filter((column) => keys.includes(column)),
      ...keys.filter((column) => !current.includes(column)),
    ]);
    setHiddenColumns((current) => current.filter((column) => keys.includes(column)));
  }, [signature]);

  useEffect(() => {
    if (!appliedLayout) return;
    setColumnOrder(appliedLayout.columnOrder);
    setHiddenColumns(appliedLayout.hiddenColumns);
    setPinnedColumns(appliedLayout.pinnedColumns);
    setColumnWidths(appliedLayout.columnWidths);
    setShowHistograms(appliedLayout.showHistograms);
  }, [appliedLayout?.revision]);

  useEffect(() => {
    if (!resizing) return;
    const onPointerMove = (event: PointerEvent) => {
      const width = Math.max(90, Math.min(520, resizing.startWidth + event.clientX - resizing.startX));
      setColumnWidths((current) => ({ ...current, [resizing.column]: width }));
    };
    const stop = () => setResizing(null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [resizing]);

  const orderedColumns = columnOrder.length ? columnOrder : keys;
  const visibleColumnNames = orderedColumns.filter((column) => !hiddenColumns.includes(column));
  const visiblePinnedColumns = visibleColumnNames.filter((column) => pinnedColumns.includes(column));
  const computedNames = useMemo(() => new Set(computedFields.map((field) => field.name)), [computedFields]);
  const loadingSet = useMemo(() => new Set(profileLoadingColumns), [profileLoadingColumns]);
  const activeFilterSet = useMemo(() => new Set(activeFilterKeys), [activeFilterKeys]);
  const selectedFeatureSet = useMemo(() => new Set(selectedFeatureIds), [selectedFeatureIds]);
  const featureIdForRow = (row: RowData) => String(
    row._alur_feature_id
    ?? (featureIdColumn ? row[featureIdColumn] : undefined)
    ?? row.__alur_mvt_id
    ?? '',
  );
  const widthForColumn = useCallback((column: string) => columnWidths[column] || 158, [columnWidths]);
  const pinnedOffset = useCallback((column: string) => {
    if (!pinnedColumns.includes(column)) return undefined;
    const preceding = visiblePinnedColumns.slice(0, visiblePinnedColumns.indexOf(column));
    return (onToggleSelection ? 40 : 0) + preceding.reduce((sum, item) => sum + widthForColumn(item), 0);
  }, [onToggleSelection, pinnedColumns, visiblePinnedColumns, widthForColumn]);

  useEffect(() => setLastSelectedIndex(null), [pageIndex, signature]);

  const moveColumn = useCallback((column: string, direction: -1 | 1) => {
    setColumnOrder((current) => {
      const next = [...(current.length ? current : keys)];
      const from = next.indexOf(column);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= next.length) return current;
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, [keys]);

  const hideColumn = useCallback((column: string) => {
    setHiddenColumns((current) => current.includes(column) ? current : [...current, column]);
  }, []);

  const togglePinnedColumn = useCallback((column: string) => {
    setPinnedColumns((current) => current.includes(column)
      ? current.filter((item) => item !== column)
      : [...current, column]);
  }, []);

  useEffect(() => {
    if (!showHistograms) return;
    visibleColumnNames.slice(0, 10).forEach((column) => {
      if (!columnProfiles[column] && !loadingSet.has(column)) onProfileColumn(column);
    });
  }, [columnProfiles, loadingSet, onProfileColumn, showHistograms, visibleColumnNames.join('\u001f')]);

  const columns = useMemo(() => visibleColumnNames.map((key) => columnHelper.accessor(key, {
    id: key,
    header: () => {
      const profile = columnProfiles[key];
      const loading = loadingSet.has(key);
      const canFilter = Boolean(onApplyProfileFilter);
      const datasetField = datasetMetadata?.fields.find((field) => field.name === key);
      return (
        <div className="group/column relative space-y-1.5" style={{ width: widthForColumn(key) }}>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onSortChange(key)}
              className="pressable flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-left text-[11px] font-bold text-slate-700 hover:border-slate-300"
              title={`Sort by ${key}`}
            >
              <span className="min-w-0 flex-1 truncate">{key}</span>
              {computedNames.has(key) && <span className="rounded bg-violet-50 px-1 text-[8px] font-bold text-violet-600">FX</span>}
              {sortBy === key && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
            </button>
            <button type="button" onClick={() => togglePinnedColumn(key)} aria-label={`${pinnedColumns.includes(key) ? 'Unpin' : 'Pin'} ${key}`} title={`${pinnedColumns.includes(key) ? 'Unpin' : 'Pin'} ${key}`} className="pressable h-7 w-0 overflow-hidden rounded-md border-0 bg-white p-0 text-slate-400 opacity-0 transition-colors hover:text-slate-700 focus-visible:w-7 focus-visible:border focus-visible:border-slate-200 focus-visible:opacity-100 group-hover/column:w-7 group-hover/column:border group-hover/column:border-slate-200 group-hover/column:p-1.5 group-hover/column:opacity-100">
              {pinnedColumns.includes(key) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => hideColumn(key)} aria-label={`Hide ${key}`} title={`Hide ${key}`} className="pressable h-7 w-0 overflow-hidden rounded-md border-0 bg-white p-0 text-slate-400 opacity-0 transition-colors hover:text-slate-700 focus-visible:w-7 focus-visible:border focus-visible:border-slate-200 focus-visible:opacity-100 group-hover/column:w-7 group-hover/column:border group-hover/column:border-slate-200 group-hover/column:p-1.5 group-hover/column:opacity-100">
              <EyeOff className="h-3.5 w-3.5" />
            </button>
            {datasetField && onAddFilter && (
              <FieldQuickExploreMenu
                field={datasetField}
                onChart={onQuickChart ? () => onQuickChart(key) : undefined}
                onFilter={setNewFilter}
                onProfile={() => onProfileColumn(key)}
                onStyle={onQuickStyle ? () => onQuickStyle(key) : undefined}
                onPinMetric={datasetField.semanticType === 'numeric' && onPinMetric ? () => onPinMetric(key) : undefined}
              />
            )}
          </div>
          {showHistograms && (
            <div className="relative">
              <button type="button" onClick={() => moveColumn(key, -1)} disabled={orderedColumns.indexOf(key) === 0} aria-label={`Move ${key} left`} title="Move column left" className="pressable absolute -left-2.5 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1 text-slate-500 opacity-0 shadow-sm transition-opacity hover:bg-slate-100 disabled:hidden group-hover/column:opacity-100 focus-visible:opacity-100">
                <ArrowLeft className="h-3 w-3" />
              </button>
              {loading ? (
                <div className="flex h-[72px] items-center justify-center rounded-md border border-slate-200 bg-white">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                </div>
              ) : profile ? (
                <MiniHistogram profile={profile} activeFilterKeys={activeFilterSet} canFilter={canFilter} onSelect={(bin) => onApplyProfileFilter?.(profile, bin)} />
              ) : (
                <button type="button" onClick={() => onProfileColumn(key)} className="pressable flex h-[72px] w-full items-center justify-center rounded-md border border-dashed border-slate-200 bg-white text-[10px] font-semibold text-slate-400 hover:border-slate-300 hover:text-slate-600">Load histogram</button>
              )}
              <button type="button" onClick={() => moveColumn(key, 1)} disabled={orderedColumns.indexOf(key) === orderedColumns.length - 1} aria-label={`Move ${key} right`} title="Move column right" className="pressable absolute -right-2.5 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1 text-slate-500 opacity-0 shadow-sm transition-opacity hover:bg-slate-100 disabled:hidden group-hover/column:opacity-100 focus-visible:opacity-100">
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}
          <button
            type="button"
            aria-label={`Resize ${key}`}
            title="Drag to resize column"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setResizing({ column: key, startX: event.clientX, startWidth: widthForColumn(key) });
            }}
            className="pressable absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize opacity-0 hover:bg-slate-300/60 group-hover/column:opacity-100"
          />
        </div>
      );
    },
    cell: (info) => {
      const value = info.getValue();
      const formatted = formatCellValue(value);
      return formatted === null
        ? <span className="italic text-slate-300">null</span>
        : <span title={formatted}>{formatted}</span>;
    },
  })), [activeFilterSet, columnProfiles, computedNames, datasetMetadata, hideColumn, loadingSet, moveColumn, onAddFilter, onApplyProfileFilter, onPinMetric, onProfileColumn, onQuickChart, onQuickStyle, onSortChange, orderedColumns, pinnedColumns, showHistograms, sortBy, sortDirection, togglePinnedColumn, visibleColumnNames, widthForColumn]);

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const rowCount = totalRows ?? data.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const selectableIds = data.map(featureIdForRow).filter(Boolean);
  const allPageSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedFeatureSet.has(id));
  const selectedOnPage = selectableIds.filter((id) => selectedFeatureSet.has(id)).length;
  const currentLayout: TableLayout = {
    columnOrder: orderedColumns,
    hiddenColumns,
    pinnedColumns,
    columnWidths,
    showHistograms,
  };

  const selectRow = (index: number, featureId: string, extendRange: boolean) => {
    if (!featureId || !onToggleSelection) return;
    if (extendRange && lastSelectedIndex !== null && onSetSelection) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = data.slice(start, end + 1).map(featureIdForRow).filter(Boolean);
      onSetSelection([...new Set([...selectedFeatureIds, ...range])]);
    } else {
      onToggleSelection(featureId);
    }
    setLastSelectedIndex(index);
  };

  if (isLoading && !data.length) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white/80">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" /> Loading data
        </div>
      </div>
    );
  }

  if (!data.length) {
    return <div className="flex h-full items-center justify-center bg-slate-50 text-xs italic text-slate-400">No attribute data available for the selected node or layer.</div>;
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b bg-slate-50 px-2.5 py-1.5">
        <label className="relative min-w-[180px] max-w-md flex-1">
          <span className="sr-only">Search table</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => { onSearchChange(event.target.value); onPageChange(0); }}
            placeholder="Search every field…"
            className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-7 text-xs outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          />
          {search && <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search" className="pressable absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>}
        </label>

        <button type="button" aria-pressed={showHistograms} onClick={() => setShowHistograms((current) => !current)} className={cn('pressable inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-bold', showHistograms ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600')}>
          <BarChart3 className="h-3.5 w-3.5" /> Histograms
        </button>

        <div className="relative">
          <button type="button" aria-expanded={showFieldMenu} onClick={() => setShowFieldMenu((current) => !current)} className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100">
            <Columns3 className="h-3.5 w-3.5" /> Fields <span className="font-normal text-slate-400">{visibleColumnNames.length}/{keys.length}</span>
          </button>
          {showFieldMenu && (
            <div className="absolute right-0 top-9 z-40 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Visible fields</span>
                <button type="button" onClick={() => { setColumnOrder(keys); setHiddenColumns([]); setPinnedColumns([]); setColumnWidths({}); }} className="pressable inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800"><RotateCcw className="h-3 w-3" /> Reset</button>
              </div>
              <div className="max-h-72 overflow-auto p-1.5">
                {orderedColumns.map((column) => {
                  const hidden = hiddenColumns.includes(column);
                  return (
                    <div key={column} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-50">
                      <button type="button" aria-label={`${hidden ? 'Show' : 'Hide'} ${column}`} onClick={() => setHiddenColumns((current) => hidden ? current.filter((item) => item !== column) : [...current, column])} className="pressable rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <span className={cn('min-w-0 flex-1 truncate text-xs', hidden ? 'text-slate-400' : 'font-semibold text-slate-700')} title={column}>{column}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {onSetSelection && (
          <div className="relative">
            <button type="button" aria-expanded={showSelectionMenu} onClick={() => setShowSelectionMenu((current) => !current)} className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100">
              <ListChecks className="h-3.5 w-3.5" /> Select
            </button>
            {showSelectionMenu && (
              <div className="absolute right-0 top-9 z-40 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
                <button type="button" onClick={() => onSetSelection([...new Set([...selectedFeatureIds, ...selectableIds])])} className="pressable flex w-full items-center rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50">Select visible page</button>
                <button type="button" onClick={onSelectAllFiltered} disabled={isSelectionActionLoading} className="pressable flex w-full items-center rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Select all filtered rows</button>
                <button type="button" onClick={onInvertSelection} disabled={isSelectionActionLoading} className="pressable flex w-full items-center rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Invert filtered selection</button>
                <button type="button" onClick={onClearSelection} disabled={!selectedFeatureIds.length} className="pressable flex w-full items-center rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Clear selection</button>
                <div className="my-1 border-t border-slate-100" />
                <button type="button" onClick={onCreateSelectionLayer} disabled={!selectedFeatureIds.length} className="pressable flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Layers className="h-3.5 w-3.5" /> Selection as layer</button>
                <button type="button" onClick={onCreateSelectionFilterNode} disabled={!selectedFeatureIds.length} className="pressable flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><GitBranch className="h-3.5 w-3.5" /> Selection as filter node</button>
              </div>
            )}
          </div>
        )}

        {onSaveView && (
          <div className="relative">
            <button type="button" aria-expanded={showViewsMenu} onClick={() => setShowViewsMenu((current) => !current)} className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100">
              <Bookmark className="h-3.5 w-3.5" /> Views {savedViews.length > 0 && <span className="text-slate-400">{savedViews.length}</span>}
            </button>
            {showViewsMenu && (
              <div className="absolute right-0 top-9 z-40 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                <div className="flex gap-1.5 border-b border-slate-100 p-2">
                  <input value={viewName} onChange={(event) => setViewName(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && viewName.trim()) { onSaveView(viewName.trim(), currentLayout); setViewName(''); }
                  }} placeholder="Name this view…" aria-label="Table view name" className="h-7 min-w-0 flex-1 rounded border border-slate-200 px-2 text-xs outline-none focus:border-slate-400" />
                  <button type="button" disabled={!viewName.trim()} onClick={() => { onSaveView(viewName.trim(), currentLayout); setViewName(''); }} className="pressable inline-flex h-7 items-center gap-1 rounded bg-slate-900 px-2 text-[10px] font-bold text-white disabled:opacity-40"><Save className="h-3 w-3" /> Save</button>
                </div>
                <div className="max-h-64 overflow-auto p-1.5">
                  {!savedViews.length && <div className="px-2 py-4 text-center text-xs italic text-slate-400">No saved views</div>}
                  {savedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-1 rounded hover:bg-slate-50">
                      <button type="button" onClick={() => onApplyView?.(view.id)} className="pressable min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs font-semibold text-slate-700" title={view.name}>{view.name}</button>
                      <button type="button" onClick={() => onDeleteView?.(view.id)} aria-label={`Delete view ${view.name}`} className="pressable rounded p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedFeatureIds.length > 0 && (
          <div className="flex h-8 items-center overflow-hidden rounded-md border border-orange-200 bg-orange-50 text-[11px] font-bold text-orange-700">
            <span className="px-2.5">{selectedFeatureIds.length.toLocaleString()} selected</span>
            {onZoomSelection && (
              <button type="button" onClick={onZoomSelection} disabled={isZoomingSelection} className="pressable flex h-full items-center gap-1 border-l border-orange-200 px-2 hover:bg-orange-100 disabled:opacity-50" title="Zoom map to selected rows">
                <LocateFixed className="h-3.5 w-3.5" /> Zoom
              </button>
            )}
            <button type="button" onClick={onClearSelection} className="pressable flex h-full items-center border-l border-orange-200 px-2 hover:bg-orange-100" aria-label="Clear selection" title="Clear map and table selection"><X className="h-3 w-3" /></button>
          </div>
        )}
      </div>

      <FilterChips filters={filters} onRemove={(index) => onRemoveFilter?.(index)} onUpdate={onUpdateFilter} onClear={() => onClearFilters?.()} />
      {newFilter && onAddFilter && (
        <FilterEditorDialog
          title={`Filter ${newFilter.field}`}
          filter={newFilter}
          onApply={(filter) => { onAddFilter(filter); setNewFilter(null); }}
          onCancel={() => setNewFilter(null)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[11px]">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {onToggleSelection && (
                  <th className="sticky left-0 z-30 w-10 min-w-10 border-b border-r border-slate-200 bg-slate-50 p-2 align-top">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allPageSelected}
                      ref={(element) => { if (element) element.indeterminate = selectedOnPage > 0 && !allPageSelected; }}
                      onChange={() => {
                        const next = allPageSelected
                          ? selectedFeatureIds.filter((id) => !selectableIds.includes(id))
                          : [...new Set([...selectedFeatureIds, ...selectableIds])];
                        if (onSetSelection) onSetSelection(next);
                        else selectableIds.forEach((id) => {
                          if (allPageSelected ? selectedFeatureSet.has(id) : !selectedFeatureSet.has(id)) onToggleSelection(id);
                        });
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-orange-500"
                    />
                  </th>
                )}
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn('relative border-b border-r border-slate-200 bg-slate-50 p-1.5 text-left align-top font-normal', pinnedColumns.includes(header.column.id) && 'sticky z-30 shadow-[2px_0_4px_-3px_rgba(15,23,42,0.5)]')}
                    style={{
                      width: widthForColumn(header.column.id),
                      minWidth: widthForColumn(header.column.id),
                      maxWidth: widthForColumn(header.column.id),
                      left: pinnedOffset(header.column.id),
                    }}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, rowIndex) => {
              const featureId = featureIdForRow(row.original);
              const selected = Boolean(featureId) && selectedFeatureSet.has(featureId);
              return (
                <tr
                  key={row.id}
                  tabIndex={featureId ? 0 : undefined}
                  aria-selected={selected}
                  onClick={(event) => selectRow(rowIndex, featureId, event.shiftKey)}
                  onKeyDown={(event) => {
                    if ((event.key === ' ' || event.key === 'Enter') && featureId) {
                      event.preventDefault();
                      selectRow(rowIndex, featureId, event.shiftKey);
                    }
                  }}
                  onMouseEnter={() => { if (featureId) onHoverFeature?.(featureId); }}
                  onMouseLeave={() => { if (featureId) onHoverFeature?.(null); }}
                  className={cn(
                    'group outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400',
                    featureId && 'cursor-pointer',
                    hoveredFeatureId === featureId && !selected && 'bg-sky-50',
                    selected ? 'bg-orange-50' : hoveredFeatureId === featureId ? 'bg-sky-50' : 'odd:bg-white even:bg-slate-50/40 hover:bg-slate-50',
                  )}
                >
                  {onToggleSelection && (
                    <td className={cn('sticky left-0 z-10 w-10 min-w-10 border-b border-r border-slate-100 p-2 text-center', selected ? 'bg-orange-50' : 'bg-white group-even:bg-slate-50')}>
                      {featureId && <input type="checkbox" aria-label={`Select row ${featureId}`} checked={selected} onClick={(event) => { event.stopPropagation(); selectRow(rowIndex, featureId, event.shiftKey); }} onChange={() => {}} className="h-3.5 w-3.5 rounded border-slate-300 accent-orange-500" />}
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'h-7 truncate border-b border-r border-slate-100 px-2 text-slate-700',
                        pinnedColumns.includes(cell.column.id) && 'sticky z-10 shadow-[2px_0_4px_-3px_rgba(15,23,42,0.35)]',
                        pinnedColumns.includes(cell.column.id) && (selected ? 'bg-orange-50' : hoveredFeatureId === featureId ? 'bg-sky-50' : 'bg-white group-even:bg-slate-50'),
                      )}
                      style={{
                        width: widthForColumn(cell.column.id),
                        minWidth: widthForColumn(cell.column.id),
                        maxWidth: widthForColumn(cell.column.id),
                        left: pinnedOffset(cell.column.id),
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-t bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <div className="flex items-center gap-3">
          <strong className="text-slate-700">{rowCount.toLocaleString()} rows</strong>
          <span>{visibleColumnNames.length} of {keys.length} fields</span>
          {selectedOnPage > 0 && <span className="font-semibold text-orange-700">{selectedOnPage} selected on page</span>}
          {onToggleSelection && <span className="hidden text-slate-400 sm:inline">Click to toggle · Shift-click for a range</span>}
          {isLoading && <span className="inline-flex items-center gap-1"><span className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-slate-700" /> Updating</span>}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 font-semibold">
            Rows
            <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] outline-none">
              {[25, 50, 100, 250].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span>Page {pageIndex + 1} of {pageCount}</span>
          <button type="button" onClick={() => onPageChange(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0} className="pressable rounded border border-slate-200 bg-white px-2 py-1 font-bold disabled:opacity-30">Prev</button>
          <button type="button" onClick={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))} disabled={pageIndex >= pageCount - 1} className="pressable rounded border border-slate-200 bg-white px-2 py-1 font-bold disabled:opacity-30">Next</button>
        </div>
      </footer>
    </div>
  );
};
