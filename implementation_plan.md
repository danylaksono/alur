# ALUR Visual Analytics Implementation Plan

Last updated: 24 July 2026

## 1. Objective

Evolve ALUR from a capable linked map, table, chart and workflow workspace into a fast, recoverable and general-purpose visual analytics dashboard.

The implementation should make these user behaviours easy:

1. Load a dataset and understand its shape and quality.
2. Start an appropriate visual exploration from any field with one action.
3. Filter, brush and spatially select without losing context.
4. Compare a subset with a baseline or another named cohort.
5. Undo mistakes, revisit analytical states and recover work after a reload.
6. Export or share the evidence behind an insight.
7. Work with spatial and non-spatial datasets through the same interaction model.

## 2. Current baseline

ALUR already provides:

- DuckDB-Wasm analytical queries and MVT rendering.
- Linked map, table and chart interactions for map layers.
- Workflow and manual SQL execution.
- Feature hover, click selection, pop-ups and selection-to-layer/filter actions.
- Category, range and temporal filters with visible filter chips.
- Histograms, bars, donut, rose, scatter and small-multiple charts.
- Temporal playback, selection summaries and selection-versus-rest explanations.
- Table views, computed fields, node and result exports, map-style export.
- Twelve map visualisation recipes, including bivariate and glyph-grid views.
- Error boundaries, loading feedback and a passing automated test suite.

Known constraints that shape this plan:

- Workspace state is ephemeral; only settings and saved table views persist.
- Map selection is click-based; there is no box or lasso selection.
- Filter chips can be removed but not edited.
- Non-spatial table charts are deliberately unlinked.
- Data ingestion accepts Parquet and CSV only.
- Chart, summary and profile queries can repeat work across components.
- The production build contains a large main bundle and large DuckDB assets.

## 3. Product and engineering principles

### 3.1 Analytical interaction semantics

- Hover highlights; it must never change the active subset.
- Selection identifies records; filtering changes the analytical subset.
- Pinning creates a durable cohort for comparison.
- Filters on different fields combine with `AND`.
- Multiple included categories within one field combine with `OR`.
- Global dataset filters remain visually separate from chart-local display controls.
- Every subset-changing interaction must support clear, reset and undo.

### 3.2 Visual integrity

- Prefer line charts for ordered time, bars for comparison and position-based encodings for precise values.
- Avoid adding decorative charts unless they answer a distinct analytical task.
- Show units, aggregation, grain, filter scope and missingness close to the visual.
- Do not connect time-series lines across missing periods without indicating the gap.
- Do not rely on hue alone for selection, comparison or status.
- Warn when a choropleth uses raw counts where normalisation may be needed.

### 3.3 Technical approach

- Extend existing services and Zustand actions incrementally.
- Keep loaded data and DuckDB relations outside undo snapshots and project manifests.
- Prefer discriminated unions and pure query builders over stringly typed UI state.
- Preserve existing `VisualChartSpec` and layer behaviour until the later dataset-source migration.
- Add runtime validation and versioned migrations at file and persistence boundaries.
- Keep each milestone independently releasable.

## 4. Delivery overview

| Milestone | Theme | Relative effort | Depends on |
|---|---|---:|---|
| M0 | Shared interaction foundations | Medium | None |
| M1 | Faster and safer exploration | Medium | M0 |
| M2 | Analytical depth and data understanding | Medium | M0 |
| M3 | Export, recovery and broader ingestion | Medium–large | M0–M2 |
| M4 | Cohort comparison and sensemaking | Large | M1–M3 |
| M5 | Linked non-spatial datasets | Large | M0–M4 |
| M6 | Performance, accessibility and dashboard presentation | Medium–large | Continuous; final integration after M5 |

Relative effort assumes one developer familiar with the codebase. It is deliberately not a calendar commitment.

### 4.1 Implementation status

