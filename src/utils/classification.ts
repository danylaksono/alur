import type {
  CategoricalVisualisation,
  ChoroplethVisualisation,
  GraduatedSymbolVisualisation,
  HeatmapVisualisation,
  LabelVisualisation,
  DotDensityVisualisation,
  ExtrusionVisualisation,
  GraduatedLineVisualisation,
  HexbinVisualisation,
  HexbinAggregate,
  BivariateVisualisation,
  ClassificationMethod,
  GlyphGridVisualisation,
  GlyphGridGlyph,
  H3GridVisualisation,
  LayerVisualisation,
  LegendSpec,
} from "../types/visualisation";
import {
  CATEGORICAL_PALETTE,
  fitPaletteToClassCount,
  paletteMetadataForColors,
} from "./palettes";
import { numericExtent } from "./extent";

export type NumericProfile = {
  kind: "numeric";
  total: number;
  nullCount: number;
  min: number;
  max: number;
  values: number[];
  bins: Array<{ label: string; count: number; min: number; max: number }>;
};

export type CategoricalProfile = {
  kind: "categorical";
  total: number;
  nullCount: number;
  categories: Array<{ value: string; count: number }>;
};

export type FieldProfile = NumericProfile | CategoricalProfile;

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const asNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const profileGeoJsonField = (
  features: GeoJSON.Feature[],
  field: string,
  options: { binCount?: number; categoryLimit?: number } = {},
): FieldProfile => {
  const binCount = options.binCount ?? 12;
  const categoryLimit = options.categoryLimit ?? 12;
  const rawValues = features.map(
    (feature) =>
      (feature.properties as Record<string, unknown> | null)?.[field],
  );
  const nonNull = rawValues.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
  const numericValues = nonNull
    .map(asNumber)
    .filter((value): value is number => value !== null);
  const nullCount = rawValues.length - nonNull.length;

  if (
    numericValues.length > 0 &&
    numericValues.length >= nonNull.length * 0.8
  ) {
    const { min, max } = numericExtent(numericValues);
    const width = max === min ? 1 : (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => {
      const low = min + width * index;
      const high = min + width * (index + 1);
      return {
        label: `${numberFormatter.format(low)}-${numberFormatter.format(high)}`,
        min: low,
        max: high,
        count: 0,
      };
    });

    numericValues.forEach((value) => {
      const index =
        max === min
          ? 0
          : Math.min(binCount - 1, Math.floor((value - min) / width));
      bins[index].count += 1;
    });

    return {
      kind: "numeric",
      total: rawValues.length,
      nullCount,
      min,
      max,
      values: numericValues.sort((a, b) => a - b),
      bins,
    };
  }

  const counts = new Map<string, number>();
  nonNull.forEach((value) => {
    const label = String(value);
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return {
    kind: "categorical",
    total: rawValues.length,
    nullCount,
    categories: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, categoryLimit)
      .map(([value, count]) => ({ value, count })),
  };
};

export const classifyNumericValues = (
  values: number[],
  method: Extract<
    ClassificationMethod,
    "equal_interval" | "quantile" | "manual"
  >,
  classCount: number,
  manualBreaks?: number[],
) => {
  if (!values.length) return [];
  if (method === "manual" && manualBreaks?.length)
    return [...manualBreaks].sort((a, b) => a - b);

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const count = Math.max(2, classCount);

  if (max === min) return [min];

  if (method === "quantile") {
    const breaks = Array.from({ length: count - 1 }, (_, index) => {
      const position = ((index + 1) * sorted.length) / count;
      return sorted[
        Math.min(sorted.length - 1, Math.max(0, Math.ceil(position) - 1))
      ];
    });
    return [...new Set(breaks)].sort((a, b) => a - b);
  }

  const width = (max - min) / count;
  return Array.from(
    { length: count - 1 },
    (_, index) => min + width * (index + 1),
  );
};

export const buildChoroplethVisualisation = ({
  field,
  profile,
  method,
  classCount,
  palette,
}: {
  field: string;
  profile: NumericProfile;
  method: ChoroplethVisualisation["method"];
  classCount: number;
  palette: string[];
}): ChoroplethVisualisation => {
  const resolvedClassCount = Math.max(2, Math.min(9, classCount));
  const breaks = classifyNumericValues(
    profile.values,
    method,
    resolvedClassCount,
  );
  const paletteSize = Math.max(2, breaks.length + 1);
  return {
    kind: "choropleth",
    field,
    method,
    classCount: paletteSize,
    breaks,
    palette: fitPaletteToClassCount(palette, paletteSize),
    nullColor: "#e2e8f0",
    opacity: 0.72,
    outlineColor: "#334155",
    outlineWidth: 0.7,
  };
};

export const buildCategoricalVisualisation = ({
  field,
  profile,
  topN = 8,
}: {
  field: string;
  profile: CategoricalProfile;
  topN?: number;
}): CategoricalVisualisation => ({
  kind: "categorical",
  field,
  method: "categorical_top_n",
  categories: profile.categories.slice(0, topN).map((category, index) => ({
    ...category,
    color: CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length],
  })),
  otherColor: "#94a3b8",
  nullColor: "#e2e8f0",
  opacity: 0.78,
  totalCount: profile.total,
});

