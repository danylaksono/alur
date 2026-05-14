import type { LegendSpec } from '../../types/visualisation';
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
};

export const LegendControl = ({
  legends,
}: {
  legends: Array<{ layerId: string; layerName: string; legend: LegendSpec }>;
}) => {
  if (!legends.length) return null;

  return (
    <aside className="pointer-events-auto absolute bottom-4 left-4 z-10 max-h-[45%] w-64 overflow-y-auto rounded-md border border-slate-200 bg-white/95 p-3 text-[10px] shadow-lg backdrop-blur">
      <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">Legend</div>
      <div className="space-y-3">
        {legends.slice(0, 4).map(({ layerId, layerName, legend }) => (
          <div key={layerId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate font-bold text-slate-700" title={layerName}>
                {layerName}
              </div>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">
                {legendKindLabel[legend.kind]}
              </span>
            </div>
            <div className="space-y-1">
              {legend.items.slice(0, MAX_ITEMS).map((item) => (
                <div key={`${item.label}-${item.color}`} className="flex min-w-0 items-center gap-2">
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
                </div>
              ))}
              {legend.items.length > MAX_ITEMS && (
                <div className="text-[9px] font-semibold text-slate-400">
                  + {(legend.items.length - MAX_ITEMS).toLocaleString()} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};

