---
name: verify
description: Build, launch, and drive ALUR (browser visual analytics app) to verify changes at the UI surface.
---

# Verifying ALUR

Client-side React + DuckDB-WASM + MapLibre app. No backend. Surface is the browser UI.

## Launch

```bash
npm run dev          # Vite dev server on http://localhost:5173 (run in background)
```

DuckDB-WASM init takes a few seconds; wait for the header status to read **Engine ready**
before driving data flows.

## Drive (Playwright, headless Chromium)

Playwright is not a project dep — install it in a scratch dir (`npm i playwright`) and
`npx playwright install chromium` once. Drive with a node script, e.g.:

- First-run: expect the "Start with your data" empty-state card over a world-view map.
- Ingest data: `page.locator('#alur-file-input').setInputFiles('data_sample/need_london.parquet')`
  (there are now four hidden file inputs — project open, story open, data, and one more — so a
  `header input[type="file"]` locator is a strict-mode violation; use the id)
  → success toast `Loaded 25,000 features from need_london.parquet.` (~2-5s; the 51 MB
  yogyakarta file also loads in ~3s once the dev server is warm — first-ever load can be much slower).
- Bottom drawer tabs: buttons named **Workflow / Table / SQL**; collapse/maximize via
  `page.getByTitle('Collapse drawer' | 'Maximize drawer' | 'Restore drawer')`.
- Left rail: buttons named **Layers / Charts / Copilot**; clicking the active one collapses the panel.
- Settings (BYOK): `page.getByTitle('Settings')` → key input placeholder `sk-or-…`.
- Manual SQL toggle is an `sr-only` checkbox — use `.setChecked(true, { force: true })`.
- Map feature click: collapse the drawer first, then click the `.maplibregl-canvas` center;
  selection shows the `Selection — <layer>` overlay top-left.
- Test fixtures: `data_sample/*.parquet` (not bundled into the app; local only).

## Debug handles (dev builds only)

`window.__alurMap` (the MapLibre instance), `window.__alurStore` (the zustand store) and
`window.__alurDuckdb` (the DuckDB service) are exposed in dev. Use them from `page.evaluate`
to assert layer types, paint, pitch, store state and query results directly instead of
scraping the DOM.

**Always reach the engine through `window.__alurDuckdb`, never `await import('/src/services/duckdb.ts')`.**
After any edit to a module, Vite serves it under a cache-busting `?t=` query, so a raw-path
import resolves to a *different module instance* — a second, uninitialised DuckDB service
whose every query throws `DuckDB not initialized`. It works until you edit the file, then
fails in a way that looks like a product bug. Importing other services by path is fine.

## Gotchas

- **Check the dev server port.** Multiple Vite instances pile up on 5173-517x (user's
  editor + zombie background tasks). Read the background task's output file for the
  actual port — driving a stale instance produces bizarre failures (broken DuckDB
  worker cache, old code).
- Text probes on panel labels must be case-insensitive: many labels render through
  CSS `uppercase`, and `innerText` reflects the transformed text.
- Field profiles on 100k+ row layers take 30s+; wait for the per-layer restyle spinner
  (`getByTitle('Rendering layer…')`) to detach rather than using fixed sleeps.
- `INSTALL h3 FROM community` is **safe again** on duckdb-wasm 1.32 — the 1.28 bug where a
  loaded community extension broke registerFileHandle/registerFileBuffer for the session is
  fixed, retested across repeated file loads. It is loaded lazily via
  `duckdbService.ensureH3()`, never at startup, because it costs a ~2s network fetch. Expect
  `isH3Loaded === false` on a fresh page.
- Loading a second file logs `Input node "…" has no table loaded` from the node-preview
  effect. Pre-existing and transient — filter it out rather than chasing it.
- Loaded files are cached in OPFS (`alur-sources/`), which is **per origin and survives
  across pages in the same browser context** — so a second `newPage()` still sees what the
  first cached. Use `clearSourceCache()` between scenarios that need a cold start.
- Overwriting an OPFS file DuckDB currently holds a handle to raises
  `NotReadableError: … after a reference to a file was acquired`, often seconds later and
  far from the cause. If a test deliberately corrupts cached files, assert on console
  errors *before* that step, not after.
- A recovery snapshot from an earlier run puts a blocking dialog at `z-[10000]` over
  everything, including Settings. Dismiss it (`Discard recovery snapshot`) before driving
  other dialogs, or clicks silently retry until they time out.

- The smoke test uses `renderToString` — zustand SSR renders *initial* state, so `setState`
  before render has no effect there. Don't copy that pattern for runtime verification.
- Toasts auto-dismiss; wait for text with a generous regex including error variants
  (`/Loaded [\d,.]+ features|Error loading file/`).
- `npm run lint` works (`.eslintrc.cjs`, `--max-warnings 0`). Run it alongside `npx tsc --noEmit`.
- The **Execute Workflow** button only exists while the workflow surface is open. Call
  `window.__alurStore.getState().navigate('workflow')` before looking for it.
- Toasts auto-dismiss, so reading `store.toasts` after an action is racy. Assert on durable
  state instead — `datasetRegistry['workflow:<nodeId>']`, `mapLayers`, feature counts.
- `data_sample/need_london.parquet` is EPC/energy data: `REGION`, `PROP_TYPE`,
  `COUNCIL_TAX_BAND`, `IMD_BAND_ENG`, `EPC`, `Gcons2005..2023`, `Econs2005..2023`,
  `Latitude`, `Longitude` — 95 columns, 25,000 rows. There is no `need` or `borough` column.
