# Visualisation Module Implementation Plan

## Current State (updated May 2026)

The app now has a first-class visualisation architecture:

- **Style specification model**: `LayerVisualisation` union type covering `simple`, `choropleth`, `categorical`, `graduated_symbol`, `heatmap`, `label`, and `dot_density`. Each `MapLayer` carries an optional `visualisation`, `legend`, `clusterRadius`, and `dotDensityLayerId`.
- **MapLibre style compiler**: `src/utils/mapStyleCompiler.ts` generates paint/layout expressions from the visualisation config, including `step` for choropleths, `match` for categories, `interpolate` for graduated symbols, heatmap layers, and companion symbol layers for labels.
- **Visualisation panel**: `src/components/Visualisation/VisualisationPanel.tsx` provides a live editor with field picker, distribution preview with click-to-filter, classification controls, palette picker, temporal slider with animation, clustering toggle, and dot density controls.
- **Visualisation nodes**: `src/components/Flow/VisualisationNode.tsx` attaches style recipes to workflows. Output nodes and per-node execution both resolve and apply the visualisation config via `src/utils/visualisationResolver.ts`.
- **Interactive analytics state**: `src/types/visualAnalytics.ts` defines `VisualFilter` (category, range, temporal), `LayerFeatureSelection` (hovered + selected feature IDs), and `LayerAnalyticsSummary`. MapLibre feature-state drives hover/selection highlighting. DuckDB-backed services (`src/services/visualAnalyticsService.ts`) recompute rows, profiles, and summaries under active filters.
- **Legend and export**: Map-corner legend rendering (`LegendControl.tsx`), legend items in the visualisation panel, and map style export action (`mapStyleExport.ts`).
- **Chat tooling**: LLM tools for `add_visualisation_node` and `style_layer` (all 6 visualisation kinds), plus general node/connection management.
- **Feature identity**: Stable `_ymn_feature_id` assigned on layer creation (`src/utils/featureIdentity.ts`), used for MapLibre `promoteId` and cross-component selection linking.
- **Temporal animation**: Time slider with play/pause, configurable window size, and speed control, backed by DuckDB temporal range detection.
- **Dot density**: DuckDB `ST_GeneratePoints`/`ST_Dump` generates random point GeoJSON from polygon layers, creating companion dot layers.
- **Clustered point maps**: `clusterRadius`/`clusterMaxZoom` on `MapLayer` drive MapLibre cluster sources with circle clusters, count labels, and drill-to-zoom.

**Deferred to future iteration:** flow/OD maps, swipe/side-by-side comparison, bivariate choropleth, difference/change maps, static image export, cartographic output composer.

## Product Goal

Add visualisation modules that let users turn workflow outputs into adjustable map products without writing MapLibre JSON by hand. A user should be able to:

- [x] Select a layer and a data column.
- [x] Inspect the distribution with a histogram/profile view.
- [x] Choose a visualisation type.
- [x] Pick or auto-generate classes, breaks, colours, sizes, labels, and opacity.
- [x] See a legend and update the MapLibre style live.
- [x] Select, hover, filter, brush, and compare features interactively.
- [x] Recompute summaries, histograms, and derived layers from the current interaction state.
- [x] Save the visualisation as a layer style, workflow output configuration, or reusable visualisation node.
- [ ] Compare layers using swipe or side-by-side mode. *(deferred)*
- [ ] Create flow/OD maps. *(deferred)*
- [ ] Build bivariate choropleths. *(deferred)*

## Proposed Architecture

### 0. Interaction and Analytics Principle (implemented)

Keep visual analytics as two cooperating layers:

1. React/Zustand stores lightweight interaction intent.
2. DuckDB performs data-heavy recomputation.

React state stores identifiers and constraints, not large derived datasets:

```ts
export type VisualAnalyticsState = {
  layers: Record<string, LayerFeatureSelection>;
};

export type LayerFeatureSelection = {
  hoveredFeatureId?: string;
  selectedFeatureIds: string[];
  filters: VisualFilter[];
};
```

DuckDB answers "what data result follows from that intent?":

- [x] Filtered feature queries (`queryLayerRows`).
- [x] Selection summaries (`queryLayerSummary`).
- [x] Histogram and profile recomputation under active filters (`queryLayerColumnProfile`).
- [x] Layer registration with signature-based caching.
- [x] H3/hex aggregation (via chat `add_h3_layer`).
- [x] Spatial joins, intersections, buffers, and nearest-neighbour derivations (workflow analysis nodes).
- [x] Temporal range detection and filtering (`queryLayerTemporalRange`).
- [ ] Difference/comparison layers. *(deferred)*

