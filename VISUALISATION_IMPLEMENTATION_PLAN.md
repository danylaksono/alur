# Visualisation Module Implementation Plan

## Current State

The app already has the core ingredients for interactive GIS visualisation:

- DuckDB-Wasm loads spatial data and can emit GeoJSON from workflow outputs.
- MapLibre renders each `MapLayer` as one simple GeoJSON source/layer.
- React Flow models data processing as nodes.
- The attribute inspector can profile numeric and categorical columns with a compact histogram.
- The layer manager supports visibility, opacity, zoom-to-layer, deletion, basemap changes, and layer/node linkage.

The missing layer is a first-class visualisation model. Today `MapLayer` only stores `color` and `opacity`, and `MapView` converts geometry type into one fixed MapLibre paint style. Choropleths, graduated symbols, category colours, temporal filters, labels, legends, and chart-linked map interactions all need a reusable style specification that can be edited from nodes, chat, or layer controls and compiled into MapLibre expressions.

The next layer after styling is first-class interactive visual analytics state. The app should not treat visualisation only as style generation. Map selections, legend filters, histogram brushes, temporal ranges, comparison modes, and linked table/chart/map highlighting should be represented explicitly, then resolved through DuckDB where the interaction requires filtering, aggregation, profiling, or spatial derivation.

## Product Goal

Add visualisation modules that let users turn workflow outputs into adjustable map products without writing MapLibre JSON by hand. A user should be able to:

- Select a layer and a data column.
- Inspect the distribution with a histogram/profile view.
- Choose a visualisation type.
- Pick or auto-generate classes, breaks, colours, sizes, labels, and opacity.
- See a legend and update the MapLibre style live.
- Select, hover, filter, brush, and compare features interactively.
- Recompute summaries, histograms, and derived layers from the current interaction state.
- Save the visualisation as a layer style, workflow output configuration, or reusable visualisation node.

## Proposed Architecture

### 0. Interaction and Analytics Principle

Keep visual analytics as two cooperating layers:

1. React/Zustand stores lightweight interaction intent.
2. DuckDB performs data-heavy recomputation.

React state should answer "what is the user focusing on right now?" It should store identifiers and constraints, not large derived datasets:

```ts
export type VisualAnalyticsState = {
  activeLayerId?: string;
  hoveredFeatureId?: string;
  selectedFeatureIds: string[];
  filters: VisualFilter[];
  brush?: NumericBrush;
  timeRange?: TemporalRange;
  comparison?: MapComparisonState;
};
```

DuckDB should answer "what data result follows from that intent?" Use DuckDB for:

- Filtered feature queries.
- Selection summaries.
- Histogram and profile recomputation under active filters.
- Class break recomputation for filtered subsets.
- H3/hex aggregation.
- Spatial joins, intersections, buffers, and nearest-neighbour derivations.
- Temporal binning and animation frames.
- Difference/comparison layers.

MapLibre should remain the rendering and immediate interaction surface. Use MapLibre expressions and feature-state for fast hover/highlight/display changes. Use DuckDB when an interaction changes the underlying set, aggregation, statistics, or geometry.

Interactive state should initially be session-local. Later, users can promote useful visual analytics states into workflow nodes or output configuration when they want reproducibility.

### 1. Style Specification Model

Extend `MapLayer` with a serialisable visualisation config:

```ts
export type LayerVisualisation =
  | ChoroplethVisualisation
  | CategorisedVisualisation
  | GraduatedSymbolVisualisation
  | HeatmapVisualisation
  | DotDensityVisualisation
  | FlowVisualisation
  | LabelVisualisation
  | SimpleVisualisation;

export type ClassificationMethod =
  | 'equal_interval'
  | 'quantile'
  | 'jenks'
  | 'stddev'
  | 'manual'
  | 'categorical_top_n';

export type ChoroplethVisualisation = {
  id: string;
  kind: 'choropleth';
  field: string;
  method: ClassificationMethod;
  classCount: number;
  breaks: number[];
  palette: string[];
  nullColor: string;
  opacity: number;
  outlineColor: string;
  outlineWidth: number;
};
```

Add these fields to `MapLayer`:

- `visualisation?: LayerVisualisation`
- `legend?: LegendSpec`
- `styleVersion: number`

This keeps the visual settings next to the layer while still allowing output nodes and chat tools to create or modify them.

### 2. MapLibre Style Compiler

