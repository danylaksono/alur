import { describe, it, expect } from "vitest";
import {
  buildH3Expression,
  buildH3PolyfillBody,
  h3NodeErrors,
  h3OperationById,
  h3Operations,
  h3PolyfillErrors,
  workflowUsesH3,
} from "./h3Functions";

describe("h3Functions · metadata", () => {
  it("exposes the full encode operation set with unique ids", () => {
    const ids = h3Operations.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "h3_latlng_to_cell",
        "h3_cell_to_parent",
        "h3_get_resolution",
        "h3_cell_to_lat",
        "h3_cell_to_lng",
        "h3_cell_to_boundary_wkt",
      ]),
    );
  });

  it("looks operations up by id and flags workflow graphs that use H3", () => {
    expect(h3OperationById("h3_cell_to_parent")?.label).toContain("parent");
    expect(h3OperationById("nope")).toBeUndefined();
    expect(
      workflowUsesH3([{ data: { type: "h3" } }, { data: { type: "filter" } }]),
    ).toBe(true);
    expect(workflowUsesH3([{ data: { type: "filter" } }])).toBe(false);
  });
});

describe("h3Functions · encode expressions", () => {
  it("keeps cell ids in their canonical string form", () => {
    expect(
      buildH3Expression(h3OperationById("h3_latlng_to_cell")!, {
        latField: "lat",
        lngField: "lng",
        resolution: 7,
      }),
    ).toBe('h3_latlng_to_cell_string("lat", "lng", 7)');
    expect(
      buildH3Expression(h3OperationById("h3_cell_to_parent")!, {
        cellField: "cell",
        resolution: 4,
      }),
    ).toBe('h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3("cell"), 4))');
    expect(
      buildH3Expression(h3OperationById("h3_cell_to_boundary_wkt")!, {
        cellField: "cell",
      }),
    ).toBe('h3_cell_to_boundary_wkt(h3_string_to_h3("cell"))');
    expect(
      buildH3Expression(h3OperationById("h3_cell_to_boundary_geometry")!, {
        cellField: "cell",
      }),
    ).toBe('ST_GeomFromText(h3_cell_to_boundary_wkt(h3_string_to_h3("cell")))');
  });

  it("quotes identifiers defensively", () => {
    expect(
      buildH3Expression(h3OperationById("h3_get_resolution")!, {
        cellField: 'weird"col',
      }),
    ).toBe('h3_get_resolution(h3_string_to_h3("weird""col"))');
  });
});

describe("h3Functions · polyfill body", () => {
  const config = (overrides: Record<string, unknown>) => ({
    geometryField: "geometry",
    resolution: 9,
    ...overrides,
  });

  it("covers the geometry and dissolves back to one row per cell (count)", () => {
    const sql = buildH3PolyfillBody("src", "geometry", config({}));
    expect(sql).toContain(
      'h3_polygon_wkt_to_cells_string(ST_AsText("geometry"), 9)',
    );
    expect(sql).toContain("COUNT(*) AS feature_count");
    expect(sql).toContain(
      "ST_GeomFromText(h3_cell_to_boundary_wkt(cell)) AS geometry",
    );
    expect(sql).toContain("GROUP BY 1");
    expect(sql).not.toContain("__alur_h3_value");
  });

  it("sums a numeric attribute per cell", () => {
    const sql = buildH3PolyfillBody(
      "src",
      "geometry",
      config({
        aggregate: "sum",
        valueField: "population",
        resultField: "pop_total",
      }),
    );
    expect(sql).toContain('SUM(__alur_h3_value) AS "pop_total"');
    expect(sql).toContain('"population" AS __alur_h3_value');
    expect(sql).toContain(
      'WHERE "geometry" IS NOT NULL AND "population" IS NOT NULL',
    );
  });

  it("averages when asked and buffers lines", () => {
    const sql = buildH3PolyfillBody(
      "src",
      "geometry",
      config({ aggregate: "avg", valueField: "cost", buffer: 250 }),
    );
    expect(sql).toContain('AVG(__alur_h3_value) AS "cell_value"');
    expect(sql).toContain('ST_AsText(ST_Buffer("geometry", 250))');
  });

  it("does not buffer when distance is zero", () => {
    const sql = buildH3PolyfillBody("src", "geometry", config({ buffer: 0 }));
    expect(sql).toContain('ST_AsText("geometry")');
    expect(sql).not.toContain("ST_Buffer");
  });

  it("omits the boundary geometry when includeGeometry is false", () => {
    const sql = buildH3PolyfillBody(
      "src",
      "geometry",
      config({ includeGeometry: false }),
    );
    expect(sql).not.toContain("h3_cell_to_boundary_wkt");
    expect(sql).not.toContain("AS geometry");
    expect(sql).toContain("COUNT(*) AS feature_count");
    expect(sql).toContain("GROUP BY 1");
  });

  it("keeps the geometry by default and when explicitly requested", () => {
    expect(buildH3PolyfillBody("src", "geometry", config({}))).toContain(
      "AS geometry",
    );
    expect(
      buildH3PolyfillBody("src", "geometry", config({ includeGeometry: true })),
    ).toContain("AS geometry");
  });
});

describe("h3Functions · validation", () => {
  it("flags missing encode fields and out-of-range resolutions", () => {
    expect(h3NodeErrors(h3OperationById("h3_latlng_to_cell")!, {})).toEqual(
      expect.arrayContaining([
        "Choose a latitude column",
        "Choose a longitude column",
      ]),
    );
    expect(
      h3NodeErrors(h3OperationById("h3_cell_to_parent")!, {
        cellField: "c",
        resolution: 16,
      }),
    ).toContain("Resolution must be a whole number from 0 to 15");
    expect(
      h3NodeErrors(h3OperationById("h3_cell_to_lat")!, {
        cellField: "c",
        resultField: "1bad",
      }),
    ).toContain("Result column must be a valid identifier");
    expect(
      h3NodeErrors(h3OperationById("h3_cell_to_lat")!, { cellField: "c" }),
    ).toEqual([]);
  });

  it("flags incomplete polyfill config", () => {
    expect(h3PolyfillErrors({})).toContain("Choose a geometry column");
    expect(
      h3PolyfillErrors({ geometryField: "geometry", aggregate: "sum" }),
    ).toContain("Choose a value column to aggregate");
    expect(
      h3PolyfillErrors({ geometryField: "geometry", buffer: -1 }),
    ).toContain("Buffer distance cannot be negative");
    expect(
      h3PolyfillErrors({ geometryField: "geometry", resultField: "a b" }),
    ).toContain("Result column must be a valid identifier");
    expect(h3PolyfillErrors({ geometryField: "geometry" })).toEqual([]);
  });
});