- [x] **M0 initial foundation** — dataset metadata and semantic field inference; typed analytical commands; centralised chart defaults; bounded history for filters, selections, charts and layer presentation; undo/redo UI and keyboard shortcuts; automated tests.
- [x] **M1 first release — Faster and safer exploration** — table-header Quick Explore actions; editable include/exclude filters for category, range, temporal, text, boolean and null values; consistent SQL, MapLibre, chart, legend and glyph filtering; map box selection with replace/add/subtract semantics; fullscreen, scale, geolocation, home and coordinate-copy controls; searchable command palette; focused automated tests.
- [x] **M2 Analytical depth and data understanding** — chronological line and area charts with validated/automatic grains, explicit gaps, top-series grouping, temporal brushing and accessible tables; cached, undoable KPI shelf with total, preceding-period and current-selection comparison; progressive dataset overview and quality signals; user-configurable selection summaries across selected/active/total scopes; searchable legends with counts, percentages, palette warnings, classification methods and break values.
- [x] **M3 Export, recovery and broader ingestion** — safe chart CSV/SVG/PNG downloads with provenance, filtered-SQL copy and active-subset export; validated and migrated `.alur.json` manifests with secret stripping, source fingerprints, saved views, basemap/camera/layout state and explicit relinking; debounced five-snapshot IndexedDB recovery with save status and restore offer; typed Parquet/CSV/JSON/GeoJSON ingestion shared by pickers and drag/drop, plus guarded URL and clipboard JSON/GeoJSON/CSV/TSV flows.
- [x] **M4 Cohort comparison and sensemaking** — named filter and materialised-selection cohorts with rename, colour, duplicate, remove and workflow-filter recreation; A/B and active-remainder comparison with explicit overlap, denominators and missingness, numeric distributions and standardised effect sizes, category-share differences and monthly trends; labelled cohort/overlap map colouring for reproducible filter cohorts; analytical bookmarks covering filters, cohorts, selected dataset, camera, charts, KPI order and notes, including project/recovery persistence.
- [x] **M5 Linked non-spatial datasets** — versioned layer/table/workflow source union and manifest migration; dataset-keyed interactions; validated or materialised stable row identity; linked non-spatial table, chart and KPI filters/selections with no map requirement; registry rebinding and persistence tests.
- [x] **M6 Performance, accessibility and dashboard presentation** — bounded analytical query coordinator with stable keys, deduplication, invalidation, generations, concurrency and development metrics; coordinated chart/KPI/profile reads; lazy copilot/workflow/style delivery and explicit MapLibre/XYFlow/DuckDB chunks; immutable Wasm/worker caching; focus/reduced-motion and chart keyboard/table alternatives; saved responsive board mode with map, chart, KPI, table and note cards, shared filters, bookmark states and transient presentation mode.

M0 deliberately excludes uploaded data, DuckDB relations, hover state and loading state from history. Workflow graph history will be added after the first interaction release has established stable transaction boundaries. Commands for KPIs and dataset profiles will be activated when those specifications arrive in M2.

The M1 first release deliberately places Quick Explore on table headers, the common field-inspection surface. The same menu will be surfaced in the dataset overview when M2.3 creates it and in the schema inspector when workflow-node filtering moves into the shared dataset source model. Lasso selection, measurement, relative-date presets, KPI commands, workflow execution and project export remain attached to their later milestones rather than being implemented as disconnected shortcuts.

M2 adds Quick Explore to the dataset overview and activates KPI commands. KPI specifications live in analytical project state and undo history; serialising them into a portable project manifest remains part of M3. Current-selection comparison provides an immediate cohort baseline, while named, durable cohorts remain M4. Legend text, numbering, warnings and classification metadata provide non-colour interpretation cues; reusable map pattern fills remain an accessibility hardening option in M6.

M3 keeps source records outside manifests and recovery snapshots; reopening therefore presents each missing source as an explicit relink task rather than pretending that transient DuckDB relations survived. GeoJSON rows with absent or invalid geometry remain available in the attribute table while only valid geometry is rendered. URL fetching omits credentials and reports CORS, timeout and size failures. Map PNG remains deliberately deferred until cross-browser WebGL export can be verified; map-style JSON export remains the reliable map export. Verification at the milestone gate: TypeScript and lint clean, 28 test files / 152 tests passed, production build passed with the existing large-bundle advisory only, and `git diff --check` passed apart from Git's line-ending notices.