Create `src/utils/mapStyleCompiler.ts`:

- `compileLayerStyle(layer: MapLayer): CompiledMapLibreLayers`
- `compileFillColorExpression(vis: ChoroplethVisualisation)`
- `compileCircleRadiusExpression(vis: GraduatedSymbolVisualisation)`
- `compileCategoryExpression(vis: CategorisedVisualisation)`
- `compileHeatmapPaint(vis: HeatmapVisualisation)`
- `compileLabelLayout(vis: LabelVisualisation)`

MapLibre expressions should be generated from the config instead of embedded in UI components. For choropleths this means emitting an expression like:

```ts
[
  'case',
  ['==', ['get', field], null], nullColor,
  ['step', ['to-number', ['get', field]], color0, break1, color1, break2, color2]
]
```

For categories, use `match`. For proportional symbols, use `interpolate`. For labels, add a separate `symbol` layer with `text-field`, collision settings, halo, and zoom thresholds.

### 3. Data Profiling Service

Move the histogram/profile logic currently embedded in `App.tsx` into `src/utils/dataProfiling.ts` and `src/services/profileService.ts`.

Needed functions:

- `profileGeoJsonColumn(features, field)`
- `profileDuckDbColumn({ withClause, alias, field, search })`
- `classifyNumericValues(values, method, classCount)`
- `classifyCategoricalValues(values, topN)`
- `suggestVisualisations(schema, geometryType, profile)`

Classification methods:

- Equal interval: simple min/max divided by class count.
- Quantile: each class has roughly equal feature counts.
- Jenks natural breaks: best for skewed socio-economic values; implement with a tested local utility or a lightweight dependency.
- Standard deviation: useful for z-score style thematic maps.
- Manual: editable breakpoints from the UI.
- Categorical top-N: most common categories, with an "Other" bucket.

The existing attribute histogram becomes the first consumer of this shared service. The visualisation editor becomes the second.

### 4. Visualisation Editor Panel

Add a third workspace/right-panel mode: `Style` or `Visualise`.

Primary components:

- `VisualisationPanel`
- `FieldPicker`
- `DistributionPreview`
- `ClassificationControls`
- `PalettePicker`
- `LegendPreview`
- `StyleControls`
- `LabelControls`

Expected workflow:

1. User selects a map layer.
2. Panel detects geometry type and schema/profile.
3. Recommended visualisation types are shown first.
4. User picks a field.
5. Histogram or category distribution appears.
6. Breaks and colours are generated.
7. User adjusts class count, method, colours, opacity, outlines, labels.
8. Map updates immediately.

For choropleths, the histogram should show class break markers and allow drag/manual editing later. First implementation can expose numeric inputs for breaks and keep drag handles as a later polish pass.

### 5. Visualisation Nodes

Add a new node type:

```ts
type: 'visualisation'
```

This node should not transform row data. It should attach a visualisation config to the map output produced by its parent.

Example node configs:

```ts
{
  kind: 'choropleth',
  field: 'need',
  method: 'quantile',
  classCount: 5,
  palette: 'viridis'
}
```

Why a node matters:

- Users can treat styling as part of a reproducible workflow.
- Chat can create the map styling from natural language.
- Output nodes can visualise using the nearest upstream visualisation config.
- Multiple visual interpretations can branch from the same analytical result.

Implementation detail:

- Extend `GISNode['data']['type']` with `'visualisation'`.
- Add `VisualisationNode.tsx`.
- Update `workflowEngine` to pass through source rows for visualisation nodes and expose the config in `WorkflowResult` metadata.
- Update `buildUpToSQL` to preserve visualisation metadata.
- Update `llmToolDefinitions` so chat can add and update visualisation nodes.

### 6. Layer Manager Enhancements

The current layer manager is a good base. Add:

- Style badge: simple, choropleth, categories, symbols, heatmap, flow.
- Legend preview under each styled layer.
- Colour swatch button to open the visualisation panel.
- Duplicate style.
- Copy style to another layer.
- Reset style.
- Reorder layers. MapLibre draw order currently follows `mapLayers` order, but there is no drag/reorder action in the store.

Add store actions:

- `updateLayerVisualisation(layerId, visualisation)`
- `clearLayerVisualisation(layerId)`
- `reorderMapLayer(layerId, targetIndex)`
- `duplicateMapLayer(layerId)`
- `copyLayerVisualisation(sourceLayerId, targetLayerId)`

