import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Donut, Loader2, Plus, Trash2 } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import {
  queryLayerChart,
  visualChartFilterKey,
} from '../../services/visualAnalyticsService';
import { CATEGORICAL_PALETTE, SEQUENTIAL_PALETTES } from '../../utils/palettes';
import { cn } from '../../utils/cn';
import type {
  VisualChartAggregation,
  VisualChartDatum,
  VisualChartResult,
  VisualChartSpec,
  VisualChartType,
  VisualFilter,
} from '../../types/visualAnalytics';

const EXCLUDED_FIELDS = new Set(['geojson', 'geometry', 'geom', 'wkb_geometry', '__ymn_tile_geom', '_ymn_feature_id']);

const CHART_TYPES: Array<{ id: VisualChartType; label: string }> = [
  { id: 'bar', label: 'Bar' },
  { id: 'donut', label: 'Donut' },
  { id: 'rose', label: 'Rose' },
  { id: 'histogram', label: 'Histogram' },
];

const AGGREGATIONS: Array<{ id: VisualChartAggregation; label: string }> = [
  { id: 'count', label: 'Count' },
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Mean' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
];

const PALETTES = [
  { id: 'categorical', name: 'Categorical', colors: CATEGORICAL_PALETTE },
  ...SEQUENTIAL_PALETTES,
];

const isNumericType = (type: string) =>
  ['tinyint', 'smallint', 'integer', 'bigint', 'hugeint', 'utinyint', 'usmallint', 'uinteger', 'ubigint', 'float', 'double', 'decimal', 'real']
    .some((item) => type.toLowerCase().includes(item));

const fieldsForLayer = (layer: MapLayer | undefined) =>
  (layer?.source.fields || [])
    .filter((field) => !EXCLUDED_FIELDS.has(field.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

const numericFieldsForLayer = (layer: MapLayer | undefined) => {
  const fields = fieldsForLayer(layer);
  const typed = fields.filter((field) => isNumericType(field.type));
  return typed.length ? typed : fields;
};

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });

const defaultChartForLayer = (layer: MapLayer): VisualChartSpec | null => {
  const fields = fieldsForLayer(layer);
  if (!fields.length) return null;
  return {
    id: `chart-${Date.now()}`,
    title: `${fields[0].name} distribution`,
    layerId: layer.id,
    type: 'bar',
    dimensionField: fields[0].name,
    measureField: numericFieldsForLayer(layer)[0]?.name,
    aggregation: 'count',
    paletteId: 'categorical',
    maxCategories: 8,
  };
};

const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians) };
};

const arcPath = (cx: number, cy: number, inner: number, outer: number, startAngle: number, endAngle: number) => {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outer, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outer, startAngle);
  const innerStart = polarToCartesian(cx, cy, inner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, inner, endAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
};