export const buildGraduatedSymbolVisualisation = ({
  field,
  profile,
}: {
  field: string;
  profile: NumericProfile;
}): GraduatedSymbolVisualisation => ({
  kind: "graduated_symbol",
  field,
  method: "equal_interval",
  minValue: profile.min,
  maxValue: profile.max,
  minRadius: 4,
  maxRadius: 16,
  color: "#2563eb",
  opacity: 0.78,
});

export const buildHeatmapVisualisation = ({
  field,
  palette,
}: {
  field?: string;
  palette: string[];
}): HeatmapVisualisation => ({
  kind: "heatmap",
  field,
  palette: fitPaletteToClassCount(palette, 5),
  radius: 24,
  intensity: 1,
  opacity: 0.72,
});

export const buildLabelVisualisation = ({
  field,
}: {
  field: string;
}): LabelVisualisation => ({
  kind: "label",
  field,
  fontSize: 11,
  color: "#1e293b",
  haloColor: "#ffffff",
  haloWidth: 1.5,
  minZoom: 0,
});

export const buildDotDensityVisualisation = ({
  field,
}: {
  field: string;
}): DotDensityVisualisation => ({
  kind: "dot_density",
  field,
  dotValue: 100,
  color: "#0d9488",
  radius: 2.5,
  opacity: 0.65,
});

export const buildExtrusionVisualisation = ({
  field,
  profile,
  classCount,
  palette,
  heightMultiplier,
}: {
  field: string;
  profile: NumericProfile;
  classCount: number;
  palette: string[];
  heightMultiplier: number;
}): ExtrusionVisualisation => {
  const resolvedClassCount = Math.max(2, Math.min(9, classCount));
  const breaks = classifyNumericValues(
    profile.values,
    "quantile",
    resolvedClassCount,
  );
  const paletteSize = Math.max(2, breaks.length + 1);
  return {
    kind: "extrusion",
    field,
    method: "quantile",
    classCount: paletteSize,
    breaks,
    palette: fitPaletteToClassCount(palette, paletteSize),
    nullColor: "#e2e8f0",
    heightMultiplier,
    opacity: 0.85,
  };
};

export const buildGraduatedLineVisualisation = ({
  field,
  profile,
}: {
  field: string;
  profile: NumericProfile;
}): GraduatedLineVisualisation => ({
  kind: "graduated_line",
  field,
  minValue: profile.min,
  maxValue: profile.max,
  minWidth: 1,
  maxWidth: 8,
  color: "#2563eb",
  opacity: 0.85,
});

export const buildHexbinVisualisation = ({
  field,
  aggregate,
  cellSize,
}: {
  field?: string;
  aggregate: HexbinAggregate;
  cellSize: number;
}): HexbinVisualisation => ({
  kind: "hexbin",
  field: aggregate === "count" ? undefined : field,
  aggregate,
  cellSize: Math.max(50, Math.min(20000, Math.round(cellSize))),
});

