# ALUR

**Interactive visual analytics, from data to direction.**

## What it does

ALUR is a browser-based workspace for inspecting, exploring and understanding data through coordinated tables, charts, maps and visual workflows. Load data, compare distributions, filter and select across linked views, calculate fields, build reproducible processing pipelines and ask the analysis copilot for help.

Maps are one analytical view, not the product boundary: ALUR uses MapLibre when geography helps answer the question, while the interactive table, charts and DuckDB workflow remain equally important. Everything runs locally in the browser. The copilot is bring-your-own-key — add an OpenRouter API key in Settings; it is stored only in your browser's localStorage.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Analytical engine | DuckDB-Wasm (in-browser SQL + `spatial` + `h3` extensions) |
| Linked views | TanStack Table + custom SVG charts + MapLibre GL JS |
| Workflow editor | XYFlow (React Flow) |
| State management | Zustand |
| AI assistant | LLM-powered chat with tool calling |
| UI framework | React 18 + Tailwind CSS |
| Build tool | Vite |

Everything runs client-side. No backend, no server, no installation.

## Getting Started

```bash
npm install
npm run dev        # Start dev server on localhost:5173
npm run build      # Production build
npm run preview    # Preview production build
npm run test       # Run the test suite
```

## GitHub Pages Deployment

The GitHub Actions build uses Vite's `github-pages` mode, which configures the `/ymnngis/` repository subpath so static assets resolve correctly after deployment. The default production build uses `/`, which is suitable for Netlify and other root-domain deployments.

Pushes to `main` are deployed through GitHub Actions in `.github/workflows/deploy.yml`. In the repository settings, set Pages to use GitHub Actions as the source.

## Netlify Deployment

Netlify builds the site with `npm run build` and publishes `dist`. The included `netlify.toml` records those settings in the repository.

## Architecture

Coordinated visual-analytics shell: the main canvas provides geographic context when available, while charts, layers and the copilot live in a collapsible left panel and the workflow, table and SQL views share a resizable bottom drawer.

```
┌──────────────────────────────────────────────────────────┐
│ Header: logo · Add data · New project · Settings (BYOK)  │
├──┬───────────────┬───────────────────────────────────────┤
│R │ Left panel    │                                       │
│a │ (collapsible) │           MapLibre GL (full-bleed)    │
│i │  · Layers +   │                                       │
│l │    Style      │   Legend overlay    Selection overlay │
│  │  · Charts     │                                       │
│  │  · Copilot    │                                       │
├──┴───────────────┴───────────────────────────────────────┤
│ Bottom drawer (collapsed ▲ / resizable / maximizable)    │
│   Workflow (node canvas + palette) · Table · SQL         │
└──────────────────────────────────────────────────────────┘
         │               │                    │
         └───────────────┼────────────────────┘
                         │
                  ┌──────┴──────┐
                  │   Zustand   │   Single store for all state
                  │   Store     │
                  └──────┬──────┘
                         │
                  ┌──────┴──────┐
                  │  DuckDB-Wasm│   Spatial queries, filtering,
                  │             │   profiling, dot generation
                  └─────────────┘
```

### Data flow

1. **Load** — Bring Parquet, CSV, or GeoJSON data into local DuckDB tables/views
2. **Inspect** — Explore records, field profiles, distributions and missing values in the table
3. **Relate** — Select and filter across linked tables, charts and maps
4. **Transform** — Chain filters, calculations, joins, aggregates, spatial operations and visualisation recipes as a directed acyclic graph
5. **Explain or export** — Revisit the generated SQL, use the copilot, or export a reusable result

## Features

### Workflow Engine
- **7 node types**: Input, Analysis (16+ spatial operations), Attribute (computed columns), Filter (SQL WHERE), Aggregate (GROUP BY / dissolve), Visualisation (style recipe), Output (map preview or file export)
- Unlimited branching — style the same data multiple ways
- Step-through execution per node or full workflow run
- SQL preview for every stage

### Map visualisation (7 styles)
- **Choropleth** — numeric classification with equal interval or quantile breaks, configurable class count and palette
- **Categorical** — top-N categories with stable colour assignment
- **Graduated symbols** — point radius proportional to a numeric field
- **Heatmap** — dense point aggregation with weight field and intensity controls
- **Labels** — text annotations with halo, font size, and zoom threshold
- **Dot density** — DuckDB `ST_GeneratePoints` creates random dots within polygons, proportional to a numeric field
- **Clustered points** — MapLibre cluster sources with drill-to-zoom

All styles are compiled to native MapLibre expressions — no hand-written JSON.

### Interactive Analytics
- **Place search** — locate a place or address with Nominatim/OpenStreetMap, then zoom to its bounds
- **Hover / select** — features highlight via MapLibre feature-state, linked to the attribute table
- **Legend filtering** — click legend items to isolate categories or value ranges
- **Distribution brushing** — click histogram bins or category bars to filter the map
- **Temporal slider** — animated time range with play/pause, configurable window size, and speed control
- **DuckDB-backed summaries** — count, mean, min, max, and category breakdowns computed under active filters
- **Filter chips** — visual display of all active filters with individual remove and clear-all
- **Stable feature IDs** — `_ymn_feature_id` assigned on layer creation, used for cross-component linking

