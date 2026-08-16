import { describe, expect, it } from "vitest";
import {
  buildCategoricalVisualisation,
  buildChoroplethVisualisation,
  buildH3GridVisualisation,
  buildLegend,
  classifyNumericValues,
  profileGeoJsonField,
} from "./classification";

const fc = (values: Array<Record<string, unknown>>): GeoJSON.Feature[] =>
  values.map((properties, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [index, index] },
    properties,
  }));

describe("classification utilities", () => {
  it("profiles numeric GeoJSON fields with bins and null counts", () => {
    const profile = profileGeoJsonField(
      fc([{ need: 10 }, { need: 20 }, { need: null }, { need: 30 }]),
      "need",
    );

    expect(profile.kind).toBe("numeric");
    if (profile.kind !== "numeric") throw new Error("expected numeric profile");
    expect(profile.min).toBe(10);
    expect(profile.max).toBe(30);
    expect(profile.nullCount).toBe(1);
    expect(profile.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
  });

  it("profiles categorical fields by frequency", () => {
    const profile = profileGeoJsonField(
      fc([
        { borough: "Camden" },
        { borough: "Hackney" },
        { borough: "Camden" },
      ]),
      "borough",
    );

    expect(profile.kind).toBe("categorical");
    if (profile.kind !== "categorical")
      throw new Error("expected categorical profile");
    expect(profile.categories[0]).toEqual({ value: "Camden", count: 2 });
  });

  it("classifies numeric values with equal intervals and quantiles", () => {
    expect(classifyNumericValues([0, 10, 20, 30], "equal_interval", 4)).toEqual(
      [7.5, 15, 22.5],
    );
    expect(classifyNumericValues([0, 10, 20, 30], "quantile", 2)).toEqual([10]);
  });

  it("builds choropleth and categorical legends", () => {
    const numeric = profileGeoJsonField(
      fc([{ need: 10 }, { need: 20 }, { need: 30 }, { need: 40 }]),
      "need",
    );
    if (numeric.kind !== "numeric") throw new Error("expected numeric profile");
    const choropleth = buildChoroplethVisualisation({
      field: "need",
      profile: numeric,
      method: "quantile",
      classCount: 3,
      palette: ["#fee2e2", "#ef4444", "#7f1d1d"],
    });
    expect(choropleth.kind).toBe("choropleth");
    expect(buildLegend(choropleth)).toMatchObject({
      classification: { method: "quantile" },
      palette: { name: "Custom", colorBlindSafe: false },
    });
    expect(buildLegend(choropleth).items.at(-1)?.label).toBe("No data");

    const categorical = profileGeoJsonField(
      fc([{ borough: "Camden" }, { borough: "Hackney" }]),
      "borough",
    );
    if (categorical.kind !== "categorical")
      throw new Error("expected categorical profile");
    const categories = buildCategoricalVisualisation({
      field: "borough",
      profile: categorical,
    });
    const categoryLegend = buildLegend(categories);
    expect(categoryLegend.items.map((item) => item.label)).toContain("Other");
    expect(categoryLegend.items[0]).toMatchObject({
      count: 1,
      percentage: 0.5,
    });
  });

  it("builds an h3 grid visualisation with sane defaults and a ramp legend", () => {
    const vis = buildH3GridVisualisation({
      cellColumn: "h3_cell",
      palette: ["#fff", "#000"],
    });
    expect(vis).toMatchObject({
      kind: "h3grid",
      cellColumn: "h3_cell",
      extruded: false,
      elevationScale: 1,
      opacity: 0.82,
    });
    expect(vis.valueField).toBeUndefined();

    const valued = buildH3GridVisualisation({
      cellColumn: "cell",
      valueField: "population",
      palette: ["#fff", "#000"],
      extruded: true,
      elevationScale: 3,
    });
    expect(valued.valueField).toBe("population");
    expect(valued.extruded).toBe(true);

    const legend = buildLegend(valued);
    expect(legend.title).toContain("population");
    expect(legend.kind).toBe("heatmap");
    expect(legend.items.length).toBeGreaterThanOrEqual(2);
  });
});
