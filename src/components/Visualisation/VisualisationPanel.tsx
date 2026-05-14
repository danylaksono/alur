import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Eraser, Palette } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import {
  buildCategoricalVisualisation,
  buildChoroplethVisualisation,
  buildGraduatedSymbolVisualisation,
  buildHeatmapVisualisation,
  buildLabelVisualisation,
  buildDotDensityVisualisation,
  buildLegend,
  profileGeoJsonField,
  type FieldProfile,
} from '../../utils/classification';
import { geometryKindForLayer } from '../../utils/mapStyleCompiler';
import { getPalette, SEQUENTIAL_PALETTES } from '../../utils/palettes';
import { cn } from '../../utils/cn';
import { queryLayerTemporalRange, type TemporalRange } from '../../services/visualAnalyticsService';
import { generateDotDensityGeoJSON } from '../../services/dotDensityService';
import { TemporalSlider } from './TemporalSlider';

const excludedFields = new Set(['geojson', 'geometry', 'geom']);

const formatCount = (count: number) => count.toLocaleString();

const fieldNamesForLayer = (layer: MapLayer | null) => {
  if (!layer) return [];
  const names = new Set<string>();
  layer.geojson.features.slice(0, 200).forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((key) => {
      if (!excludedFields.has(key.toLowerCase())) names.add(key);
    });
  });
  return [...names].sort((a, b) => a.localeCompare(b));
};

