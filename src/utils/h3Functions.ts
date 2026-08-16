/**
 * H3 hierarchical hex grid — metadata for the workflow node.
 *
 * The heavy lifting runs in DuckDB's community `h3` extension (loaded lazily
 * via `duckdbService.ensureH3()`), so no external H3 library is needed. Cells
 * are kept in their canonical string form on purpose: an H3 index is a 64-bit
 * integer and several are already past 2^53, so reading one as a JS number
 * silently rounds it and distinct cells collide.
 */
export type H3InputKind = "cell" | "lat" | "lng";

export interface H3OperationMetadata {
  /** DuckDB function this maps to. */
  id: string;
  label: string;
  summary: string;
  /** Which field inputs the operation needs. */
  inputs: H3InputKind[];
  needsResolution: boolean;
  resultHint: string;
  resultField: string;
}

export const h3Operations: H3OperationMetadata[] = [
  {
    id: "h3_latlng_to_cell",
    label: "Lat/Lng → H3 cell",
    summary:
      "Assign an H3 cell to each row from latitude and longitude columns.",
    inputs: ["lat", "lng"],
    needsResolution: true,
    resultHint: "H3 cell id (string)",
    resultField: "h3_cell",
  },
  {
    id: "h3_cell_to_parent",
    label: "Cell → parent",
    summary: "Coarser parent cell at a lower resolution.",
    inputs: ["cell"],
    needsResolution: true,
    resultHint: "Parent H3 cell id (string)",
    resultField: "h3_parent",
  },
  {
    id: "h3_get_resolution",
    label: "Cell resolution",
    summary: "Resolution number of a cell id.",
    inputs: ["cell"],
    needsResolution: false,
    resultHint: "Resolution (0–15)",
    resultField: "h3_resolution",
  },
  {
    id: "h3_cell_to_lat",
    label: "Cell → latitude",
    summary: "Latitude of a cell's centroid.",
    inputs: ["cell"],
    needsResolution: false,
    resultHint: "Latitude",
    resultField: "h3_lat",
  },
  {
    id: "h3_cell_to_lng",
    label: "Cell → longitude",
    summary: "Longitude of a cell's centroid.",
    inputs: ["cell"],
    needsResolution: false,
    resultHint: "Longitude",
    resultField: "h3_lng",
  },
  {
    id: "h3_cell_to_boundary_wkt",
    label: "Cell → boundary WKT",
    summary: "Cell outline as WKT geometry text.",
    inputs: ["cell"],
    needsResolution: false,
    resultHint: "WKT polygon",
    resultField: "h3_boundary_wkt",
  },
];

export const h3OperationById = (id: string): H3OperationMetadata | undefined =>
  h3Operations.find((op) => op.id === id);

/** Whether a workflow graph contains any H3 node (needs the extension loaded). */
export const workflowUsesH3 = (
  nodes: Array<{ data?: { type?: string } }>,
): boolean => nodes.some((node) => node.data?.type === "h3");

const qi = (name: unknown) => `"${String(name).replace(/"/g, '""')}"`;

/** Builds the SQL expression for an H3 operation, quoted and string-safe. */
export const buildH3Expression = (
  op: H3OperationMetadata,
  config: Record<string, unknown>,
): string => {
  const resolution = Number(config.resolution ?? 9);
  const cell = (field: unknown) => `h3_string_to_h3(${qi(field)})`;
  const cellOut = (expression: string) => `h3_h3_to_string(${expression})`;

  switch (op.id) {
    case "h3_latlng_to_cell":
      return `h3_latlng_to_cell_string(${qi(config.latField)}, ${qi(config.lngField)}, ${resolution})`;
    case "h3_cell_to_parent":
      return cellOut(
        `h3_cell_to_parent(${cell(config.cellField)}, ${resolution})`,
      );
    case "h3_get_resolution":
      return `h3_get_resolution(${cell(config.cellField)})`;
    case "h3_cell_to_lat":
      return `h3_cell_to_lat(${cell(config.cellField)})`;
    case "h3_cell_to_lng":
      return `h3_cell_to_lng(${cell(config.cellField)})`;
    case "h3_cell_to_boundary_wkt":
      return `h3_cell_to_boundary_wkt(${cell(config.cellField)})`;
    default:
      return "";
  }
};

/** Human-readable problems with an H3 node's current config, for inline errors. */
export const h3NodeErrors = (
  op: H3OperationMetadata,
  config: Record<string, unknown>,
): string[] => {
  const errors: string[] = [];
  const needs = (key: string, message: string) => {
    if (!String(config[key] ?? "").trim()) errors.push(message);
  };

  if (op.inputs.includes("lat")) needs("latField", "Choose a latitude column");
  if (op.inputs.includes("lng")) needs("lngField", "Choose a longitude column");
  if (op.inputs.includes("cell"))
    needs("cellField", "Choose an H3 cell column");

  const resolution = Number(config.resolution ?? 9);
  if (
    op.needsResolution &&
    (!Number.isInteger(resolution) || resolution < 0 || resolution > 15)
  ) {
    errors.push("Resolution must be a whole number from 0 to 15");
  }

  const resultField = String(config.resultField ?? "").trim();
  if (resultField && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(resultField)) {
    errors.push("Result column must be a valid identifier");
  }
  return errors;
};