M4 stores arbitrary selections in DuckDB tables instead of serialising feature-ID arrays; active-subset cohorts remain portable filter definitions. Because selection tables are intentionally transient, a restored selection-table cohort reports the missing relation until it is recreated, while filter cohorts restore and map-colour immediately. Simultaneous map colouring uses each cohort's named colour plus a labelled purple overlap; selection-table comparisons remain available statistically and disclose that map-colouring boundary. Verification at the milestone gate: TypeScript and lint clean, 29 test files / 156 tests passed, production build passed with the existing large-bundle advisory only, and `git diff --check` passed apart from Git's line-ending notices.

M5 keeps legacy `layerId` and `tableName` fields only as import adapters while all new chart and KPI specifications carry a `DatasetSource`. Non-spatial inputs are registered as workflow datasets, rebind provisional table identifiers after stable identity materialisation, and share filters, selected row IDs, charts, KPIs and exports with sibling views. Map-only operations remain intentionally unavailable when the dataset has no geography. Verification at the milestone gate: TypeScript and lint clean, 31 test files / 160 tests passed, production build passed with the existing large-bundle advisory only, and `git diff --check` passed apart from Git's line-ending notices.

M6 coordinates cacheable analytical reads while keeping exports and mutations uncached. Existing map instances remain mounted when switching between exploration and the board; optional analytical panels are code-split, and deployment headers make content-hashed DuckDB runtime assets immutable. Board card width is saved as a deterministic responsive grid span rather than relying on a fragile pixel layout; smaller screens stack cards. Presentation sessions are deliberately transient, while layouts and bookmark-driven states persist in `.alur.json`. The bundle report now separates copilot, workflow, style, DuckDB, MapLibre and icon chunks; DuckDB Wasm remains intrinsically large and is handled through long-lived caching rather than hidden from the report.

---

## 5. M0 — Shared interaction foundations

### M0.1 Introduce typed analytical commands

Create a small command layer so field menus, charts, legends, the table and the copilot invoke the same actions.

Proposed modules:

- `src/types/analyticsCommands.ts`
- `src/utils/analyticsCommands.ts`
- `src/hooks/useAnalyticsCommands.ts`

Initial commands:

- `createChartForField`
- `styleLayerByField`
- `filterField`
- `pinMetric`
- `openFieldProfile`
- `clearDatasetFilters`
- `focusSelection`

Acceptance criteria:

- Commands validate dataset, field type and geometry requirements before changing state.
- Commands return a structured success or error result suitable for UI and copilot use.
- No component duplicates default chart or style selection rules.
- Pure command/default-selection logic has unit tests.

### M0.2 Add bounded analysis history

Add a custom past/present/future history slice rather than snapshotting the entire store.

Include initially:

- Dataset filters and feature selections.
- Chart and KPI specifications.
- Map visualisation specifications and legend state.
- Workflow nodes and edges after the first release proves stable.

Exclude:

- Hover state.
- Loading and error state.
- DuckDB connections, tables, file objects and MVT data.
- High-frequency map camera movement.

Implementation details:

- Store at most 50 history entries.
- Coalesce pointer drags and slider changes into one transaction.
- Add `undo`, `redo`, `canUndo`, `canRedo` and transaction labels.
- Add `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` shortcuts.
- Show the latest action label in button tooltips and the command palette.

Acceptance criteria:

- A chart brush, legend click, box selection and style edit each undo in one step.
- Undo never restores stale loading operations or duplicate DuckDB data.
- Resetting a project clears history.
- History behaviour is covered by store tests.

### M0.3 Establish reusable dataset metadata

Add lightweight metadata helpers without yet replacing `layerId` and `tableName`.

Define:

```ts
type DatasetMetadata = {
  id: string;
  name: string;
  kind: 'layer' | 'table' | 'workflow-node';
  fields: Array<{ name: string; type: string; semanticType?: string }>;
  rowCount?: number;
  geometryKind?: 'point' | 'line' | 'polygon';
  crs?: string;
  featureIdColumn?: string;
  sourceUpdatedAt?: number;
};
```

