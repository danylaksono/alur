import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Donut, Loader2, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import {
  describeChartTable,
  listChartTables,
  queryChartFacetValues,
  queryLayerChart,
  queryLayerScatter,
  queryTableChart,
  queryTableScatter,
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
  VisualScatterResult,
} from '../../types/visualAnalytics';

const EXCLUDED_FIELDS = new Set(['geojson', 'geometry', 'geom', 'wkb_geometry', '__alur_tile_geom', '_alur_feature_id']);

const CHART_TYPES: Array<{ id: VisualChartType; label: string }> = [
  { id: 'bar', label: 'Bar' },
  { id: 'donut', label: 'Donut' },
  { id: 'rose', label: 'Rose' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'scatter', label: 'Scatter' },
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

type ChartField = { name: string; type: string };

const filterChartFields = (fields: ChartField[]) =>
  fields
    .filter((field) => {
      const lower = field.name.toLowerCase();
      return !EXCLUDED_FIELDS.has(lower) && !lower.startsWith('__alur_');
    })
    .sort((a, b) => a.name.localeCompare(b.name));

const fieldsForLayer = (layer: MapLayer | undefined) =>
  filterChartFields(layer?.source.fields || []);

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

/** Whether a datum's mark should render as selected given the layer's active filters. */
const isDatumActive = (datum: VisualChartDatum, filters: VisualFilter[]) => {
  const own = datum.filter;
  if (own.kind === 'category') {
    return filters.some(
      (filter) => filter.kind === 'category' && filter.field === own.field
        && own.values.every((value) => filter.values.includes(value)),
    );
  }
  if (own.kind === 'range') {
    return filters.some(
      (filter) => filter.kind === 'range' && filter.field === own.field
        && (filter.min === undefined || (own.min ?? -Infinity) >= filter.min - 1e-9)
        && (filter.max === undefined || (own.max ?? Infinity) <= filter.max + 1e-9),
    );
  }
  return filters.some((filter) => visualChartFilterKey(filter) === visualChartFilterKey(own));
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
  maxScale,
  onHover,
  onLeave,
  onClick,
}: {
  data: VisualChartDatum[];
  activeKeys: Set<string>;
  /** Shared scale across small multiples; defaults to this chart's own max. */
  maxScale?: number;
  onHover: (datum: VisualChartDatum) => void;
  onLeave: () => void;
  onClick: (datum: VisualChartDatum) => void;
}) => {
  const maxValue = maxScale ?? Math.max(...data.map((datum) => datum.totalValue), 1);

  return (
    <div className="space-y-1.5">
      {data.map((datum) => {
        const active = activeKeys.has(datum.key);
        const isFiltered = datum.value !== datum.totalValue;
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
              'grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-50',
              active && 'bg-sky-50 ring-1 ring-sky-200'
            )}
            title={`${datum.label}: ${formatNumber(datum.value)} of ${formatNumber(datum.totalValue)} (${datum.count.toLocaleString()} rows)`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-slate-600">{datum.label}</span>
              <span className="relative mt-1 block h-2 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-slate-200"
                  style={{ width: `${Math.max(3, (datum.totalValue / maxValue) * 100)}%` }}
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${(datum.value / maxValue) * 100}%`, backgroundColor: datum.color }}
                />
              </span>
            </span>
            <span className="text-right text-[11px] tabular-nums">
              <span className="font-bold text-slate-700">{formatNumber(datum.value)}</span>
              {isFiltered && (
                <span className="text-slate-400"> /{formatNumber(datum.totalValue)}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const HISTOGRAM_WIDTH = 260;
const HISTOGRAM_HEIGHT = 88;

type BrushRange = { min: number; max: number };

const Histogram = ({
  data,
  brush,
  maxScale,
  onHover,
  onLeave,
  onBrushRange,
  onClearRange,
}: {
  data: VisualChartDatum[];
  brush: BrushRange | null;
  /** Shared scale across small multiples; defaults to this chart's own max. */
  maxScale?: number;
  onHover: (datum: VisualChartDatum) => void;
  onLeave: () => void;
  onBrushRange: (min: number, max: number) => void;
  onClearRange: () => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(null);

  const bins = data.map((datum) => datum.filter as Extract<VisualFilter, { kind: 'range' }>);
  const domainMin = bins[0]?.min ?? 0;
  const domainMax = bins[bins.length - 1]?.max ?? 1;
  const domainSpan = domainMax - domainMin || 1;
  const maxValue = maxScale ?? Math.max(...data.map((datum) => datum.totalValue), 1);
  const cellWidth = HISTOGRAM_WIDTH / Math.max(1, data.length);
  const xOfValue = (value: number) => ((value - domainMin) / domainSpan) * HISTOGRAM_WIDTH;

  const pointerX = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    const x = ((event.clientX - rect.left) / rect.width) * HISTOGRAM_WIDTH;
    return Math.max(0, Math.min(HISTOGRAM_WIDTH, x));
  };

  const binIndexAt = (x: number) =>
    Math.max(0, Math.min(data.length - 1, Math.floor(x / cellWidth)));

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!data.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = pointerX(event);
    setDrag({ start: x, current: x });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (drag) {
      setDrag({ start: drag.start, current: pointerX(event) });
      return;
    }
    onHover(data[binIndexAt(pointerX(event))]);
  };

  const handlePointerUp = (_event: React.PointerEvent) => {
    if (!drag) return;
    const from = Math.min(drag.start, drag.current);
    const to = Math.max(drag.start, drag.current);
    setDrag(null);

    if (to - from < 4) {
      // Treat as a click: brush the single bin, or clear if it is the active brush.
      const bin = bins[binIndexAt(from)];
      if (bin?.min === undefined || bin?.max === undefined) return;
      if (brush && brush.min === bin.min && brush.max === bin.max) onClearRange();
      else onBrushRange(bin.min, bin.max);
      return;
    }

    const first = bins[binIndexAt(from)];
    const last = bins[binIndexAt(to)];
    if (first?.min === undefined || last?.max === undefined) return;
    onBrushRange(first.min, last.max);
  };

  const dragRect = drag
    ? { x: Math.min(drag.start, drag.current), width: Math.abs(drag.current - drag.start) }
    : null;
  const brushRect = brush && !drag
    ? { x: xOfValue(brush.min), width: Math.max(2, xOfValue(brush.max) - xOfValue(brush.min)) }
    : null;

  return (
    <div>
      {brush && (
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-sky-700">
            {formatNumber(brush.min)} – {formatNumber(brush.max)}
          </span>
          <button
            type="button"
            onClick={onClearRange}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
            Clear range
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${HISTOGRAM_WIDTH} ${HISTOGRAM_HEIGHT}`}
        className="w-full cursor-crosshair touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { if (!drag) onLeave(); }}
      >
        {data.map((datum, index) => {
          const bin = bins[index];
          const outsideBrush = brush
            && ((bin.max ?? Infinity) <= brush.min + 1e-9 || (bin.min ?? -Infinity) >= brush.max - 1e-9);
          const totalHeight = (datum.totalValue / maxValue) * (HISTOGRAM_HEIGHT - 4);
          const filteredHeight = (datum.value / maxValue) * (HISTOGRAM_HEIGHT - 4);
          const x = index * cellWidth + 1;
          const width = Math.max(1, cellWidth - 2);
          return (
            <g key={datum.key} opacity={outsideBrush ? 0.35 : 1}>
              <title>{`${datum.label}: ${formatNumber(datum.value)} of ${formatNumber(datum.totalValue)}`}</title>
              <rect
                x={x}
                y={HISTOGRAM_HEIGHT - totalHeight}
                width={width}
                height={totalHeight}
                rx={1.5}
                className="fill-slate-200"
              />
              <rect
                x={x}
                y={HISTOGRAM_HEIGHT - filteredHeight}
                width={width}
                height={filteredHeight}
                rx={1.5}
                fill={datum.color}
              />
            </g>
          );
        })}
        {(dragRect || brushRect) && (
          <rect
            x={(dragRect || brushRect)!.x}
            y={0}
            width={(dragRect || brushRect)!.width}
            height={HISTOGRAM_HEIGHT}
            className="fill-sky-400/15 stroke-sky-500"
            strokeWidth={1}
          />
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-400">
        <span>{formatNumber(domainMin)}</span>
        <span className="text-slate-300">drag to brush</span>
        <span>{formatNumber(domainMax)}</span>
      </div>
    </div>
  );
};

const SCATTER_WIDTH = 260;
const SCATTER_HEIGHT = 180;
const SCATTER_PAD = 6;

type Brush2D = { xMin: number; xMax: number; yMin: number; yMax: number };

const ScatterChart = ({
  result,
  color,
  brush,
  onBrush,
  onClear,
}: {
  result: VisualScatterResult;
  color: string;
  brush: Brush2D | null;
  onBrush: (brush: Brush2D) => void;
  onClear: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const spanX = result.xMax - result.xMin || 1;
  const spanY = result.yMax - result.yMin || 1;
  const plotW = SCATTER_WIDTH - 2 * SCATTER_PAD;
  const plotH = SCATTER_HEIGHT - 2 * SCATTER_PAD;
  const pxOf = (value: number) => SCATTER_PAD + ((value - result.xMin) / spanX) * plotW;
  const pyOf = (value: number) => SCATTER_HEIGHT - SCATTER_PAD - ((value - result.yMin) / spanY) * plotH;
  const xValueAt = (px: number) =>
    Math.min(result.xMax, Math.max(result.xMin, result.xMin + ((px - SCATTER_PAD) / plotW) * spanX));
  const yValueAt = (py: number) =>
    Math.min(result.yMax, Math.max(result.yMin, result.yMin + ((SCATTER_HEIGHT - SCATTER_PAD - py) / plotH) * spanY));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SCATTER_WIDTH * dpr;
    canvas.height = SCATTER_HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SCATTER_WIDTH, SCATTER_HEIGHT);

    const dense = result.points.length > 4000;
    const size = dense ? 2 : 3.5;
    const half = size / 2;
    ctx.globalAlpha = dense ? 0.4 : 0.65;
    ctx.fillStyle = '#cbd5e1';
    for (const point of result.points) {
      if (point.inContext) continue;
      ctx.fillRect(pxOf(point.x) - half, pyOf(point.y) - half, size, size);
    }
    ctx.fillStyle = color;
    for (const point of result.points) {
      if (!point.inContext) continue;
      ctx.fillRect(pxOf(point.x) - half, pyOf(point.y) - half, size, size);
    }
    ctx.globalAlpha = 1;
  }, [result, color]);

  const pointerPos = (event: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(SCATTER_WIDTH, ((event.clientX - rect.left) / rect.width) * SCATTER_WIDTH)),
      y: Math.max(0, Math.min(SCATTER_HEIGHT, ((event.clientY - rect.top) / rect.height) * SCATTER_HEIGHT)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = pointerPos(event);
    setDrag({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const pos = pointerPos(event);
    setDrag({ ...drag, x1: pos.x, y1: pos.y });
  };

  const handlePointerUp = () => {
    if (!drag) return;
    const { x0, y0, x1, y1 } = drag;
    setDrag(null);
    if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
      if (brush) onClear();
      return;
    }
    onBrush({
      xMin: xValueAt(Math.min(x0, x1)),
      xMax: xValueAt(Math.max(x0, x1)),
      yMin: yValueAt(Math.max(y0, y1)),
      yMax: yValueAt(Math.min(y0, y1)),
    });
  };

  const overlayRect = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : brush
      ? {
          left: pxOf(brush.xMin),
          top: pyOf(brush.yMax),
          width: Math.max(2, pxOf(brush.xMax) - pxOf(brush.xMin)),
          height: Math.max(2, pyOf(brush.yMin) - pyOf(brush.yMax)),
        }
      : null;

  return (
    <div>
      {brush && (
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="truncate font-semibold text-sky-700">
            {formatNumber(brush.xMin)} – {formatNumber(brush.xMax)} × {formatNumber(brush.yMin)} – {formatNumber(brush.yMax)}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
            Clear selection
          </button>
        </div>
      )}
      <div className="flex gap-1.5">
        <div className="flex select-none flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-slate-400">
          <span>{formatNumber(result.yMax)}</span>
          <span>{formatNumber(result.yMin)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            className="cursor-crosshair touch-none rounded border border-slate-100 bg-white"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          {overlayRect && (
            <div
              className="pointer-events-none absolute border border-sky-500 bg-sky-400/10"
              style={{
                left: `${(overlayRect.left / SCATTER_WIDTH) * 100}%`,
                top: `${(overlayRect.top / SCATTER_HEIGHT) * 100}%`,
                width: `${(overlayRect.width / SCATTER_WIDTH) * 100}%`,
                height: `${(overlayRect.height / SCATTER_HEIGHT) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between pl-6 text-[11px] tabular-nums text-slate-400">
        <span>{formatNumber(result.xMin)}</span>
        <span className="text-slate-300">drag to select</span>
        <span>{formatNumber(result.xMax)}</span>
      </div>
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
          const active = activeKeys.has(datum.key);
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
            <span className="text-[11px] tabular-nums">
              <span className="font-bold text-slate-700">{formatNumber(datum.value)}</span>
              {datum.value !== datum.totalValue && (
                <span className="text-slate-400"> /{formatNumber(datum.totalValue)}</span>
              )}
            </span>
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
  tables,
  filters,
  onUpdate,
  onRemove,
  onToggleFilter,
  onBrushRange,
  onClearRange,
  onBrush2D,
  onClear2D,
  onHoverDatum,
  onLeaveDatum,
}: {
  chart: VisualChartSpec;
  layer: MapLayer | undefined;
  layers: MapLayer[];
  tables: string[];
  filters: VisualFilter[];
  onUpdate: (patch: Partial<Omit<VisualChartSpec, 'id'>>) => void;
  onRemove: () => void;
  onToggleFilter: (datum: VisualChartDatum) => void;
  onBrushRange: (min: number, max: number) => void;
  onClearRange: () => void;
  onBrush2D: (brush: Brush2D) => void;
  onClear2D: () => void;
  onHoverDatum: (datum: VisualChartDatum) => void;
  onLeaveDatum: () => void;
}) => {
  const [result, setResult] = useState<VisualChartResult | null>(null);
  const [scatter, setScatter] = useState<VisualScatterResult | null>(null);
  const [facetResults, setFacetResults] = useState<Array<{ value: string; result: VisualChartResult }> | null>(null);
  const [tableFields, setTableFields] = useState<ChartField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTableChart = Boolean(chart.tableName);
  const availableFields = isTableChart ? tableFields : fieldsForLayer(layer);
  const typedNumericFields = availableFields.filter((field) => isNumericType(field.type));
  const numericFields = typedNumericFields.length ? typedNumericFields : availableFields;
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!chart.tableName) {
      setTableFields([]);
      return;
    }
    let cancelled = false;
    describeChartTable(chart.tableName)
      .then((fields) => { if (!cancelled) setTableFields(filterChartFields(fields)); })
      .catch(() => { if (!cancelled) setTableFields([]); });
    return () => { cancelled = true; };
  }, [chart.tableName]);

  // A freshly table-bound chart has no fields yet — pick sensible defaults
  // once the table schema arrives (or when the schema no longer has the field).
  useEffect(() => {
    if (!isTableChart || !tableFields.length) return;
    if (chart.dimensionField && tableFields.some((field) => field.name === chart.dimensionField)) return;
    const numerics = tableFields.filter((field) => isNumericType(field.type));
    onUpdate({
      dimensionField: tableFields[0].name,
      measureField: (numerics[0] || tableFields[0]).name,
    });
  }, [isTableChart, tableFields, chart.dimensionField]);
  const activeKeys = useMemo(
    () => new Set((result?.data || []).filter((datum) => isDatumActive(datum, filters)).map((datum) => datum.key)),
    [result, filtersKey],
  );
  const rangeFilterOn = (field: string | undefined) =>
    field === undefined ? undefined : filters.find(
      (filter): filter is Extract<VisualFilter, { kind: 'range' }> =>
        filter.kind === 'range' && filter.field === field
        && filter.min !== undefined && filter.max !== undefined,
    );
  const ownRangeFilter = rangeFilterOn(chart.dimensionField);
  const brush = ownRangeFilter ? { min: ownRangeFilter.min!, max: ownRangeFilter.max! } : null;
  const yRangeFilter = chart.measureField === chart.dimensionField ? ownRangeFilter : rangeFilterOn(chart.measureField);
  const brush2D: Brush2D | null = chart.type === 'scatter' && ownRangeFilter && yRangeFilter
    ? { xMin: ownRangeFilter.min!, xMax: ownRangeFilter.max!, yMin: yRangeFilter.min!, yMax: yRangeFilter.max! }
    : null;
  const paletteColors = PALETTES.find((palette) => palette.id === chart.paletteId)?.colors || CATEGORICAL_PALETTE;
  const pointColor = chart.paletteId === 'categorical'
    ? paletteColors[0]
    : paletteColors[Math.min(paletteColors.length - 1, Math.floor(paletteColors.length * 0.75))];

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if ((!isTableChart && !layer) || !chart.dimensionField) {
        setResult(null);
        setScatter(null);
        setFacetResults(null);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        if (chart.type === 'scatter') {
          const nextScatter = isTableChart
            ? await queryTableScatter({ tableName: chart.tableName!, chart })
            : await queryLayerScatter({ layer: layer!, filters, chart });
          if (!cancelled) {
            setScatter(nextScatter);
            setResult(null);
            setFacetResults(null);
          }
        } else if (chart.facetField) {
          const values = await queryChartFacetValues({
            layer: isTableChart ? undefined : layer!,
            tableName: chart.tableName,
            facetField: chart.facetField,
          });
          const results = await Promise.all(values.map((value) => {
            const facet = { field: chart.facetField!, value };
            return isTableChart
              ? queryTableChart({ tableName: chart.tableName!, chart, facet })
              : queryLayerChart({ layer: layer!, filters, chart, facet });
          }));
          if (!cancelled) {
            setFacetResults(values.map((value, index) => ({ value, result: results[index] })));
            setResult(null);
            setScatter(null);
          }
        } else {
          const nextResult = isTableChart
            ? await queryTableChart({ tableName: chart.tableName!, chart })
            : await queryLayerChart({ layer: layer!, filters, chart });
          if (!cancelled) {
            setResult(nextResult);
            setScatter(null);
            setFacetResults(null);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Chart query failed');
          setResult(null);
          setScatter(null);
          setFacetResults(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [layer?.id, layer?.styleVersion, chart.tableName, filtersKey, chart.type, chart.dimensionField, chart.measureField, chart.aggregation, chart.paletteId, chart.maxCategories, chart.facetField]);

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
            {isTableChart ? `table · ${chart.tableName}` : layer?.name || 'Missing layer'}
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Source</span>
          <select
            value={isTableChart ? `table:${chart.tableName}` : `layer:${chart.layerId}`}
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith('layer:')) {
                const layerId = value.slice('layer:'.length);
                const nextLayer = layers.find((item) => item.id === layerId);
                const nextFields = fieldsForLayer(nextLayer);
                onUpdate({
                  layerId,
                  tableName: undefined,
                  dimensionField: nextFields[0]?.name || '',
                  measureField: numericFieldsForLayer(nextLayer)[0]?.name,
                });
              } else {
                // Fields load async; the schema effect fills the defaults in.
                onUpdate({
                  tableName: value.slice('table:'.length),
                  dimensionField: '',
                  measureField: undefined,
                });
              }
            }}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {layers.length > 0 && (
              <optgroup label="Layers (linked)">
                {layers.map((item) => (
                  <option key={item.id} value={`layer:${item.id}`}>{item.name}</option>
                ))}
              </optgroup>
            )}
            {tables.length > 0 && (
              <optgroup label="DuckDB tables">
                {tables.map((name) => (
                  <option key={name} value={`table:${name}`}>{name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
          <select
            value={chart.type}
            onChange={(event) => {
              const nextType = event.target.value as VisualChartType;
              onUpdate({
                type: nextType,
                ...(nextType === 'scatter'
                  ? { facetField: undefined, ...(chart.measureField ? {} : { measureField: numericFields[0]?.name }) }
                  : {}),
              });
            }}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {CHART_TYPES.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {chart.type === 'scatter' ? 'X field' : 'Dimension'}
          </span>
          <select
            value={chart.dimensionField}
            onChange={(event) => onUpdate({ dimensionField: event.target.value })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {availableFields.map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {chart.type === 'scatter' ? 'Y field' : 'Value'}
          </span>
          <select
            value={chart.type === 'scatter'
              ? chart.measureField || ''
              : chart.aggregation === 'count' ? '' : chart.measureField || ''}
            disabled={chart.type !== 'scatter' && chart.aggregation === 'count'}
            onChange={(event) => onUpdate({ measureField: event.target.value || undefined })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none disabled:bg-slate-100 disabled:text-slate-400"
          >
            {chart.type !== 'scatter' && <option value="">Rows</option>}
            {numericFields.map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aggregate</span>
          <select
            value={chart.aggregation}
            disabled={chart.type === 'scatter'}
            onChange={(event) => onUpdate({ aggregation: event.target.value as VisualChartAggregation })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
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

        {chart.type !== 'scatter' && (
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Facet by</span>
            <select
              value={chart.facetField || ''}
              onChange={(event) => onUpdate({ facetField: event.target.value || undefined })}
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
            >
              <option value="">None</option>
              {availableFields.map((field) => (
                <option key={field.name} value={field.name}>{field.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="p-3">
        {isLoading && !result && !scatter && !facetResults ? (
          <div className="flex h-36 items-center justify-center text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-rose-500">
            {error}
          </div>
        ) : chart.type === 'scatter' ? (
          !scatter || !scatter.points.length ? (
            <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-400">
              No numeric value pairs for these fields.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{isTableChart ? `${scatter.totalRows.toLocaleString()} rows` : `${scatter.filteredRows.toLocaleString()} active rows`}</span>
                <span>
                  {scatter.sampled && <span className="text-slate-300">sampled · </span>}
                  {!isTableChart && `${scatter.totalRows.toLocaleString()} total`}
                </span>
              </div>
              <ScatterChart
                result={scatter}
                color={pointColor}
                brush={brush2D}
                onBrush={onBrush2D}
                onClear={onClear2D}
              />
            </div>
          )
        ) : chart.facetField ? (
          !facetResults || !facetResults.length ? (
            <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-400">
              No facet values for this field.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(() => {
                const sharedMax = Math.max(
                  ...facetResults.flatMap((item) => item.result.data.map((datum) => datum.totalValue)),
                  1,
                );
                return facetResults.map(({ value, result: facetResult }) => {
                  const facetActiveKeys = new Set(
                    facetResult.data.filter((datum) => isDatumActive(datum, filters)).map((datum) => datum.key),
                  );
                  return (
                    <div key={value} className="rounded-md border border-slate-100 bg-white p-1.5">
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className="truncate text-[11px] font-semibold text-slate-600" title={value}>{value}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                          {facetResult.totalRows.toLocaleString()}
                        </span>
                      </div>
                      {!facetResult.data.length ? (
                        <div className="py-4 text-center text-[10px] text-slate-300">no values</div>
                      ) : chart.type === 'histogram' ? (
                        <Histogram
                          data={facetResult.data}
                          brush={brush}
                          maxScale={sharedMax}
                          onHover={onHoverDatum}
                          onLeave={onLeaveDatum}
                          onBrushRange={onBrushRange}
                          onClearRange={onClearRange}
                        />
                      ) : (
                        <Bars
                          data={facetResult.data}
                          activeKeys={facetActiveKeys}
                          maxScale={sharedMax}
                          onHover={onHoverDatum}
                          onLeave={onLeaveDatum}
                          onClick={onToggleFilter}
                        />
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )
        ) : !result || !result.data.length ? (
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-400">
            No chartable values for this field.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{isTableChart ? `${result.totalRows.toLocaleString()} rows` : `${result.filteredRows.toLocaleString()} active rows`}</span>
              <span>{!isTableChart && `${result.totalRows.toLocaleString()} total`}</span>
            </div>
            {chart.type === 'histogram' ? (
              <Histogram
                data={result.data}
                brush={brush}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onBrushRange={onBrushRange}
                onClearRange={onClearRange}
              />
            ) : chart.type === 'donut' || chart.type === 'rose' ? (
              <RadialChart
                data={result.data}
                type={chart.type}
                activeKeys={activeKeys}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onClick={onToggleFilter}
              />
            ) : (
              <Bars
                data={result.data}
                activeKeys={activeKeys}
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
  const [tables, setTables] = useState<string[]>([]);

  const [tablesRefreshTick, setTablesRefreshTick] = useState(0);

  // Workflow runs and SQL executions materialize new DuckDB tables; refresh
  // the source list when the panel (re)mounts, the workspace changes, or the
  // user asks via the refresh button.
  useEffect(() => {
    let cancelled = false;
    listChartTables()
      .then((names) => { if (!cancelled) setTables(names); })
      .catch(() => { if (!cancelled) setTables([]); });
    return () => { cancelled = true; };
  }, [mapLayers, charts.length, tablesRefreshTick]);

  const handleAddChart = () => {
    if (selectedLayer) {
      const nextChart = defaultChartForLayer(selectedLayer);
      if (nextChart) {
        addChart(nextChart);
        return;
      }
    }
    if (tables.length) {
      addChart({
        id: `chart-${Date.now()}`,
        title: `${tables[0]} distribution`,
        layerId: '',
        tableName: tables[0],
        type: 'bar',
        dimensionField: '',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      });
      return;
    }
    addToast({ type: 'warning', message: 'No chartable layers or tables available' });
  };

  const layerFilters = (layerId: string) => visualAnalytics.layers[layerId]?.filters || [];

  const toggleFilter = (chart: VisualChartSpec, datum: VisualChartDatum) => {
    if (chart.tableName) return; // table charts are unlinked views
    const currentFilters = layerFilters(chart.layerId);

    if (datum.filter.kind === 'category') {
      // Merge into one multi-value filter per field so several categories
      // combine as OR instead of contradictory ANDed single-value filters.
      const value = datum.filter.values[0];
      const existing = currentFilters.find(
        (filter): filter is Extract<VisualFilter, { kind: 'category' }> =>
          filter.kind === 'category' && filter.field === datum.filter.field,
      );
      if (!existing) {
        setLayerFilters(chart.layerId, [...currentFilters, datum.filter]);
        return;
      }
      const values = existing.values.includes(value)
        ? existing.values.filter((item) => item !== value)
        : [...existing.values, value];
      setLayerFilters(
        chart.layerId,
        values.length
          ? currentFilters.map((filter) => (filter === existing ? { ...existing, values } : filter))
          : currentFilters.filter((filter) => filter !== existing),
      );
      return;
    }

    const datumKey = visualChartFilterKey(datum.filter);
    const exists = currentFilters.some((filter) => visualChartFilterKey(filter) === datumKey);
    setLayerFilters(
      chart.layerId,
      exists
        ? currentFilters.filter((filter) => visualChartFilterKey(filter) !== datumKey)
        : [...currentFilters, datum.filter],
    );
  };

  const setRangeFilter = (chart: VisualChartSpec, min: number, max: number) => {
    if (chart.tableName) return;
    const rest = layerFilters(chart.layerId).filter(
      (filter) => !(filter.kind === 'range' && filter.field === chart.dimensionField),
    );
    setLayerFilters(chart.layerId, [...rest, { kind: 'range', field: chart.dimensionField, min, max }]);
  };

  const clearRangeFilter = (chart: VisualChartSpec) => {
    if (chart.tableName) return;
    setLayerFilters(
      chart.layerId,
      layerFilters(chart.layerId).filter(
        (filter) => !(filter.kind === 'range' && filter.field === chart.dimensionField),
      ),
    );
  };

  const scatterAxisFields = (chart: VisualChartSpec) =>
    new Set([chart.dimensionField, chart.measureField].filter((field): field is string => Boolean(field)));

  const setScatterBrush = (chart: VisualChartSpec, brush: Brush2D) => {
    if (chart.tableName) return;
    const axes = scatterAxisFields(chart);
    const rest = layerFilters(chart.layerId).filter(
      (filter) => !(filter.kind === 'range' && axes.has(filter.field)),
    );
    const next: VisualFilter[] = [
      ...rest,
      { kind: 'range', field: chart.dimensionField, min: brush.xMin, max: brush.xMax },
    ];
    if (chart.measureField && chart.measureField !== chart.dimensionField) {
      next.push({ kind: 'range', field: chart.measureField, min: brush.yMin, max: brush.yMax });
    }
    setLayerFilters(chart.layerId, next);
  };

  const clearScatterBrush = (chart: VisualChartSpec) => {
    if (chart.tableName) return;
    const axes = scatterAxisFields(chart);
    setLayerFilters(
      chart.layerId,
      layerFilters(chart.layerId).filter((filter) => !(filter.kind === 'range' && axes.has(filter.field))),
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
              Click marks to filter, drag histograms to brush. Grey bars show the unfiltered total.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTablesRefreshTick((tick) => tick + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              title="Refresh data sources (picks up new workflow and SQL tables)"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleAddChart}
              disabled={!hasChartableLayer && !tables.length}
              className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!mapLayers.length && !tables.length ? (
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
              const filters = chart.tableName ? [] : visualAnalytics.layers[chart.layerId]?.filters || [];
              return (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  layer={layer}
                  layers={mapLayers}
                  tables={tables}
                  filters={filters}
                  onUpdate={(patch) => updateChart(chart.id, patch)}
                  onRemove={() => removeChart(chart.id)}
                  onToggleFilter={(datum) => toggleFilter(chart, datum)}
                  onBrushRange={(min, max) => setRangeFilter(chart, min, max)}
                  onClearRange={() => clearRangeFilter(chart)}
                  onBrush2D={(brush) => setScatterBrush(chart, brush)}
                  onClear2D={() => clearScatterBrush(chart)}
                  onHoverDatum={(datum) => { if (!chart.tableName) setHighlightedFeatures(chart.layerId, datum.featureIds); }}
                  onLeaveDatum={() => { if (!chart.tableName) setHighlightedFeatures(chart.layerId, []); }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
