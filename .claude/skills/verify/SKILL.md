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
- Ingest data: `page.locator('header input[type="file"]').setInputFiles('data_sample/need_london.parquet')`
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

`window.__alurMap` (the MapLibre instance) and `window.__alurStore` (the zustand store) are
exposed in dev. Use them from `page.evaluate` to assert layer types, paint, pitch, and
store state directly instead of scraping the DOM.

## Gotchas

- **Check the dev server port.** Multiple Vite instances pile up on 5173-517x (user's
  editor + zombie background tasks). Read the background task's output file for the
  actual port — driving a stale instance produces bizarre failures (broken DuckDB
  worker cache, old code).
- Text probes on panel labels must be case-insensitive: many labels render through
  CSS `uppercase`, and `innerText` reflects the transformed text.
- Field profiles on 100k+ row layers take 30s+; wait for the per-layer restyle spinner
  (`getByTitle('Rendering layer…')`) to detach rather than using fixed sleeps.
- Do NOT `INSTALL h3 FROM community` in duckdb-wasm: a loaded community extension
  breaks registerFileHandle/registerFileBuffer for the whole session.

- The smoke test uses `renderToString` — zustand SSR renders *initial* state, so `setState`
  before render has no effect there. Don't copy that pattern for runtime verification.
- Toasts auto-dismiss; wait for text with a generous regex including error variants
  (`/Loaded [\d,.]+ features|Error loading file/`).
- `npm run lint` is broken (no ESLint config in repo). Use `npx tsc --noEmit`.
