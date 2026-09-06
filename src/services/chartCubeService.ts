import { duckdbService } from './duckdb';
import { compileVisualFilterPredicate } from '../utils/visualFilterSql';
import type { VisualChartSpec, VisualFilter } from '../types/visualAnalytics';

/**
 * Cross-filter cubes, after Falcon and Mosaic.
 *
 * Brushing one chart normally re-queries every other chart. Measured on this
 * engine that is ~250ms at a million rows and ~1.1s at five million — fine once
 * per brush, hopeless per frame, which is why brushing here only committed on
 * release.
 *
 * The trick is that while one chart is being brushed, only its own binning
 * changes. So for each other chart, count every (brushed bin, other bin) pair
 * once up front; a brush is then a range of columns, and each other chart's
 * bars are column sums over that range — arithmetic on a typed array rather
 * than a query. That is what makes dragging a brush and watching every other
 * chart follow affordable.
 *
 * The cube is only valid for the filters it was built under. Anything that
 * changes them — another chart's brush, a new dataset — invalidates it, which
 * is what the key records.
 */

export type ChartCube = {
  /** The chart being brushed. */
  activeChartId: string;
  /** The chart these counts describe. */
  passiveChartId: string;
  activeBins: number;
  passiveBins: number;
  /** Extent of the active field, so a brush value maps to a bin. */
  activeMin: number;
  activeMax: number;
  /** Row-major: counts[activeBin * passiveBins + passiveBin]. */
  counts: Uint32Array;
  /**
   * What to multiply a count by to estimate the population.
   *
   * 1 for an exact cube. Above 1 when the cube was built from a sample: a drag
   * needs the shape of the answer within a frame, not the answer, and the exact
   * numbers arrive from the ordinary query the moment the brush is committed.
   */
  scale: number;
};

/**
 * Bins a histogram draws for a chart. The cube must use exactly this, or a
 * sliced column would land on the wrong bar.
 */
export const histogramBinCount = (chart: { maxCategories?: number }) =>
  Math.max(4, Math.min(24, chart.maxCategories || 12));

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Bin index for a value, clamped, matching the SQL that filled the cube. */
export const binIndexFor = (value: number, min: number, max: number, bins: number) => {
  if (!(max > min)) return 0;
  const index = Math.floor(((value - min) / (max - min)) * bins);
  return Math.max(0, Math.min(bins - 1, index));
};

/**
 * Sums the cube over a brush on the active field, giving one count per bin of
 * the passive chart. This is the whole point: no database, no await.
 */
export const sliceCube = (cube: ChartCube, min: number, max: number): number[] => {
  const from = binIndexFor(min, cube.activeMin, cube.activeMax, cube.activeBins);
  const to = binIndexFor(max, cube.activeMin, cube.activeMax, cube.activeBins);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  const out = new Array<number>(cube.passiveBins).fill(0);
  for (let active = lo; active <= hi; active += 1) {
    const row = active * cube.passiveBins;
    for (let passive = 0; passive < cube.passiveBins; passive += 1) {
      out[passive] += cube.counts[row + passive];
    }
  }
  return cube.scale === 1 ? out : out.map((value) => Math.round(value * cube.scale));
};

/**
 * Extents for every field at once.
 *
 * One pass rather than one per field: the table is the expensive part, and at
 * five million rows each extra scan was costing as much as the cube itself.
 */
const extentsOf = async (table: string, fields: string[], where: string) => {
  const projections = fields
    .map((field, index) => {
      const value = `TRY_CAST(${quote(field)} AS DOUBLE)`;
      return `MIN(${value}) AS lo_${index}, MAX(${value}) AS hi_${index}`;
    })
    .join(', ');
  const result = await duckdbService.query(
    `SELECT ${projections} FROM ${quote(table)} ${where};`,
  );
  const raw = result.toArray()[0];
  const row = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
  return fields.map((_, index) => ({
    min: Number(row?.[`lo_${index}`] ?? 0),
    max: Number(row?.[`hi_${index}`] ?? 0),
  }));
};

const binExpression = (field: string, extent: { min: number; max: number }, bins: number) => {
  const value = `TRY_CAST(${quote(field)} AS DOUBLE)`;
  const width = extent.max === extent.min ? 1 : (extent.max - extent.min) / bins;
  return `LEAST(${bins - 1}, GREATEST(0, CAST(FLOOR((${value} - ${extent.min}) / ${width || 1}) AS INTEGER)))`;
};

