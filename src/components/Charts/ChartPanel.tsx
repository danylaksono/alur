import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Donut, FileImage, FileSpreadsheet, ImageDown, Loader2, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { useStore, type MapLayer } from '../../store/useStore';
import {
  describeChartTable,
  listChartTables,
  queryChartFacetValues,
  queryLayerChart,
  queryLayerScatter,
  queryLayerTemporalChart,
  queryTableChart,
  queryTableScatter,
  queryTableTemporalChart,
  visualChartFilterKey,
} from '../../services/visualAnalyticsService';
import { CATEGORICAL_PALETTE, SEQUENTIAL_PALETTES } from '../../utils/palettes';
import { cn } from '../../utils/cn';
import { buildDefaultChartForDataset } from '../../utils/analyticsCommands';
import { metadataForLayer } from '../../utils/datasetMetadata';
import { chartDatasetId, chartDatasetSource } from '../../utils/datasetSource';
import { buildChartCubes, sliceCube, type ChartCube } from '../../services/chartCubeService';
import { analyticsTableForLayer } from '../../services/visualAnalyticsService';
import { ensureStableTableDataset } from '../../services/datasetService';
import type { DatasetDescriptor } from '../../types/datasets';
import {
  downloadChartCsv,
  downloadChartPng,
  downloadChartSvg,
  type ChartExportData,
} from '../../services/chartExportService';
import type {
  VisualChartAggregation,
  VisualChartDatum,
  VisualChartResult,
  VisualChartSpec,
  VisualChartType,
  VisualFilter,
  VisualScatterResult,
  VisualTemporalResult,
  TimeGrain,
} from '../../types/visualAnalytics';

const EXCLUDED_FIELDS = new Set(['geojson', 'geometry', 'geom', 'wkb_geometry', '__alur_tile_geom', '_alur_feature_id']);

/** Types that read a numeric column directly rather than aggregating it. */
const usesRawMeasure = (type: VisualChartType) =>
  type === 'scatter' || type === 'box' || type === 'violin';

