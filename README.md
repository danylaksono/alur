# ALUR

**Interactive visual analytics, from data to direction.**

## What it does

ALUR is a browser-based workspace for inspecting, exploring and understanding data through coordinated tables, charts, maps and visual workflows. Load data, compare distributions, filter and select across linked views, calculate fields, build reproducible processing pipelines and ask the analysis copilot for help.

Maps are one analytical view, not the product boundary: ALUR uses MapLibre when geography helps answer the question, while the interactive table, charts and DuckDB workflow remain equally important. Everything runs locally in the browser. The copilot is bring-your-own-key — add an OpenRouter API key in Settings; it is stored only in your browser's localStorage.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Analytical engine | DuckDB-Wasm (in-browser SQL + `spatial`, plus `h3` fetched on first use) |
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

## Netlify Deployment

Netlify is the sole production deployment at [alur-app.netlify.app](https://alur-app.netlify.app/). It builds the site with `npm run build` and publishes `dist`; the included `netlify.toml` records those settings in the repository.

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
- **11 node types**: Input, Analysis (spatial operations), Attribute (computed columns), Score (weighted multi-criteria ranking), Filter (SQL WHERE, map selection, top-N by column, or named conditions that record what they excluded), Summarise (numeric `GROUP BY`, or geometry dissolve), Allocate (spend a budget or capacity down a ranked list), Join (spatial predicate or attribute key), Operation (a named, reusable group of steps you saved), Visualisation (style recipe), Output (map preview or file export)
- Unlimited branching — style the same data multiple ways
- Step-through execution per node or full workflow run
- Results without geometry register as datasets, so charts, comparison and the report can read them even when the map cannot
- SQL preview for every stage

**Summarise** computes count, count distinct, sum, average, median, min and max over any number of group keys. Sum, average and median cast to a number; min and max do not, so they still work on dates and text. Merging each group's geometry is optional, and keeps the summary mappable.

**Allocate** answers "who gets served before the money runs out". It accumulates a column in priority order and either flags each row within/over the limit, drops the rows past it, or gives the row straddling it a partial share. Partitioning gives each group its own limit rather than sharing one.

**Score** combines several numeric columns into one weighted ranking. Each column is normalised across the whole result — min–max, z-score or percentile rank — before weighting, so columns on different scales combine safely, and weights are shares of their total so they need not sum to 1. Alongside the score and its rank it emits one column per criterion recording what that criterion contributed, and those contributions sum exactly to the score.

### Map visualisation
- **Choropleth** — numeric classification with equal interval or quantile breaks, configurable class count and palette
- **Categorical** — top-N categories with stable colour assignment
- **Graduated symbols / lines** — radius or width proportional to a numeric field
- **Heatmap** — dense point aggregation with weight field and intensity controls
- **Labels** — text annotations with halo, font size, and zoom threshold
- **Dot density** — DuckDB `ST_GeneratePoints` creates random dots within polygons, proportional to a numeric field
- **Hexbin / glyph grid** — binned aggregation over dense points, using equal-area H3 cells aggregated in the engine, falling back to Web Mercator cells when the extension cannot be fetched
- **Bivariate** — two numeric fields on a 3×3 colour matrix
- **Extrusion** — polygon height driven by a numeric field
- **Clustered points** — MapLibre cluster sources with drill-to-zoom

All styles are compiled to native MapLibre expressions — no hand-written JSON.

### Composite scoring

The **Score** panel in the left rail is where weights become arguable rather than declared. Moving a weight re-ranks the list underneath it against live data, each row carries a stacked bar of its criterion contributions, and a sensitivity strip reports how far the ranking moves when each weight is nudged — so a criterion that barely disturbs the top of the list is visibly not worth arguing over. Any model built there can be handed to the workflow as a Score node, which is what makes the result reproducible and feeds the rest of the pipeline.

### Explaining exclusions

A `WHERE` clause answers what survived; it cannot answer why a particular row did not, because the statement that produces the answer destroys the evidence. The Filter node's **named conditions** mode takes a list of labelled conditions instead of one anonymous clause, and writes on every row which ones it failed — `alur_excluded`, `alur_excluded_by` and `alur_excluded_count`. Conditions are **hard** (can remove a row) or **soft** (only marks it), so near-misses stay visible instead of being lost. Set the outcome to *keep them, marked* and nothing is removed at all.

The reasons are plain text, so they group in a Summarise node, colour a map through the category renderer and export to CSV without anything downstream needing to know they are special.

Inside the node, a **constraint funnel** measures each condition against the real upstream rows and reports both what it removes on its own and what it removes that the earlier conditions had not already. The gap is the useful part: a condition that removes thousands alone but nothing in sequence does not bind, which no surviving row count would ever tell you.

### Naming your own operations

A workflow that reads as fifteen anonymous Attribute nodes is one nobody can follow a month later. Select a run of steps and **save them as an operation** with a name and fill-in-the-blank values: it joins the node palette and reads as one step on the canvas.

Blanks are found rather than declared — write `{{amount}}` or `{{column}}` anywhere in a step's configuration and the save dialog offers them to be labelled and typed. Values are a **number**, a **column**, or **one of a list**, and each is validated before any SQL is built; free text is deliberately not offered, because a value is interpolated into the query.

ALUR ships no domain vocabulary of its own. `Retrofit(−20% on Gcons2023)` is something you author out of generic nodes, and it travels in your project file for whoever you share it with.

### Reopening a project

Project files record the workflow, styling, cohorts and report — but not the data, which stays on your machine. ALUR keeps a copy of every file you load in the browser's private storage, so reopening a project or recovering a crashed session re-attaches its data without asking you to find each file again. Where a file is not held — a different machine, or storage the browser has reclaimed — the existing relink prompt asks for exactly that file and checks it matches before accepting it.

Nothing leaves your device. Settings shows how much is cached and clears it, and the cache stays inside a fixed budget by dropping least-recently-used files.

### Compare, cohorts and reporting
- **Cohorts** — name and save a filtered subset, then compare it against another cohort or the remainder, with effect sizes and explicit denominator and missing-value notes
- **Compare workspace** — two to four groups drawn from datasets, snapshotted filters or cohorts; aligned by summary, by record key, by time or by location; overview, distribution, category, time, map and record views on shared scales
- **Difference maps** — per-record deltas rendered on a diverging scale when two groups are keyed to the same entities
- **Scenario variants** — branch a workflow specification, run each branch, and compare the results as groups
- **Report workspace** — pin charts, KPIs, tables, maps and comparisons as evidence cards, each carrying its own provenance and staleness state; write findings that link to the evidence supporting or contradicting them
- **Stories** — export a finished, read-only account that renders without the source data, and diff two stories to see where their claims actually disagree
- **Scenario lineage** — a card showing what branched from what, exactly which parameters differ at each branch, and what each scenario assumed; frozen when shared, so a recipient sees the derivation without the scenarios
- **Assumptions on the evidence** — a chart or table built on a scenario's result carries that scenario's assumptions, captured when it was pinned
- **Analysis history** — labelled undo/redo across filters, cohorts, charts and layout, plus bookmarks that restore a whole analytical state

### Interactive Analytics
- **Place search** — locate a place or address with Nominatim/OpenStreetMap, then zoom to its bounds
- **Hover / select** — features highlight via MapLibre feature-state, linked to the attribute table
- **Legend filtering** — click legend items to isolate categories or value ranges
- **Distribution brushing** — click histogram bins or category bars to filter the map
- **Temporal slider** — animated time range with play/pause, configurable window size, and speed control
- **DuckDB-backed summaries** — count, mean, min, max, and category breakdowns computed under active filters
- **Filter chips** — visual display of all active filters with individual remove and clear-all
- **Stable feature IDs** — `_alur_feature_id` assigned on layer creation, used for cross-component linking

### ALUR Copilot
- Natural-language workflow creation (“add a 500m buffer around london wards”)
- One-shot map styling (“style the need layer as a five-class quantile choropleth”)
- Filtering and selection in plain English (“show only wards where need is above 40”)
- All 13 chat tools write directly to the Zustand store — the map updates immediately

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
│   ├── workflowEngine.ts        # Node graph → chained-CTE SQL compiler
│   ├── mapStyleCompiler.ts      # Visualisation → MapLibre expressions
│   ├── classification.ts        # Profiling, classification, vis builders
│   ├── scoreModel.ts            # Weighted multi-criteria score → SQL
│   ├── aggregationSql.ts        # Group-by measures, running-total allocation, top-N
│   ├── filterPredicates.ts      # Named conditions → exclusion columns and funnel SQL
│   ├── workflowFragments.ts     # Saved operations: parameters, validation, expansion
│   ├── variantLineage.ts        # Scenario tree, per-branch parameter diffs, assumptions
│   ├── visualFilterSql.ts       # VisualFilter → DuckDB WHERE clauses
│   ├── visualisationResolver.ts # Workflow config → LayerVisualisation
│   ├── scenarioComparison.ts    # Variant results → ComparisonSpec
│   ├── storyDiff.ts             # Claim matching between two stories
│   ├── fieldCalculator.ts       # Table-view expression parser
│   └── toolDefinitions.ts       # LLM tool schemas
├── services/
│   ├── duckdb.ts                # DuckDB-Wasm init + query interface
│   ├── visualAnalyticsService.ts # Filtered rows, profiles, summaries, temporal range
│   ├── comparisonService.ts     # Comparison alignment and denominators
│   ├── scoreService.ts          # Live scoring, ranking and weight sensitivity
│   ├── filterFunnelService.ts   # What each condition in a filter actually removes
│   ├── sourceCache.ts           # Loaded files kept in OPFS so projects reopen with their data
│   ├── layerMaterialization.ts  # Workflow result → layer or dataset
│   ├── workflowRun.ts           # Registers a run's output across the store
│   ├── projectService.ts        # Project manifest save / load / migrate
│   └── storyService.ts          # Story export, parse and disclosure
├── components/
│   ├── Visualisation/           # Style editor, cohorts, filters, KPIs, selection
│   ├── Compare/                 # Compare workspace + shared evidence views
│   ├── Explain/                 # Report workspace, story viewer, diff, export
│   ├── Variants/                # Scenario variants panel
│   ├── Charts/ · Map/ · Flow/   # Chart panel, MapLibre view, workflow nodes
│   ├── shell/                   # AppShell, rail, panel, drawer, command palette
│   ├── Chat.tsx                 # LLM agent with tool execution (BYOK)
│   └── DataTable.tsx            # Attribute table with profiling
└── App.tsx                      # DuckDB init + AppShell mount
```

## Tests

379 tests across 46 files, covering the visualisation pipeline, workflow SQL generation, store actions, comparison and story services, and a full workflow smoke test. Some of the more load-bearing ones:

| Test file | Focus |
|-----------|-------|
| `visualisationIntegration.test.ts` | End-to-end pipeline: vis kinds, resolver, branching, interaction state, feature IDs, clustering, cleanup |
| `workflowEngine.test.ts` | SQL generation, joins, visualisation propagation, terminal-node attribution |
| `scoreModel.test.ts` | Weighted score compilation: weights, direction, normalisation, missing values |
| `filterPredicates.test.ts` | Named conditions: NULL handling, hard vs soft, exclusion columns, funnel counts |
| `workflowFragments.test.ts` | Saved operations: parameter validation, expansion, rewiring, graph immutability |
| `variantLineage.test.ts` | Scenario tree, per-branch diffs, orphans and cycles, assumption capture |
| `comparisonService.test.ts` | Comparison alignment, denominators and warnings |
| `useStore.test.ts` | Layer state, layout preferences, scenario variants |
| `storyDiff.test.ts` | Claim matching and divergence reasons between two stories |
| `sampleWorkflowSmoke.test.tsx` | Full workflow sequence + UI mounting + chat tools |

```bash
npm test            # Run once
npm run test:watch  # Watch mode
npm run test:e2e    # Playwright
```

## Roadmap

[docs/improvement-plan.md](docs/improvement-plan.md) is the current plan. Composite scoring, the numeric `GROUP BY` and allocation nodes, filter provenance, named reusable operations, equal-area hexbins, resumable projects and scenario lineage have shipped; wider copilot coverage has not.

Still deferred, and not in that plan:

- Flow / origin-destination maps
- Swipe map comparison (side-by-side and difference maps ship in the Compare workspace)
- Static map / image export beyond report evidence capture
- Cartographic output composer (title, scale bar, north arrow, layout)
- Jenks natural breaks and standard deviation classification
