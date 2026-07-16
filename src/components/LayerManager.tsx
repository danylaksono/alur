import { useState } from 'react';
import { Download, Eye, EyeOff, Focus, GripVertical, Palette, Trash2, Layers } from 'lucide-react';
import { useStore, type MapLayer } from '../store/useStore';
import { cn } from '../utils/cn';
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

export const LayerManager = ({ onEditStyle }: { onEditStyle?: (layerId: string) => void }) => {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const mapLayers = useStore((s) => s.mapLayers);
  const nodes = useStore((s) => s.nodes);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const selectLayer = useStore((s) => s.selectLayer);
  const focusLayer = useStore((s) => s.focusLayer);
  const toggleMapLayerVisibility = useStore((s) => s.toggleMapLayerVisibility);
  const updateMapLayer = useStore((s) => s.updateMapLayer);
  const reorderMapLayer = useStore((s) => s.reorderMapLayer);
  const removeMapLayer = useStore((s) => s.removeMapLayer);
  const clearFeatureSelection = useStore((s) => s.clearFeatureSelection);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);
  const styledLayerCount = mapLayers.filter((layer) => layer.visualisation || layer.legend || layer.color).length;

  const sourceName = (layer: MapLayer) => {
    if (!layer.sourceNodeId) return KIND_LABEL[layer.sourceKind || 'manual'] || 'Layer';
    return nodes.find((node) => node.id === layer.sourceNodeId)?.data.label || layer.sourceNodeId;
  };

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <div className="border-b bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Layers className="h-3.5 w-3.5" />
            Map Layers
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => downloadMapStyleExport(mapLayers)}
              disabled={styledLayerCount === 0}
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export map style JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <span className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
              {mapLayers.length}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mapLayers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            Add an input node or run a workflow to create map layers.
          </div>
        ) : (
          <div className="space-y-2">
            {[...mapLayers].reverse().map((layer) => {
              const index = mapLayers.findIndex((item) => item.id === layer.id);
              const isSelected = selectedLayerId === layer.id;
              const color = layer.color || fallbackColor(index);
              const selectedFeatureCount = visualAnalytics.layers[layer.id]?.selectedFeatureIds.length || 0;
              const filterCount = visualAnalytics.layers[layer.id]?.filters.length || 0;
              const isDragTarget = draggedLayerId && draggedLayerId !== layer.id;

              return (
                <div
                  key={layer.id}
                  onDragOver={(event) => {
                    if (!draggedLayerId || draggedLayerId === layer.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceLayerId = draggedLayerId || event.dataTransfer.getData('text/plain');
                    if (!sourceLayerId || sourceLayerId === layer.id) return;
                    reorderMapLayer(sourceLayerId, index);
                    setDraggedLayerId(null);
                  }}
                  onDragEnd={() => setDraggedLayerId(null)}
                  className={cn(
                    'rounded-lg border bg-white p-2 text-[11px] transition-colors',
                    isSelected ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300',
                    isDragTarget && 'border-dashed border-slate-400',
                    draggedLayerId === layer.id && 'opacity-45',
                    !layer.visible && draggedLayerId !== layer.id && 'opacity-60'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      draggable
                      onDragStart={(event) => {
                        setDraggedLayerId(layer.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', layer.id);
                      }}
                      className="flex h-7 w-3.5 shrink-0 cursor-grab items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
                      title="Drag to reorder layer"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                    <button
                      type="button"
                      onClick={() => selectLayer(isSelected ? null : layer.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title="Select layer"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold leading-tight text-slate-800">{layer.name}</span>
                        <span className="block truncate text-[10px] uppercase leading-tight tracking-wide text-slate-400">
                          {KIND_LABEL[layer.sourceKind || 'workflow']} · {sourceName(layer)}
                        </span>
                      </span>
                    </button>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      {layer.visualisation?.kind || layer.featureCount.toLocaleString()}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-0.5 pl-5">
                    {onEditStyle && (
                      <button
                        type="button"
                        onClick={() => onEditStyle(layer.id)}
                        className={cn(
                          'rounded p-1 transition-colors',
                          layer.visualisation
                            ? 'text-indigo-600 hover:bg-indigo-50'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                        )}
                        title={layer.visualisation ? `Edit style (${layer.visualisation.kind})` : 'Style layer'}
                      >
                        <Palette className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleMapLayerVisibility(layer.id)}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => focusLayer(layer.id)}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      title="Zoom to layer"
                    >
                      <Focus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMapLayer(layer.id)}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      title="Remove layer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={layer.opacity}
                      onChange={(event) => updateMapLayer(layer.id, { opacity: Number(event.target.value) })}
                      className="ml-1.5 min-w-0 flex-1 accent-slate-700"
                      title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                    />
                  </div>

                  {layer.legend && (
                    <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
                      {layer.legend.items.slice(0, 6).map((item) => (
                        <span
                          key={`${item.label}-${item.color}`}
                          className="h-2.5 w-2.5 rounded-sm border border-slate-200"
                          style={{ backgroundColor: item.color }}
                          title={`${layer.legend?.title}: ${item.label}`}
                        />
                      ))}
                    </div>
                  )}

                  {(selectedFeatureCount > 0 || filterCount > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5 text-[10px] font-semibold">
                      {selectedFeatureCount > 0 && (
                        <span className="flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-orange-700">
                          {selectedFeatureCount.toLocaleString()} selected
                          <button
                            type="button"
                            onClick={() => clearFeatureSelection(layer.id)}
                            className="underline decoration-orange-300 underline-offset-2 hover:text-orange-900"
                          >
                            clear
                          </button>
                        </span>
                      )}
                      {filterCount > 0 && (
                        <span className="flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                          {filterCount.toLocaleString()} filter{filterCount > 1 ? 's' : ''}
                          <button
                            type="button"
                            onClick={() => clearLayerFilters(layer.id)}
                            className="underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
                          >
                            clear
                          </button>
                        </span>
                      )}
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