// ─── polyfill mode ─────────────────────────────────────────────────────────

/** How attributes are encoded onto the dissolved cells. */
export type H3PolyfillAggregate = "count" | "sum" | "avg";

export const h3PolyfillAggregates: Array<{
  value: H3PolyfillAggregate;
  label: string;
  hint: string;
}> = [
  { value: "count", label: "Count features", hint: "Features per cell" },
  {
    value: "sum",
    label: "Sum value",
    hint: "Total of a numeric field per cell",
  },
  {
    value: "avg",
    label: "Average value",
    hint: "Mean of a numeric field per cell",
  },
];

export interface H3PolyfillConfig {
  /** Mode discriminator — must be "polyfill". */
  mode: "polyfill";
  /** Upstream GEOMETRY column to cover. */
  geometryField: string;
  /** H3 resolution, 0–15. */
  resolution?: number;
  /** How attributes are encoded onto each cell. */
  aggregate?: H3PolyfillAggregate;
  /** Numeric column for sum/avg. */
  valueField?: string;
  /** Output column holding the aggregated value. */
  resultField?: string;
  /** Optional buffer distance (geometry units) so lines become fillable areas. */
  buffer?: number;
}

/** Human-readable problems with a polyfill node's current config. */
export const h3PolyfillErrors = (config: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!String(config.geometryField ?? "").trim()) {
    errors.push("Choose a geometry column");
  }
  const resolution = Number(config.resolution ?? 9);
  if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) {
    errors.push("Resolution must be a whole number from 0 to 15");
  }
  const aggregate = String(config.aggregate ?? "count");
  if (aggregate !== "count" && !String(config.valueField ?? "").trim()) {
    errors.push("Choose a value column to aggregate");
  }
  const buffer = Number(config.buffer ?? 0);
  if (Number.isFinite(buffer) && buffer < 0) {
    errors.push("Buffer distance cannot be negative");
  }
  const resultField = String(config.resultField ?? "").trim();
  if (resultField && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(resultField)) {
    errors.push("Result column must be a valid identifier");
  }
  return errors;
};

/**
 * SQL body for the polyfill node's CTE. Covers each upstream geometry with H3
 * cells at the chosen resolution, then dissolves them back to one row per cell
 * so attributes are encoded onto the hexagon that receives them — the standard
 * "polyfill and summarise" workflow (population per hex, catchment counts,
 * demand surface from overlapping polygons, buffered line coverage).
 *
 * Cells come back from the extension as strings already, so no 2^53 rounding
 * can occur. By default the cell boundary is turned into a real GEOMETRY
 * column so the result materialises as a mappable layer; set
 * `includeGeometry: false` to emit a pure attribute table (cell ids + encoded
 * values) that exports to Parquet/CSV/JSON with no geometry bytes.
 */
export const buildH3PolyfillBody = (
  source: string,
  geomColumn: string,
  config: Record<string, unknown>,
): string => {
  const resolution = Number(config.resolution ?? 9);
  const aggregate = String(config.aggregate ?? "count");
  const valueField = String(config.valueField ?? "").trim();
  const resultField = String(config.resultField ?? "").trim() || "cell_value";
  const buffer = Number(config.buffer ?? 0);
  const includeGeometry = config.includeGeometry !== false;

  // Buffer in the geometry's own units, so lines become fillable areas. Zero
  // leaves the geometry untouched.
  const fillExpr =
    Number.isFinite(buffer) && buffer > 0
      ? `ST_AsText(ST_Buffer(${qi(geomColumn)}, ${buffer}))`
      : `ST_AsText(${qi(geomColumn)})`;

  const aggregates = ["COUNT(*) AS feature_count"];
  const wantsValue = aggregate !== "count" && Boolean(valueField);
  if (wantsValue) {
    const fn = aggregate === "avg" ? "AVG" : "SUM";
    aggregates.push(`${fn}(__alur_h3_value) AS ${qi(resultField)}`);
  }

  const innerSelect = wantsValue
    ? `unnest(h3_polygon_wkt_to_cells_string(${fillExpr}, ${resolution})) AS cell, ${qi(valueField)} AS __alur_h3_value`
    : `unnest(h3_polygon_wkt_to_cells_string(${fillExpr}, ${resolution})) AS cell`;
  const innerWhere = wantsValue
    ? `${qi(geomColumn)} IS NOT NULL AND ${qi(valueField)} IS NOT NULL`
    : `${qi(geomColumn)} IS NOT NULL`;

  const columns = ["    cell", ...aggregates.map((agg) => `    ${agg}`)];
  if (includeGeometry) {
    columns.push(
      "    ST_GeomFromText(h3_cell_to_boundary_wkt(cell)) AS geometry",
    );
  }

  return [
    "  SELECT",
    columns.join(",\n"),
    "  FROM (",
    `    SELECT ${innerSelect}`,
    `    FROM ${source}`,
    `    WHERE ${innerWhere}`,
    "  )",
    "  GROUP BY 1",
  ].join("\n");
};