const CHART_TYPES: Array<{ id: VisualChartType; label: string }> = [
  { id: 'bar', label: 'Bar' },
  { id: 'donut', label: 'Donut' },
  { id: 'rose', label: 'Rose' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'box', label: 'Box plot' },
  { id: 'violin', label: 'Violin' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
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

const isTemporalType = (type: string) =>
  ['date', 'time', 'timestamp'].some((item) => type.toLowerCase().includes(item));

const isTemporalChart = (type: VisualChartType): type is 'line' | 'area' => type === 'line' || type === 'area';

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

/**
 * Horizontal box plots, one row per category, on a shared scale.
 *
 * The scale is shared deliberately: the whole reason to draw boxes rather than
 * a bar of means is to compare spread between groups, and per-row scales would
 * make every group look alike. Whiskers are Tukey, so a mark drawn beyond one
 * is an observation outside 1.5 IQR rather than the end of the data.
 */
const BoxPlot = ({
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
  const summaries = data.filter((datum) => datum.distribution);
  if (!summaries.length) {
    return <div className="py-4 text-center text-[11px] text-slate-500">no distribution</div>;
  }
  const low = Math.min(...summaries.map((d) => d.distribution!.min));
  const high = Math.max(...summaries.map((d) => d.distribution!.max));
  const span = high - low || 1;
  const pct = (value: number) => ((value - low) / span) * 100;
  const format = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-1.5">
      {summaries.map((datum) => {
        const d = datum.distribution!;
        const active = activeKeys.has(datum.key);
        return (
          <button
            key={datum.key}
            type="button"
            onMouseEnter={() => onHover(datum)}
            onMouseLeave={onLeave}
            onFocus={() => onHover(datum)}
            onBlur={onLeave}
            onClick={() => onClick(datum)}
            title={`${datum.label} — median ${format(d.median)}, IQR ${format(d.q1)}–${format(d.q3)}, range ${format(d.min)}–${format(d.max)} (${datum.count.toLocaleString()} rows)`}
            className={cn(
              'pressable block w-full rounded-sm px-px text-left outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
              active ? 'opacity-100' : 'opacity-90 hover:opacity-100',
            )}
          >
            <span className="flex items-baseline justify-between gap-2 text-[11px] text-slate-600">
              <span className="truncate font-medium">{datum.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-slate-500">{format(d.median)}</span>
            </span>
            <span className="relative mt-1 block h-5">
              {/* Whisker span */}
              <span
                className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-400"
                style={{ left: `${pct(d.lower)}%`, width: `${Math.max(pct(d.upper) - pct(d.lower), 0.5)}%` }}
              />
              {/* Whisker caps */}
              {[d.lower, d.upper].map((value, i) => (
                <span
                  key={i}
                  className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-slate-400"
                  style={{ left: `${pct(value)}%` }}
                />
              ))}
              {/* Outlier reach: where the data goes past the fence */}
              {d.min < d.lower && (
                <span className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-slate-400" style={{ left: `${pct(d.min)}%` }} />
              )}
              {d.max > d.upper && (
                <span className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-slate-400" style={{ left: `${pct(d.max)}%` }} />
              )}
              {/* The box: the middle half of the data */}
              <span
                className={cn('absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border', active ? 'border-slate-900' : 'border-transparent')}
                style={{
                  left: `${pct(d.q1)}%`,
                  width: `${Math.max(pct(d.q3) - pct(d.q1), 0.75)}%`,
                  backgroundColor: datum.color,
                }}
              />
              {/* Median */}
              <span
                className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-white mix-blend-difference"
                style={{ left: `${pct(d.median)}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Violins: the same rows as a box plot, with the shape drawn instead of the
 * quartiles. Each group is normalised to its own widest bin, so the outline
 * says where a group's values concentrate rather than how many rows it has —
 * a group with a tenth of the data still shows its shape. The median stays,
 * because a shape without a location is hard to compare across rows.
 */
const Violins = ({
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
  const shapes = data.filter((datum) => datum.distribution && datum.density?.length);
  if (!shapes.length) {
    return <div className="py-4 text-center text-[11px] text-slate-500">no distribution</div>;
  }
  const low = Math.min(...shapes.map((d) => d.distribution!.min));
  const high = Math.max(...shapes.map((d) => d.distribution!.max));
  const span = high - low || 1;
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-1.5">
      {shapes.map((datum) => {
        const d = datum.distribution!;
        const bins = datum.density!;
        const peak = Math.max(...bins, 1);
        const active = activeKeys.has(datum.key);
        // Bin i covers an equal slice of [low, high]; its centre is the x, and
        // half the normalised count is the distance from the midline.
        const x = (i: number) => ((i + 0.5) / bins.length) * 100;
        const y = (count: number) => (count / peak) * 45;
        const top = bins.map((c, i) => `${x(i)},${50 - y(c)}`).join(' ');
        const bottom = bins.map((c, i) => `${x(i)},${50 + y(c)}`).reverse().join(' ');

        return (
          <button
            key={datum.key}
            type="button"
            onMouseEnter={() => onHover(datum)}
            onMouseLeave={onLeave}
            onFocus={() => onHover(datum)}
            onBlur={onLeave}
            onClick={() => onClick(datum)}
            title={`${datum.label} — median ${format(d.median)}, IQR ${format(d.q1)}–${format(d.q3)}, range ${format(d.min)}–${format(d.max)} (${datum.count.toLocaleString()} rows)`}
            className={cn(
              'pressable block w-full rounded-sm px-px text-left outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
              active ? 'opacity-100' : 'opacity-90 hover:opacity-100',
            )}
          >
            <span className="flex items-baseline justify-between gap-2 text-[11px] text-slate-600">
              <span className="truncate font-medium">{datum.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-slate-500">{format(d.median)}</span>
            </span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-1 block h-8 w-full" aria-hidden="true">
              <polygon
                points={`${top} ${bottom}`}
                fill={datum.color}
                stroke={active ? '#0f172a' : 'none'}
                strokeWidth={active ? 1 : 0}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={((d.median - low) / span) * 100}
                x2={((d.median - low) / span) * 100}
                y1={8}
                y2={92}
                stroke="#0f172a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
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
              'pressable grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-50',
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
                <span className="text-slate-500"> /{formatNumber(datum.totalValue)}</span>
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
  onLiveBrushStart,
  onLiveBrush,
  onLiveBrushEnd,
}: {
  data: VisualChartDatum[];
  brush: BrushRange | null;
  /** Shared scale across small multiples; defaults to this chart's own max. */
  maxScale?: number;
  onHover: (datum: VisualChartDatum) => void;
  onLeave: () => void;
  onBrushRange: (min: number, max: number) => void;
  onClearRange: () => void;
  /** Fired while dragging, so other charts can follow before the brush lands. */
  onLiveBrushStart?: () => void;
  onLiveBrush?: (min: number, max: number) => void;
  onLiveBrushEnd?: () => void;
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
    // Kick the cube build off now: it runs while the pointer is still down, and
    // the preview simply starts once it lands.
    onLiveBrushStart?.();
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (drag) {
      const current = pointerX(event);
      setDrag({ start: drag.start, current });
      const first = data[binIndexAt(Math.min(drag.start, current))];
      const last = data[binIndexAt(Math.max(drag.start, current))];
      if (first?.filter.kind === 'range' && last?.filter.kind === 'range') {
        onLiveBrush?.(first.filter.min ?? 0, last.filter.max ?? 0);
      }
      return;
    }
    onHover(data[binIndexAt(pointerX(event))]);
  };

  const handlePointerUp = (_event: React.PointerEvent) => {
    // The exact numbers come from the ordinary query the commit triggers, so
    // the estimate is dropped the moment the drag ends.
    onLiveBrushEnd?.();
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
            className="pressable flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-600"
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
        role="img"
        tabIndex={0}
        aria-label={`Histogram with ${data.length} bins. Use left and right arrow keys to select a bin; Escape clears the range.`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { onClearRange(); return; }
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const current = brush ? bins.findIndex((bin) => bin.min === brush.min && bin.max === brush.max) : -1;
          const next = current < 0 ? 0 : Math.max(0, Math.min(bins.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
          const bin = bins[next];
          if (bin?.min !== undefined && bin?.max !== undefined) onBrushRange(bin.min, bin.max);
        }}
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
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-500">
        <span>{formatNumber(domainMin)}</span>
        <span className="text-slate-500">drag to brush</span>
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
            className="pressable flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
            Clear selection
          </button>
        </div>
      )}
      <div className="flex gap-1.5">
        <div className="flex select-none flex-col justify-between py-0.5 text-right text-[11px] tabular-nums text-slate-500">
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
      <div className="mt-1 flex items-center justify-between pl-6 text-[11px] tabular-nums text-slate-500">
        <span>{formatNumber(result.xMin)}</span>
        <span className="text-slate-500">drag to select</span>
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
            className="pressable flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50"
            title={datum.label}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: datum.color }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{datum.label}</span>
            <span className="text-[11px] tabular-nums">
              <span className="font-bold text-slate-700">{formatNumber(datum.value)}</span>
              {datum.value !== datum.totalValue && (
                <span className="text-slate-500"> /{formatNumber(datum.totalValue)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const TEMPORAL_WIDTH = 300;
const TEMPORAL_HEIGHT = 142;
const TEMPORAL_PADDING = { top: 10, right: 8, bottom: 22, left: 34 };

const TemporalChart = ({
  result,
  type,
  showPoints,
  connectMissing,
  brush,
  onBrush,
  onClear,
}: {
  result: VisualTemporalResult;
  type: 'line' | 'area';
  showPoints: boolean;
  connectMissing: boolean;
  brush: { start: string; end: string } | null;
  onBrush: (start: string, end: string) => void;
  onClear: () => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(null);
  const [active, setActive] = useState<{ series: string; point: VisualTemporalResult['series'][number]['points'][number] } | null>(null);
  const points = result.series[0]?.points || [];
  const plotWidth = TEMPORAL_WIDTH - TEMPORAL_PADDING.left - TEMPORAL_PADDING.right;
  const plotHeight = TEMPORAL_HEIGHT - TEMPORAL_PADDING.top - TEMPORAL_PADDING.bottom;
  const values = result.series.flatMap((series) => series.points.flatMap((point) => [point.value, point.totalValue])).filter((value): value is number => value !== null && Number.isFinite(value));
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(1, ...values);
  const ySpan = yMax - yMin || 1;
  const xAt = (index: number) => TEMPORAL_PADDING.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number) => TEMPORAL_PADDING.top + (1 - (value - yMin) / ySpan) * plotHeight;
  const indexAtPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return 0;
    const x = ((event.clientX - rect.left) / rect.width) * TEMPORAL_WIDTH;
    return Math.max(0, Math.min(points.length - 1, Math.round(((x - TEMPORAL_PADDING.left) / plotWidth) * Math.max(1, points.length - 1))));
  };
  const lineSegments = (seriesPoints: typeof points, key: 'value' | 'totalValue') => {
    const source = connectMissing ? seriesPoints.filter((point) => point[key] !== null) : seriesPoints;
    const segments: Array<Array<{ index: number; value: number }>> = [];
    let segment: Array<{ index: number; value: number }> = [];
    source.forEach((point) => {
      const originalIndex = seriesPoints.indexOf(point);
      const value = point[key];
      if (value === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else {
        segment.push({ index: originalIndex, value });
      }
    });
    if (segment.length) segments.push(segment);
    return segments;
  };
  const pathFor = (segment: Array<{ index: number; value: number }>) => segment
    .map((point, index) => `${index ? 'L' : 'M'} ${xAt(point.index)} ${yAt(point.value)}`)
    .join(' ');
  const brushIndexes = brush && points.length ? [
    points.findIndex((point) => point.bucketStart === brush.start),
    points.findIndex((point) => point.bucketEnd === brush.end),
  ] : null;
  const dragBounds = drag ? [Math.min(drag.start, drag.current), Math.max(drag.start, drag.current)] : null;
  const selectedBounds = dragBounds || (brushIndexes && brushIndexes.every((index) => index >= 0) ? brushIndexes : null);
  const contextVisible = result.filteredRows !== result.totalRows;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Series legend">
        {result.series.map((series) => (
          <span key={series.key} className="inline-flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: series.color }} />
            <span className="max-w-28 truncate" title={series.label}>{series.label}</span>
          </span>
        ))}
        {result.hasOtherSeries && <span className="text-[11px] text-slate-500">remaining series grouped as Other</span>}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${TEMPORAL_WIDTH} ${TEMPORAL_HEIGHT}`}
        className="h-40 w-full touch-none overflow-visible rounded-md border border-slate-100 bg-white outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        role="img"
        tabIndex={0}
        aria-label={`${type === 'area' ? 'Area' : 'Line'} chart from ${points[0]?.label || 'no date'} to ${points.at(-1)?.label || 'no date'}. Drag horizontally to filter time.`}
        onPointerDown={(event) => {
          if (!points.length) return;
          const index = indexAtPointer(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ start: index, current: index });
        }}
        onPointerMove={(event) => setDrag((current) => current ? { ...current, current: indexAtPointer(event) } : current)}
        onPointerUp={(event) => {
          if (!drag || !points.length) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          const from = Math.min(drag.start, drag.current);
          const to = Math.max(drag.start, drag.current);
          onBrush(points[from].bucketStart, points[to].bucketEnd);
          setDrag(null);
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Delete' || event.key === 'Backspace') && brush) {
            event.preventDefault();
            onClear();
          }
        }}
      >
        {[0, 0.5, 1].map((fraction) => {
          const value = yMax - ySpan * fraction;
          const y = TEMPORAL_PADDING.top + plotHeight * fraction;
          return <g key={fraction}><line x1={TEMPORAL_PADDING.left} x2={TEMPORAL_WIDTH - TEMPORAL_PADDING.right} y1={y} y2={y} stroke="#e2e8f0" /><text x={TEMPORAL_PADDING.left - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{formatNumber(value)}</text></g>;
        })}
        {selectedBounds && (
          <rect
            x={xAt(selectedBounds[0]) - (points.length > 1 ? plotWidth / (points.length - 1) / 2 : 4)}
            y={TEMPORAL_PADDING.top}
            width={Math.max(8, xAt(selectedBounds[1]) - xAt(selectedBounds[0]) + (points.length > 1 ? plotWidth / (points.length - 1) : 8))}
            height={plotHeight}
            fill="#bae6fd"
            opacity="0.45"
          />
        )}
        {result.series.map((series) => (
          <g key={series.key}>
            {contextVisible && lineSegments(series.points, 'totalValue').map((segment, index) => (
              <path key={`total-${index}`} d={pathFor(segment)} fill="none" stroke={series.color} strokeWidth="1.25" strokeDasharray="3 3" opacity="0.35" />
            ))}
            {lineSegments(series.points, 'value').map((segment, index) => {
              const line = pathFor(segment);
              const area = `${line} L ${xAt(segment.at(-1)!.index)} ${yAt(0)} L ${xAt(segment[0].index)} ${yAt(0)} Z`;
              return type === 'area'
                ? <g key={index}><path d={area} fill={series.color} opacity="0.14" /><path d={line} fill="none" stroke={series.color} strokeWidth="2" /></g>
                : <path key={index} d={line} fill="none" stroke={series.color} strokeWidth="2" />;
            })}
            {series.points.map((point, index) => point.value !== null && (showPoints || points.length === 1) ? (
              <circle
                key={point.bucketStart}
                cx={xAt(index)}
                cy={yAt(point.value)}
                r="2.75"
                fill="white"
                stroke={series.color}
                strokeWidth="1.75"
                tabIndex={0}
                role="button"
                aria-label={`${series.label}, ${point.label}: ${formatNumber(point.value)}`}
                onMouseEnter={() => setActive({ series: series.label, point })}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive({ series: series.label, point })}
                onBlur={() => setActive(null)}
              />
            ) : null)}
          </g>
        ))}
        <text x={TEMPORAL_PADDING.left} y={TEMPORAL_HEIGHT - 5} fontSize="8" fill="#94a3b8">{points[0]?.label}</text>
        <text x={TEMPORAL_WIDTH - TEMPORAL_PADDING.right} y={TEMPORAL_HEIGHT - 5} textAnchor="end" fontSize="8" fill="#94a3b8">{points.at(-1)?.label}</text>
      </svg>
      <div className="flex min-h-5 items-center justify-between gap-2 text-[11px] text-slate-500" aria-live="polite">
        <span className="truncate">{active ? `${active.series} · ${active.point.label}: ${formatNumber(active.point.value ?? 0)} (${active.point.count.toLocaleString()} rows)` : 'Drag across periods to filter · focus a point for details'}</span>
        {brush && <button type="button" onClick={onClear} className="pressable shrink-0 rounded px-1.5 py-0.5 font-semibold text-sky-700 hover:bg-sky-50">Reset time</button>}
      </div>
      <details className="rounded-md border border-slate-100 bg-slate-50/70 text-[11px] text-slate-500">
        <summary className="cursor-pointer px-2 py-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Accessible data table</summary>
        <div className="max-h-48 overflow-auto border-t border-slate-100">
          <table className="w-full border-collapse text-left tabular-nums">
            <thead className="sticky top-0 bg-slate-100"><tr><th className="px-2 py-1">Period</th><th className="px-2 py-1">Series</th><th className="px-2 py-1 text-right">Value</th><th className="px-2 py-1 text-right">Rows</th></tr></thead>
            <tbody>{result.series.flatMap((series) => series.points.map((point) => (
              <tr key={`${series.key}-${point.bucketStart}`} className="border-t border-slate-100"><td className="px-2 py-1">{point.label}</td><td className="px-2 py-1">{series.label}</td><td className="px-2 py-1 text-right">{point.value === null ? 'Missing' : formatNumber(point.value)}</td><td className="px-2 py-1 text-right">{point.count.toLocaleString()}</td></tr>
            )))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

const ChartCard = ({
  chart,
  layer,
  layers,
  tables,
  tableDatasets,
  filters,
  selectedFeatureIds,
  onUpdate,
  onRemove,
  onToggleFilter,
  onBrushRange,
  onClearRange,
  onBrush2D,
  onClear2D,
  onBrushTemporal,
  onClearTemporal,
  onHoverDatum,
  onLeaveDatum,
  previewCounts,
  onLiveBrushStart,
  onLiveBrush,
  onLiveBrushEnd,
}: {
  chart: VisualChartSpec;
  layer: MapLayer | undefined;
  layers: MapLayer[];
  tables: string[];
  tableDatasets: DatasetDescriptor[];
  filters: VisualFilter[];
  selectedFeatureIds: string[];
  onUpdate: (patch: Partial<Omit<VisualChartSpec, 'id'>>) => void;
  onRemove: () => void;
  onToggleFilter: (datum: VisualChartDatum) => void;
  onBrushRange: (min: number, max: number) => void;
  onClearRange: () => void;
  onBrush2D: (brush: Brush2D) => void;
  onClear2D: () => void;
  onBrushTemporal: (start: string, end: string) => void;
  onClearTemporal: () => void;
  onHoverDatum: (datum: VisualChartDatum) => void;
  /** Estimated bar counts while another chart is being brushed, one per bin. */
  previewCounts?: number[] | null;
  onLiveBrushStart?: () => void;
  onLiveBrush?: (min: number, max: number) => void;
  onLiveBrushEnd?: () => void;
  onLeaveDatum: () => void;
}) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const addToast = useStore((state) => state.addToast);
  const [result, setResult] = useState<VisualChartResult | null>(null);
  const [scatter, setScatter] = useState<VisualScatterResult | null>(null);
  const [temporal, setTemporal] = useState<VisualTemporalResult | null>(null);
  const [facetResults, setFacetResults] = useState<Array<{ value: string; result: VisualChartResult }> | null>(null);
  const [tableFields, setTableFields] = useState<ChartField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const datasetSource = chartDatasetSource(chart);
  const datasetId = chartDatasetId(chart);
  const datasetDescriptor = useStore((state) => state.datasetRegistry[datasetId]);
  const registerDataset = useStore((state) => state.registerDataset);
  const tableName = datasetSource.kind === 'table'
    ? datasetSource.tableName
    : datasetSource.kind === 'workflow-node'
      ? datasetDescriptor?.relationName
      : undefined;
  const rowIdColumn = datasetSource.kind === 'layer' ? undefined : datasetDescriptor?.rowIdColumn;
  const isTableChart = datasetSource.kind !== 'layer';
  const availableFields = isTableChart ? tableFields : fieldsForLayer(layer);
  const typedNumericFields = availableFields.filter((field) => isNumericType(field.type));
  const numericFields = typedNumericFields.length ? typedNumericFields : availableFields;
  const temporalFields = availableFields.filter((field) => isTemporalType(field.type));
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!tableName) {
      setTableFields([]);
      return;
    }
    let cancelled = false;
    describeChartTable(tableName)
      .then((fields) => { if (!cancelled) setTableFields(filterChartFields(fields)); })
      .catch(() => { if (!cancelled) setTableFields([]); });
    return () => { cancelled = true; };
  }, [tableName]);

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
    () => {
      const selected = new Set(selectedFeatureIds);
      return new Set((result?.data || []).filter((datum) => isDatumActive(datum, filters) || datum.featureIds.some((id) => selected.has(id))).map((datum) => datum.key));
    },
    [result, filtersKey, selectedFeatureIds],
  );
  const rangeFilterOn = (field: string | undefined) =>
    field === undefined ? undefined : filters.find(
      (filter): filter is Extract<VisualFilter, { kind: 'range' }> =>
        filter.kind === 'range' && filter.field === field
        && filter.min !== undefined && filter.max !== undefined,
    );
  const ownRangeFilter = rangeFilterOn(chart.dimensionField);
  const brush = ownRangeFilter ? { min: ownRangeFilter.min!, max: ownRangeFilter.max! } : null;

  /**
   * The estimate, laid over this chart's own bars while another chart is being
   * dragged. Bar for bar — the cube was built with this chart's bin count, so a
   * mismatched length means something is out of step and the estimate is
   * dropped rather than drawn against the wrong bins.
   */
  const previewData = useMemo(() => {
    if (!previewCounts || !result || previewCounts.length !== result.data.length) return null;
    return result.data.map((datum, index) => ({
      ...datum,
      value: previewCounts[index],
      count: previewCounts[index],
    }));
  }, [previewCounts, result]);
  const yRangeFilter = chart.measureField === chart.dimensionField ? ownRangeFilter : rangeFilterOn(chart.measureField);
  const brush2D: Brush2D | null = chart.type === 'scatter' && ownRangeFilter && yRangeFilter
    ? { xMin: ownRangeFilter.min!, xMax: ownRangeFilter.max!, yMin: yRangeFilter.min!, yMax: yRangeFilter.max! }
    : null;
  const temporalFilter = filters.find(
    (filter): filter is Extract<VisualFilter, { kind: 'temporal' }> =>
      filter.kind === 'temporal' && filter.field === chart.dimensionField && Boolean(filter.start && filter.end),
  );
  const temporalBrush = temporalFilter ? { start: temporalFilter.start!, end: temporalFilter.end! } : null;
  const paletteColors = PALETTES.find((palette) => palette.id === chart.paletteId)?.colors || CATEGORICAL_PALETTE;
  const pointColor = chart.paletteId === 'categorical'
    ? paletteColors[0]
    : paletteColors[Math.min(paletteColors.length - 1, Math.floor(paletteColors.length * 0.75))];

  const exportData = useMemo<ChartExportData | null>(() => {
    if (temporal) return { kind: 'temporal', result: temporal };
    if (scatter) return { kind: 'scatter', result: scatter };
    if (facetResults) return { kind: 'facets', results: facetResults };
    if (result) return { kind: 'aggregate', result };
    return null;
  }, [facetResults, result, scatter, temporal]);

  const exportChartData = () => {
    if (!exportData) return;
    try {
      downloadChartCsv(chart, filters, exportData);
      addToast({ type: 'success', message: `Exported plotted data for ${chart.title}` });
    } catch (exportError: any) {
      addToast({ type: 'error', message: `Chart data export failed: ${exportError?.message || 'Unknown error'}` });
    }
  };

  const exportChartImage = async (format: 'svg' | 'png') => {
    if (!cardRef.current) return;
    try {
      if (format === 'svg') downloadChartSvg(cardRef.current, chart, filters);
      else await downloadChartPng(cardRef.current, chart, filters);
      addToast({ type: 'success', message: `Exported ${chart.title} as ${format.toUpperCase()}` });
    } catch (exportError: any) {
      addToast({ type: 'error', message: exportError?.message || `Chart ${format.toUpperCase()} export failed` });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if ((isTableChart && !tableName) || (!isTableChart && !layer) || !chart.dimensionField) {
        setResult(null);
        setScatter(null);
        setTemporal(null);
        setFacetResults(null);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        if (chart.type === 'scatter') {
          const nextScatter = isTableChart
            ? await queryTableScatter({ tableName: tableName!, filters, chart })
            : await queryLayerScatter({ layer: layer!, filters, chart });
          if (!cancelled) {
            setScatter(nextScatter);
            setResult(null);
            setTemporal(null);
            setFacetResults(null);
          }
        } else if (isTemporalChart(chart.type)) {
          const nextTemporal = isTableChart
            ? await queryTableTemporalChart({ tableName: tableName!, filters, chart })
            : await queryLayerTemporalChart({ layer: layer!, filters, chart });
          if (!cancelled) {
            setTemporal(nextTemporal);
            setResult(null);
            setScatter(null);
            setFacetResults(null);
          }
        } else if (chart.facetField) {
          const values = await queryChartFacetValues({
            layer: isTableChart ? undefined : layer!,
            tableName,
            facetField: chart.facetField,
          });
          const results = await Promise.all(values.map((value) => {
            const facet = { field: chart.facetField!, value };
            return isTableChart
              ? queryTableChart({ tableName: tableName!, rowIdColumn, filters, chart, facet })
              : queryLayerChart({ layer: layer!, filters, chart, facet });
          }));
          if (!cancelled) {
            setFacetResults(values.map((value, index) => ({ value, result: results[index] })));
            setResult(null);
            setScatter(null);
            setTemporal(null);
          }
        } else {
          const nextResult = isTableChart
            ? await queryTableChart({ tableName: tableName!, rowIdColumn, filters, chart })
            : await queryLayerChart({ layer: layer!, filters, chart });
          if (!cancelled) {
            setResult(nextResult);
            setScatter(null);
            setTemporal(null);
            setFacetResults(null);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Chart query failed');
          setResult(null);
          setScatter(null);
          setTemporal(null);
          setFacetResults(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [layer?.id, layer?.styleVersion, tableName, rowIdColumn, filtersKey, chart.type, chart.dimensionField, chart.measureField, chart.aggregation, chart.paletteId, chart.maxCategories, chart.facetField, chart.timeGrain, chart.seriesField]);

  return (
    <section ref={cardRef} className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <input
            value={chart.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            className="w-full truncate bg-transparent text-[11px] font-semibold uppercase tracking-wide text-slate-700 outline-none"
          />
          <div className="truncate text-[11px] text-slate-500">
            {isTableChart
              ? `${datasetSource.kind === 'workflow-node' ? 'workflow' : 'table'} · ${datasetDescriptor?.name || tableName || 'Missing relation'}${datasetDescriptor ? ` · ID ${datasetDescriptor.rowIdColumn} (${datasetDescriptor.rowIdQuality === 'validated-unique' ? 'validated' : 'materialised'})` : ''}`
              : layer?.name || 'Missing layer'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={exportChartData}
            disabled={!exportData}
            className="pressable rounded-md p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="Export the plotted values and filter provenance as CSV"
            aria-label={`Export plotted data for ${chart.title} as CSV`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { void exportChartImage('svg'); }}
            disabled={!exportData}
            className="pressable rounded-md p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="Export the rendered chart as SVG (SVG charts only)"
            aria-label={`Export ${chart.title} as SVG`}
          >
            <FileImage className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { void exportChartImage('png'); }}
            disabled={!exportData}
            className="pressable rounded-md p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="Export the rendered chart as PNG (canvas or SVG charts)"
            aria-label={`Export ${chart.title} as PNG`}
          >
            <ImageDown className="h-3.5 w-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
          <button
            type="button"
            onClick={onRemove}
            className="pressable rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            title="Remove chart"
            aria-label={`Remove ${chart.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b p-3">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
          <select
            value={isTableChart && datasetDescriptor ? `dataset:${datasetDescriptor.id}` : isTableChart ? `table:${tableName || ''}` : `layer:${datasetSource.layerId}`}
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith('layer:')) {
                const layerId = value.slice('layer:'.length);
                const nextLayer = layers.find((item) => item.id === layerId);
                const nextFields = fieldsForLayer(nextLayer);
                onUpdate({
                  layerId,
                  tableName: undefined,
                  source: { kind: 'layer', layerId },
                  dimensionField: nextFields[0]?.name || '',
                  measureField: numericFieldsForLayer(nextLayer)[0]?.name,
                });
              } else if (value.startsWith('dataset:')) {
                const dataset = tableDatasets.find((item) => item.id === value.slice('dataset:'.length));
                if (!dataset) return;
                onUpdate({ source: dataset.source, layerId: '', tableName: dataset.relationName, dimensionField: '', measureField: undefined });
              } else {
                // Fields load async; the schema effect fills the defaults in.
                const selectedTableName = value.slice('table:'.length);
                void ensureStableTableDataset({ tableName: selectedTableName }).then((dataset) => {
                  registerDataset(dataset);
                  onUpdate({
                    source: dataset.source,
                    layerId: '',
                    tableName: dataset.relationName || selectedTableName,
                    dimensionField: '',
                    measureField: undefined,
                  });
                }).catch((sourceError: any) => {
                  addToast({ type: 'error', message: `Could not link table: ${sourceError?.message || 'Unknown error'}` });
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
                {tableName && !tables.includes(tableName) && <option value={`table:${tableName}`}>{datasetDescriptor?.name || tableName}</option>}
                {tables.map((name) => (
                  <option key={name} value={`table:${name}`}>{name}</option>
                ))}
              </optgroup>
            )}
            {tableDatasets.length > 0 && (
              <optgroup label="Linked datasets">
                {tableDatasets.map((dataset) => <option key={dataset.id} value={`dataset:${dataset.id}`}>{dataset.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</span>
          <select
            value={chart.type}
            onChange={(event) => {
              const nextType = event.target.value as VisualChartType;
              onUpdate({
                type: nextType,
                ...(usesRawMeasure(nextType)
                  ? { facetField: undefined, ...(chart.measureField ? {} : { measureField: numericFields[0]?.name }) }
                  : isTemporalChart(nextType)
                    ? { facetField: undefined, dimensionField: temporalFields[0]?.name || chart.dimensionField, timeGrain: chart.timeGrain || 'auto' }
                    : { seriesField: undefined }),
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {chart.type === 'scatter' ? 'X field' : isTemporalChart(chart.type) ? 'Date / time' : 'Dimension'}
          </span>
          <select
            value={chart.dimensionField}
            onChange={(event) => onUpdate({ dimensionField: event.target.value })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400"
          >
            {(isTemporalChart(chart.type) && temporalFields.length ? temporalFields : availableFields).map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {chart.type === 'scatter' ? 'Y field' : 'Value'}
          </span>
          <select
            value={usesRawMeasure(chart.type)
              ? chart.measureField || ''
              : chart.aggregation === 'count' ? '' : chart.measureField || ''}
            disabled={!usesRawMeasure(chart.type) && chart.aggregation === 'count'}
            onChange={(event) => onUpdate({ measureField: event.target.value || undefined })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none disabled:bg-slate-100 disabled:text-slate-400"
          >
            {!usesRawMeasure(chart.type) && <option value="">Rows</option>}
            {numericFields.map((field) => (
              <option key={field.name} value={field.name}>{field.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Aggregate</span>
          <select
            value={chart.aggregation}
            disabled={usesRawMeasure(chart.type)}
            onChange={(event) => onUpdate({ aggregation: event.target.value as VisualChartAggregation })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
          >
            {AGGREGATIONS.map((aggregation) => (
              <option key={aggregation.id} value={aggregation.id}>{aggregation.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Palette</span>
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

        {chart.type !== 'scatter' && !isTemporalChart(chart.type) && (
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Facet by</span>
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

        {isTemporalChart(chart.type) && (
          <>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time grain</span>
              <select value={chart.timeGrain || 'auto'} onChange={(event) => onUpdate({ timeGrain: event.target.value as TimeGrain })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400">
                <option value="auto">Auto</option>
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Series</span>
              <select value={chart.seriesField || ''} onChange={(event) => onUpdate({ seriesField: event.target.value || undefined })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-slate-400">
                <option value="">Single series</option>
                {availableFields.filter((field) => field.name !== chart.dimensionField).map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <input type="checkbox" checked={chart.showPoints ?? true} onChange={(event) => onUpdate({ showPoints: event.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-sky-600" /> Show points
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-slate-500" title="Off by default so periods without observations remain visible as gaps">
              <input type="checkbox" checked={Boolean(chart.connectMissing)} onChange={(event) => onUpdate({ connectMissing: event.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-sky-600" /> Connect missing periods
            </label>
          </>
        )}
        {result && result.data.length > 0 && (
          <details className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
            <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">Accessible data table</summary>
            <div className="mt-2 max-h-40 overflow-auto">
              <table className="w-full text-left text-[11px] text-slate-600">
                <caption className="sr-only">Values plotted in {chart.title}</caption>
                <thead><tr><th scope="col" className="py-1">{chart.dimensionField}</th><th scope="col" className="py-1 text-right">Active</th><th scope="col" className="py-1 text-right">Total</th></tr></thead>
                <tbody>{result.data.map((datum) => <tr key={datum.key} className="border-t border-slate-200"><th scope="row" className="py-1 font-medium">{datum.label}</th><td className="py-1 text-right tabular-nums">{formatNumber(datum.value)}</td><td className="py-1 text-right tabular-nums">{formatNumber(datum.totalValue)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <div className="p-3">
        {isLoading && !result && !scatter && !temporal && !facetResults ? (
          <div className="flex h-36 items-center justify-center text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-rose-500">
            {error}
          </div>
        ) : isTemporalChart(chart.type) ? (
          !temporal || !temporal.series.some((series) => series.points.some((point) => point.value !== null)) ? (
            <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-500">
              No valid temporal values for this field and aggregation.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>{chart.aggregation} · {temporal.grain} grain</span>
                <span>{temporal.filteredRows.toLocaleString()} active / {temporal.totalRows.toLocaleString()} total</span>
              </div>
              <TemporalChart
                result={temporal}
                type={chart.type}
                showPoints={chart.showPoints ?? true}
                connectMissing={Boolean(chart.connectMissing)}
                brush={temporalBrush}
                onBrush={onBrushTemporal}
                onClear={onClearTemporal}
              />
            </div>
          )
        ) : chart.type === 'scatter' ? (
          !scatter || !scatter.points.length ? (
            <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-500">
              No numeric value pairs for these fields.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{scatter.filteredRows.toLocaleString()} active rows</span>
                <span>
                  {scatter.sampled && <span className="text-slate-500">sampled · </span>}
                  {scatter.totalRows.toLocaleString()} total
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
            <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-500">
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
                    facetResult.data.filter((datum) => isDatumActive(datum, filters) || datum.featureIds.some((id) => selectedFeatureIds.includes(id))).map((datum) => datum.key),
                  );
                  return (
                    <div key={value} className="rounded-md border border-slate-100 bg-white p-1.5">
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className="truncate text-[11px] font-semibold text-slate-600" title={value}>{value}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                          {facetResult.totalRows.toLocaleString()}
                        </span>
                      </div>
                      {!facetResult.data.length ? (
                        <div className="py-4 text-center text-[11px] text-slate-500">no values</div>
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
          <div className="flex h-36 items-center justify-center px-4 text-center text-[11px] text-slate-500">
            No chartable values for this field.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>{result.filteredRows.toLocaleString()} active rows</span>
              <span>{result.totalRows.toLocaleString()} total</span>
            </div>
            {chart.type === 'histogram' ? (
              <Histogram
                data={previewData ?? result.data}
                brush={brush}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onBrushRange={onBrushRange}
                onClearRange={onClearRange}
                onLiveBrushStart={onLiveBrushStart}
                onLiveBrush={onLiveBrush}
                onLiveBrushEnd={onLiveBrushEnd}
              />
            ) : chart.type === 'violin' ? (
              <Violins
                data={result.data}
                activeKeys={activeKeys}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onClick={onToggleFilter}
              />
            ) : chart.type === 'box' ? (
              <BoxPlot
                data={result.data}
                activeKeys={activeKeys}
                onHover={onHoverDatum}
                onLeave={onLeaveDatum}
                onClick={onToggleFilter}
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
    datasetRegistry,
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
  const tableDatasets = Object.values(datasetRegistry).filter((dataset) => !dataset.spatial && Boolean(dataset.relationName));
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

  const handleAddChart = async () => {
    if (selectedLayer) {
      const nextChart = buildDefaultChartForDataset(metadataForLayer(selectedLayer));
      if (nextChart) {
        addChart({ ...nextChart, source: { kind: 'layer', layerId: nextChart.layerId } });
        return;
      }
    }
    if (tableDatasets.length) {
      const dataset = tableDatasets[0];
      addChart({
        id: `chart-${Date.now()}`,
        title: `${dataset.name} distribution`,
        layerId: '',
        tableName: dataset.relationName,
        source: dataset.source,
        type: 'bar',
        dimensionField: '',
        aggregation: 'count',
        paletteId: 'categorical',
        maxCategories: 8,
      });
      return;
    }
    if (tables.length) {
      try {
        const dataset = await ensureStableTableDataset({ tableName: tables[0] });
        useStore.getState().registerDataset(dataset);
        addChart({
          id: `chart-${Date.now()}`,
          title: `${tables[0]} distribution`,
          layerId: '',
          tableName: dataset.relationName || tables[0],
          source: dataset.source,
          type: 'bar',
          dimensionField: '',
          aggregation: 'count',
          paletteId: 'categorical',
          maxCategories: 8,
        });
      } catch (sourceError: any) {
        addToast({ type: 'error', message: `Could not link table: ${sourceError?.message || 'Unknown error'}` });
      }
      return;
    }
    addToast({ type: 'warning', message: 'No chartable layers or tables available' });
  };

  const datasetFilters = (datasetId: string) => visualAnalytics.datasets[datasetId]?.filters || [];

  const toggleFilter = (chart: VisualChartSpec, datum: VisualChartDatum) => {
    const datasetId = chartDatasetId(chart);
    const currentFilters = datasetFilters(datasetId);

    if (datum.filter.kind === 'category') {
      // Merge into one multi-value filter per field so several categories
      // combine as OR instead of contradictory ANDed single-value filters.
      const value = datum.filter.values[0];
      const existing = currentFilters.find(
        (filter): filter is Extract<VisualFilter, { kind: 'category' }> =>
          filter.kind === 'category' && filter.field === datum.filter.field,
      );
      if (!existing) {
        setLayerFilters(datasetId, [...currentFilters, datum.filter]);
        return;
      }
      const values = existing.values.includes(value)
        ? existing.values.filter((item) => item !== value)
        : [...existing.values, value];
      setLayerFilters(
        datasetId,
        values.length
          ? currentFilters.map((filter) => (filter === existing ? { ...existing, values } : filter))
          : currentFilters.filter((filter) => filter !== existing),
      );
      return;
    }

    const datumKey = visualChartFilterKey(datum.filter);
    const exists = currentFilters.some((filter) => visualChartFilterKey(filter) === datumKey);
    setLayerFilters(
      datasetId,
      exists
        ? currentFilters.filter((filter) => visualChartFilterKey(filter) !== datumKey)
        : [...currentFilters, datum.filter],
    );
  };

  /**
   * Live cross-filtering while a brush is being dragged.
   *
   * Progressive enhancement, deliberately: the build is kicked off on pointer
   * down and nothing waits for it. If it lands before the drag ends the other
   * charts start following; if it does not, the drag behaves exactly as it did
   * before and the committed brush queries them properly. So the worst case is
   * today's behaviour, and a slow dataset degrades rather than stalls.
   *
   * The estimate comes from a 5% sample — measured at five million rows that is
   * a 665ms build against 4.7s exact, for a worst-case bar error of 2%. Nobody
   * reads exact counts off a moving bar, and the commit is exact regardless.
   */
  const [livePreview, setLivePreview] = useState<Record<string, number[]> | null>(null);
  const cubes = useRef<{ key: string; entries: ChartCube[] } | null>(null);

  const beginLiveBrush = async (active: VisualChartSpec) => {
    const datasetId = chartDatasetId(active);
    const filters = visualAnalytics.datasets[datasetId]?.filters || [];
    // Only histograms on the same dataset: the cube bins a numeric field, and a
    // chart reading different data is not answered by this one's rows.
    const passives = charts.filter(
      (item) =>
        item.id !== active.id &&
        item.type === 'histogram' &&
        chartDatasetId(item) === datasetId,
    );
    if (!passives.length) return;

    const key = JSON.stringify([datasetId, active.id, filters, passives.map((c) => c.id)]);
    if (cubes.current?.key === key) return;

    try {
      const source = chartDatasetSource(active);
      const tableName =
        active.tableName ||
        (source.kind === 'layer'
          ? await analyticsTableForLayer(mapLayers.find((l) => l.id === source.layerId) as any)
          : undefined);
      if (!tableName) return;
      // Sampling only where it buys something. Below a couple of hundred
      // thousand rows the exact cube is already quick, and a 5% sample of a
      // small table is few enough rows that the estimate visibly disagrees with
      // the answer that lands a moment later.
      const rowCount = Number(datasetRegistry[datasetId]?.rowCount ?? 0);
      const entries = await buildChartCubes({
        tableName,
        activeChart: active,
        passiveCharts: passives,
        filters,
        sampleRate: rowCount > 200_000 ? 5 : undefined,
      });
      cubes.current = { key, entries };
    } catch {
      // An estimate is a courtesy; failing to build one must not break the drag.
      cubes.current = null;
    }
  };

  const updateLiveBrush = (active: VisualChartSpec, min: number, max: number) => {
    const entries = cubes.current?.entries;
    if (!entries?.length || entries[0].activeChartId !== active.id) return;
    setLivePreview(
      Object.fromEntries(entries.map((cube) => [cube.passiveChartId, sliceCube(cube, min, max)])),
    );
  };

  const setRangeFilter = (chart: VisualChartSpec, min: number, max: number) => {
    const datasetId = chartDatasetId(chart);
    const rest = datasetFilters(datasetId).filter(
      (filter) => !(filter.kind === 'range' && filter.field === chart.dimensionField),
    );
    setLayerFilters(datasetId, [...rest, { kind: 'range', field: chart.dimensionField, min, max }]);
  };

  const clearRangeFilter = (chart: VisualChartSpec) => {
    const datasetId = chartDatasetId(chart);
    setLayerFilters(
      datasetId,
      datasetFilters(datasetId).filter(
        (filter) => !(filter.kind === 'range' && filter.field === chart.dimensionField),
      ),
    );
  };

  const scatterAxisFields = (chart: VisualChartSpec) =>
    new Set([chart.dimensionField, chart.measureField].filter((field): field is string => Boolean(field)));

  const setScatterBrush = (chart: VisualChartSpec, brush: Brush2D) => {
    const datasetId = chartDatasetId(chart);
    const axes = scatterAxisFields(chart);
    const rest = datasetFilters(datasetId).filter(
      (filter) => !(filter.kind === 'range' && axes.has(filter.field)),
    );
    const next: VisualFilter[] = [
      ...rest,
      { kind: 'range', field: chart.dimensionField, min: brush.xMin, max: brush.xMax },
    ];
    if (chart.measureField && chart.measureField !== chart.dimensionField) {
      next.push({ kind: 'range', field: chart.measureField, min: brush.yMin, max: brush.yMax });
    }
    setLayerFilters(datasetId, next);
  };

  const clearScatterBrush = (chart: VisualChartSpec) => {
    const datasetId = chartDatasetId(chart);
    const axes = scatterAxisFields(chart);
    setLayerFilters(
      datasetId,
      datasetFilters(datasetId).filter((filter) => !(filter.kind === 'range' && axes.has(filter.field))),
    );
  };

  const setTemporalBrush = (chart: VisualChartSpec, start: string, end: string) => {
    const datasetId = chartDatasetId(chart);
    const rest = datasetFilters(datasetId).filter(
      (filter) => !(filter.kind === 'temporal' && filter.field === chart.dimensionField),
    );
    setLayerFilters(datasetId, [...rest, { kind: 'temporal', field: chart.dimensionField, start, end }]);
  };

  const clearTemporalBrush = (chart: VisualChartSpec) => {
    const datasetId = chartDatasetId(chart);
    setLayerFilters(
      datasetId,
      datasetFilters(datasetId).filter(
        (filter) => !(filter.kind === 'temporal' && filter.field === chart.dimensionField),
      ),
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
            <p className="mt-1 truncate text-[11px] text-slate-500">
              Click marks to filter; drag distributions or timelines to brush. Muted marks show unfiltered context.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTablesRefreshTick((tick) => tick + 1)}
              className="pressable flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              title="Refresh data sources (picks up new workflow and SQL tables)"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { void handleAddChart(); }}
              disabled={!hasChartableLayer && !tables.length && !tableDatasets.length}
              className="pressable flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!mapLayers.length && !tables.length && !tableDatasets.length ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-slate-500">
            Add or run a layer before creating charts.
          </div>
        ) : !charts.length ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-[11px] text-slate-500">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <Donut className="h-5 w-5" />
            </div>
            Create linked charts from the selected layer, then use chart marks as visual filters.
          </div>
        ) : (
          <div className="space-y-3">
            {charts.map((chart) => {
              const source = chartDatasetSource(chart);
              const datasetId = chartDatasetId(chart);
              const layer = source.kind === 'layer' ? mapLayers.find((item) => item.id === source.layerId) : undefined;
              const filters = visualAnalytics.datasets[datasetId]?.filters || [];
              const selectedFeatureIds = visualAnalytics.datasets[datasetId]?.selectedFeatureIds || [];
              return (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  layer={layer}
                  layers={mapLayers}
                  tables={tables}
                  tableDatasets={tableDatasets}
                  filters={filters}
                  selectedFeatureIds={selectedFeatureIds}
                  onUpdate={(patch) => updateChart(chart.id, patch)}
                  onRemove={() => removeChart(chart.id)}
                  onToggleFilter={(datum) => toggleFilter(chart, datum)}
                  onBrushRange={(min, max) => setRangeFilter(chart, min, max)}
                  onClearRange={() => clearRangeFilter(chart)}
                  onBrush2D={(brush) => setScatterBrush(chart, brush)}
                  onClear2D={() => clearScatterBrush(chart)}
                  onBrushTemporal={(start, end) => setTemporalBrush(chart, start, end)}
                  onClearTemporal={() => clearTemporalBrush(chart)}
                  onHoverDatum={(datum) => { if (source.kind === 'layer') setHighlightedFeatures(source.layerId, datum.featureIds); }}
                  onLeaveDatum={() => { if (source.kind === 'layer') setHighlightedFeatures(source.layerId, []); }}
                  previewCounts={livePreview?.[chart.id] ?? null}
                  onLiveBrushStart={() => { void beginLiveBrush(chart); }}
                  onLiveBrush={(min, max) => updateLiveBrush(chart, min, max)}
                  onLiveBrushEnd={() => setLivePreview(null)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