### ALUR Copilot
- Natural-language workflow creation (“add a 500m buffer around london wards”)
- One-shot map styling (“style the need layer as a five-class quantile choropleth”)
- H3 hexbin generation (“create H3 cells at resolution 7 covering camden”)
- All 9 chat tools write directly to the Zustand store — map updates immediately

### Layer Management
- Visibility toggle, opacity slider, colour swatch, zoom-to-layer, deletion
- Layer ↔ source node back-linking
- Basemap switcher (multiple tile styles)
- Map style export as JSON

## Workflow Example

```
Data Input           Filter              Analysis            Output
┌──────────┐      ┌──────────┐      ┌──────────────┐      ┌──────────┐
│ wards      │ ──► │ need >= 10│ ──► │ ST_Buffer    │ ──► │ Map      │
│ .parquet   │      │          │      │ (500m)       │      │ Preview  │
└──────────┘      └──────────┘      └──────────────┘      └──────────┘
```

This compiles to a single DuckDB query:
```sql
WITH step1 AS (SELECT * FROM "wards"),
     step2 AS (SELECT * FROM step1 WHERE need >= 10),
     step3 AS (SELECT *, ST_Buffer("geometry", 500) AS geom_buffered FROM step2)
SELECT * FROM step3 LIMIT 5000;
```

## Project Structure

```
src/
├── store/
│   └── useStore.ts              # Zustand store (nodes, edges, mapLayers, visualAnalytics, chat)
├── types/
│   ├── visualisation.ts         # LayerVisualisation union, LegendSpec
│   └── visualAnalytics.ts       # VisualFilter, LayerFeatureSelection, summaries
├── utils/
│   ├── mapStyleCompiler.ts      # Visualisation → MapLibre expressions
│   ├── classification.ts        # Profiling, classification, vis builders
│   ├── palettes.ts              # Sequential + categorical palettes
│   ├── visualFilterSql.ts       # VisualFilter → DuckDB WHERE clauses
│   ├── visualisationResolver.ts # Workflow config → LayerVisualisation
│   ├── featureIdentity.ts       # _ymn_feature_id assignment
│   ├── workflowEngine.ts        # Node graph → SQL compiler
│   ├── mapStyleExport.ts        # Export map styles as JSON
│   ├── basemaps.ts              # Basemap tile sources
│   └── toolDefinitions.ts       # LLM tool schemas
├── services/
│   ├── duckdb.ts                # DuckDB-Wasm init + query interface
│   ├── visualAnalyticsService.ts # Filtered rows, profiles, summaries, temporal range
│   └── dotDensityService.ts     # ST_GeneratePoints / ST_Dump dot generation
├── components/
│   ├── Visualisation/
│   │   ├── VisualisationPanel.tsx # Unified style editor
│   │   ├── FilterChips.tsx        # Active filter display
│   │   ├── SelectionSummary.tsx   # DuckDB-backed metrics
│   │   └── TemporalSlider.tsx     # Animated time slider
│   ├── Map/
│   │   ├── MapView.tsx            # MapLibre integration + layer sync
│   │   └── LegendControl.tsx      # Map-corner legend overlay
│   ├── Flow/
│   │   └── VisualisationNode.tsx  # Workflow style recipe node
│   ├── shell/
│   │   ├── AppShell.tsx           # Map-first layout composition
│   │   ├── Header.tsx             # Add data, New project, Settings
│   │   ├── LeftRail.tsx           # Icon rail: Layers / Charts / Copilot
│   │   ├── LeftPanel.tsx          # Collapsible panel for the active rail tab
│   │   ├── BottomDrawer.tsx       # Resizable drawer: Workflow / Table / SQL
│   │   ├── NodePalette.tsx        # Node cards + spatial function search
│   │   ├── SettingsDialog.tsx     # BYOK OpenRouter settings
│   │   └── MapEmptyState.tsx      # Blank-canvas first-run overlay
│   ├── Chat.tsx                   # LLM agent with tool execution (BYOK)
│   ├── DataTable.tsx              # Attribute table with profiling
│   └── LayerManager.tsx           # Layer visibility, opacity, management
└── App.tsx                        # DuckDB init + AppShell mount
```

## Tests

60 tests across 9 files:

| Test file | Focus |
|-----------|-------|
| `visualisationIntegration.test.ts` | End-to-end pipeline: all 6 vis kinds, resolver, branching, interaction state, feature IDs, clustering, cleanup |
| `mapStyleCompiler.test.ts` | Compiler output for point, line, polygon, choropleth, categorical |
| `classification.test.ts` | Profiling, classification methods, legend building |
| `visualFilterSql.test.ts` | Filter SQL compilation for category, range, temporal |
| `visualAnalyticsService.test.ts` | Layer registration caching |
| `workflowEngine.test.ts` | SQL generation and visualisation node propagation |
| `mapStyleExport.test.ts` | Export payload structure |
| `useStore.test.ts` | Store actions for layer management |
| `sampleWorkflowSmoke.test.tsx` | Full workflow sequence + UI mounting + chat tools |

```bash
npm test            # Run once
npm run test:watch  # Watch mode
```

## Roadmap — Deferred for Future Iteration

- Flow / origin-destination maps
- Swipe and side-by-side map comparison
- Bivariate choropleth
- Difference / change maps
- Static map / image export
- Cartographic output composer (title, scale bar, north arrow, layout)
- Jenks natural breaks and standard deviation classification
- Vector tile (MVT) rendering for large datasets