const DistributionPreview = ({
  field,
  profile,
  activeFilterKeys,
  onToggleFilter,
}: {
  field: string;
  profile: FieldProfile | null;
  activeFilterKeys: Set<string>;
  onToggleFilter: (filter: { kind: 'category'; field: string; values: string[] } | { kind: 'range'; field: string; min: number; max: number }) => void;
}) => {
  if (!profile) return null;

  if (profile.kind === 'numeric') {
    const maxCount = Math.max(...profile.bins.map((bin) => bin.count), 1);
    return (
      <div className="flex h-20 items-end gap-1">
        {profile.bins.map((bin) => (
          <div key={bin.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleFilter({ kind: 'range', field, min: bin.min, max: bin.max })}
              className={
                activeFilterKeys.has(`${field}:range:${bin.min}:${bin.max}`)
                  ? 'w-full rounded-t bg-orange-500 ring-2 ring-orange-200'
                  : 'w-full rounded-t bg-slate-800 hover:bg-slate-600'
              }
              style={{ height: `${Math.max(4, (bin.count / maxCount) * 60)}px` }}
              title={`Filter ${field} by ${bin.label}: ${formatCount(bin.count)}`}
            />
            <span className="w-full truncate text-center text-[8px] text-slate-400" title={bin.label}>
              {bin.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const maxCount = Math.max(...profile.categories.map((category) => category.count), 1);
  return (
    <div className="space-y-1.5">
      {profile.categories.slice(0, 8).map((category) => (
        <button
          type="button"
          key={category.value}
          onClick={() => onToggleFilter({ kind: 'category', field, values: [category.value] })}
          className={cn(
            'grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-2 rounded px-1 py-0.5 text-left text-[10px]',
            activeFilterKeys.has(`${field}:category:${category.value}`)
              ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
              : 'hover:bg-slate-50'
          )}
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-600">{category.value}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-800"
                style={{ width: `${Math.max(4, (category.count / maxCount) * 100)}%` }}
              />
            </div>
          </div>
          <span className="text-right font-bold text-slate-400">{formatCount(category.count)}</span>
        </button>
      ))}
    </div>
  );
};

export const VisualisationPanel = () => {
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const mapLayers = useStore((s) => s.mapLayers);
  const updateLayerVisualisation = useStore((s) => s.updateLayerVisualisation);
  const clearLayerVisualisation = useStore((s) => s.clearLayerVisualisation);
  const updateMapLayer = useStore((s) => s.updateMapLayer);
  const addMapLayer = useStore((s) => s.addMapLayer);
  const removeMapLayer = useStore((s) => s.removeMapLayer);
  const visualAnalytics = useStore((s) => s.visualAnalytics);
  const setLayerFilters = useStore((s) => s.setLayerFilters);
  const clearLayerFilters = useStore((s) => s.clearLayerFilters);

  const selectedLayer = useMemo(
    () => mapLayers.find((layer) => layer.id === selectedLayerId) || null,
    [mapLayers, selectedLayerId],
  );
  const fields = useMemo(() => fieldNamesForLayer(selectedLayer), [selectedLayer]);
  const geometryKind = useMemo(() => selectedLayer ? geometryKindForLayer(selectedLayer) : null, [selectedLayer]);
  const [field, setField] = useState('');
  const [kind, setKind] = useState<'choropleth' | 'categorical' | 'graduated_symbol' | 'heatmap' | 'label' | 'dot_density'>('choropleth');
  const [method, setMethod] = useState<'equal_interval' | 'quantile'>('quantile');
  const [classCount, setClassCount] = useState(5);
  const [paletteId, setPaletteId] = useState(SEQUENTIAL_PALETTES[0].id);
  const [temporalField, setTemporalField] = useState('');
  const [temporalStart, setTemporalStart] = useState('');
  const [temporalEnd, setTemporalEnd] = useState('');
  const [temporalRange, setTemporalRange] = useState<TemporalRange | null>(null);

  useEffect(() => {
    if (!selectedLayer || !temporalField) {
      setTemporalRange(null);
      return;
    }
    let cancelled = false;
    queryLayerTemporalRange({ layer: selectedLayer, column: temporalField }).then((result) => {
      if (!cancelled) setTemporalRange(result);
    }).catch(() => {
      if (!cancelled) setTemporalRange(null);
    });
    return () => { cancelled = true; };
  }, [selectedLayer?.id, temporalField]);

  useEffect(() => {
    if (!selectedLayer) {
      setField('');
      return;
    }

    const vis = selectedLayer.visualisation;
    if (vis?.kind === 'choropleth' || vis?.kind === 'categorical' || vis?.kind === 'graduated_symbol' || vis?.kind === 'heatmap' || vis?.kind === 'label' || vis?.kind === 'dot_density') {
      setKind(vis.kind);
      setField('field' in vis && vis.field ? vis.field : fields[0] || '');
      if (vis.kind === 'choropleth') {
        setMethod(vis.method === 'manual' ? 'quantile' : vis.method);
        setClassCount(vis.classCount);
      }
      return;
    }

    setField(fields[0] || '');
    setTemporalField(fields[0] || '');
  }, [selectedLayer?.id, fields]);

  const profile = useMemo(() => {
    if (!selectedLayer || !field) return null;
    return profileGeoJsonField(selectedLayer.geojson.features, field);
  }, [selectedLayer, field]);

  const canApply = Boolean(
    selectedLayer &&
    field &&
    ((kind === 'choropleth' && profile?.kind === 'numeric') ||
      (kind === 'categorical' && profile?.kind === 'categorical') ||
      (kind === 'graduated_symbol' && geometryKind === 'point' && profile?.kind === 'numeric') ||
      (kind === 'heatmap' && geometryKind === 'point') ||
      (kind === 'label' && field) ||
      (kind === 'dot_density' && geometryKind === 'polygon' && profile?.kind === 'numeric')),
  );

  const [dotDensityGenerating, setDotDensityGenerating] = useState(false);

  useEffect(() => {
    if (!selectedLayer || !canApply || !profile) return;

    if (kind === 'dot_density' && profile.kind === 'numeric') {
      const visualisation = buildDotDensityVisualisation({ field });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));

      const dotLayerId = `${selectedLayer.id}-dots`;
      const existingDotsLayer = mapLayers.find((l) => l.id === dotLayerId);
      if (existingDotsLayer) return;

      setDotDensityGenerating(true);
      generateDotDensityGeoJSON(selectedLayer, { field, dotValue: visualisation.dotValue, color: visualisation.color, radius: visualisation.radius, opacity: visualisation.opacity })
        .then((dotsGeojson) => {
          addMapLayer({
            id: dotLayerId,
            name: `${selectedLayer.name} (dots)`,
            geojson: dotsGeojson,
            visible: selectedLayer.visible,
            sourceNodeId: selectedLayer.sourceNodeId,
            sourceKind: 'manual',
            color: visualisation.color,
            opacity: visualisation.opacity,
            visualisation: { kind: 'simple', color: visualisation.color, opacity: visualisation.opacity },
          });
          updateMapLayer(selectedLayer.id, { dotDensityLayerId: dotLayerId });
        })
        .catch(() => {})
        .finally(() => setDotDensityGenerating(false));
      return;
    }

    if (kind === 'choropleth' && profile.kind === 'numeric') {
      const visualisation = buildChoroplethVisualisation({
        field,
        profile,
        method,
        classCount,
        palette: getPalette(paletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'categorical' && profile.kind === 'categorical') {
      const visualisation = buildCategoricalVisualisation({ field, profile });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'graduated_symbol' && profile.kind === 'numeric') {
      const visualisation = buildGraduatedSymbolVisualisation({ field, profile });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'heatmap') {
      const visualisation = buildHeatmapVisualisation({
        field: profile.kind === 'numeric' ? field : undefined,
        palette: getPalette(paletteId).colors,
      });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }

    if (kind === 'label') {
      const visualisation = buildLabelVisualisation({ field });
      updateLayerVisualisation(selectedLayer.id, visualisation, buildLegend(visualisation));
    }
  }, [selectedLayer?.id, field, kind, method, classCount, paletteId, canApply, profile, updateLayerVisualisation]);

  const activeLegend = selectedLayer?.legend;
  const activeFilters = selectedLayer ? visualAnalytics.layers[selectedLayer.id]?.filters || [] : [];
  const activeFilterKeys = new Set(activeFilters.map((filter) => {
    if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}`;
    if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`;
    return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
  }));

  const toggleLegendFilter = (item: { label: string; value?: string; min?: number; max?: number }) => {
    if (!selectedLayer || !activeLegend) return;
    const existingFilters = visualAnalytics.layers[selectedLayer.id]?.filters || [];
    const nextFilter = item.label === 'No data' && activeLegend.kind === 'categorical'
      ? { kind: 'category' as const, field: activeLegend.title, values: [], includeNull: true }
      : item.value !== undefined
      ? { kind: 'category' as const, field: activeLegend.title, values: [item.value], includeNull: item.label === 'No data' }
      : { kind: 'range' as const, field: activeLegend.title, min: item.min, max: item.max, includeNull: item.label === 'No data' };
    const nextKey = nextFilter.kind === 'category'
      ? `${nextFilter.field}:category:${nextFilter.values.join('|')}`
      : `${nextFilter.field}:range:${nextFilter.min ?? ''}:${nextFilter.max ?? ''}`;
    const withoutSame = existingFilters.filter((filter) => {
      const key = filter.kind === 'category'
        ? `${filter.field}:category:${filter.values.join('|')}`
        : filter.kind === 'temporal'
          ? `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`
        : `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
      return key !== nextKey;
    });
    setLayerFilters(selectedLayer.id, withoutSame.length === existingFilters.length ? [...existingFilters, nextFilter] : withoutSame);
  };

  const toggleDistributionFilter = (
    nextFilter: { kind: 'category'; field: string; values: string[] } | { kind: 'range'; field: string; min: number; max: number },
  ) => {
    if (!selectedLayer) return;
    const existingFilters = visualAnalytics.layers[selectedLayer.id]?.filters || [];
    const nextKey = nextFilter.kind === 'category'
      ? `${nextFilter.field}:category:${nextFilter.values.join('|')}`
      : `${nextFilter.field}:range:${nextFilter.min ?? ''}:${nextFilter.max ?? ''}`;
    const withoutSame = existingFilters.filter((filter) => {
      const key = filter.kind === 'category'
        ? `${filter.field}:category:${filter.values.join('|')}`
        : filter.kind === 'temporal'
          ? `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}`
        : `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}`;
      return key !== nextKey;
    });
    setLayerFilters(selectedLayer.id, withoutSame.length === existingFilters.length ? [...existingFilters, nextFilter] : withoutSame);
  };

  const applyTemporalFilter = () => {
    if (!selectedLayer || !temporalField || (!temporalStart && !temporalEnd)) return;
    const nextFilter = {
      kind: 'temporal' as const,
      field: temporalField,
      start: temporalStart || undefined,
      end: temporalEnd || undefined,
    };
    const existingFilters = visualAnalytics.layers[selectedLayer.id]?.filters || [];
    const withoutSameField = existingFilters.filter((filter) => !(filter.kind === 'temporal' && filter.field === temporalField));
    setLayerFilters(selectedLayer.id, [...withoutSameField, nextFilter]);
  };

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <div className="border-b bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Palette className="h-3.5 w-3.5" />
            Visualise
          </h3>
          {selectedLayer?.visualisation && (
            <button
              type="button"
              onClick={() => {
                if (!selectedLayer) return;
                if (selectedLayer.dotDensityLayerId) removeMapLayer(selectedLayer.dotDensityLayerId);
                if (selectedLayer.dotDensityLayerId) updateMapLayer(selectedLayer.id, { dotDensityLayerId: undefined });
                clearLayerVisualisation(selectedLayer.id);
              }}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50"
              title="Reset style"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!selectedLayer ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            No layer selected.
          </div>
        ) : fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[11px] text-slate-500">
            No styleable fields.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">Layer</div>
              <div className="truncate text-[11px] font-bold text-slate-700">{selectedLayer.name}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Type</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="choropleth">Choropleth</option>
                  <option value="categorical">Categories</option>
                  {geometryKind === 'point' && <option value="graduated_symbol">Symbols</option>}
                  {geometryKind === 'point' && <option value="heatmap">Heatmap</option>}
                  {geometryKind === 'polygon' && <option value="dot_density">Dot density</option>}
                  <option value="label">Labels</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Field</span>
                <select
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  {fields.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            {(kind === 'choropleth' || kind === 'heatmap') && (
              <div className="grid grid-cols-3 gap-2">
                {kind === 'choropleth' && <label className="space-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Method</span>
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value as typeof method)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="quantile">Quantile</option>
                    <option value="equal_interval">Equal interval</option>
                  </select>
                </label>}
                {kind === 'choropleth' && <label className="space-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Classes</span>
                  <input
                    type="number"
                    min={2}
                    max={9}
                    value={classCount}
                    onChange={(event) => setClassCount(Number(event.target.value))}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                </label>}
                <label className="space-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Palette</span>
                  <select
                    value={paletteId}
                    onChange={(event) => setPaletteId(event.target.value)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    {SEQUENTIAL_PALETTES.map((palette) => (
                      <option key={palette.id} value={palette.id}>{palette.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {kind === 'dot_density' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Dot value</span>
                    <input
                      type="number"
                      min={1}
                      value={selectedLayer?.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.dotValue : 100}
                      onChange={(event) => {
                        if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                        const vis = { ...selectedLayer.visualisation, dotValue: Number(event.target.value) };
                        updateLayerVisualisation(selectedLayer.id, vis, selectedLayer.legend);
                      }}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Radius</span>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={selectedLayer?.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.radius : 2.5}
                      onChange={(event) => {
                        if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                        const vis = { ...selectedLayer.visualisation, radius: Number(event.target.value) };
                        updateLayerVisualisation(selectedLayer.id, vis, selectedLayer.legend);
                      }}
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={dotDensityGenerating}
                  onClick={() => {
                    if (!selectedLayer || selectedLayer.visualisation?.kind !== 'dot_density') return;
                    const dotLayerId = `${selectedLayer.id}-dots`;
                    const existingDots = mapLayers.find((l) => l.id === dotLayerId);
                    if (existingDots) removeMapLayer(dotLayerId);
                    setDotDensityGenerating(true);
                    generateDotDensityGeoJSON(selectedLayer, {
                      field: selectedLayer.visualisation.field,
                      dotValue: selectedLayer.visualisation.dotValue,
                      color: selectedLayer.visualisation.color,
                      radius: selectedLayer.visualisation.radius,
                      opacity: selectedLayer.visualisation.opacity,
                    })
                      .then((dotsGeojson) => {
                        addMapLayer({
                          id: dotLayerId,
                          name: `${selectedLayer.name} (dots)`,
                          geojson: dotsGeojson,
                          visible: selectedLayer.visible,
                          sourceNodeId: selectedLayer.sourceNodeId,
                          sourceKind: 'manual',
                          color: selectedLayer.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.color : undefined,
                          opacity: selectedLayer.visualisation?.kind === 'dot_density' ? selectedLayer.visualisation.opacity : 0.65,
                          visualisation: selectedLayer.visualisation?.kind === 'dot_density' ? undefined : undefined,
                        });
                        updateMapLayer(selectedLayer.id, { dotDensityLayerId: dotLayerId });
                      })
                      .catch(() => {})
                      .finally(() => setDotDensityGenerating(false));
                  }}
                  className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  {dotDensityGenerating ? 'Generating...' : 'Regenerate dots'}
                </button>
              </div>
            )}

            {geometryKind === 'point' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Point Clustering</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={typeof selectedLayer?.clusterRadius === 'number'}
                      onChange={(event) => {
                        if (!selectedLayer) return;
                        updateMapLayer(selectedLayer.id, {
                          clusterRadius: event.target.checked ? 50 : undefined,
                          clusterMaxZoom: event.target.checked ? 16 : undefined,
                        });
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-[10px] font-semibold text-slate-600">Cluster</span>
                  </label>
                </div>
                {typeof selectedLayer?.clusterRadius === 'number' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Radius</span>
                      <input
                        type="number"
                        min={10}
                        max={200}
                        value={selectedLayer.clusterRadius}
                        onChange={(event) => {
                          if (!selectedLayer) return;
                          updateMapLayer(selectedLayer.id, { clusterRadius: Number(event.target.value) });
                        }}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Max Zoom</span>
                      <input
                        type="number"
                        min={8}
                        max={24}
                        value={selectedLayer.clusterMaxZoom ?? 16}
                        onChange={(event) => {
                          if (!selectedLayer) return;
                          updateMapLayer(selectedLayer.id, { clusterMaxZoom: Number(event.target.value) });
                        }}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className={cn('rounded-lg border p-3', canApply ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50')}>
              <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                <BarChart3 className="h-3.5 w-3.5" />
                Distribution
              </div>
              {canApply ? (
                <DistributionPreview
                  field={field}
                  profile={profile}
                  activeFilterKeys={activeFilterKeys}
                  onToggleFilter={toggleDistributionFilter}
                />
              ) : (
                <div className="text-[11px] font-medium text-amber-700">
                  {kind === 'choropleth' || kind === 'graduated_symbol'
                    ? 'Choose a numeric field.'
                    : kind === 'heatmap'
                      ? 'Heatmaps require point layers.'
                      : kind === 'label'
                        ? 'Choose a text field.'
                        : kind === 'dot_density'
                          ? 'Pick a numeric field on a polygon layer.'
                          : 'Choose a categorical field.'}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">Temporal Filter</div>
              <select
                value={temporalField}
                onChange={(event) => {
                  setTemporalField(event.target.value);
                }}
                className="mb-2 h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {fields.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>

              {temporalRange ? (
                <TemporalSlider
                  range={temporalRange}
                  field={temporalField}
                  currentFilter={activeFilters.find((f) => f.kind === 'temporal' && f.field === temporalField)}
                  onApply={(filter) => {
                    if (!selectedLayer) return;
                    const existing = visualAnalytics.layers[selectedLayer.id]?.filters || [];
                    const withoutField = existing.filter((f) => !(f.kind === 'temporal' && f.field === temporalField));
                    setLayerFilters(selectedLayer.id, [...withoutField, filter]);
                  }}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={temporalStart}
                      onChange={(event) => setTemporalStart(event.target.value)}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      type="date"
                      value={temporalEnd}
                      onChange={(event) => setTemporalEnd(event.target.value)}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyTemporalFilter}
                    disabled={!temporalField || (!temporalStart && !temporalEnd)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-slate-900 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply Date Range
                  </button>
                </>
              )}
            </div>

            {activeLegend && (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Legend · {activeLegend.title}
                  </div>
                  {activeFilters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => selectedLayer && clearLayerFilters(selectedLayer.id)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-[8px] font-bold uppercase text-slate-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {activeLegend.items.slice(0, 8).map((item) => (
                    <button
                      type="button"
                      key={`${item.label}-${item.color}`}
                      onClick={() => toggleLegendFilter(item)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[10px]',
                        activeFilterKeys.has(item.value !== undefined
                          ? `${activeLegend.title}:category:${item.value}`
                          : `${activeLegend.title}:range:${item.min ?? ''}:${item.max ?? ''}`)
                          ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
                          : 'hover:bg-slate-50'
                      )}
                    >
                      <span className="h-3 w-3 rounded-sm border border-slate-200" style={{ backgroundColor: item.color }} />
                      <span className="min-w-0 flex-1 truncate text-slate-600">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
