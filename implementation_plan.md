# Implementation Plan: ALUR — Interactive Visual Analytics

## Executive Summary

The repository has a strong foundation: DuckDB-Wasm + MapLibre GL + React Flow + LLM chat in a single-page app. However, the four core components (Chat, Node DAG, SQL Editor, Map) currently feel like four separate apps glued together rather than a tightly integrated visual analytics workspace. The plan below addresses this in three progressive phases.

---

## Phase 0: Foundation & Hygiene (prerequisite for everything else)

### P0-1: Remove committed API key from git history
**Why:** `VITE_OPENROUTER_API_KEY` is in `.env` which is committed. This is a security vulnerability.
**How:** Add `.env` to `.gitignore`, scrub from git history with `git-filter-repo`, add documentation to `.env.example`.
**Risk:** Low.

### P0-2: Fix dynamic Tailwind classes
**Why:** `Sidebar.tsx` line 142 uses `hover:bg-${color}-50` — Tailwind JIT cannot scan dynamic class names, so these classes will not exist in production builds.
**How:** Replace with static class maps or use inline `style` props per color variant.
**Risk:** Low.

### P0-3: Consolidate duplicate `cn()` utility
**Why:** Both `App.tsx` (line 41) and `Chat.tsx` (line 9) define the same `cn()` helper.
**How:** Move to a shared `src/utils/cn.ts` and import everywhere.
**Risk:** Very low.

### P0-4: Remove unused `framer-motion` dependency
**Why:** Declared in `package.json` but never imported anywhere.
**How:** Uninstall with `npm uninstall framer-motion`.
**Risk:** Very low.

### P0-5: Remove production `console.log` statements
**Why:** `duckdb.ts` lines 40, 42, 90, 93 contain `console.log`/`console.warn` that should be removed or replaced with a proper logger.
**How:** Replace with silent internal state or remove.
**Risk:** Very low.

### P0-6: Replace `alert()` calls with proper UI toasts
**Why:** `App.tsx` lines 107, 132 use native `alert()` which is jarring and non-production.
**How:** Add a simple toast notification system (can be lightweight, no extra library needed — use a Zustand slice + a Toast component).
**Risk:** Low.

### P0-7: Add test infrastructure
**Why:** Zero test coverage. The workflow engine is pure logic and should be unit-testable.
**How:** Add `vitest` as dev dependency. Write tests for `workflowEngine.ts` (topological sort, CTE building) and `duckdb.ts` (GeoJSON conversion).
**Risk:** Low.

---

## Phase 1: Tighten Chat ↔ Workflow ↔ Map Integration

### 1.1 Upgrade LLM integration from `functions` to `tools` API
**Current:** Uses the deprecated OpenAI `functions` parameter (openrouter.ts line 51).
**Target:** Use the `tools` parameter with `{"type": "function"}` wrapper, matching current OpenAI API spec.
**Why:** Ensures forward compatibility and enables future tool features (e.g., `tool_choice: "required"`).

### 1.2 Visual tool-call rendering in Chat
**Current:** When the LLM calls a tool, the chat shows a bare text message: `"Invoking tool: add_node"` and `"Tool executed: add_node (node-123)"`.
**Target:** Render tool calls as rich inline cards showing what happened:
- `add_node` → show mini node preview with type/color
- `connect_nodes` → show a small edge diagram
- `run_spatial_query` → show row count, preview of first 3 rows
**Why:** Makes the chat feel like a copilot, not a log file. Users can see cause-and-effect.

### 1.3 Bidirectional Map ↔ Node selection
**Current:** Clicking a node in the flow selects it and fetches attribute preview. No map reaction.
**Target:**
- Click a node → highlight associated map layer (dim others, zoom to bounds)
- Click a feature on the map → highlight the corresponding node in the flow, show its attributes in the table
- Map “Layer Stack” panel shows which node produced which layer (already partially done but no node link)
**Why:** This is the single most impactful integration. Analysts expect to click on a result and see both the map and the workflow light up.

### 1.4 Map interactivity: popups, filtering, measurement
**Current:** Map is a passive display. No click interaction, no popups, no querying.
**Target:**
- Click feature → popup with key attribute values
- Shift+click → select features and filter the active workflow node
- Right-click → context menu: “Zoom to layer”, “Filter selection”, “Add as new Input”
- Simple measurement tool (distance, area) — MapLibre has built-in helpers
**Why:** Without click interaction, the map is a static image. Analysts need to explore spatial data visually.

