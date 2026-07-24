import { ScreenGridLayerGL, type ScreenGridLayerOptions, type SemanticCell } from 'screengrid';
import { duckdbService } from './duckdb';
import { FEATURE_ID_PROPERTY, type VisualFilter } from '../types/visualAnalytics';
import type { GlyphGridVisualisation } from '../types/visualisation';
import { compileVisualFilterPredicate, quoteIdentifier } from '../utils/visualFilterSql';
import type { MapLayer } from '../store/useStore';

export type GlyphPoint = {
  position: [number, number];
  id: string;
  /** Cell weight input: 1 for count, fields[0] value for sum/avg. */
  weight: number;
  /** Values aligned with the visualisation's fields, for multivariate glyphs. */
  values: number[];
};

const GLYPH_MAX_POINTS = 60000;

const normalizeRows = (rows: any[]) =>
  rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));

export const glyphPointDataKey = ({
  layer,
  filters,
  vis,
}: {
  layer: Pick<MapLayer, 'id' | 'source' | 'styleVersion'>;
  filters: VisualFilter[];
  vis: GlyphGridVisualisation;
}) => {
  const source = layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query'
    ? {
        kind: layer.source.kind,
        renderVersion: layer.source.renderVersion,
        tableName: layer.source.tileSource?.tableName,
        featureIdColumn: layer.source.featureIdColumn,
      }
    : {
        kind: layer.source.kind,
        styleVersion: layer.styleVersion,
      };

  return JSON.stringify({
    layerId: layer.id,
    source,
    filters,
    fields: vis.fields,
    aggregate: vis.aggregate,
  });
};

const geometryCentroid = (geometry: GeoJSON.Geometry | null): [number, number] | null => {
  if (!geometry) return null;
  if (geometry.type === 'GeometryCollection') return geometryCentroid(geometry.geometries[0] || null);
  const flatten = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return [[Number(value[0]), Number(value[1])]];
    }
    return value.flatMap(flatten);
  };
  const coords = flatten(geometry.coordinates);
  if (!coords.length) return null;
  const sx = coords.reduce((sum, [x]) => sum + x, 0);
  const sy = coords.reduce((sum, [, y]) => sum + y, 0);
  return [sx / coords.length, sy / coords.length];
};

const matchesFilterJs = (properties: Record<string, unknown>, filter: VisualFilter): boolean => {
  const raw = properties[filter.field];
  let matches = false;
  if (filter.kind === 'null') {
    return filter.isNull ? raw === null || raw === undefined : raw !== null && raw !== undefined;
  }
  if (raw === null || raw === undefined) {
    matches = 'includeNull' in filter && Boolean(filter.includeNull);
  } else if (filter.kind === 'category') {
    matches = filter.values.includes(String(raw));
  } else if (filter.kind === 'temporal') {
    const value = String(raw);
    matches = !(filter.start && value < filter.start) && !(filter.end && value > filter.end);
  } else if (filter.kind === 'text') {
    const value = String(raw);
    const haystack = filter.caseSensitive ? value : value.toLocaleLowerCase();
    const needle = filter.caseSensitive ? filter.value : filter.value.toLocaleLowerCase();
    matches = filter.operator === 'contains'
      ? haystack.includes(needle)
      : filter.operator === 'starts_with'
        ? haystack.startsWith(needle)
        : filter.operator === 'ends_with'
          ? haystack.endsWith(needle)
          : haystack === needle;
  } else if (filter.kind === 'boolean') {
    matches = (raw === true || String(raw).toLocaleLowerCase() === 'true') === filter.value;
  } else {
    const value = Number(raw);
    matches = Number.isFinite(value)
      && !(filter.min !== undefined && value < filter.min)
      && !(filter.max !== undefined && value > filter.max);
  }
  return 'mode' in filter && filter.mode === 'exclude' ? !matches : matches;
};