### 7. Chat Tooling

Extend LLM tools with:

- `style_layer`
- `classify_layer`
- `suggest_visualisations`
- `add_visualisation_node`
- `copy_layer_style`

Example:

> Make the London need layer a five-class choropleth using quantiles and a colour-blind-safe palette.

The tool call should update either the selected layer directly or create a `visualisation` node when the user is working in workflow mode.

### 8. Legend and Export

Add `Legend` rendering in the map corner and in the layer manager.

Status:

- [x] Map-corner legend rendering for visible styled layers.
- [x] Layer manager legend swatches.
- [x] Export map style action.
- [ ] Static map/image export.

Legend types:

- Continuous ramp.
- Stepped classes.
- Category swatches.
- Graduated symbol sizes.
- Heatmap ramp.
- Flow width ramp.

Export implications:

- GeoJSON/CSV/Parquet export should remain data-only.
- Add a future "Export map style" action that emits the visualisation config or a partial MapLibre style JSON.
- Later, add static map/image export if the app grows print/cartography support.

### 9. Visual Analytics State and DuckDB Services

Add first-class state for interactive analysis:

```ts
export type VisualFilter =
  | { kind: 'category'; field: string; values: string[]; includeNull?: boolean }
  | { kind: 'range'; field: string; min?: number; max?: number; includeNull?: boolean }
  | { kind: 'temporal'; field: string; start?: string; end?: string };

export type NumericBrush = {
  layerId: string;
  field: string;
  min: number;
  max: number;
};

export type MapComparisonState = {
  mode: 'swipe' | 'side_by_side' | 'difference';
  layerAId: string;
  layerBId: string;
};
```

Add store actions:

- `setHoveredFeature(layerId, featureId)`
- `toggleSelectedFeature(layerId, featureId)`
- `clearFeatureSelection(layerId)`
- `setLayerFilters(layerId, filters)`
- `setLayerBrush(layerId, brush)`
- `setTemporalRange(layerId, range)`
- `setComparisonMode(comparison)`

Add DuckDB-backed services:

- `queryFilteredLayer({ layerId, filters, brush, timeRange })`
- `querySelectionSummary({ layerId, featureIds, metrics })`
- `queryFilteredProfile({ layerId, field, filters })`
- `queryFilteredClassBreaks({ layerId, field, method, classCount, filters })`
- `queryComparisonLayer({ layerAId, layerBId, mode })`
- `queryTemporalBins({ layerId, timeField, interval, filters })`

The same interaction state should drive:

- Map visibility and highlight filters.
- Attribute table rows.
- Histogram/profile panels.
- Legend active/inactive classes.
- Summary cards.
- Derived comparison or aggregation layers.

### 10. Feature Identity Model

Interactive analytics needs stable feature identity. Add a feature ID strategy whenever GeoJSON is created from DuckDB:

- Prefer an existing primary key or unique ID column.
- Otherwise generate a stable row identifier in SQL for the current result.
- Store the ID in a reserved property such as `_ymn_feature_id`.
- Configure MapLibre sources with `promoteId: '_ymn_feature_id'` where possible.

This enables:

- Hover and selected-feature styling through MapLibre feature-state.
- Linked table rows and map features.
- Histogram brushing that highlights map features.
- Selection summaries in DuckDB.

Feature IDs only need to be stable within a materialised layer at first. Workflow-level persistent IDs can come later.

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

- [~] Extract profile logic from `App.tsx`. Layer profiling has moved into shared services/utilities; node preview profiling still has local logic.
- [x] Implement classification utilities.
- [x] Add unit tests for equal interval, quantile, categorical top-N, and null handling.
- [~] Wire the existing `DataTable` histogram to the shared profile service. Selected map layers use DuckDB-backed shared services; workflow node tables still use the existing node SQL path.
- [~] Add field type detection from `nodeSchemas` and layer feature properties. Basic detection exists; recommendation logic is still limited.

Acceptance criteria:

- [x] Attribute inspector still profiles columns.
- [x] Classification results are deterministic.
- [~] Numeric and categorical fields produce different visualisation behavior; full recommendation UI is still pending.

### Phase 3: Visualisation Panel