Acceptance criteria:

- Quick Explore and dataset overview consume the same metadata interface.
- Field semantic types distinguish numeric, categorical, boolean, temporal, identifier and geometry.
- Existing layer behaviour remains unchanged.

---

## 6. M1 — Faster and safer exploration

### M1.1 Quick Explore field menu

Add an accessible field action menu to table headers, the schema inspector and dataset overview.

Actions vary by field type:

- Numeric: histogram, summary metric, choropleth/graduated symbol, range filter.
- Categorical: sorted bar, category filter, categorical map.
- Temporal: time-series chart, temporal filter, temporal slider.
- Boolean: two-category bar and boolean filter.
- Identifier: search, copy and uniqueness inspection; do not recommend aggregation by default.

Default behaviour:

- One primary action is visible; secondary actions live in the menu.
- Creating a chart opens the Charts rail and scrolls the new chart into view.
- Styling a field opens the existing style editor with a preview before commit.
- Suggested actions explain why they are available or disabled.

Acceptance criteria:

- A user can go from a loaded field to a useful visual in at most two interactions.
- Actions are keyboard reachable and have visible focus.
- Long field names and narrow panels remain usable.

Likely files:

- `src/components/DataTable.tsx`
- `src/components/Flow/NodeSchema.tsx`
- `src/components/Charts/ChartPanel.tsx`
- `src/components/Visualisation/VisualisationPanel.tsx`

### M1.2 Editable typed filters

Extend `VisualFilter` while keeping category, range and temporal filters backwards compatible.

Proposed additions:

```ts
type FilterMode = 'include' | 'exclude';

type TextFilter = {
  kind: 'text';
  field: string;
  operator: 'contains' | 'starts_with' | 'ends_with' | 'equals';
  value: string;
  caseSensitive?: boolean;
  mode?: FilterMode;
};

type BooleanFilter = {
  kind: 'boolean';
  field: string;
  value: boolean;
  mode?: FilterMode;
};

type NullFilter = {
  kind: 'null';
  field: string;
  isNull: boolean;
};
```

Update:

- SQL predicate compilation.
- MapLibre filter-expression compilation.
- Filter labels, stable keys and legend toggling.
- Table, chart, summary and export queries.
- Project persistence migrations.

UI requirements:

- Clicking a filter chip opens an editor popover.
- Each editor supports apply, cancel and remove.
- Include/exclude is explicit in text and iconography.
- Relative dates resolve to visible absolute bounds before query execution.
- General nested boolean groups are out of scope for this milestone.

Acceptance criteria:

- SQL and map visibility produce the same subset for every supported filter.
- Empty strings and nulls are distinguishable.
- Unsafe field names and text values are escaped.
- Cross-filter semantics are documented in the UI.

### M1.3 Map selection toolbar

Add a compact map interaction toolbar with pointer and box-select modes.

First release:

- Drag rectangle over the active layer.
- Replace selection by default.
- Shift adds and Alt/Option subtracts.
- Escape cancels or returns to pointer mode.
- Deduplicate feature IDs returned from multiple rendered tiles.
- Show selection count during or immediately after the operation.

Implementation approach:

- Draw the rectangle as a DOM overlay.
- Use MapLibre `queryRenderedFeatures` for the active rendered layer IDs.
- Commit once through `setFeatureSelection` when the drag ends.
- Keep native navigation enabled in pointer mode.
- Add a configurable guard before selecting extremely large visible subsets.

Second release:

- Freehand lasso.
- Drawn area-of-interest converted into a spatial filter or workflow node.

Acceptance criteria:

- Works for GeoJSON and MVT-backed point, line and polygon layers.
- Hidden and visually filtered features are not selected.
- Selection is linked to the table, charts and context inspector.
- Box selection is undoable as one action.

Likely files:

- `src/components/Map/MapView.tsx`
- `src/components/Map/MapSelectionToolbar.tsx`
- `src/utils/mapSelection.ts`

### M1.4 Map utility controls