### 1.5 Step-through workflow execution
**Current:** The only way to “run” a workflow is the “Execute Workflow” button which runs the entire DAG at once.
**Target:** Add “Run to here” per-node execution:
- Each node shows its current status (idle/running/done/error)
- Nodes can be executed incrementally — run upstream, inspect intermediate result on map, continue downstream
- Cache intermediate results so re-running a downstream node doesn’t recompute upstream work
**Why:** This is how mature visual workflow tools work (for example, QGIS Graphical Modeler's “Run selected”). Debugging a 10-node workflow is impossible if you only see the final output.

### 1.6 Chat can directly add layers to map
**Current:** `add_geojson_layer` and `add_h3_layer` tool definitions exist but are stubbed with “not implemented yet” (Chat.tsx lines 123-127).
**Target:** Implement both:
- `add_geojson_layer` — takes raw GeoJSON, adds it as a map layer
- `add_h3_layer` — converts point data to H3 hex bins using DuckDB’s `h3` extension (install `h3` alongside `spatial`)
**Why:** These are the only two LLM tools directly affecting the map. Without them, the chat cannot visualize query results.

---

## Phase 2: Polish Node Tools & Interface

### 2.1 Dedicated `AttributeNode` component
**Current:** `AnalysisNode.tsx` serves double duty for both `analysis` and `attribute` types via `isAttribute` flag. This creates confusing code paths and config UI that shows irrelevant controls.
**Target:** Separate `AttributeNode.tsx` with its own rendering, schema, and workflow engine handler.
**Why:** Cleaner code, simpler per-node UI, easier to add attribute-specific features later.

### 2.2 Make `OutputNode` buttons functional
**Current:** The “PREVIEW” and “Share” buttons in `OutputNode.tsx` have no `onClick` handlers.
**Target:**
- PREVIEW → zoom map to this output’s layer, open attribute table
- Share → copy permalink or export GeoJSON to clipboard
**Why:** Dead buttons signal incomplete product.

### 2.3 SQL feedback loop: manual edits should update the workflow
**Current:** When `isManualSQL` is toggled on, the SQL editor is editable. But editing the SQL has no effect on the workflow nodes/edges — it just runs independently against DuckDB.
**Target:** After a user manually edits SQL and clicks “RUN QUERY”, show a “Promote to node?” suggestion that creates a new `analysis` node with the handwritten SQL as its config, connected to the appropriate input nodes.
**Why:** Bridges the gap between visual modeling and power-user SQL. Users should be able to write a custom SQL snippet and have it become part of their DAG.

### 2.4 Node config validation with inline errors
**Current:** Users can set `ST_Buffer` distance to -100, or filter to `WHERE nonexistent_column > 0`, or leave required fields empty. Errors only surface during full workflow execution.
**Target:** Validate node configs on change:
- Check that numeric fields are valid numbers
- Run a lightweight `EXPLAIN` or `DESCRIBE` on the intermediate SQL to catch column errors early
- Show inline error badges on nodes
**Why:** Fail fast. Mature analytical tools report invalid parameters immediately.

### 2.5 Filter and Aggregate: auto-suggest columns from schema
**Current:** Filter and Aggregate nodes have free-text inputs for column names (`condition`, `groupBy`). Users must guess column names.
**Target:** Autocomplete dropdown populated from `nodeSchemas` (which is already being fetched).
**Why:** Reduces friction. The schema data is already in the store — this is just not wired into the UI.

### 2.6 Better Node Library presentation
**Current:** The sidebar lists 4 items (Data Input, Spatial Analysis, Attribute Analysis, Map Preview). Missing: Aggregate and Filter nodes cannot be added from the sidebar — only from the chat.
**Target:** Add all 6 node types to the sidebar with clear categorization. Show a search bar for spatial operations (there are 120+ functions). Show recently used functions.
**Why:** Users should not need the LLM to add basic node types.

---

## Phase 3: Production-Grade UX & Architecture

### 3.1 Break up monolithic `App.tsx`
**Current:** 441 lines containing layout, state orchestration, SQL preview, export, schema fetching, resize handling.
**Target:**
- `Layout.tsx` — pure layout grid (header, sidebar, main, right panel, footer)
- `useWorkflowSync.ts` — hook for SQL generation ↔ manual SQL sync logic
- `useSchemaFetcher.ts` — hook for schema fetching debounced on node changes
- `WorkflowPreview.tsx` — the SQL editor panel
- `AttributeInspector.tsx` — the bottom data table panel
**Why:** Testability, maintainability, readability.

### 3.2 Optimize Zustand store subscriptions
**Current:** Many components use `useStore()` (full subscription), causing re-renders on every state change. `AnalysisNode.tsx` line 10, `Chat.tsx` line 14-23.
**Target:** Use selectors: `useStore(state => state.specificField)` for all components. Consider using `useShallow` for multiple selectors.
**Why:** Performance. With large workflows (20+ nodes), unnecessary re-renders will cause React Flow jank.

### 3.3 Replace `LIMIT 5000` hardcode with pagination/virtualization
**Current:** `workflowEngine.ts` line 212 hardcodes `LIMIT 5000`. For large datasets this misses data; for small ones it’s unnecessary.
**Target:**
- Configurable limit per node (in node config UI)
- MVT (Mapbox Vector Tiles) rendering for large datasets using `ST_AsMVT` instead of `ST_AsGeoJSON`
- Virtual scrolling in the DataTable via TanStack Table’s built-in virtualization
**Why:** Without this, the app is limited to ~5000 features. That is not production-ready for medium-scale visual analysis.

### 3.4 Add error boundaries for each panel
**Current:** A crash in the chat, map, or flow will take down the entire app.
**Target:** Wrap each major panel (Chat, MapView, ReactFlow, DataTable, SQL editor) in `<ErrorBoundary>` with a fallback UI.
**Why:** Resilience. A bad SQL query should not break the map.

### 3.5 Workflow persistence (localStorage/IndexedDB)
**Current:** Page refresh loses all work.
**Target:** Auto-save workflow JSON to `localStorage` on every change. “Restore last session” prompt on load. Manual save/load buttons.
**Why:** A modeler session can last hours. Losing work on refresh is unacceptable.

### 3.6 Map legend and layer controls
**Current:** Layer stack panel shows feature count but no way to toggle visibility, change opacity, reorder, or remove layers.
**Target:**
- Toggle layer visibility (checkbox)
- Opacity slider per layer
- Drag-to-reorder layers
- Color picker for symbolization
- Delete layer button
**Why:** Essential for any analytical map view.

### 3.7 Keyboard shortcuts and accessibility
**Current:** No keyboard shortcuts. No ARIA labels.
**Target:**
- `Ctrl+Enter` — run workflow
- `Ctrl+S` — save workflow
- `Ctrl+Shift+M` — toggle manual SQL mode
- `Delete` — delete selected node
- `Ctrl+D` — duplicate node
- Tab navigation through the workspace panels
**Why:** Power users expect keyboard-driven workflows.

### 3.8 Export node-specific results (not just final)
**Current:** `handleExport` uses `nodes[nodes.length - 1]` which is unreliable — it depends on array order, not DAG topology.
**Target:** Right-click on any node → “Export this node’s output” → choose format.
**Why:** Users need to export intermediate results, not just the final output.

### 3.9 Generalize `ST_Transform` handling in the workflow engine
**Current:** `ST_Transform` is hardcoded as a special case in `workflowEngine.ts` lines 116-121. Other spatial functions that take extra parameters (e.g., `ST_ConcaveHull` with ratio) have no support.
**Target:** Design a parameter system where node config specifies `params: Record<string, any>` and the workflow engine inserts them into the SQL template generically.
**Why:** The current approach doesn’t scale to 120+ spatial functions.

---

## Effort & Priority Summary

| Item | Phase | Effort | Impact | Priority |
|------|-------|--------|--------|----------|
| P0-1: Remove committed API key | 0 | 1h | High | P0 |
| P0-6: Replace `alert()` with toasts | 0 | 2h | Medium | P0 |
| 1.3: Bidirectional Map ↔ Node selection | 1 | 12h | Highest | P0 |
| 1.4: Map interactivity (popups, etc.) | 1 | 8h | High | P0 |
| 1.2: Visual tool-call rendering | 1 | 6h | High | P0 |
| 1.6: Implement `add_geojson_layer` / `add_h3_layer` | 1 | 4h | High | P0 |
| 2.4: Node config validation | 2 | 6h | High | P0 |
| 2.2: Make OutputNode buttons functional | 2 | 3h | Medium | P0 |
| P0-2: Fix dynamic Tailwind classes | 0 | 1h | Medium | P1 |
| 1.5: Step-through execution | 1 | 16h | Highest | P1 |
| 3.1: Break up App.tsx | 3 | 8h | Medium | P1 |
| 3.6: Map legend and layer controls | 3 | 6h | High | P1 |
| 2.6: Better Node Library | 2 | 4h | Medium | P1 |
| 2.5: Auto-suggest columns from schema | 2 | 4h | Medium | P1 |
| 3.5: Workflow persistence | 3 | 6h | High | P1 |
| 2.1: Dedicated AttributeNode | 2 | 3h | Low | P2 |
| 1.1: Upgrade to tools API | 1 | 2h | Low | P2 |
| 2.3: SQL feedback loop | 2 | 8h | Medium | P2 |
| 3.3: Pagination / MVT rendering | 3 | 12h | High | P2 |
| 3.2: Optimize store subscriptions | 3 | 4h | Medium | P2 |
| 3.4: Error boundaries | 3 | 3h | Medium | P2 |
| 3.8: Node-specific export | 3 | 3h | Low | P2 |
| 3.9: Generic parameter system | 3 | 8h | Medium | P3 |
| 3.7: Keyboard shortcuts | 3 | 4h | Low | P3 |
| P0-3 / P0-4 / P0-5 / P0-7 | 0 | <2h each | Low | P3 |

---

## Architecture Diagram (Target State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          App (Layout)                                │
│  ┌──────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │ Sidebar   │  │ Main Workspace       │  │ Right Panel          │  │
│  │ ┌──────┐  │  │ ┌─────────────────┐  │  │ ┌─────────────────┐  │  │
│  │ │Node  │  │  │ │    MapView      │  │  │ │Loaded Tables    │  │  │
│  │ │Library│  │  │ │  (MapLibre GL)  │  │  │ │(clickable,      │  │  │
│  │ │       │  │  │ │  - popups       │  │  │ │ linked to nodes)│  │  │
│  │ │       │  │  │ │  - click→select │  │  │ └─────────────────┘  │  │
│  │ └──────┘  │  │ │  - measurement   │  │  │ ┌─────────────────┐  │  │
│  │ ┌──────┐  │  │ └─────────────────┘  │  │ │SQL Editor       │  │  │
│  │ │Chat  │  │  │ ┌─────────────────┐  │  │ │(synced + manual)│  │  │
│  │ │agent │  │  │ │   ReactFlow     │  │  │ │  - promote to   │  │  │
│  │ │(rich │  │  │ │  (DAG Nodes)    │  │  │ │    node button   │  │  │
│  │ │tool  │  │  │ │  status per node│  │  │ └─────────────────┘  │  │
│  │ │cards)│  │  │ │  validation     │  │  │                      │  │
│  │ └──────┘  │  │ └─────────────────┘  │  │                      │  │
│  │ ┌──────┐  │  │ ┌─────────────────┐  │  │                      │  │
│  │ │Execute│  │  │ │ DataTable       │  │  │                      │  │
│  │ │Button │  │  │ │(virtual scroll) │  │  │                      │  │
│  │ └──────┘  │  │ └─────────────────┘  │  │                      │  │
│  └──────────┘  └──────────────────────┘  └──────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Footer (status + export + system status)                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

Data Flow (Target):
  Chat → tool calls → Zustand store → ReactFlow nodes
  ReactFlow → workflowEngine.ts → SQL → DuckDB → GeoJSON → Map
  Map click → feature query → DuckDB → select node → DataTable
  SQL Editor (manual) → DuckDB → result → "Promote to node" → ReactFlow
```

---

## Measurement: How we know we’re done

The app is production-ready for basic to medium visual and spatial analysis with vector datasets when:

1. **Load data** → A user can upload Parquet/CSV and see it on the map in <3s
2. **Build workflow** → A user can create a 5+ node workflow without touching the chat (or with chat, either way)
3. **Intermediate inspection** → User can click any node and see both the map result and the attribute table update
4. **Map feedback** → Clicking a feature shows its attributes; selecting nodes zooms to the right layer
5. **Chat integration** → “Buffer the input by 500 meters” creates the correct nodes, runs the workflow, and shows the result on the map — all in one interaction
6. **Export** → User can export any node’s output as Parquet/CSV/GeoJSON
7. **Error handling** → Invalid inputs show inline errors, not alert() boxes
8. **Persistence** → Refreshing the page restores the last workflow state
9. **Performance** → 100K features render on map and in table without jank
10. **Tests** → Core engine (workflow SQL generation, GeoJSON conversion) has >80% coverage