### 1. Style Specification Model (implemented)

`MapLayer` carries `visualisation`, `legend`, and `styleVersion`. The union type `LayerVisualisation` covers:

```ts
export type LayerVisualisation =
  | SimpleVisualisation
  | ChoroplethVisualisation
  | CategoricalVisualisation
  | GraduatedSymbolVisualisation
  | HeatmapVisualisation
  | LabelVisualisation
  | DotDensityVisualisation;
```

Types are defined in `src/types/visualisation.ts`. MapLayer fields in `src/store/useStore.ts`.

### 2. MapLibre Style Compiler (implemented)

`src/utils/mapStyleCompiler.ts` exports:

- [x] `compileLayerStyle(layer, options)` -- returns `{ type, paint, layout?, label? }`
- [x] `compileChoroplethColorExpression(vis)` -- MapLibre `step` expression
- [x] `compileCategoricalColorExpression(vis)` -- MapLibre `match` expression
- [x] `compileLabelLayer(vis, geometryKind)` -- symbol layer config
- [x] Graduated symbol radius via `interpolate`
- [x] Heatmap paint via `heatmap-density`
- [x] `withInteractionColor(baseColor)` -- wraps color with hover/selection feature-state
- [x] `geometryKindForLayer(layer)` -- detects point/line/polygon

### 3. Data Profiling Service (implemented)

Profiling and classification live in:

- `src/utils/classification.ts`: `profileGeoJsonField`, `classifyNumericValues`, `buildChoroplethVisualisation`, `buildCategoricalVisualisation`, `buildGraduatedSymbolVisualisation`, `buildHeatmapVisualisation`, `buildLabelVisualisation`, `buildDotDensityVisualisation`, `buildLegend`
- `src/services/visualAnalyticsService.ts`: `queryLayerColumnProfile` (DuckDB-backed, filter-aware)

No separate `dataProfiling.ts` or `profileService.ts` -- those functions are consolidated.

Classification methods implemented:
- [x] Equal interval
- [x] Quantile
- [x] Categorical top-N
- [ ] Jenks natural breaks *(deferred)*
- [ ] Standard deviation *(deferred)*
- [ ] Manual breakpoints from UI *(deferred)*

### 4. Visualisation Editor Panel (implemented)

`src/components/Visualisation/VisualisationPanel.tsx` is a unified panel containing:
- Field picker, distribution preview (histogram or category bars), classification controls, palette picker, legend preview, temporal range filter, time slider with animation, point clustering controls, dot density controls.

Sub-components were folded inline rather than creating separate `FieldPicker.tsx`, `DistributionPreview.tsx`, `ClassificationControls.tsx`, `PalettePicker.tsx`, `LegendPreview.tsx` files.

### 5. Visualisation Nodes (implemented)

- [x] `src/components/Flow/VisualisationNode.tsx`
- [x] Node type `'visualisation'` in `GISNode['data']['type']`
- [x] `src/utils/workflowEngine.ts` passes visualisation config through `visualisationMetadata`
- [x] `buildUpToSQL` preserves visualisation metadata per target node
- [x] `src/utils/visualisationResolver.ts` resolves configs to `LayerVisualisation + LegendSpec`
- [x] Workflow can branch to multiple styled outputs from the same data source

### 6. Layer Manager Enhancements (implemented)

- [x] `updateLayerVisualisation(layerId, visualisation, legend?)` -- sets visualisation + legend, bumps `styleVersion`
- [x] `clearLayerVisualisation(layerId)` -- removes visualisation and legend
- [x] `reorderMapLayer(layerId, targetIndex)` -- reorders layers in store
- [ ] `duplicateMapLayer(layerId)` *(deferred)*
- [ ] `copyLayerVisualisation(sourceLayerId, targetLayerId)` *(deferred)*

Additional store actions added:
- [x] `updateMapLayer` extended with `clusterRadius`, `clusterMaxZoom`, `dotDensityLayerId`
- [x] `removeMapLayer` cleans up companion dot density layers and their visualAnalytics state

### 7. Chat Tooling (implemented)

LLM tools in `src/utils/toolDefinitions.ts`:
- [x] `add_node` (all node types including visualisation)
- [x] `add_visualisation_node`
- [x] `style_layer` (all 6 visualisation kinds: choropleth, categorical, graduated_symbol, heatmap, label, dot_density)
- [x] `connect_nodes`, `update_node`, `delete_node`, `copy_node`
- [x] `run_spatial_query`
- [x] `add_geojson_layer` (inline handler)
- [x] `add_h3_layer` (inline handler)
- [ ] `classify_layer` *(consolidated into style_layer)*
- [ ] `suggest_visualisations` *(deferred)*
- [ ] `copy_layer_style` *(deferred)*