export const buildBivariateVisualisation = ({
  fieldX,
  fieldY,
  profileX,
  profileY,
  palette,
}: {
  fieldX: string;
  fieldY: string;
  profileX: NumericProfile;
  profileY: NumericProfile;
  palette: string[];
}): BivariateVisualisation => ({
  kind: "bivariate",
  fieldX,
  fieldY,
  breaksX: classifyNumericValues(profileX.values, "quantile", 3),
  breaksY: classifyNumericValues(profileY.values, "quantile", 3),
  palette,
  nullColor: "#e2e8f0",
  opacity: 0.78,
  outlineColor: "#334155",
  outlineWidth: 0.5,
});

export const buildGlyphGridVisualisation = ({
  mode,
  cellSize,
  glyph,
  fields,
  aggregate,
  palette,
}: {
  mode: "grid" | "hex";
  cellSize: number;
  glyph: GlyphGridGlyph;
  fields: string[];
  aggregate: "count" | "sum" | "avg";
  palette: string[];
}): GlyphGridVisualisation => ({
  kind: "glyph_grid",
  mode,
  cellSize: Math.max(24, Math.min(128, Math.round(cellSize))),
  glyph,
  fields: fields.slice(0, 6),
  aggregate,
  palette,
  opacity: 0.85,
});

export const buildH3GridVisualisation = ({
  cellColumn,
  valueField,
  palette,
  extruded = false,
  elevationScale = 1,
}: {
  cellColumn: string;
  valueField?: string;
  palette: string[];
  extruded?: boolean;
  elevationScale?: number;
}): H3GridVisualisation => ({
  kind: "h3grid",
  cellColumn,
  valueField: valueField || undefined,
  palette,
  opacity: 0.82,
  extruded,
  elevationScale: Math.max(0.01, elevationScale),
});

const classBreakItems = (breaks: number[], palette: string[]) =>
  palette.map((color, index) => {
    const low = index === 0 ? undefined : breaks[index - 1];
    const high = breaks[index];
    const label =
      index === 0
        ? `< ${numberFormatter.format(high ?? 0)}`
        : high === undefined
          ? `>= ${numberFormatter.format(low ?? 0)}`
          : `${numberFormatter.format(low ?? 0)}-${numberFormatter.format(high)}`;
    return { label, min: low, max: high, color };
  });