Add:

- Scale control.
- Fullscreen control.
- Home/data-extent button.
- Pointer coordinates with copy action.
- Optional geolocation, only after an explicit user request.

Defer distance/area measurement until the selection toolbar interaction model is stable.

### M1.5 Command palette

Add `Ctrl/Cmd+K` with searchable actions for:

- Add data.
- Open a panel or drawer tab.
- Add chart or KPI.
- Clear filters or selection.
- Undo/redo.
- Run workflow.
- Zoom to layer or selection.
- Export project.

Commands should reuse M0.1 rather than invoking component-specific handlers.

---

## 7. M2 — Analytical depth and data understanding

### M2.1 Temporal line and area charts

Extend `VisualChartType` with `line`, then add optional chart fields:

```ts
type TimeGrain = 'auto' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

type TemporalChartOptions = {
  timeGrain?: TimeGrain;
  seriesField?: string;
  showPoints?: boolean;
  connectMissing?: boolean; // default false
};
```

Query requirements:

- Use DuckDB `DATE_TRUNC` with validated grain values.
- Choose an automatic grain from the visible temporal extent and target point count.
- Return explicit empty periods when feasible so gaps remain visible.
- Limit series to a readable top-N with a clear remainder policy.
- Preserve total-versus-filtered context where it remains legible.

Interaction requirements:

- Brush horizontally to create or edit a temporal filter.
- Hover reveals time, aggregation, series and exact value.
- Reset restores the full temporal extent.
- Keyboard users can step through points or access a tabular alternative.

Acceptance criteria:

- Time is ordered chronologically rather than lexicographically.
- Missing periods are not silently interpolated.
- Aggregation and time grain appear in the chart subtitle.
- Sparse, dense and single-period datasets have intentional empty states.

### M2.2 Pinnable KPI shelf

Add `KpiSpec` and `visualAnalytics.kpis`:

```ts
type KpiSpec = {
  id: string;
  datasetId: string;
  title: string;
  field?: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  comparison: 'none' | 'total' | 'previous-period' | 'cohort';
  format?: 'number' | 'compact' | 'percent' | 'currency';
  unit?: string;
};
```

Features:

- Pin from Quick Explore or the selection summary.
- Reorder and remove KPI cards.
- Show active value, comparison value and delta only when mathematically meaningful.
- Make filter scope explicit.
- Persist KPIs in project state and include them in undo history.

Acceptance criteria:

- Division-by-zero and empty subsets show `n/a`, not misleading percentages.
- Number formatting does not alter the underlying value.
- KPI queries share cached summary results where possible.

### M2.3 Dataset overview and data-quality scan

Create a cached, progressive dataset profile:

- Rows and fields.
- Field type and inferred semantic type.
- Null count and percentage.
- Approximate or exact distinct count depending on size.
- Numeric min, max, mean and distribution preview.
- Temporal start, end and missingness.
- Geometry kind, extent, CRS confidence and sampled validity.
- Duplicate identifier warning when a candidate ID exists.

Performance rules:

- Show cheap metadata first.
- Run expensive profiles on demand or in an idle queue.
- Use sampling or approximate distinct counts for large data.
- Cache by source version and invalidate on workflow re-execution.

UI:

- Add an Overview entry from Layers and the table source header.
- Present issues by severity but avoid implying that unusual data is necessarily erroneous.
- Every issue links to a relevant filter, table field or workflow action.

### M2.4 Configurable selection summary

Replace hard-coded first-field slicing with user-selected summary fields.

- Allow pin/unpin of numeric and categorical summaries.
- Show selection, active subset and total consistently.
- Preserve “What sets it apart” as a separate ranked explanation.
- Add a clear note when the selected sample is too small for a stable comparison.

### M2.5 Legend and palette improvements

- Expand, collapse and search long categorical legends.
- Show counts and percentages when available.
- Add colour-blind-safe palette metadata.
- Warn about low contrast and excessive category count.
- Add direct labels or patterns where colour alone is insufficient.
- Surface classification method and break values in the legend.

---

## 8. M3 — Export, recovery and broader ingestion