const Bars = ({
  data,
  activeKeys,
  onHover,
  onLeave,
  onClick,
}: {
  data: VisualChartDatum[];
  activeKeys: Set<string>;
  onHover: (datum: VisualChartDatum) => void;
  onLeave: () => void;
  onClick: (datum: VisualChartDatum) => void;
}) => {
  const maxValue = Math.max(...data.map((datum) => datum.value), 1);

  return (
    <div className="space-y-1.5">
      {data.map((datum) => {
        const active = activeKeys.has(visualChartFilterKey(datum.filter));
        return (
          <button
            key={datum.key}
            type="button"
            onMouseEnter={() => onHover(datum)}
            onMouseLeave={onLeave}
            onFocus={() => onHover(datum)}
            onBlur={onLeave}
            onClick={() => onClick(datum)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_64px] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-50',
              active && 'bg-sky-50 ring-1 ring-sky-200'
            )}
            title={`${datum.label}: ${formatNumber(datum.value)} (${datum.count.toLocaleString()} rows)`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-slate-600">{datum.label}</span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(3, (datum.value / maxValue) * 100)}%`, backgroundColor: datum.color }}
                />
              </span>
            </span>
            <span className="text-right text-[11px] font-bold tabular-nums text-slate-700">
              {formatNumber(datum.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const RadialChart = ({
  data,
  type,
  activeKeys,
  onHover,
  onLeave,
  onClick,
}: {
  data: VisualChartDatum[];
  type: 'donut' | 'rose';
  activeKeys: Set<string>;
  onHover: (datum: VisualChartDatum) => void;
  onLeave: () => void;
  onClick: (datum: VisualChartDatum) => void;
}) => {
  const total = data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0) || 1;
  const maxValue = Math.max(...data.map((datum) => datum.value), 1);
  let cursor = 0;

  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3">
      <svg viewBox="0 0 132 132" className="h-32 w-32">
        {data.map((datum, index) => {
          const fraction = type === 'donut' ? Math.max(0, datum.value) / total : 1 / Math.max(1, data.length);
          const start = type === 'donut' ? cursor : index * (360 / data.length);
          const end = start + fraction * 360;
          cursor = end;
          const outer = type === 'rose' ? 24 + (datum.value / maxValue) * 40 : 54;
          const active = activeKeys.has(visualChartFilterKey(datum.filter));
          return (
            <path
              key={datum.key}
              d={arcPath(66, 66, type === 'donut' ? 30 : 8, outer, start, Math.max(start + 1, end - 1))}
              fill={datum.color}
              opacity={active ? 1 : 0.84}
              stroke={active ? '#0f172a' : '#ffffff'}
              strokeWidth={active ? 2.5 : 1}
              onMouseEnter={() => onHover(datum)}
              onMouseLeave={onLeave}
              onFocus={() => onHover(datum)}
              onBlur={onLeave}
              onClick={() => onClick(datum)}
              tabIndex={0}
              role="button"
            />
          );
        })}
      </svg>
      <div className="min-w-0 space-y-1 self-center">
        {data.slice(0, 6).map((datum) => (
          <button
            key={datum.key}
            type="button"
            onMouseEnter={() => onHover(datum)}
            onMouseLeave={onLeave}
            onClick={() => onClick(datum)}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50"
            title={datum.label}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: datum.color }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{datum.label}</span>
            <span className="text-[11px] font-bold tabular-nums text-slate-700">{formatNumber(datum.value)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const ChartCard = ({
  chart,
  layer,
  layers,
  filters,
  onUpdate,
  onRemove,
  onToggleFilter,
  onHoverDatum,
  onLeaveDatum,
}: {
  chart: VisualChartSpec;
  layer: MapLayer | undefined;
  layers: MapLayer[];
  filters: VisualFilter[];
  onUpdate: (patch: Partial<Omit<VisualChartSpec, 'id'>>) => void;
  onRemove: () => void;
  onToggleFilter: (datum: VisualChartDatum) => void;
  onHoverDatum: (datum: VisualChartDatum) => void;
  onLeaveDatum: () => void;
}) => {
  const [result, setResult] = useState<VisualChartResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numericFields = numericFieldsForLayer(layer);
  const filtersKey = JSON.stringify(filters);
  const activeFilterKeys = useMemo(() => new Set(filters.map(visualChartFilterKey)), [filters]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!layer || !chart.dimensionField) {
        setResult(null);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const nextResult = await queryLayerChart({ layer, filters, chart });
        if (!cancelled) setResult(nextResult);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Chart query failed');
          setResult(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [layer?.id, layer?.styleVersion, filtersKey, chart.type, chart.dimensionField, chart.measureField, chart.aggregation, chart.paletteId, chart.maxCategories]);

  const selectedLayerFields = fieldsForLayer(layer);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <input
            value={chart.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            className="w-full truncate bg-transparent text-[11px] font-semibold uppercase tracking-wide text-slate-700 outline-none"
          />
          <div className="truncate text-[11px] text-slate-400">
            {layer?.name || 'Missing layer'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          title="Remove chart"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b p-3">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Layer</span>
          <select
            value={chart.layerId}
            onChange={(event) => {
              const nextLayer = layers.find((item) => item.id === event.target.value);
              const nextFields = fieldsForLayer(nextLayer);
              onUpdate({
                layerId: event.target.value,
                dimensionField: nextFields[0]?.name || '',
                measureField: numericFieldsForLayer(nextLayer)[0]?.name,
              });
            }}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {layers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
          <select
            value={chart.type}
            onChange={(event) => onUpdate({ type: event.target.value as VisualChartType })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {CHART_TYPES.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dimension</span>
          <select
            value={chart.dimensionField}
            onChange={(event) => onUpdate({ dimensionField: event.target.value })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {selectedLayerFields.map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Value</span>
          <select
            value={chart.aggregation === 'count' ? '' : chart.measureField || ''}
            disabled={chart.aggregation === 'count'}
            onChange={(event) => onUpdate({ measureField: event.target.value || undefined })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="">Rows</option>
            {numericFields.map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aggregate</span>
          <select
            value={chart.aggregation}
            onChange={(event) => onUpdate({ aggregation: event.target.value as VisualChartAggregation })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {AGGREGATIONS.map((aggregation) => (
              <option key={aggregation.id} value={aggregation.id}>{aggregation.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Palette</span>
          <select
            value={chart.paletteId}
            onChange={(event) => onUpdate({ paletteId: event.target.value })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {PALETTES.map((palette) => (
              <option key={palette.id} value={palette.id}>{palette.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-3">
        {isLoading ? (
          <div className="flex h-36 items-center justify-center text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-rose-500">
            {error}
          </div>
        ) : !result || !result.data.length ? (
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-400">
            No chartable values for this field.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{result.filteredRows.toLocaleString()} active rows</span>
              <span>{result.totalRows.toLocaleString()} total</span>
            </div>
            {chart.type === 'donut' || chart.type === 'rose' ? (
              <RadialChart
                data={result.data}
                type={chart.type}
                activeKeys={activeFilterKeys}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onClick={onToggleFilter}
              />
            ) : (
              <Bars
                data={result.data}
                activeKeys={activeFilterKeys}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onClick={onToggleFilter}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export const ChartPanel = () => {
  const {
    mapLayers,
    selectedLayerId,
    visualAnalytics,
    addChart,
    updateChart,
    removeChart,
    setLayerFilters,
    setHighlightedFeatures,
    addToast,
  } = useStore();

  const selectedLayer = mapLayers.find((layer) => layer.id === selectedLayerId) || mapLayers[0];
  const charts = visualAnalytics.charts;
  const hasChartableLayer = mapLayers.some((layer) => fieldsForLayer(layer).length > 0);

  const handleAddChart = () => {
    if (!selectedLayer) return;
    const nextChart = defaultChartForLayer(selectedLayer);
    if (!nextChart) {
      addToast({ type: 'warning', message: 'Selected layer has no chartable fields' });
      return;
    }
    addChart(nextChart);
  };

  const toggleFilter = (chart: VisualChartSpec, datum: VisualChartDatum) => {
    const currentFilters = visualAnalytics.layers[chart.layerId]?.filters || [];
    const datumKey = visualChartFilterKey(datum.filter);
    const exists = currentFilters.some((filter) => visualChartFilterKey(filter) === datumKey);
    setLayerFilters(
      chart.layerId,
      exists
        ? currentFilters.filter((filter) => visualChartFilterKey(filter) !== datumKey)
        : [...currentFilters, datum.filter],
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <BarChart3 className="h-3.5 w-3.5" />
              Charts
            </h3>
            <p className="mt-1 truncate text-[11px] text-slate-400">
              Click chart marks to filter. Hover to highlight mapped features.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddChart}
            disabled={!hasChartableLayer}
            className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!mapLayers.length ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-slate-400">
            Add or run a layer before creating charts.
          </div>
        ) : !charts.length ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-[11px] text-slate-400">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <Donut className="h-5 w-5" />
            </div>
            Create linked charts from the selected layer, then use chart marks as visual filters.
          </div>
        ) : (
          <div className="space-y-3">
            {charts.map((chart) => {
              const layer = mapLayers.find((item) => item.id === chart.layerId);
              const filters = visualAnalytics.layers[chart.layerId]?.filters || [];
              return (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  layer={layer}
                  layers={mapLayers}
                  filters={filters}
                  onUpdate={(patch) => updateChart(chart.id, patch)}
                  onRemove={() => removeChart(chart.id)}
                  onToggleFilter={(datum) => toggleFilter(chart, datum)}
                  onHoverDatum={(datum) => setHighlightedFeatures(chart.layerId, datum.featureIds)}
                  onLeaveDatum={() => setHighlightedFeatures(chart.layerId, [])}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