- [x] Add a `Visualise` tab/panel in the right panel.
- [x] Build field picker, histogram/category profile, class controls, and palette picker.
- [x] Add live preview by updating `selectedLayer.visualisation`.
- [x] Add legend preview.
- [~] Add reset and apply-to-layer controls. Reset exists; apply is live rather than a separate explicit action.

Acceptance criteria:

- [x] User can build a choropleth without writing SQL or JSON.
- [x] User can change class method, class count, and palette.
- [x] Map and legend update immediately.
- [x] Null/missing values are represented.

### Phase 4: Interaction State and Feature Selection

- [x] Add first-class visual analytics state to the store.
- [x] Assign stable `_ymn_feature_id` values to rendered GeoJSON features.
- [x] Add hover and click selection state in `MapView`.
- [x] Add selected-feature styling with MapLibre feature-state or filter expressions.
- [x] Link selected map features to the attribute table.
- [x] Add a small selection summary panel.

Acceptance criteria:

- [x] Hovering a feature highlights it without changing the layer style.
- [x] Clicking a feature stores its ID in interaction state.
- [x] The attribute table can show or emphasise selected features.
- [x] Clearing selection restores the default map/table state.
- [x] Selection state is separate from selected layer/node state.

### Phase 5: DuckDB-Backed Interactive Filtering and Profiling

- [x] Add a service for translating visual filters into safe DuckDB SQL predicates.
- [x] Recompute attribute rows from active filters.
- [x] Recompute histograms/profiles from active filters.
- [x] Let legend category/class clicks filter or isolate values.
- [x] Let histogram range brushing filter or highlight features.
- [x] Cache recent profile/filter results where useful. Layer registration for DuckDB-backed visual analytics now reuses cached temporary tables while the layer signature is unchanged.
- [x] Add active filter chips with remove and clear-all controls.
- [x] Add DuckDB-backed summaries for selected or filtered subsets.

Acceptance criteria:

- [x] Filtering a category in the legend updates the map, table, and profile.
- [x] Brushing a numeric histogram updates the filtered map/table/profile state.
- [~] Profiles and class breaks can be recomputed for the filtered subset. Profiles are recomputed; class-break recomputation UX is still limited.
- [x] Filter operations use DuckDB rather than large in-memory scans where possible.

### Phase 6: Visualisation Nodes

- [x] Add `VisualisationNode`.
- [x] Add node library entry.
- [x] Update workflow result metadata to carry visualisation config.
- [x] Let output execution attach visualisation config to the produced `MapLayer`.
- [x] Add chat tool support for visualisation node creation and updates.

Acceptance criteria:

- [x] A workflow can branch into two styled outputs from the same data.
- [x] Re-running the workflow preserves the intended style.
- [x] Chat can create a choropleth or graduated symbol map from schema metadata.

### Phase 7: Comparison and Temporal Analytics

- [ ] Add layer comparison state for swipe and side-by-side modes.
- [ ] Add DuckDB-backed difference layer generation where schemas/geometries allow it.
- [~] Add date/time field detection. Users can pick any field for date filtering; automatic date-field recommendation is still pending.
- [x] Add temporal range filtering.
- [ ] Add time-bin summaries for charts and animation frames.

Acceptance criteria:

- [ ] Users can compare two layers visually using swipe or side-by-side mode.
- [x] Users can filter a temporal layer by a date range.
- [ ] DuckDB can return time-binned counts or summaries for the active layer.
- [ ] Difference layers are treated as derived session layers before becoming workflow outputs.

### Phase 8: Additional Visualisation Modules

Implement modules in this order:

- [x] Choropleth polygons.
- [x] Categorised polygons/lines/points.
- [x] Graduated/proportional point symbols.
- [x] Heatmaps for dense points.
- [ ] Labels and annotations.
- [ ] Clustered point maps.
- [~] Hex/H3 bin styling. H3 layer creation exists; full bin styling workflow is pending.
- [ ] Flow/OD maps.
- [ ] Time slider and animated temporal layers.
- [x] Linked chart/map brushing for histogram and map/table selection basics.
- [x] Interactive legend filtering.
- [ ] Swipe and side-by-side map comparison.
- [ ] Difference/change maps.
- [x] Selection summaries and linked table/map/chart views for the current map/table/profile loop.

## Case Studies and Unanticipated Workflows

### 1. Socio-Economic Choropleth

Example: deprivation, housing need, accessibility scores by ward or borough.

Needs:

- Numeric classification.
- Histogram/distribution view.
- Normalisation support, such as count per population or percentage.
- Diverging palettes for positive/negative values.
- Clear legends and null handling.

Current gaps:

- No classification model.
- No style editor.
- No legend.
- No support for derived visual fields except adding an `attribute` node manually.

### 2. Category Land-Use or Zoning Map

Example: parcels coloured by land-use class.

Needs:

- Categorical profiling.
- Top-N categories plus "Other".
- Stable category-colour assignments.
- Search/filter categories.

Current gaps:

- Only one colour per layer.
- No `match` expression generation.
- No category legend.

### 3. Graduated Symbol Map

Example: schools sized by enrolment, stations sized by entries/exits, incidents sized by count.

Needs:

- Numeric field mapped to circle radius.
- Optional colour by second field.
- Min/max size controls.
- Overlap/collision strategy.

Current gaps:

- Point style only supports fixed radius.
- No dual encoding.
- No scale/legend for symbol sizes.

### 4. Dense Point Heatmap

Example: crime incidents, 311 requests, GPS traces.

Needs:

- MapLibre `heatmap` layer.
- Weight field.
- Radius/intensity controls by zoom.
- Optional point overlay at high zoom.

Current gaps:

- No heatmap layer type.
- No zoom-dependent paint controls.
- GeoJSON rendering will become slow for very large point sets.

### 5. H3/Hexbin Analytical Map

Example: aggregate demand, risk, accessibility, or incident counts to hexagons.

Needs:

- H3 generation already exists in chat.
- Styling bins by count/rate.
- Resolution control.
- Legend and classification.

Current gaps:

- H3 is a one-off chat path, not a workflow/visualisation module.
- No bin styling workflow.

### 6. Flow or Origin-Destination Map

Example: commuting flows, referrals between services, migration.

Needs:

- Origin/destination fields or two point layers.
- Line generation.
- Width by magnitude.
- Direction arrows or tapered lines.
- Filtering weak flows.

Current gaps:

- No flow node.
- No line width data expression.
- No directional symbol support.

### 7. Temporal Map

Example: change in incidents over time, planning applications by month, moving assets.

Needs:

- Date/time field detection.
- Time slider.
- Temporal filtering.
- Optional animation.
- Aggregation by time bin.

Current gaps:

- No temporal state.
- No range filter UI.
- No date profiling.

### 8. Bivariate Choropleth

Example: need vs accessibility, risk vs capacity.

Needs:

- Two numeric fields.
- 2D classification grid.
- Bivariate palette and legend.
- Strong warnings about interpretation.

Current gaps:

- No multi-field visualisation model.
- No bivariate legend.

### 9. Linked Chart and Map Brushing

Example: histogram selection filters/highlights map features.

Needs:

- Feature identity model.
- Selection state separate from layer selection.
- Map feature-state or filter expressions.
- Histogram brush interactions.

Current gaps:

- Popups show feature properties but selected features are not stored.
- No feature IDs are assigned during GeoJSON conversion.
- DataTable rows are not linked back to map features.
- Histogram/profile interactions are not translated into DuckDB-backed filter queries.
- There is no shared interaction state for map, chart, legend, and table views.

### 10. Cartographic Output Map

Example: user wants a shareable final map, not just analysis preview.

Needs:

- Title, subtitle, legend, scale bar, north arrow, attribution.
- Layout presets.
- Export image/PDF.

Current gaps:

- App is an analytical workspace, not a map composer.
- No persistent map document model.

### 11. Interactive Filtering and Selection

Example: user clicks a borough, filters to high-need wards, brushes a histogram range, then asks for summary statistics for the selected subset.

Needs:

- Stable feature IDs.
- Selection state separate from active layer/node state.
- Filter state for categories, numeric ranges, temporal ranges, and null handling.
- DuckDB-backed summary/profile queries over the active subset.
- Clear affordances to reset filters and selections.

Current gaps:

- Layer selection and feature selection are not separated.
- There is no generic visual filter model.
- Map clicks open popups but do not create analytical selection state.
- Attribute table and histogram views do not consume a shared filter state.

### 12. Map Comparison and Change Exploration

Example: compare pre/post intervention layers, swipe between two accessibility surfaces, or calculate differences between two compatible polygon layers.

Needs:

- Swipe and side-by-side comparison state.
- Layer pairing and schema compatibility checks.
- Optional DuckDB-backed difference layer generation.
- Legends that can show both layers or a computed delta.