### M3.1 Unified export utilities

Create:

- `src/utils/download.ts`
- `src/services/chartExportService.ts`
- `src/services/projectService.ts`

Chart export:

- SVG for SVG charts.
- PNG for SVG and canvas charts.
- CSV for the plotted aggregate data.
- Include title, aggregation, filters and generated timestamp in metadata.

Analysis export:

- Copy filtered SQL.
- Export active table subset through the existing DuckDB path.
- Export map-style JSON through the existing utility.
- Add map PNG only after browser and WebGL behaviour is verified reliably.

Acceptance criteria:

- Exported data matches the values visible in the chart.
- Canvas exports respect device-pixel ratio.
- Filenames are stable, readable and safe.
- Failed exports produce actionable toast messages.

### M3.2 Versioned project manifest

Define `ProjectManifestV1` containing:

- Manifest version and application version.
- Workflow nodes and edges.
- Source descriptors and file fingerprints, not file contents.
- Layer order, visibility, opacity and visualisation specs.
- Charts, KPIs, cohorts and filters.
- Saved analytical views and UI layout.
- Basemap and optional map camera.

Never include:

- OpenRouter API keys.
- Raw uploaded records by default.
- DuckDB worker or connection state.
- Transient loading, hover or error state.

Add:

- Runtime schema validation.
- Versioned migration functions.
- Export/import of `.alur.json` files.
- A source-relink flow based on filename, size and last-modified fingerprint.

Acceptance criteria:

- Importing an invalid or future-version manifest fails safely with a useful explanation.
- A manifest round trip preserves the analytical layout and specifications.
- Missing source files are shown as relinkable rather than silently dropped.
- Secrets are absent from exported JSON tests.

### M3.3 Autosave and crash recovery

- Debounce manifest autosave after meaningful state changes.
- Store recovery state in IndexedDB behind a small storage adapter.
- Show `Saving`, `Saved` and `Recovery unavailable` states unobtrusively.
- Restore only after DuckDB initialises and sources are resolved.
- Offer recovery after an unclean reload; do not unexpectedly replace an active workspace.
- Keep a small number of rolling recovery snapshots.

File System Access handles may be stored when supported and explicitly granted; source relinking remains the cross-browser fallback.

### M3.4 GeoJSON, JSON, URL and clipboard ingestion

Refactor ingestion around a typed `IngestionSource` and format detector.

First release:

- GeoJSON FeatureCollection and Feature.
- JSON arrays/records via DuckDB `read_json_auto`.
- Drag/drop and file picker parity.

Second release:

- URL import with CORS, timeout and size-limit feedback.
- Clipboard paste for CSV, TSV, JSON and GeoJSON.

Acceptance criteria:

- Format detection uses content and extension where practical.
- Invalid geometry is reported without discarding valid non-spatial fields.
- Large text input is guarded before parsing on the main thread.
- Remote requests do not include user credentials by default.

---

## 9. M4 — Cohort comparison and sensemaking

### M4.1 Named cohorts

Add a cohort model:

```ts
type CohortSpec = {
  id: string;
  datasetId: string;
  name: string;
  colour: string;
  definition:
    | { kind: 'filters'; filters: VisualFilter[] }
    | { kind: 'selection-table'; tableName: string };
  createdAt: number;
};
```

Avoid persisting very large arrays of feature IDs. Materialise large selection cohorts into DuckDB and store a reproducible definition where possible.

Features:

- Pin current selection or active subset as a named cohort.
- Rename, recolour, duplicate and remove cohorts.
- Compare A versus B or A versus the active remainder.
- Make overlaps and denominators explicit.
- Recreate a cohort as a workflow filter node when possible.

### M4.2 Comparison view

Provide:

- Counts and relative size.
- Numeric means and distributions with effect sizes.
- Category share differences.
- Temporal trends by cohort.
- Linked map highlighting using distinct selection states.

Acceptance criteria:

- Every comparison states its denominator and missing-value treatment.
- Cohort overlap is reported rather than double-counted silently.
- Colour is reinforced with labels or line styles.
- Comparison calculations have deterministic service tests.