### 8. Legend and Export (implemented)

- [x] Map-corner legend rendering (`src/components/Map/LegendControl.tsx`)
- [x] Layer manager legend swatches
- [x] Export map style action (`src/utils/mapStyleExport.ts`)
- [ ] Static map/image export *(deferred)*

### 9. Visual Analytics State and DuckDB Services (implemented)

State (`src/types/visualAnalytics.ts`):
- [x] `VisualFilter` with category, range, and temporal kinds
- [x] `LayerFeatureSelection` with hovered + selected feature IDs + filters
- [x] `LayerAnalyticsSummary` with numeric metrics and category breakdowns

Store actions:
- [x] `setHoveredFeature`, `toggleSelectedFeature`, `clearFeatureSelection`
- [x] `setLayerFilters`, `clearLayerFilters`
- [ ] `setLayerBrush` *(deferred)*
- [ ] `setTemporalRange` *(deferred -- handled via filter state)*
- [ ] `setComparisonMode` *(deferred)*

DuckDB-backed services (`src/services/visualAnalyticsService.ts`):
- [x] `registerLayerForAnalytics` (with signature-based cache)
- [x] `queryLayerRows` (filtered + paginated)
- [x] `queryLayerColumnProfile` (DuckDB-backed, filter-aware)
- [x] `queryLayerSummary` (selection + filter summaries)
- [x] `queryLayerTemporalRange` (min/max date detection)
- [ ] `queryComparisonLayer` *(deferred)*
- [ ] `queryTemporalBins` *(deferred)*

### 10. Feature Identity Model (implemented)

- [x] `_ymn_feature_id` property on all GeoJSON features
- [x] ID strategy: prefers existing PK/ID columns, falls back to `{layerId}:{index}`
- [x] `promoteId: '_ymn_feature_id'` on MapLibre GeoJSON sources
- [x] `featureIdFromMapFeature` for MapLibre event feature ID extraction
- [x] `ensureFeatureIds` called on layer creation via `hydrateLayer`

## Phased Implementation

### Phase 1: Foundations

- [x] Add visualisation types to `useStore.ts`.
- [x] Add `updateLayerVisualisation`, `clearLayerVisualisation`, and reorder actions.
- [x] Create `mapStyleCompiler.ts`.
- [x] Refactor `MapView.tsx` so paint/layout comes from the compiler.
- [x] Preserve existing simple colour/opacity behaviour as the default `simple` visualisation.
- [x] Add tests for compiler output for point, line, polygon, choropleth, and categorical styles.

Acceptance criteria:

- [x] Existing layers still render with the default simple style path.
- [x] A hard-coded choropleth config on a polygon layer renders via MapLibre `step`.
- [x] A hard-coded categorical config renders via MapLibre `match`.
- [x] Basemap switching re-applies styled layers correctly through the compiler-driven sync path.

### Phase 2: Profiling and Classification

- [x] Extract profile logic from `App.tsx`. Layer profiling moved into `classification.ts` and `visualAnalyticsService.ts`; node preview profiling still has local logic in `App.tsx`.
- [x] Implement classification utilities.
- [x] Add unit tests for equal interval, quantile, categorical top-N, and null handling.
- [x] Wire the existing `DataTable` histogram to the shared profile service. Selected map layers use DuckDB-backed shared services; workflow node tables still use the existing node SQL path.
- [x] Add field type detection from layer feature properties. Basic detection via `profileGeoJsonField` heuristics (80% numeric threshold).

Acceptance criteria:

- [x] Attribute inspector still profiles columns.
- [x] Classification results are deterministic.
- [x] Numeric and categorical fields produce different visualisation behavior.

### Phase 3: Visualisation Panel

- [x] Add a `Visualise` tab/panel in the right panel.
- [x] Build field picker, histogram/category profile, class controls, and palette picker.
- [x] Add live preview by updating `selectedLayer.visualisation`.
- [x] Add legend preview with click-to-filter.
- [x] Add reset control (eraser button).

Acceptance criteria:

- [x] User can build a choropleth without writing SQL or JSON.
- [x] User can change class method, class count, and palette.
- [x] Map and legend update immediately.
- [x] Null/missing values are represented.

### Phase 4: Interaction State and Feature Selection

