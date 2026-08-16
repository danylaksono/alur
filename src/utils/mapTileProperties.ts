import type { LayerVisualisation } from "../types/visualisation";
import type { VisualFilter } from "../types/visualAnalytics";

const visualisationFields = (visualisation?: LayerVisualisation): string[] => {
  if (!visualisation || visualisation.kind === "simple") return [];
  if (visualisation.kind === "bivariate")
    return [visualisation.fieldX, visualisation.fieldY];
  if (visualisation.kind === "glyph_grid") return visualisation.fields;
  if (visualisation.kind === "h3grid")
    return visualisation.valueField ? [visualisation.valueField] : [];
  if ("field" in visualisation && visualisation.field)
    return [visualisation.field];
  return [];
};

/**
 * Keep initial vector tiles lean. Attribute columns are embedded only when a
 * MapLibre style or client-side filter actually reads them; table analytics
 * continue to use the complete DuckDB relation.
 */
export const requiredMapTileProperties = (
  availableProperties: string[],
  visualisation: LayerVisualisation | undefined,
  filters: VisualFilter[],
) => {
  const available = new Set(availableProperties);
  return [
    ...new Set([
      ...visualisationFields(visualisation),
      ...filters.map((filter) => filter.field),
    ]),
  ]
    .filter((field) => available.has(field))
    .sort((a, b) => a.localeCompare(b));
};