### M4.3 Analytical bookmarks

Allow users to save a lightweight analytical state containing:

- Filters and cohorts.
- Selected layer/dataset.
- Map camera.
- Visible charts and KPI layout.
- Optional note.

Bookmarks should restore state, be included in the project manifest and form the basis of later presentation mode.

---

## 10. M5 — Linked non-spatial datasets

This is the principal architectural milestone. It should follow the smaller releases so it does not block near-term value.

### M5.1 Introduce a dataset source union

Replace chart `layerId`/`tableName` branching with a versioned discriminated union:

```ts
type DatasetSource =
  | { kind: 'layer'; layerId: string }
  | { kind: 'table'; datasetId: string; tableName: string; rowIdColumn: string }
  | { kind: 'workflow-node'; datasetId: string; nodeId: string; rowIdColumn: string };
```

Migration requirements:

- Existing layer charts become `{ kind: 'layer' }` sources.
- Existing table charts become `{ kind: 'table' }` sources.
- Old saved manifests remain importable.

### M5.2 Key visual analytics state by dataset

Evolve state from `visualAnalytics.layers[layerId]` to dataset-scoped interaction state:

- Filters.
- Selection.
- Hover/highlight where meaningful.
- Charts, KPIs and cohorts.

Provide layer adapters so map code remains focused on rendering rather than dataset-source branching.

### M5.3 Stable row identity

- Use an existing unique identifier when validated.
- Otherwise materialise a stable row ID in a DuckDB view or table.
- Never rely on page index or transient query order.
- Surface identifier quality in the dataset overview.

### M5.4 Link tables and charts without requiring a map

Acceptance criteria:

- Clicking or brushing a non-spatial chart filters its table and sibling charts.
- Selecting table rows highlights corresponding chart marks where practical.
- The map remains absent when geography is irrelevant.
- Filters and exports operate through the same dataset query layer.
- No cross-filter loop repeatedly re-applies equivalent state.

---

## 11. M6 — Performance, accessibility and dashboard presentation

### M6.1 Analytical query client

Add a local query coordinator for DuckDB analytical reads:

- Stable query keys derived from dataset version, filters, fields, aggregation and facet.
- In-flight request deduplication.
- Bounded result cache with explicit invalidation.
- Request generations so stale results cannot overwrite current UI.
- A small concurrency queue for expensive profiles and chart queries.
- Instrumentation for query duration and cache hit rate in development.

Do not cache exports or mutation queries. Do not use stale results after a workflow source version changes.

### M6.2 Reduce redundant work

- Share total and filtered counts across charts, KPIs and summaries.
- Batch compatible aggregates where this produces simpler SQL and fewer scans.
- Reuse dataset profiles between the table, style editor and Quick Explore.
- Debounce continuous controls and commit on pointer release where possible.

### M6.3 Loading and code delivery

- Lazy-load copilot, workflow editor and advanced style panels.
- Define explicit Vite chunks for MapLibre, XYFlow and secondary UI.
- Cache DuckDB Wasm and workers with long-lived immutable asset headers.
- Keep the map mounted across layout changes.
- Add a warm-start performance test and bundle-size report.

### M6.4 Accessibility completion

- Keyboard operation for charts, filter editors, box-selection mode and command palette.
- Visible focus and sufficiently large interactive targets.
- Text or pattern reinforcement for colour states.
- Chart summaries and accessible tabular alternatives.
- Reduced-motion handling for temporal playback and transitions.
- Automated accessibility checks for the major shell states, supplemented by manual keyboard testing.

### M6.5 Dashboard board and presentation mode

After dataset-scoped linking is stable, add an optional board layout:

- Map, chart, KPI, table and note cards.
- Resizable grid with saved layouts.
- Edit mode and presentation mode.
- Shared global filters displayed in a consistent location.
- Bookmark-driven presentation states.
- Responsive fallback that stacks cards rather than shrinking them into unreadability.

The existing map-first workspace remains the default exploration environment; board mode is for assembling and communicating findings.

---

## 12. Testing strategy

### 12.1 Unit tests