- [x] Add first-class visual analytics state to the store.
- [x] Assign stable `_ymn_feature_id` values to rendered GeoJSON features.
- [x] Add hover and click selection state in `MapView`.
- [x] Add selected-feature styling with MapLibre feature-state.
- [x] Link selected map features to the attribute table (row highlighting).
- [x] Add a selection summary panel (`SelectionSummary.tsx`).

Acceptance criteria:

- [x] Hovering a feature highlights it without changing the layer style.
- [x] Clicking a feature stores its ID in interaction state.
- [x] The attribute table shows selected features with highlighting.
- [x] Clearing selection restores the default map/table state.
- [x] Selection state is separate from selected layer/node state.

### Phase 5: DuckDB-Backed Interactive Filtering and Profiling

- [x] Add a service for translating visual filters into safe DuckDB SQL predicates (`visualFilterSql.ts`).
- [x] Recompute attribute rows from active filters (`queryLayerRows`).
- [x] Recompute histograms/profiles from active filters (`queryLayerColumnProfile`).
- [x] Let legend category/class clicks filter or isolate values.
- [x] Let distribution bar clicks filter or isolate values.
- [x] Cache recent profile/filter results via signature-based layer registration.
- [x] Add active filter chips with remove and clear-all controls (`FilterChips.tsx`).
- [x] Add DuckDB-backed summaries for selected or filtered subsets (`queryLayerSummary`, `SelectionSummary.tsx`).

Acceptance criteria:

- [x] Filtering a category in the legend updates the map, table, and profile.
- [x] Clicking a distribution bin updates the filtered map/table/profile state.
- [x] Profiles are recomputed for the filtered subset.
- [x] Filter operations use DuckDB rather than large in-memory scans.

### Phase 6: Visualisation Nodes

- [x] Add `VisualisationNode.tsx`.
- [x] Add node library entry.
- [x] Update workflow result metadata to carry visualisation config.
- [x] Let output execution attach visualisation config to the produced `MapLayer` (Sidebar, OutputNode preview, and NodeActions per-node execution).
- [x] Add chat tool support for visualisation node creation and updates.

Acceptance criteria:

- [x] A workflow can branch into two styled outputs from the same data.
- [x] Re-running the workflow preserves the intended style.
- [x] Chat can create a choropleth, graduated symbol, categorical, heatmap, label, or dot density map.

### Phase 7: Comparison and Temporal Analytics

- [ ] Add layer comparison state for swipe and side-by-side modes. *(deferred)*
- [ ] Add DuckDB-backed difference layer generation. *(deferred)*
- [x] Add date/time field detection via `queryLayerTemporalRange` (DuckDB `TRY_CAST`).
- [x] Add temporal range filtering (date pickers + animated time slider).
- [ ] Add time-bin summaries for charts and animation frames. *(deferred)*

Acceptance criteria:

- [ ] Users can compare two layers visually using swipe or side-by-side mode. *(deferred)*
- [x] Users can filter a temporal layer by a date range (static pickers or animated slider).
- [ ] DuckDB can return time-binned counts or summaries for the active layer. *(deferred)*
- [ ] Difference layers are treated as derived session layers. *(deferred)*

### Phase 8: Additional Visualisation Modules

- [x] Choropleth polygons.
- [x] Categorised polygons/lines/points.
- [x] Graduated/proportional point symbols.
- [x] Heatmaps for dense points.
- [x] Labels and annotations (companion symbol layer).
- [x] Clustered point maps (MapLibre cluster sources with drill-to-zoom).
- [x] H3/hex bin styling (H3 layers use standard GeoJSON polygon styling; visualisation panel works for H3 layers).
- [x] Dot density maps (DuckDB `ST_GeneratePoints` + companion point layer).
- [ ] Flow/OD maps. *(deferred)*
- [x] Time slider and animated temporal layers (`TemporalSlider.tsx`).
- [x] Linked chart/map brushing (distribution click → filter, histogram → filter, legend → filter).
- [x] Interactive legend filtering.
- [ ] Swipe and side-by-side map comparison. *(deferred)*
- [ ] Difference/change maps. *(deferred)*
- [x] Selection summaries and linked table/map/chart views (`SelectionSummary.tsx`).

## Case Studies and Previously Identified Gaps

### 1. Socio-Economic Choropleth -- RESOLVED

Numeric classification, histogram/distribution view, diverging palettes, clear legends, and null handling all implemented. Normalisation support available via `attribute` nodes in workflows.

### 2. Category Land-Use or Zoning Map -- RESOLVED

Categorical profiling, Top-N categories plus "Other", stable category-colour assignments, and `match` expression generation all implemented.

### 3. Graduated Symbol Map -- RESOLVED