Current gaps:

- No comparison mode in map state.
- No paired layer UI.
- No derived difference layer service.
- No change-map visualisation model.

## Current Functionality Missing or Needing Refactor

### Data and Rendering

- `MapLayer` lacks a style/visualisation schema.
- `MapView` has hard-coded paint rules.
- No legend system.
- No MapLibre expression compiler.
- No support for multiple MapLibre layers per logical layer, such as fill plus outline plus labels.
- No feature IDs for hover/selection state.
- No vector tile/MVT path for large layers.
- Layer order cannot be changed from the UI/store.
- No `promoteId`/feature-state path for fast hover and selection styling.
- No comparison rendering mode such as swipe or side-by-side maps.

### Analysis and Profiling

- Histogram logic is embedded in `App.tsx`, making it hard to reuse.
- No formal classification utilities.
- No Jenks, quantile, standard deviation, or manual breaks.
- No normalisation helper for rates/percentages.
- No persisted column profiles or cached stats.
- No DuckDB-backed service for filtered profiles, selection summaries, or class-break recomputation.
- No generic filter-to-SQL predicate builder for visual interactions.

### Interactive Analytics

- No first-class visual analytics state.
- No stable feature identity model.
- No selected-feature state.
- No hovered-feature state.
- No legend-driven filtering.
- No histogram brushing state.
- No temporal range state.
- No comparison state.
- No shared state connecting map, table, legend, and chart views.

### Workflow Nodes

- No visualisation node type.
- Output node config does not carry style information.
- Workflow SQL returns data, but not style metadata.
- Styling cannot branch from the same analytical result.
- Interactive visual analytics states cannot be promoted into workflow nodes or output configurations.

### User Interface

- No dedicated style editor panel.
- No palette picker.
- No class-break editor.
- No label controls.
- No hover/selection styling controls.
- Map-level legend component exists for visible styled layers.
- No category management for long categorical fields.
- No filter chips or clear-all controls for active visual filters.
- No selection summary panel.
- No comparison mode controls.

### Chat and Automation

- LLM tools do not expose styling operations.
- Chat can add GeoJSON/H3 layers, but cannot classify or style them.
- Chat has schema metadata, but not layer profile metadata.
- Chat cannot create visual filters, summarize the selected subset, or set comparison modes.

### Testing

- No tests for MapLibre style generation.
- No tests for classification.
- No tests proving basemap changes preserve styled layers.
- No interaction tests for selecting a layer, editing style, and seeing store updates.

## Suggested File Map

- `src/types/visualisation.ts`
- `src/utils/mapStyleCompiler.ts`
- `src/utils/classification.ts`
- `src/utils/palettes.ts`
- `src/utils/dataProfiling.ts`
- `src/components/Visualisation/VisualisationPanel.tsx`
- `src/components/Visualisation/FieldPicker.tsx`
- `src/components/Visualisation/DistributionPreview.tsx`
- `src/components/Visualisation/ClassificationControls.tsx`
- `src/components/Visualisation/PalettePicker.tsx`
- `src/components/Visualisation/LegendPreview.tsx`
- `src/components/Map/LegendControl.tsx`
- `src/components/Flow/VisualisationNode.tsx`
- `src/types/visualAnalytics.ts`
- `src/services/visualAnalyticsService.ts`
- `src/utils/visualFilterSql.ts`
- `src/components/Visualisation/FilterChips.tsx`
- `src/components/Visualisation/SelectionSummary.tsx`
- `src/components/Map/ComparisonControl.tsx`

## Recommended First PR

The first implementation should be deliberately narrow:

1. Add visualisation types and store actions.
2. Add `mapStyleCompiler.ts`.
3. Support simple, choropleth, and categorical styles.
4. Add tests for the compiler and classification utilities.
5. Add a minimal visualisation panel for selected layers.

This will unlock the central architecture without forcing every visualisation type to be designed at once.

## Recommended Second PR

After the basic styling architecture lands, add the smallest useful interactive analytics loop:

1. Add stable `_ymn_feature_id` values to rendered features.
2. Add hovered and selected feature state.
3. Highlight hovered/selected features on the map.
4. Link selected features to the attribute table.
5. Add a compact selection summary.

This keeps the app's visual analytics direction explicit without taking on temporal animation, linked brushing, and comparison all at once.
