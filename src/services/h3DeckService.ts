import { duckdbService } from "./duckdb";
import type { MapLayer } from "../store/useStore";
import type { H3GridVisualisation } from "../types/visualisation";

/**
 * Bridge between ALUR layers styled with the `h3grid` visualisation and
 * deck.gl's H3HexagonLayer.
 *
 * deck.gl is deliberately NOT imported here at module scope: it is a large,
 * optional dependency. `loadDeckGeo()` / `loadDeckMapbox()` return memoised
 * dynamic imports, so the base bundle never pays for deck.gl until a layer
 * actually asks to be drawn by it.
 */

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;

const h3ColumnScore = (name: string): number =>
  /h3|hex|cell|cell_id|hexagon|index/i.test(name) ? 2 : 1;

/** DuckDB-backed source table for a layer, if it has one. */
const layerTableName = (layer: MapLayer): string | null => {
  const kind = layer.source.kind;
  if (kind === "duckdb-table" || kind === "duckdb-query")
    return layer.source.tableName;
  return null;
};

export const isH3GridLayer = (layer: MapLayer): boolean =>
  layer.visualisation?.kind === "h3grid";

/**
 * Finds the H3 cell column in a layer's source by sampling values, preferring
 * columns whose names hint at H3. Mirrors the ingestion-time detector so a
 * trimmed H3 parquet gets the same answer here.
 */
export const resolveH3CellColumn = async (
  layer: MapLayer,
): Promise<string | null> => {
  const tableName = layerTableName(layer);
  if (!tableName) return null;
  try {
    const schema = (await duckdbService.getTableSchema(tableName))
      .toArray()
      .map((row: any) =>
        typeof row.toJSON === "function" ? row.toJSON() : row,
      );
    const stringCols = schema.filter((col: any) =>
      /varchar|char|text|string/i.test(String(col.type || "")),
    );
    if (!stringCols.length) return null;

    const ordered = [...stringCols].sort(
      (a, b) => h3ColumnScore(String(b.name)) - h3ColumnScore(String(a.name)),
    );

    for (const col of ordered.slice(0, 3)) {
      const name = String(col.name);
      const probe = await duckdbService.query(
        `SELECT COUNT(*) AS total, COUNT_IF(LOWER(${qi(name)}) ~ '^[0-9a-f]{15,16}$') AS matched ` +
          `FROM (SELECT ${qi(name)} FROM ${qi(tableName)} WHERE ${qi(name)} IS NOT NULL LIMIT 500) t`,
      );
      const row = probe.toArray()[0];
      const json = typeof row?.toJSON === "function" ? row.toJSON() : row;
      const total = Number(json?.total ?? 0);
      const matched = Number(json?.matched ?? 0);
      if (total > 0 && matched === total) return name;
    }
    return null;
  } catch {
    return null;
  }
};

export type H3GridDatum = {
  cell: string;
  value: number | null;
};

/** Rows for an H3HexagonLayer: the cell id plus an optional numeric value. */
export const queryH3GridRows = async (
  layer: MapLayer,
  vis: H3GridVisualisation,
  limit = 250_000,
): Promise<H3GridDatum[]> => {
  const tableName = layerTableName(layer);
  if (!tableName) return [];
  const valueExpr = vis.valueField
    ? `, TRY_CAST(${qi(vis.valueField)} AS DOUBLE) AS value`
    : "";
  const result = await duckdbService.query(
    `SELECT ${qi(vis.cellColumn)} AS cell${valueExpr} FROM ${qi(tableName)} ` +
      `WHERE ${qi(vis.cellColumn)} IS NOT NULL LIMIT ${limit}`,
  );
  return result.toArray().map((row: any) => {
    const json = typeof row.toJSON === "function" ? row.toJSON() : row;
    return {
      cell: String(json?.cell ?? ""),
      value:
        json?.value === null || json?.value === undefined
          ? null
          : Number(json?.value),
    };
  });
};

const hexToRgba = (
  hex: string,
  alpha: number,
): [number, number, number, number] => {
  const h = String(hex).replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [120, 130, 140, alpha];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
};

/**
 * A value → [r,g,b,a] accessor over the visualisation palette. Without a value
 * field every cell takes the palette's high colour (a plain hex fill).
 */
const makeColorAccessor = (vis: H3GridVisualisation, data: H3GridDatum[]) => {
  const alpha = Math.round(vis.opacity * 255);
  const colors = vis.palette.map((c) => hexToRgba(c, alpha));
  const nullColor: [number, number, number, number] = [226, 232, 240, alpha];
  if (!vis.valueField || colors.length < 2)
    return () => colors[colors.length - 1] ?? nullColor;

  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    if (d.value === null || d.value === undefined) continue;
    if (d.value < min) min = d.value;
    if (d.value > max) max = d.value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max)
    return () => colors[0];

  const span = max - min;
  return (value: number | null): [number, number, number, number] => {
    if (value === null || value === undefined) return nullColor;
    const t = Math.max(0, Math.min(1, (value - min) / span));
    const scaled = t * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(scaled));
    const fraction = scaled - index;
    const a = colors[index];
    const b = colors[index + 1];
    return a.map((channel, k) =>
      Math.round(channel + (b[k] - channel) * fraction),
    ) as [number, number, number, number];
  };
};

/**
 * Plain props for a deck.gl H3HexagonLayer (the caller constructs the layer so
 * this module never has to import deck.gl).
 */
export const buildH3GridLayerProps = (
  layer: MapLayer,
  vis: H3GridVisualisation,
  data: H3GridDatum[],
): Record<string, unknown> => {
  const colorFor = makeColorAccessor(vis, data);
  return {
    id: `deck-h3-${layer.id}`,
    data,
    getHexagon: (d: H3GridDatum) => d.cell,
    getFillColor: (d: H3GridDatum) => colorFor(d.value),
    getElevation: (d: H3GridDatum) => d.value ?? 0,
    extruded: vis.extruded,
    elevationScale: vis.elevationScale,
    filled: true,
    stroked: true,
    getLineColor: [15, 23, 42, 120],
    lineWidthMinPixels: 1,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 90],
  };
};

// --- lazy module loaders ---------------------------------------------------

let geoPromise: Promise<typeof import("@deck.gl/geo-layers")> | null = null;
export const loadDeckGeo = (): Promise<
  typeof import("@deck.gl/geo-layers")
> => {
  if (!geoPromise) geoPromise = import("@deck.gl/geo-layers");
  return geoPromise;
};

let mapboxPromise: Promise<typeof import("@deck.gl/mapbox")> | null = null;
export const loadDeckMapbox = (): Promise<typeof import("@deck.gl/mapbox")> => {
  if (!mapboxPromise) mapboxPromise = import("@deck.gl/mapbox");
  return mapboxPromise;
};