export const queryLayerGlyphPoints = async ({
  layer,
  filters,
  vis,
}: {
  layer: Pick<MapLayer, 'id' | 'source' | 'geojson'>;
  filters: VisualFilter[];
  vis: GlyphGridVisualisation;
}): Promise<GlyphPoint[]> => {
  const weightField = vis.aggregate === 'count' ? undefined : vis.fields[0];

  if (layer.source.kind === 'duckdb-table' || layer.source.kind === 'duckdb-query') {
    const tileTable = layer.source.tileSource?.tableName;
    if (!tileTable) return [];
    const table = `"${tileTable.replace(/"/g, '""')}"`;
    const available = new Set([...(layer.source.tileSource.propertyColumns || []), layer.source.featureIdColumn]);
    const valueFields = vis.fields.filter((field) => available.has(field));
    const predicates = filters
      .filter((filter) => available.has(filter.field))
      .map(compileVisualFilterPredicate)
      .filter((item): item is string => Boolean(item));
    const whereParts = ['__alur_tile_geom IS NOT NULL', ...predicates];
    const whereClause = `WHERE ${whereParts.join(' AND ')}`;
    const lonLat = `ST_Centroid(ST_Transform(__alur_tile_geom, 'EPSG:3857', 'EPSG:4326', true))`;
    const valueSelects = valueFields
      .map((field, index) => `, TRY_CAST(${quoteIdentifier(field)} AS DOUBLE) AS v${index}`)
      .join('');
    const weightSelect = weightField && available.has(weightField)
      ? `COALESCE(TRY_CAST(${quoteIdentifier(weightField)} AS DOUBLE), 0)`
      : '1';

    const countResult = await duckdbService.query(`SELECT COUNT(*) AS n FROM ${table} ${whereClause};`);
    const count = Number(normalizeRows(countResult.toArray())[0]?.n ?? 0);
    // SAMPLE is logically evaluated before an outer WHERE in DuckDB. Wrap the
    // filtered rows so large filtered datasets still yield up to the full cap.
    const fromClause = count > GLYPH_MAX_POINTS
      ? `(SELECT * FROM ${table} ${whereClause})
         USING SAMPLE reservoir(${GLYPH_MAX_POINTS} ROWS) REPEATABLE (11)`
      : `${table} ${whereClause}`;

    const result = await duckdbService.query(
      `SELECT ST_X(${lonLat}) AS lon, ST_Y(${lonLat}) AS lat,
              CAST(${quoteIdentifier(layer.source.featureIdColumn)} AS VARCHAR) AS id,
              ${weightSelect} AS weight${valueSelects}
       FROM ${fromClause};`
    );
    return normalizeRows(result.toArray())
      .map((row) => ({
        position: [Number(row.lon), Number(row.lat)] as [number, number],
        id: String(row.id ?? ''),
        weight: Number(row.weight) || 0,
        values: vis.fields.map((field) => {
          const index = valueFields.indexOf(field);
          return index >= 0 ? Number(row[`v${index}`]) || 0 : 0;
        }),
      }))
      .filter((point) => Number.isFinite(point.position[0]) && Number.isFinite(point.position[1]));
  }

  const features = layer.geojson?.features || [];
  const points: GlyphPoint[] = [];
  for (const feature of features) {
    const properties = (feature.properties || {}) as Record<string, unknown>;
    if (!filters.every((filter) => matchesFilterJs(properties, filter))) continue;
    const position = geometryCentroid(feature.geometry);
    if (!position) continue;
    points.push({
      position,
      id: String(properties[FEATURE_ID_PROPERTY] ?? feature.id ?? ''),
      weight: weightField ? Number(properties[weightField]) || 0 : 1,
      values: vis.fields.map((field) => Number(properties[field]) || 0),
    });
    if (points.length >= GLYPH_MAX_POINTS) break;
  }
  return points;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  const int = parseInt(value, 16);
  if (!Number.isFinite(int)) return [15, 118, 110];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

const makeColorScale = (palette: string[], opacity: number) => {
  const stops = (palette.length ? palette : ['#0f766e']).map(hexToRgb);
  return (t: number): [number, number, number, number] => {
    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * (stops.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(stops.length - 1, low + 1);
    const mix = scaled - low;
    const channel = (index: 0 | 1 | 2) => Math.round(stops[low][index] + (stops[high][index] - stops[low][index]) * mix);
    // Keep empty cells transparent; ramp alpha up quickly with density.
    const alpha = clamped <= 0 ? 0 : Math.round(255 * opacity * (0.35 + 0.65 * clamped));
    return [channel(0), channel(1), channel(2), alpha];
  };
};

const MULTIVARIATE_GLYPHS = new Set(['pie', 'donut', 'bars', 'radial']);

export const isMultivariateGlyph = (vis: GlyphGridVisualisation) =>
  MULTIVARIATE_GLYPHS.has(vis.glyph) && vis.fields.length > 0;

export const buildGlyphGridLayerOptions = ({
  id,
  vis,
  points,
  onCellClick,
}: {
  id: string;
  vis: GlyphGridVisualisation;
  points: GlyphPoint[];
  onCellClick: (cell: SemanticCell<GlyphPoint, number[]> | null) => void;
}): ScreenGridLayerOptions<GlyphPoint, number, number[]> => {
  const palette = vis.palette.length ? vis.palette : ['#0f766e'];
  const base: ScreenGridLayerOptions<GlyphPoint, number, number[]> = {
    id,
    data: points,
    getPosition: (point) => point.position,
    getWeight: (point) => point.weight,
    cellSizePixels: vis.cellSize,
    aggregationMode: vis.mode === 'hex' ? 'screen-hex' : 'screen-grid',
    aggregationModeConfig: {
      showBackground: vis.glyph === 'density',
      ...(vis.mode === 'hex' ? { hexSize: vis.cellSize } : {}),
    },
    aggregationFunction: vis.aggregate === 'avg' ? 'mean' : vis.aggregate === 'sum' ? 'sum' : 'count',
    normalizationFunction: 'max-global',
    onClick: ({ cell }) => onCellClick(cell),
  };

  if (vis.glyph === 'density') {
    return { ...base, colorScale: makeColorScale(palette, vis.opacity) };
  }

  if (vis.glyph === 'circle') {
    const color = palette[palette.length - 1];
    return {
      ...base,
      enableGlyphs: true,
      onDrawCell: (ctx, x, y, normalizedValue, cellInfo) => {
        if (!(normalizedValue > 0)) return;
        const cellSize = Number(cellInfo?.cellSize) || vis.cellSize;
        const radius = Math.max(2, Math.sqrt(normalizedValue) * cellSize * 0.45);
        ScreenGridLayerGL.drawCircleGlyph(ctx, x, y, radius, color, vis.opacity);
      },
    };
  }

  // Multivariate glyphs: per-cell sums of each selected field, with grid-wide
  // maxima captured per aggregation pass so glyph size is comparable across cells.
  const gridMax = { total: 1, field: 1 };
  return {
    ...base,
    enableGlyphs: true,
    onAfterAggregate: (cellData) =>
      vis.fields.map((_, fieldIndex) =>
        cellData.reduce((sum, item) => sum + (Number(item.data?.values?.[fieldIndex]) || 0), 0)),
    onAggregate: (gridData) => {
      const sums = ((gridData.customData || []) as Array<number[] | undefined>).filter(
        (item): item is number[] => Array.isArray(item) && item.length > 0,
      );
      gridMax.total = Math.max(1, ...sums.map((values) => values.reduce((sum, value) => sum + value, 0)));
      gridMax.field = Math.max(1, ...sums.flat());
    },
    onDrawCell: (ctx, x, y, _normalizedValue, cellInfo) => {
      const sums = (cellInfo?.customData ?? cellInfo?.custom) as number[] | undefined;
      if (!sums?.length) return;
      const total = sums.reduce((sum, value) => sum + value, 0);
      if (!(total > 0)) return;
      const cellSize = Number(cellInfo?.cellSize) || vis.cellSize;
      ctx.globalAlpha = vis.opacity;
      if (vis.glyph === 'bars') {
        ScreenGridLayerGL.drawBarGlyph(ctx, x, y, sums, gridMax.field, cellSize, palette);
      } else if (vis.glyph === 'radial') {
        ScreenGridLayerGL.drawRadialBarGlyph(ctx, x, y, sums, gridMax.field, cellSize * 0.45, palette[0]);
      } else {
        const radius = Math.max(3, Math.sqrt(total / gridMax.total) * cellSize * 0.45);
        if (vis.glyph === 'donut') {
          ScreenGridLayerGL.drawDonutGlyph(ctx, x, y, sums, radius, radius * 0.55, palette);
        } else {
          ScreenGridLayerGL.drawPieGlyph(ctx, x, y, sums, radius, palette);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
};

export const glyphCellFeatureIds = (cell: SemanticCell<GlyphPoint, number[]> | null): string[] => {
  const cellData = (cell?.cellData || cell?.records?.rawRefs || []) as Array<{ data?: GlyphPoint }>;
  return cellData
    .map((item) => String(item.data?.id ?? ''))
    .filter(Boolean)
    .slice(0, 5000);
};
