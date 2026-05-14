import { Download, Eye, EyeOff, Focus, Trash2, Layers, Route } from 'lucide-react';
import { useStore, type MapLayer } from '../store/useStore';
import { cn } from '../utils/cn';
import { BASEMAPS } from '../utils/basemaps';
import { downloadMapStyleExport } from '../utils/mapStyleExport';

const KIND_LABEL: Record<NonNullable<MapLayer['sourceKind']>, string> = {
  input: 'Input',
  workflow: 'Workflow',
  step: 'Step',
  output: 'Output',
  manual: 'SQL',
  llm: 'Copilot',
  h3: 'H3',
};

const fallbackColor = (index: number) => {
  const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
  return colors[index % colors.length];
};

export const LayerManager = () => {
  const mapLayers = useStore((s) => s.mapLayers);
  const selectedBasemapId = useStore((s) => s.selectedBasemapId);
  const nodes = useStore((s) => s.nodes);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const selectLayer = useStore((s) => s.selectLayer);
  const focusLayer = useStore((s) => s.focusLayer);
  const toggleMapLayerVisibility = useStore((s) => s.toggleMapLayerVisibility);
  const updateMapLayer = useStore((s) => s.updateMapLayer);
  const removeMapLayer = useStore((s) => s.removeMapLayer);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);
  const setSelectedBasemapId = useStore((s) => s.setSelectedBasemapId);
  const styledLayerCount = mapLayers.filter((layer) => layer.visualisation || layer.legend || layer.color).length;

  const sourceName = (layer: MapLayer) => {
    if (!layer.sourceNodeId) return KIND_LABEL[layer.sourceKind || 'manual'] || 'Layer';
    return nodes.find((node) => node.id === layer.sourceNodeId)?.data.label || layer.sourceNodeId;
  };

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <div className="border-b bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Layers className="h-3.5 w-3.5" />
            Map Layers
          </h3>
          <span className="rounded-md bg-white px-2 py-1 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">
            {mapLayers.length}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span>Basemap</span>
            <select
              value={selectedBasemapId}
              onChange={(event) => setSelectedBasemapId(event.target.value as typeof selectedBasemapId)}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              title={BASEMAPS.find((basemap) => basemap.id === selectedBasemapId)?.description}
            >
              {BASEMAPS.map((basemap) => (
                <option key={basemap.id} value={basemap.id}>
                  {basemap.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => downloadMapStyleExport(mapLayers)}
              disabled={styledLayerCount === 0}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export map style JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {mapLayers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            Add an input node or run a workflow to create map layers.
          </div>
        ) : (
          <div className="space-y-2">
            {mapLayers.map((layer, index) => {
              const isSelected = selectedLayerId === layer.id;
              const color = layer.color || fallbackColor(index);
              const isNodeSelected = layer.sourceNodeId && layer.sourceNodeId === selectedNodeId;
              const selectedFeatureCount = visualAnalytics.layers[layer.id]?.selectedFeatureIds.length || 0;
              const filterCount = visualAnalytics.layers[layer.id]?.filters.length || 0;

              return (
                <div
                  key={layer.id}
                  className={cn(
                    'rounded-lg border bg-white p-3 text-[11px] transition-colors',
                    isSelected ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300',
                    !layer.visible && 'opacity-60'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectLayer(isSelected ? null : layer.id)}
                    className="flex w-full items-start gap-2 text-left"
                    title="Select layer"
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-slate-800">{layer.name}</span>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-[9px] uppercase tracking-widest text-slate-400">
                        <Route className="h-2.5 w-2.5" />
                        {KIND_LABEL[layer.sourceKind || 'workflow']} · {sourceName(layer)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                      {layer.visualisation?.kind || layer.featureCount.toLocaleString()}
                    </span>
                  </button>

                  {layer.legend && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {layer.legend.items.slice(0, 6).map((item) => (
                        <span
                          key={`${item.label}-${item.color}`}
                          className="h-3 w-3 rounded-sm border border-slate-200"
                          style={{ backgroundColor: item.color }}
                          title={`${layer.legend?.title}: ${item.label}`}
                        />
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleMapLayerVisibility(layer.id)}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => focusLayer(layer.id)}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                      title="Zoom to layer"
                    >
                      <Focus className="h-3.5 w-3.5" />
                    </button>
                    <label className="flex min-w-0 flex-1 items-center gap-2 pl-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Opacity
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={layer.opacity}
                        onChange={(event) => updateMapLayer(layer.id, { opacity: Number(event.target.value) })}
                        className="min-w-0 flex-1 accent-slate-900"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeMapLayer(layer.id)}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50"
                      title="Remove layer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {isNodeSelected && (
                    <div className="mt-2 rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      Linked node selected
                    </div>
                  )}

                  {selectedFeatureCount > 0 && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-orange-50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-orange-700">
                      <span>{selectedFeatureCount.toLocaleString()} features selected</span>
                      <button
                        type="button"
                        onClick={() => clearFeatureSelection(layer.id)}
                        className="rounded border border-orange-200 bg-white px-1.5 py-0.5 text-[8px] hover:bg-orange-100"
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  {filterCount > 0 && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-sky-50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-sky-700">
                      <span>{filterCount.toLocaleString()} visual filters</span>
                      <button
                        type="button"
                        onClick={() => clearLayerFilters(layer.id)}
                        className="rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[8px] hover:bg-sky-100"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
