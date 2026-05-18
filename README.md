# YMNNGIS

**You Might Not Need Desktop GIS.** A browser-based spatial analysis and interactive visualisation platform powered by DuckDB-Wasm and MapLibre GL.

## What it does

GeoModeler Pro is a single-page web application that brings the GIS workflow to your browser. Load spatial data, build processing pipelines as visual node diagrams, style and interact with map layers, and get AI assistance — all without installing a server or desktop GIS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Spatial engine | DuckDB-Wasm (in-browser SQL + `spatial` + `h3` extensions) |
| Map rendering | MapLibre GL JS |
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
npm run test       # Run test suite (60 tests)
```

## Architecture

The platform has four integrated workspaces:

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar           Map View          Right Panel        │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Node    │    │              │    │ Visualise     │  │
│  │ library │    │  MapLibre GL │    │ panel         │  │
│  │         │    │              │    │               │  │
│  │ Nodes   │    │  Legend      │    │ Layer mgr     │  │
│  │ diagram │    │  Popups      │    │ Data table    │  │
│  │         │    │              │    │ Summary       │  │
│  │ Chat    │    │              │    │               │  │
│  └─────────┘    └──────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────┘
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

1. **Load data** — Parquet, CSV, or GeoJSON files via input nodes (DuckDB tables/views)
2. **Build workflow** — Chain nodes (filter, buffer, aggregate, attribute calc, visualisation, output) as a directed acyclic graph
3. **Execute** — DuckDB compiles the node chain into a single CTE SQL query and materializes renderable table-backed layers in WebAssembly
4. **Visualise** — DuckDB-backed `MapLayer` sources render through MapLibre vector tiles (`ST_AsMVT`) and use the visualisation compiler for paint/layout expressions
5. **Interact** — Hover, inspect, and filter features on the map; DuckDB recomputes profiles, summaries, and filtered rows in real time while GeoJSON remains an export/fallback format

## Features

### Workflow Engine
- **7 node types**: Input, Analysis (16+ spatial operations), Attribute (computed columns), Filter (SQL WHERE), Aggregate (GROUP BY / dissolve), Visualisation (style recipe), Output (map preview or file export)
- Unlimited branching — style the same data multiple ways
- Step-through execution per node or full workflow run
- SQL preview for every stage

### Visualisation (7 map styles)
- **Choropleth** — numeric classification with equal interval or quantile breaks, configurable class count and palette
- **Categorical** — top-N categories with stable colour assignment
- **Graduated symbols** — point radius proportional to a numeric field
- **Heatmap** — dense point aggregation with weight field and intensity controls
- **Labels** — text annotations with halo, font size, and zoom threshold
- **Dot density** — DuckDB `ST_GeneratePoints` creates random dots within polygons, proportional to a numeric field
- **Clustered points** — MapLibre cluster sources with drill-to-zoom

All styles are compiled to native MapLibre expressions — no hand-written JSON.

### Interactive Analytics
- **Hover / select** — features highlight via MapLibre feature-state, linked to the attribute table
- **Legend filtering** — click legend items to isolate categories or value ranges
- **Distribution brushing** — click histogram bins or category bars to filter the map
- **Temporal slider** — animated time range with play/pause, configurable window size, and speed control
- **DuckDB-backed summaries** — count, mean, min, max, and category breakdowns computed under active filters
- **Filter chips** — visual display of all active filters with individual remove and clear-all
- **Stable feature IDs** — `_ymn_feature_id` assigned on layer creation, used for cross-component linking

### AI Copilot
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
│ need_london│ ──► │ need >= 10│ ──► │ ST_Buffer    │ ──► │ Map      │
│ .parquet  │      │          │      │ (500m)       │      │ Preview  │
└──────────┘      └──────────┘      └──────────────┘      └──────────┘
```

This compiles to a single DuckDB query:
```sql
WITH step1 AS (SELECT * FROM "need_london"),
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
│   ├── Chat.tsx                   # LLM agent with tool execution
│   ├── Sidebar.tsx                # Node library + spatial search
│   ├── DataTable.tsx              # Attribute table with profiling
│   └── LayerManager.tsx           # Layer visibility, opacity, management
└── App.tsx                        # Root layout + workflow diagram
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