Numeric field mapped to circle radius via `interpolate`, min/max size controls, size legend. Dual encoding (color by second field) not yet implemented.

### 4. Dense Point Heatmap -- RESOLVED

MapLibre `heatmap` layer type, weight field, radius/intensity controls, zoom-dependent paint. Large point set performance remains a concern for GeoJSON-based rendering.

### 5. H3/Hexbin Analytical Map -- RESOLVED

H3 generation via chat `add_h3_layer`, styling via standard visualisation panel (choropleth/categorical on hex properties).

### 6. Flow or Origin-Destination Map -- DEFERRED

Requires new node type for OD data, curve generation, directional symbols. Marked for future iteration.

### 7. Temporal Map -- PARTIALLY RESOLVED

Date/time field detection, temporal filtering (static + animated slider), optional animation implemented. Time-bin aggregation deferred.

### 8. Bivariate Choropleth -- DEFERRED

Requires 2D classification grid, bivariate palette system, complex legend. Marked for future iteration.

### 9. Linked Chart and Map Brushing -- RESOLVED

Feature identity model, selection state, MapLibre feature-state expressions, click-to-filter distribution/legend, and linked table highlighting all implemented.

### 10. Cartographic Output Map -- DEFERRED

Static map/image export and composer UI deferred for future version.

### 11. Interactive Filtering and Selection -- RESOLVED

Feature IDs, selection state decoupled from layer state, category/range/temporal filter types, DuckDB summary/profile queries, filter chips, and reset controls all implemented.

### 12. Map Comparison and Change Exploration -- DEFERRED

Swipe/side-by-side comparison, layer pairing, difference layer generation all deferred.

## Files Created

| File | Purpose |
|------|---------|
| `src/types/visualisation.ts` | LayerVisualisation union, LegendSpec, ClassificationMethod |
| `src/types/visualAnalytics.ts` | VisualFilter, LayerFeatureSelection, LayerAnalyticsSummary, FEATURE_ID_PROPERTY |
| `src/utils/mapStyleCompiler.ts` | Compiles visualisation config to MapLibre paint/layout expressions |
| `src/utils/classification.ts` | Profiling, classification, visualisation builders, legend builder |
| `src/utils/palettes.ts` | Sequential palettes (teal, magma, forest, civic), categorical palette, fitter |
| `src/utils/visualFilterSql.ts` | Translates VisualFilter[] to DuckDB WHERE clauses |
| `src/utils/visualisationResolver.ts` | Resolves workflow visualisation configs to LayerVisualisation + LegendSpec |
| `src/utils/featureIdentity.ts` | Assigns stable `_ymn_feature_id` to GeoJSON features |
| `src/utils/mapStyleExport.ts` | Exports map layer styles as JSON |
| `src/services/visualAnalyticsService.ts` | DuckDB-backed queries for rows, profiles, summaries, temporal ranges |
| `src/services/dotDensityService.ts` | DuckDB `ST_GeneratePoints`/`ST_Dump` dot generation |
| `src/components/Visualisation/VisualisationPanel.tsx` | Unified style editor with all controls |
| `src/components/Visualisation/FilterChips.tsx` | Active filter display with remove/clear |
| `src/components/Visualisation/SelectionSummary.tsx` | DuckDB-backed selection metrics display |
| `src/components/Visualisation/TemporalSlider.tsx` | Animated time range slider with play/pause |
| `src/components/Map/LegendControl.tsx` | Map-corner legend overlay for visible styled layers |
| `src/components/Flow/VisualisationNode.tsx` | Workflow node for attaching style recipes |

## Test Coverage

| Test file | What it covers |
|-----------|---------------|
| `src/utils/mapStyleCompiler.test.ts` | Compiler output for simple, choropleth, categorical styles across geometry types |
| `src/utils/classification.test.ts` | Profiling, classification, legend building for numeric and categorical |
| `src/utils/visualFilterSql.test.ts` | Filter SQL compilation for category, range, and temporal filters |
| `src/services/visualAnalyticsService.test.ts` | Layer registration cache hits and eviction |
| `src/utils/workflowEngine.test.ts` | Workflow SQL generation and visualisation node propagation |
| `src/utils/mapStyleExport.test.ts` | Map style export payload structure |
| `src/store/useStore.test.ts` | Store actions for layer management |
| `src/sampleWorkflowSmoke.test.tsx` | Full workflow node sequence, layer management, chat tools, output config |
| `src/visualisationIntegration.test.ts` | End-to-end pipeline: all 6 vis kinds, resolver, branching, interaction state, feature IDs, clustering, cleanup |