export const buildLegend = (
  visualisation: Exclude<LayerVisualisation, { kind: "simple" }>,
): LegendSpec => {
  if (visualisation.kind === "label") {
    return {
      title: visualisation.field,
      kind: "simple",
      items: [
        { label: `Label: ${visualisation.field}`, color: visualisation.color },
      ],
    };
  }

  if (visualisation.kind === "cartogram") {
    // A cartogram re-shapes geometry rather than encoding a value in colour, so
    // the key describes where on the morph the map currently sits.
    const percent = Math.round(visualisation.morphFactor * 100);
    return {
      title: "Grid cartogram",
      kind: "simple",
      items: [
        {
          label:
            percent === 0
              ? "Geography"
              : percent === 100
                ? "Equal-area grid"
                : `${percent}% toward the grid`,
          color: visualisation.fillColor,
        },
      ],
    };
  }

  if (visualisation.kind === "dot_density") {
    return {
      title: visualisation.field,
      kind: "simple",
      items: [
        {
          label: `1 dot ≈ ${visualisation.dotValue.toLocaleString()} ${visualisation.field}`,
          color: visualisation.color,
        },
      ],
    };
  }

  if (visualisation.kind === "categorical") {
    const visibleTotal =
      visualisation.totalCount ||
      visualisation.categories.reduce(
        (sum, category) => sum + (category.count || 0),
        0,
      );
    return {
      title: visualisation.field,
      kind: "categorical",
      classification: { method: visualisation.method },
      palette: paletteMetadataForColors(
        visualisation.categories.map((category) => category.color),
        visualisation.categories.length,
      ),
      items: [
        ...visualisation.categories.map((category) => ({
          label: category.value,
          value: category.value,
          color: category.color,
          count: category.count,
          percentage:
            category.count !== undefined && visibleTotal > 0
              ? category.count / visibleTotal
              : undefined,
        })),
        { label: "Other", color: visualisation.otherColor },
        { label: "No data", color: visualisation.nullColor },
      ],
    };
  }

  if (visualisation.kind === "graduated_symbol") {
    return {
      title: visualisation.field,
      kind: "graduated_symbol",
      items: [
        {
          label: `${visualisation.minRadius}px`,
          color: visualisation.color,
          min: visualisation.minRadius,
        },
        {
          label: `${visualisation.maxRadius}px`,
          color: visualisation.color,
          max: visualisation.maxRadius,
        },
      ],
    };
  }

  if (visualisation.kind === "heatmap") {
    return {
      title: visualisation.field || "Density",
      kind: "heatmap",
      items: visualisation.palette.map((color, index) => ({
        label:
          index === 0
            ? "Low"
            : index === visualisation.palette.length - 1
              ? "High"
              : "Medium",
        color,
      })),
    };
  }

  if (visualisation.kind === "graduated_line") {
    return {
      title: visualisation.field,
      kind: "graduated_line",
      items: [
        {
          label: `${numberFormatter.format(visualisation.minValue)} (${visualisation.minWidth}px)`,
          color: visualisation.color,
        },
        {
          label: `${numberFormatter.format(visualisation.maxValue)} (${visualisation.maxWidth}px)`,
          color: visualisation.color,
        },
      ],
    };
  }

  if (visualisation.kind === "hexbin") {
    const metric =
      visualisation.aggregate === "count"
        ? "count"
        : `${visualisation.aggregate}(${visualisation.field ?? ""})`;
    const sizeLabel =
      visualisation.cellSize >= 1000
        ? `${(visualisation.cellSize / 1000).toLocaleString()} km`
        : `${visualisation.cellSize.toLocaleString()} m`;
    return {
      title: "Hexbin",
      kind: "simple",
      items: [{ label: `hex ${sizeLabel} · ${metric}`, color: "#0f766e" }],
    };
  }

  if (visualisation.kind === "glyph_grid") {
    const shape = visualisation.mode === "hex" ? "hex" : "grid";
    if (
      ["pie", "donut", "bars", "radial"].includes(visualisation.glyph) &&
      visualisation.fields.length
    ) {
      return {
        title: `Glyph ${shape} · ${visualisation.glyph}`,
        kind: "simple",
        items: visualisation.fields.map((field, index) => ({
          label: field,
          color: visualisation.palette[index % visualisation.palette.length],
        })),
      };
    }
    const metric =
      visualisation.aggregate === "count"
        ? "count"
        : `${visualisation.aggregate}(${visualisation.fields[0] ?? ""})`;
    return {
      title: `Glyph ${shape} · ${metric}`,
      kind: "heatmap",
      items: visualisation.palette.map((color, index) => ({
        label:
          index === 0
            ? "Low"
            : index === visualisation.palette.length - 1
              ? "High"
              : "",
        color,
      })),
    };
  }

  if (visualisation.kind === "h3grid") {
    const metric = visualisation.valueField
      ? visualisation.valueField
      : "count";
    const elevation = visualisation.extruded
      ? ` · 3D ×${visualisation.elevationScale}`
      : "";
    return {
      title: `H3 grid · ${metric}${elevation}`,
      kind: "heatmap",
      items: visualisation.palette.map((color, index) => ({
        label:
          index === 0
            ? "Low"
            : index === visualisation.palette.length - 1
              ? "High"
              : "",
        color,
      })),
    };
  }

  if (visualisation.kind === "bivariate") {
    const classLabels = ["low", "mid", "high"];
    const items = visualisation.palette.map((color, index) => {
      const row = Math.floor(index / 3);
      const column = index % 3;
      return {
        label: `${visualisation.fieldX} ${classLabels[column]} · ${visualisation.fieldY} ${classLabels[row]}`,
        color,
        row,
        column,
      };
    });
    return {
      title: `${visualisation.fieldX} → · ${visualisation.fieldY} ↑`,
      kind: "bivariate",
      items: [...items, { label: "No data", color: visualisation.nullColor }],
    };
  }

  // choropleth + extrusion share the classed-breaks legend shape.
  return {
    title: visualisation.field,
    kind: visualisation.kind,
    classification: {
      method: visualisation.method,
      breaks: visualisation.breaks,
    },
    palette: paletteMetadataForColors(
      visualisation.palette,
      visualisation.palette.length,
    ),
    items: [
      ...classBreakItems(visualisation.breaks, visualisation.palette),
      { label: "No data", color: visualisation.nullColor },
    ],
  };
};