- Typed command defaults and validation.
- History transactions, coalescing and exclusions.
- Every filter kind in SQL and MapLibre compilation.
- Time-grain selection and temporal query generation.
- KPI arithmetic and formatting edge cases.
- Dataset profiling and cohort comparison calculations.
- Manifest validation, migration and secret exclusion.
- Query-key stability and cache invalidation.

### 12.2 Component tests

- Quick Explore menus by semantic field type.
- Filter editing, keyboard flow and validation errors.
- Chart brushing and line-chart empty states.
- KPI pin/reorder/remove interactions.
- Project relink and recovery prompts.
- Non-spatial table/chart linking.

### 12.3 Integration tests

Cover these end-to-end stories:

1. Load data → inspect overview → create a chart from a field.
2. Brush chart → see map/table update → undo → redo.
3. Box-select map features → create a cohort → compare with the remainder.
4. Save project → reload → relink source → recover charts and filters.
5. Load a non-spatial table → chart → cross-filter → export subset.

### 12.4 Data-shape fixtures

Test with:

- Empty and one-row data.
- Long labels and high-cardinality categories.
- Missing and non-finite numeric values.
- Duplicate and missing identifiers.
- Sparse and dense time series with gaps.
- Invalid, mixed and missing geometry.
- 100k and 1m-row synthetic tables.
- MVT layers spanning multiple rendered tiles.

### 12.5 Release checks

For every milestone:

```bash
npm test
npm run build
npm run lint
```

Also perform a manual keyboard-only pass and test one small, one sparse and one large dataset.

---

## 13. Success measures

Measure locally or through privacy-preserving opt-in telemetry only.

### Exploration effectiveness

- Median interactions from loaded field to first useful visual: two or fewer.
- Target users can identify and explain active filters without instruction.
- A mistaken filter, style or selection can be recovered in one undo action.

### Analytical usefulness

- Users can compare a selection against a baseline without exporting to another tool.
- Every displayed aggregate exposes its measure, aggregation and filter scope.
- Spatial and non-spatial datasets support the same overview/filter/detail workflow.

### Reliability

- Project manifest round trips do not lose analytical specifications.
- Recovery never stores secrets or silently discards unresolved sources.
- Sparse, dense, missing and long-label test fixtures remain usable.

### Performance

- Identical concurrent analytical requests execute once.
- Rapid brushing never allows stale results to replace newer results.
- Bundle-size and warm-start regressions are visible in CI output.
- Large-data interactions remain responsive through MVT, sampling, aggregation and bounded rendering.

---

## 14. Recommended issue order

Create implementation issues in this order:

1. Typed analytical commands and field semantic metadata.
2. Bounded history slice and undo/redo controls.
3. Quick Explore field menu.
4. Filter type extensions and SQL/compiler tests.
5. Editable filter-chip popover.
6. Map box-selection helper and toolbar.
7. Scale, home, fullscreen and coordinate controls.
8. Command palette.
9. Temporal chart SQL and time-grain utilities.
10. Line-chart component and temporal brushing.
11. KPI specification, service and shelf.
12. Dataset profiling service and overview UI.
13. Configurable selection summary and legend improvements.
14. Chart/export utilities.
15. Project manifest schema, migrations and file import/export.
16. Autosave, recovery and source relinking.
17. GeoJSON/JSON ingestion, followed by URL and clipboard sources.
18. Cohort model and materialisation.
19. Comparison view and analytical bookmarks.
20. Dataset-source migration and stable row identity.
21. Linked non-spatial tables and charts.
22. Query coordinator, deduplication and profiling queue.
23. Code splitting, asset caching and performance fixtures.
24. Accessibility completion.
25. Dashboard board and presentation mode.

## 15. Explicit non-goals for the first three milestones

- Additional decorative chart types.
- More thematic map recipes before existing styles become easier to use.
- Arbitrary nested boolean filter expressions.
- Collaborative multi-user editing or server-hosted projects.
- Persisting raw user datasets without explicit consent.
- A dashboard grid before undo, recovery, filtering and dataset linking are sound.
