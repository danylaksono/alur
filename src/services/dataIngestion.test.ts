import { describe, expect, it } from "vitest";
import {
  detectIngestionFormat,
  h3CellColumnScore,
  ingestClipboardText,
  looksLikeH3Cell,
  parseJsonDataset,
  tableNameForFile,
} from "./dataIngestion";

describe("data ingestion detection and JSON normalisation", () => {
  it("detects every supported format without trusting case", () => {
    expect(detectIngestionFormat("DATA.PARQUET")).toBe("parquet");
    expect(detectIngestionFormat("rows.csv")).toBe("csv");
    expect(detectIngestionFormat("map.geojson")).toBe("geojson");
    expect(detectIngestionFormat("api", "application/json")).toBe("json");
    expect(detectIngestionFormat("notes.txt")).toBeNull();
  });

  it("normalises GeoJSON features while preserving rows with null geometry", () => {
    const parsed = parseJsonDataset(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: 7,
            properties: { name: "valid" },
            geometry: { type: "Point", coordinates: [-1, 52] },
          },
          { type: "Feature", properties: { name: "missing" }, geometry: null },
        ],
      }),
    );
    expect(parsed.format).toBe("geojson");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ name: "valid", __geojson_id: 7 });
    expect(parsed.rows[1]).toMatchObject({
      name: "missing",
      __alur_geojson: null,
    });
  });

  it("rejects scalar JSON and makes stable SQL-safe table names", () => {
    expect(() => parseJsonDataset("[1,2]")).toThrow(/array of objects/);
    expect(tableNameForFile("2026 places.geojson")).toBe("t_2026_places");
  });

  it("recognises canonical H3 cell ids and scores candidate column names", () => {
    expect(looksLikeH3Cell("878d8cb16ffffff")).toBe(true);
    expect(looksLikeH3Cell("8f089b1a2bb520a")).toBe(true);
    expect(looksLikeH3Cell("878d8cb16fffff")).toBe(false); // too short
    expect(looksLikeH3Cell("not-a-cell")).toBe(false);
    expect(looksLikeH3Cell(123)).toBe(false);
    expect(looksLikeH3Cell("878d8cb16ffffffz")).toBe(false); // not hex

    expect(h3CellColumnScore("h3_cell")).toBeGreaterThan(
      h3CellColumnScore("id"),
    );
    expect(h3CellColumnScore("hex_id")).toBeGreaterThan(
      h3CellColumnScore("name"),
    );
    expect(h3CellColumnScore("cell")).toBeGreaterThan(
      h3CellColumnScore("value"),
    );
    expect(h3CellColumnScore("value")).toBe(1);
  });

  it("rejects unstructured clipboard text before creating a source", async () => {
    await expect(ingestClipboardText("just a sentence")).rejects.toThrow(
      /CSV, or TSV/,
    );
  });
});
