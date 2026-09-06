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
};

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
  return out;
};

/** Extent of a numeric column, needed before either axis can be binned. */
const extentOf = async (table: string, field: string, where: string) => {
  const value = `TRY_CAST(${quote(field)} AS DOUBLE)`;
  const result = await duckdbService.query(
    `SELECT MIN(${value}) AS lo, MAX(${value}) AS hi FROM ${quote(table)} ${where};`,
  );
  const row = result.toArray()[0];
  const json = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  return { min: Number(json?.lo ?? 0), max: Number(json?.hi ?? 0) };
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
  passiveBins = 24,
}: {
  tableName: string;
  activeChart: VisualChartSpec;
  passiveCharts: VisualChartSpec[];
  filters: VisualFilter[];
  activeBins?: number;
  passiveBins?: number;
}): Promise<ChartCube[]> => {
  if (!passiveCharts.length) return [];

  const fixed = filters
    .filter((filter) => filter.field !== activeChart.dimensionField)
    .map(compileVisualFilterPredicate)
    .filter((item): item is string => Boolean(item));
  const where = fixed.length ? `WHERE ${fixed.join(' AND ')}` : '';

  const activeExtent = await extentOf(tableName, activeChart.dimensionField, where);
  const activeValue = `TRY_CAST(${quote(activeChart.dimensionField)} AS DOUBLE)`;
  const activeWidth =
    activeExtent.max === activeExtent.min ? 1 : (activeExtent.max - activeExtent.min) / activeBins;
  const activeBinExpr = `LEAST(${activeBins - 1}, GREATEST(0, CAST(FLOOR((${activeValue} - ${activeExtent.min}) / ${activeWidth || 1}) AS INTEGER)))`;

  const cubes: ChartCube[] = [];
  for (const passive of passiveCharts) {
    const passiveExtent = await extentOf(tableName, passive.dimensionField, where);
    const passiveValue = `TRY_CAST(${quote(passive.dimensionField)} AS DOUBLE)`;
    const passiveWidth =
      passiveExtent.max === passiveExtent.min ? 1 : (passiveExtent.max - passiveExtent.min) / passiveBins;
    const passiveBinExpr = `LEAST(${passiveBins - 1}, GREATEST(0, CAST(FLOOR((${passiveValue} - ${passiveExtent.min}) / ${passiveWidth || 1}) AS INTEGER)))`;

    const predicates = [
      `${activeValue} IS NOT NULL`,
      `${passiveValue} IS NOT NULL`,
      ...fixed,
    ];
    const result = await duckdbService.query(
      `SELECT ${activeBinExpr} AS active_bin, ${passiveBinExpr} AS passive_bin, COUNT(*) AS n
       FROM ${quote(tableName)}
       WHERE ${predicates.join(' AND ')}
       GROUP BY active_bin, passive_bin;`,
    );

    const counts = new Uint32Array(activeBins * passiveBins);
    for (const raw of result.toArray()) {
      const row = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
      const a = Number(row.active_bin);
      const p = Number(row.passive_bin);
      if (a >= 0 && a < activeBins && p >= 0 && p < passiveBins) {
        counts[a * passiveBins + p] = Number(row.n ?? 0);
      }
    }

    cubes.push({
      activeChartId: activeChart.id,
      passiveChartId: passive.id,
      activeBins,
      passiveBins,
      activeMin: activeExtent.min,
      activeMax: activeExtent.max,
      counts,
    });
  }
  return cubes;
};