/**
 * Builds one cube per passive chart in a single pass each.
 *
 * Filters on the active chart's own field are deliberately excluded: the cube
 * has to describe the whole extent of that field so any brush within it can be
 * answered. Filters from every other chart are applied, because those are fixed
 * for the duration of the brush.
 */
export const buildChartCubes = async ({
  tableName,
  activeChart,
  passiveCharts,
  filters,
  activeBins = 64,
  passiveBins,
  sampleRate,
}: {
  tableName: string;
  activeChart: VisualChartSpec;
  passiveCharts: VisualChartSpec[];
  filters: VisualFilter[];
  activeBins?: number;
  passiveBins?: number;
  /** Overrides the per-chart bin count; normally left to histogramBinCount. */
  /**
   * Percent of rows to read, 0-100. Omitted reads all of them. A drag wants
   * the shape within a frame; a few percent gives that for a fraction of the
   * scan, and the committed brush re-queries exactly regardless.
   */
  sampleRate?: number;
}): Promise<ChartCube[]> => {
  if (!passiveCharts.length) return [];

  const fixed = filters
    .filter((filter) => filter.field !== activeChart.dimensionField)
    .map(compileVisualFilterPredicate)
    .filter((item): item is string => Boolean(item));
  const where = fixed.length ? `WHERE ${fixed.join(' AND ')}` : '';

  const fields = [activeChart.dimensionField, ...passiveCharts.map((c) => c.dimensionField)];
  const [activeExtent, ...passiveExtents] = await extentsOf(tableName, fields, where);

  const activeValue = `TRY_CAST(${quote(activeChart.dimensionField)} AS DOUBLE)`;
  const activeBinExpr = binExpression(activeChart.dimensionField, activeExtent, activeBins);
  const binsPerPassive = passiveCharts.map((chart) => passiveBins ?? histogramBinCount(chart));
  const passiveBinExprs = passiveCharts.map((chart, index) =>
    binExpression(chart.dimensionField, passiveExtents[index], binsPerPassive[index]),
  );

  // Every cube in one scan. GROUPING SETS asks for a separate (active, passive)
  // grouping per chart, so the table is read once no matter how many charts are
  // on screen — the alternative was a scan each, and the scan is the cost.
  const projections = passiveBinExprs.map((expr, index) => `${expr} AS p_${index}`).join(', ');
  const groupingSets = passiveCharts.map((_, index) => `(active_bin, p_${index})`).join(', ');
  const result = await duckdbService.query(
    `WITH binned AS (
       SELECT ${activeBinExpr} AS active_bin, ${projections}
       FROM ${quote(tableName)}
       WHERE ${[`${activeValue} IS NOT NULL`, ...fixed].join(' AND ')}${
         // The sample clause follows the filter, so it draws from the rows that
         // survive it rather than from the whole table.
         sampleRate ? `\n       USING SAMPLE ${sampleRate} PERCENT (bernoulli)` : ''
       }
     )
     SELECT active_bin, ${passiveCharts.map((_, i) => `p_${i}`).join(', ')}, COUNT(*) AS n
     FROM binned
     GROUP BY GROUPING SETS (${groupingSets});`,
  );

  const cubes = passiveCharts.map((passive, index) => ({
    activeChartId: activeChart.id,
    passiveChartId: passive.id,
    activeBins,
    passiveBins: binsPerPassive[index],
    activeMin: activeExtent.min,
    activeMax: activeExtent.max,
    counts: new Uint32Array(activeBins * binsPerPassive[index]),
    scale: sampleRate ? 100 / sampleRate : 1,
  }));

  for (const raw of result.toArray()) {
    const row = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
    const active = Number(row.active_bin);
    if (!Number.isFinite(active) || active < 0 || active >= activeBins) continue;
    // A grouping set leaves every column outside it null, so the one non-null
    // passive column says which cube this row belongs to.
    for (let index = 0; index < cubes.length; index += 1) {
      const value = row[`p_${index}`];
      if (value === null || value === undefined) continue;
      const passive = Number(value);
      const bins = cubes[index].passiveBins;
      if (passive < 0 || passive >= bins) continue;
      cubes[index].counts[active * bins + passive] = Number(row.n ?? 0);
      break;
    }
  }
  return cubes;
};
