import type { LegendSpec } from '../../types/visualisation';
import { useStore } from '../../store/useStore';
import { buildLegendItemFilter, toggleFilterIn, visualFilterKey } from '../../utils/legendFilter';
import { cn } from '../../utils/cn';

const MAX_ITEMS = 6;

const legendKindLabel: Record<LegendSpec['kind'], string> = {
  simple: 'Simple',
  choropleth: 'Classes',
  categorical: 'Categories',
  graduated_symbol: 'Symbols',
  heatmap: 'Heatmap',
  label: 'Labels',
  dot_density: 'Dots',
  extrusion: '3D',
  graduated_line: 'Width',
  hexbin: 'Hexbin',
  bivariate: 'Bivariate',
};

export const LegendControl = ({
  legends,
}: {
  legends: Array<{ layerId: string; layerName: string; legend: LegendSpec }>;
}) => {
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const setLayerFilters = useStore((s) => s.setLayerFilters);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);

  if (!legends.length) return null;

  return (
    <aside className="pointer-events-auto absolute bottom-4 left-4 z-10 max-h-[45%] w-64 overflow-y-auto rounded-md border border-slate-200 bg-white/95 p-3 text-[11px] shadow-lg backdrop-blur">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Legend</div>
      <div className="space-y-3">
        {legends.slice(0, 4).map(({ layerId, layerName, legend }) => {
          const filters = visualAnalytics.layers[layerId]?.filters || [];
          const activeKeys = new Set(filters.map(visualFilterKey));
          const isFilterable = legend.kind === 'choropleth' || legend.kind === 'categorical' || legend.kind === 'extrusion';
          const isBivariate = legend.kind === 'bivariate';
          const gridItems = isBivariate ? legend.items.filter((item) => item.row !== undefined && item.column !== undefined) : [];

          return (
            <div key={layerId} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate font-semibold text-slate-700" title={layerName}>
                  {layerName}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isFilterable && filters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => clearLayerFilters(layerId)}
                      className="rounded px-1 py-0.5 text-[10px] font-semibold text-orange-600 hover:bg-orange-50"
                      title="Clear filters"
                    >
                      clear
                    </button>
                  )}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {legendKindLabel[legend.kind]}
                  </span>
                </div>
              </div>
              {isBivariate ? (
                <div className="flex items-end gap-2 px-1 py-0.5">
                  <div>
                    {/* Rows top→bottom = high→low Y; columns left→right = low→high X. */}
                    <div className="grid w-fit grid-cols-3 gap-px">
                      {[2, 1, 0].flatMap((gridRow) =>
                        [0, 1, 2].map((gridColumn) => {
                          const item = gridItems.find((entry) => entry.row === gridRow && entry.column === gridColumn);
                          return (
                            <span
                              key={`${gridRow}-${gridColumn}`}
                              className="h-4 w-4"
                              style={{ backgroundColor: item?.color || '#e2e8f0' }}
                              title={item?.label}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 text-[10px] leading-tight text-slate-500">
                    <div className="truncate" title={legend.title}>{legend.title}</div>
                    <div className="mt-0.5 text-slate-400">low → high per axis</div>
                  </div>
                </div>
              ) : (
              <div className="space-y-0.5">
                {legend.items.slice(0, MAX_ITEMS).map((item) => {
                  const itemFilter = buildLegendItemFilter(legend, item);
                  const isActive = activeKeys.has(visualFilterKey(itemFilter));
                  const row = (
                    <>
                      <span
                        className={cn(
                          'shrink-0 border border-slate-200',
                          legend.kind === 'graduated_symbol' ? 'h-3 w-3 rounded-full' : 'h-3 w-3 rounded-sm',
                        )}
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-600" title={`${legend.title}: ${item.label}`}>
                        {item.label}
                      </span>
                    </>
                  );

                  if (!isFilterable) {
                    return (
                      <div key={`${item.label}-${item.color}`} className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                        {row}
                      </div>
                    );
                  }

                  return (
                    <button
                      type="button"
                      key={`${item.label}-${item.color}`}
                      onClick={() => setLayerFilters(layerId, toggleFilterIn(filters, itemFilter))}
                      title={`Filter ${legend.title}: ${item.label}`}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors',
                        isActive ? 'bg-orange-50 ring-1 ring-orange-200' : 'hover:bg-slate-100'
                      )}
                    >
                      {row}
                    </button>
                  );
                })}
                {legend.items.length > MAX_ITEMS && (
                  <div className="text-[10px] font-semibold text-slate-400">
                    + {(legend.items.length - MAX_ITEMS).toLocaleString()} more
                  </div>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
