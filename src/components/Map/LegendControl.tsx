import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { LegendSpec } from '../../types/visualisation';
import { useStore } from '../../store/useStore';
import { buildLegendItemFilter, toggleFilterIn, visualFilterKey } from '../../utils/legendFilter';
import { cn } from '../../utils/cn';

const MAX_ITEMS = 6;

const legendKindLabel: Record<LegendSpec['kind'], string> = {
  simple: 'Simple', choropleth: 'Classes', categorical: 'Categories', graduated_symbol: 'Symbols', heatmap: 'Heatmap', label: 'Labels', dot_density: 'Dots', extrusion: '3D', graduated_line: 'Width', hexbin: 'Hexbin', bivariate: 'Bivariate', glyph_grid: 'Glyphs', h3grid: 'H3 grid',
};

export const LegendControl = ({ legends }: { legends: Array<{ layerId: string; layerName: string; legend: LegendSpec }> }) => {
  const visualAnalytics = useStore((state) => state.visualAnalytics);
  const setLayerFilters = useStore((state) => state.setLayerFilters);
  const clearLayerFilters = useStore((state) => state.clearLayerFilters);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const hasSelection = Object.values(visualAnalytics.datasets).some((dataset) => dataset.selectedFeatureIds.length > 0);
  if (!legends.length) return null;

  return (
    <aside className={cn('pointer-events-auto absolute bottom-3 left-3 z-10 max-h-[52%] overflow-y-auto rounded-lg border border-slate-200 bg-white/95 text-[11px] shadow-lg backdrop-blur', hasSelection && 'max-xl:hidden', panelCollapsed ? 'w-auto p-1.5' : 'w-72 p-3')} aria-label="Map legends">
      <button type="button" onClick={() => setPanelCollapsed(!panelCollapsed)} className={cn('flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500', !panelCollapsed && 'mb-2')} aria-expanded={!panelCollapsed}>{panelCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Legend{panelCollapsed && <span className="rounded-full bg-slate-100 px-1.5">{legends.length}</span>}</button>
      {!panelCollapsed && <div className="space-y-2">
        {legends.slice(0, 6).map(({ layerId, layerName, legend }) => {
          const filters = visualAnalytics.datasets[layerId]?.filters || [];
          const activeKeys = new Set(filters.map(visualFilterKey));
          const isFilterable = legend.kind === 'choropleth' || legend.kind === 'categorical' || legend.kind === 'extrusion';
          const isBivariate = legend.kind === 'bivariate';
          const isCollapsed = Boolean(collapsed[layerId]);
          const query = searches[layerId] || '';
          const matches = legend.items.filter((item) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          const visibleItems = query || expandedItems[layerId] ? matches : matches.slice(0, MAX_ITEMS);
          const gridItems = isBivariate ? legend.items.filter((item) => item.row !== undefined && item.column !== undefined) : [];
          const method = legend.classification?.method.replaceAll('_', ' ');

          return (
            <section key={layerId} className="rounded-md border border-slate-100 bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setCollapsed((value) => ({ ...value, [layerId]: !isCollapsed }))} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                  {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}<span className="truncate" title={layerName}>{layerName}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {isFilterable && filters.length > 0 && <button type="button" onClick={() => clearLayerFilters(layerId)} className="rounded px-1 py-0.5 text-[9px] font-semibold text-orange-600 hover:bg-orange-50">clear</button>}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">{legendKindLabel[legend.kind]}</span>
                </div>
              </div>
              {!isCollapsed && (
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2 text-[9px] text-slate-400"><span className="truncate" title={legend.title}>{legend.title}</span>{method && <span className="shrink-0 capitalize">{method}</span>}</div>
                  {legend.palette?.warnings.map((warning) => <div key={warning} className="flex gap-1 rounded bg-amber-50 px-1.5 py-1 text-[9px] leading-tight text-amber-800"><AlertTriangle className="h-3 w-3 shrink-0" />{warning}</div>)}
                  {legend.items.length > MAX_ITEMS && !isBivariate && (
                    <label className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2 focus-within:border-sky-400"><Search className="h-3 w-3 text-slate-400" /><span className="sr-only">Search {legend.title}</span><input value={query} onChange={(event) => setSearches((value) => ({ ...value, [layerId]: event.target.value }))} placeholder="Search legend" className="min-w-0 flex-1 text-[10px] outline-none" /></label>
                  )}
                  {isBivariate ? (
                    <div className="flex items-end gap-2 px-1 py-0.5"><div className="grid w-fit grid-cols-3 gap-px">{[2, 1, 0].flatMap((row) => [0, 1, 2].map((column) => { const item = gridItems.find((entry) => entry.row === row && entry.column === column); return <span key={`${row}-${column}`} className="h-4 w-4 border border-white/50" style={{ backgroundColor: item?.color || '#e2e8f0' }} title={item?.label} />; }))}</div><div className="text-[9px] leading-tight text-slate-400">low → high<br />per axis</div></div>
                  ) : (
                    <div className="space-y-0.5">
                      {visibleItems.map((item, index) => {
                        const itemFilter = buildLegendItemFilter(legend, item);
                        const isActive = activeKeys.has(visualFilterKey(itemFilter));
                        const row = <><span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-slate-300 text-[7px] font-bold text-slate-700" style={{ backgroundColor: item.color }} aria-hidden="true">{legend.kind === 'categorical' && item.label !== 'No data' ? index + 1 : ''}</span><span className="min-w-0 flex-1 truncate text-slate-600" title={`${legend.title}: ${item.label}`}>{item.label}</span>{item.count !== undefined && <span className="shrink-0 text-right tabular-nums text-slate-400">{item.count.toLocaleString()}{item.percentage !== undefined ? ` · ${(item.percentage * 100).toFixed(1)}%` : ''}</span>}</>;
                        return isFilterable ? <button type="button" key={`${item.label}-${item.color}`} onClick={() => setLayerFilters(layerId, toggleFilterIn(filters, itemFilter))} title={`Filter ${legend.title}: ${item.label}`} className={cn('flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400', isActive ? 'bg-orange-50 ring-1 ring-orange-200' : 'hover:bg-slate-100')}>{row}</button> : <div key={`${item.label}-${item.color}`} className="flex min-w-0 items-center gap-2 px-1 py-1">{row}</div>;
                      })}
                      {!visibleItems.length && <div className="py-2 text-center text-[10px] text-slate-400">No matching legend items.</div>}
                      {!query && legend.items.length > MAX_ITEMS && <button type="button" onClick={() => setExpandedItems((value) => ({ ...value, [layerId]: !value[layerId] }))} className="rounded px-1 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-50">{expandedItems[layerId] ? 'Show less' : `Show ${legend.items.length - MAX_ITEMS} more`}</button>}
                    </div>
                  )}
                  {legend.classification?.breaks?.length ? <div className="truncate text-[9px] text-slate-400" title={legend.classification.breaks.join(', ')}>Breaks: {legend.classification.breaks.map((value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })).join(' · ')}</div> : null}
                </div>
              )}
            </section>
          );
        })}
      </div>}
    </aside>
  );
};
