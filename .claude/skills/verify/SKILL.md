---
name: verify
description: Build, launch, and drive YMNNGIS (browser GIS app) to verify changes at the UI surface.
---

# Verifying YMNNGIS

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

## Gotchas

- The smoke test uses `renderToString` — zustand SSR renders *initial* state, so `setState`
  before render has no effect there. Don't copy that pattern for runtime verification.
- Toasts auto-dismiss; wait for text with a generous regex including error variants
  (`/Loaded [\d,.]+ features|Error loading file/`).
- `npm run lint` is broken (no ESLint config in repo). Use `npx tsc --noEmit`.
