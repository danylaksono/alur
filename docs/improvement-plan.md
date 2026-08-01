# ALUR Improvement Plan — Analytical Depth

**Date:** 2026-07-29 · **Status:** Workstreams 0–4, W5.1 and W5.4 done; W5.2 measured and rejected; W6–W7 proposed · **Supersedes nothing** (ROADMAP.md covers the prototype→product phases, all complete)

## Framing

Every item below is stated as a **generic visual-analytics capability**, and each is justifiable to a user who has never heard of spatial intervention planning. Composite scoring is how indices get built; running-total selection is how budgets get allocated in any domain; filter provenance is what every analyst means by "what did I just throw away". The mapping to the Spatial Intervention Loop is recorded in the [coverage table](#appendix-a--sil-coverage-map) at the end, and is a *consequence* of the work rather than its motivation.

That distinction is the point. The claim being tested is that a well-designed generic platform supports the pattern without being built for it. Every feature that only makes sense in planning language weakens that claim.

Three things are deliberately **not** in this plan:

- **A domain intervention palette** (pocket parks, heat pumps, cycle lanes). That is where ALUR would become a SIL platform. Workstream 4 got the same outcome generically, and is now done: the palette exists, and every word in it is the user's.
- **Mutable scenario state** (`UPDATE`-style semantics). The derived-dataset model is better and already works. What is missing is *iteration*, not mutation.
- **A SIL vocabulary in the UI.** No stage names, no "Filter → Prioritise → Intervene" chrome.

---

## Workstream 0 — Repairs · **done**

Small, cheap, and each one unblocks capability that has already been built and paid for. Done first, because several later workstreams depend on W0.1. Descriptions below are of the fault as found; the fix follows each one.

### W0.1 — Workflow node outputs are not registered as datasets

`VariantPanel` sets `workflowOutputDatasetId` to `workflow:<nodeId>` ([VariantPanel.tsx:46](../src/components/Variants/VariantPanel.tsx#L46)), but nothing ever registers a dataset under that id. `ensureWorkflowDataset` is only called from [dataIngestion.ts:168](../src/services/dataIngestion.ts#L168) for input nodes during file load; executing a node registers under the *layer* id `exec-<nodeId>` via [NodeActions.tsx:35](../src/components/Flow/NodeActions.tsx#L35) → `addMapLayer` ([useStore.ts:1059](../src/store/useStore.ts#L1059)).

Consequence: `comparableVariants` always returns `[]`, the "Compare scenarios" button is permanently disabled, and every variant permanently reads "Run the workflow to produce its result". The whole scenario-comparison path is dead.

**Fixed.** `materializeWorkflowOutput` now returns either a layer or a registered dataset instead of throwing when there is no geometry, `WorkflowResult` carries a `terminalNodeId`, and `registerWorkflowResult` gives all three run paths one way to publish a result. A new `registerWorkflowNodeOutput` store action points every variant built on that node at whichever dataset the run actually produced, so the variant no longer has to guess its own output id.

### W0.2 — Branching discards workflow lineage

`branchVariant` cleared `workflowNodeIds: []`, leaving a branch with no workflow attached and no way to attach one.

**Fixed.** A branch keeps its parent's workflow nodes and clears only `workflowOutputDatasetId`, which is correct: the branch has a specification to run but no result until it is run.

### W0.3 — The weighted score ignores its own weights

`weightedScoreExpression` summed min-max normalised fields and divided by the count — an unweighted mean. The `scoreModel`, with its weights, `direction`, `normalisation` and `missingValueTreatment`, was stored in the node config and never read by the SQL generator, so the behaviour was silently wrong rather than merely absent.

**Fixed.** [scoreModel.ts](../src/utils/scoreModel.ts) compiles the full spec — all three normalisations, both directions, all three missing-value policies — with weights divided by their total so the score keeps its scale. It is a pure string builder with no store or engine access, which is what Workstream 1 needs in order to reuse it for previews and sensitivity sweeps.

### W0.4 — The temporal comparison view renders raw JSON

The Compare workspace rendered `JSON.stringify(result.temporalSeries)` into a `<pre>`. The service computed the series correctly; only the view was unbuilt.

**Fixed.** `ComparisonTimeEvidence` draws one line per group per measure on a shared scale, breaking the line at missing periods rather than bridging them, and reports how many gaps it left. It lives in the shared evidence module so a Time card pinned to the report renders as a chart too, rather than falling back to summary bars.

### W0.5 — Dead code

`OPERATION_DEFINITIONS` in [variantService.ts](../src/services/variantService.ts) (ranked-selection, value-change, allocation, phase-assignment, remove-operation) is imported nowhere. Either wire it into the operation palette or delete it — as it stands it reads like implemented capability.

### W0.6 — Spread-operator crash on large columns

`Math.min(...values)` exceeds the JS argument limit at roughly 125k elements. Four sites were affected, two of them over unbounded coordinate arrays (selection bounds for in-memory GeoJSON layers, and the comparison map extent).

**Fixed.** [extent.ts](../src/utils/extent.ts) provides `numericExtent` and `coordinateExtent`; the four sites use them. Bounded cases — chart bins, top-N categories — were left alone.

### W0.7 — Documentation accuracy

README claimed DuckDB "`spatial` + `h3` extensions" — the h3 install is a core-repo no-op ([duckdb.ts:164-170](../src/services/duckdb.ts#L164-L170)) and hexbinning is pure SQL/JS. It also documented 7 node types and 60 tests against a codebase with 8 node types and 234 tests, listed shipped features as deferred roadmap items, and omitted the Compare and Report workspaces entirely.

**Fixed.** Counts, extensions, feature list, project structure and roadmap all corrected, and the roadmap now points here.

---

## Workstream 1 — Composite score · **done**

**Generic pitch:** build a weighted index from several columns, see how it ranks your rows, and see how much that ranking depends on the weights you chose.

The highest-leverage addition, and the one place where ALUR previously claimed a capability it did not have.

### 1.1 Score node

**Done.** A `score` node type whose config is a criteria table — field, weight, direction, normalisation — plus a missing-value policy. It emits `<resultField>`, `<resultField>_rank`, and one contribution column per criterion.

Normalisation, one SQL expression each:

| Method | Expression |
| --- | --- |
| min-max | `(x - MIN(x) OVER ()) / NULLIF(MAX(x) OVER () - MIN(x) OVER (), 0)` |
| z-score | `(x - AVG(x) OVER ()) / NULLIF(STDDEV_POP(x) OVER (), 0)` |
| rank | `PERCENT_RANK() OVER (ORDER BY x)` |

`direction = 'lower'` inverts: `1 - n` for min-max, a sign flip for the unbounded z-score, and a reversed window ordering for rank. Ranking happens in a second pass wrapping the scoring one, because a window function cannot reference an alias defined in its own `SELECT`. Ties share a rank rather than being separated on row order.

**One bug worth recording.** The `mean` missing-value policy originally compiled to `COALESCE(x, AVG(x) OVER ())`, which every normalisation then nested inside its own window — and DuckDB rejects a window inside a window definition. Unit tests could not catch it because they only matched generated strings; it surfaced the first time the SQL was executed in a browser. The fix threads the relation being scored into the compiler so the mean comes from a scalar subquery, which composes anywhere. A regression test now asserts no `OVER (` appears nested inside another.

### 1.2 Score panel

**Done.** A rail panel that runs the same compiler against live data: weight sliders that re-rank on each change, a ranked list, and a hand-off button that turns the current model into a workflow node wired to its source.

Two details that decide whether it is usable. Queries are debounced and guarded by a token, so a slow earlier query cannot land after a faster later one and show a ranking the weights no longer imply. And the label column is chosen by probing cardinality rather than by name: a column called `REGION` reads like a label but held one value for all 25,000 rows in testing, which rendered the same string down the entire list. Columns below 20 distinct values are treated as categories and lose to the row id.

### 1.3 Contribution breakdown

**Done.** Each row in the panel carries a stacked bar of its criterion contributions, expandable to exact figures, and the workflow node writes the same contributions as columns so they can be charted, mapped, sorted and pinned to the report. Because they are the weighted normalised terms themselves, they sum to the score exactly — verified to a maximum gap of 0 across 25,000 rows.

### 1.4 Sensitivity

**Done.** Each weight is nudged in turn and the resulting ranking compared with the base: Spearman correlation, mean absolute rank shift, and how many of the base top-N drop out. All criteria are compared in a single query, so this is one round trip regardless of how many there are. The panel sorts by top-N churn, which is the legible form of the question — a criterion that moves nobody in the top 20 is not where the argument is.

### Verification

Executed against real DuckDB-Wasm in a browser: all three normalisations compiling together, contributions summing to the score with zero drift over 25,000 rows, ranks spanning 1..25,000, the three missing-value policies producing genuinely different results (`exclude` scoring 17,029 of 25,000 rows), sensitivity returning correlations below 1 for every criterion, and the panel re-ranking on a slider move before handing a connected node to the workflow.

---

## Workstream 2 — Aggregate and constraint nodes · **done**

**Generic pitch:** group-by that keeps your numbers, and "take from the top until the budget runs out".

### 2.1 Numeric Aggregate node

The Aggregate node only aggregated geometry: it emitted `operation(geom) AS geom_agg` and dropped every attribute, and its function list was filtered to `category === 'Aggregate'`, which is entirely `ST_*`. **There was no SUM/AVG group-by anywhere in the node set** — the most conspicuous hole in the product, independent of any planning use case.

**Done.** The node now has two modes, following the Join node's precedent. `summary` takes any number of group keys and any number of measures (count, count distinct, sum, average, median, min, max), with an optional merge of each group's geometry so the result stays mappable. `spatial` is the previous dissolve behaviour, unchanged, and remains the default for nodes that already exist in saved projects.

Sum, average and median cast through `TRY_CAST(… AS DOUBLE)` so numeric text columns still add up; min and max deliberately do not, so they keep working on dates and text.

### 2.2 Running-total allocation node

**Done.** A new `allocate` node type. It accumulates a column in priority order with `SUM(…) OVER (… ROWS UNBOUNDED PRECEDING)` and offers three outcomes: `flag` keeps every row and marks it within or over the limit, `cut` drops the rows past it, and `scale` gives the row straddling the limit a partial share via `LEAST(amount, GREATEST(0, remaining))`.

`scale` earns its place because a hard cut-off silently discards the row straddling the limit, which in an allocation is usually the most interesting one. An optional partition key gives each group its own budget rather than sharing one.

### 2.3 Top-N via `QUALIFY`

**Done.** A `top-n` mode on the Filter node, compiling to `QUALIFY RANK() OVER (ORDER BY … ) <= N`. `RANK` rather than `ROW_NUMBER` so ties are kept together — dropping one of two identically scored candidates on row order alone is not a decision anyone made, and the node's help text says so.

Previously this took an Attribute node with a hand-written `ROW_NUMBER()` followed by a second Filter node.

### Verification

The generated SQL was executed against real DuckDB-Wasm in a browser, not just string-matched in unit tests: two-key `GROUP BY` over 25,000 rows producing 45 groups, `MIN` surviving on a text column, all three allocation modes emitting their expected columns, `cut` keeping strictly fewer rows than `flag` (63 vs 25,000), partitioning admitting more rows than a shared limit (58 vs 6), and a composed score → top-N → allocate → summarise chain running end to end.

---

## Workstream 3 — Filter transparency · **done**

**Generic pitch:** show me what got filtered out, and which condition removed it.

A `WHERE` clause answers "what survived". It cannot answer "why isn't this row in my result", because the same statement that produces the answer destroys the evidence for it. Every analyst asks the second question.

### 3.1 Named conditions

**Done.** A third `criteria` mode on the Filter node, alongside `condition` and `top-n`. Instead of one anonymous WHERE clause it takes a list of named conditions — label, expression, severity — and writes three columns on every row:

| Column | Meaning |
| --- | --- |
| `alur_excluded` | BOOLEAN — would a hard condition have removed this row |
| `alur_excluded_by` | VARCHAR — the names of every condition it fails, joined |
| `alur_excluded_count` | INTEGER — how many it fails |

The base name is configurable. Switching a node from `condition` to `criteria` carries the existing WHERE clause across as the first named condition, so nothing typed is lost to a dropdown.

`alur_excluded_by` is text rather than a `LIST` deliberately: as text it works with the category renderer, the attribute table, the popup, CSV export and the group-by in an Aggregate node without any of them needing to know it exists. That is what "downstream consumers get this for free" has to mean in practice. It is `NULL` rather than empty for rows nothing excluded, because no reason is a genuine absence — verified end to end by grouping 25,000 tagged rows into four reason categories through a Summarise node.

**The bug this mode exists to prevent, in its own compiler.** The obvious tagging expression is `NOT (area > 500)`. For a row where `area` is NULL that evaluates to NULL, so no reason is recorded — while `WHERE area > 500` drops the row anyway, since NULL is not TRUE. The row would vanish with its explanation blank, which is exactly the failure the mode is built to fix. Every condition is therefore coalesced to FALSE before use, so the recorded reason agrees with the filter for every row. Verified against 19,618 genuinely NULL rows: all excluded, none without a reason.

### 3.2 Hard and soft conditions

**Done.** A hard condition can remove a row; a soft one only ever annotates it. This makes near-misses visible instead of lost — a unit failing one soft preference is usually more interesting than one that passes everything.

Dropping and recording are independent, so the reason columns are written either way and only the WHERE clause depends on the outcome. An `outcome` setting picks between removing failures and keeping every row marked.

### 3.3 Constraint funnel

**Done.** A strip inside the Filter node measures every condition against the real upstream rows — the workflow's own CTEs, not a sample — in a single query, and reports two numbers per condition:

- **alone** — what it removes ignoring the others
- **in sequence** — what it removes that the earlier conditions had not already removed

The gap between them is the point. A condition that removes 7,971 rows on its own but nothing at all once the others have run does not bind, and the user is arguing about a constraint that has no effect. That is invisible from a surviving row count, and the funnel says it in words as well as bars.

### Verification

24 checks against real DuckDB-Wasm in the browser. Beyond the NULL case above: tag and drop modes agreeing exactly on who survives (1,359 of 25,000); no survivor carrying a hard exclusion and no excluded row lacking a reason; rows failing two conditions listing both; a soft condition removing nobody while still marking 2,317 rows; the funnel's predicted survivor count matching what the workflow actually returns; and the redundancy warning firing on a condition contributing zero.

---

## Workstream 4 — Parameterised workflow fragments · **done**

**Generic pitch:** save a piece of your workflow as a named operation with fill-in-the-blank values, and reuse it.

This is the answer to "how do users get an intervention palette without ALUR shipping one". A domain user authors `Retrofit(−N% on a chosen column)` out of generic nodes, names it, and it travels in the project file. ALUR ships zero domain vocabulary; the user's project carries all of it. Secondary benefit, and not a small one: a workflow reads as three named operations instead of fifteen anonymous Attribute nodes.

### 4.1 Not DuckDB table macros

The plan proposed implementing this on `CREATE MACRO … AS TABLE`. Tested against the engine, that cannot do the central job. The plan's own example fails:

```text
CREATE MACRO bump(tbl, target_field, amount) AS TABLE
  SELECT * REPLACE (COALESCE(target_field, 0) + amount AS target_field) FROM query_table(tbl);
→ Binder Error: Column "target_field" in REPLACE list not found in FROM clause
```

Macro parameters substitute **expressions, not identifiers in binding positions**, so the column being modified can never be a parameter — and "change a column the user picks" is the whole point. Macros also do not survive a reload (`Catalog Error: Table Function with name uplift does not exist`), making them session state to rebuild on every project open, which the W5.1 work makes a first-class path.

### 4.2 Expansion instead

**Done.** A fragment stores its nodes, its edges, and its parameters; a `fragment` node expands into ordinary nodes *before* compilation. The compiler never learns fragments exist, so every node type works inside one for free, the SQL preview shows the real expansion, and nothing extra has to be kept alive in the database. Node ids are namespaced by the placement, so the same operation can appear twice — or be chained into itself — without its copies colliding.

Blanks are written as `{{name}}` in any step's configuration and **discovered** rather than declared: the save dialog scans the selection and offers whatever placeholders it finds. The flow is "edit the steps until they read the way you want, then say what the blanks mean", instead of designing a signature against nothing. The operation's ends are derived too — the output is the step nothing else reads from, the inputs are those whose upstream lies outside the selection.

### 4.3 Parameters are typed because they are interpolated into SQL

Three types: **number**, **column**, and **one of a list**. Free text is deliberately absent. A fragment body is interpolated into SQL, so an unconstrained string parameter would be a way to smuggle anything into every query built from the fragment. Numbers must parse as finite numbers, columns must match a plain identifier, and choices must come from the author's list — checked before any SQL is built, and reported on the node rather than at run time. Verified: `Gcons2023; DROP TABLE need_london` is refused as a column, `1); DROP TABLE x; --` is refused as a number, and the target table is untouched.

An input node cannot be part of an operation, since baking one in would make it a copy of one dataset rather than an operation over any.

### Verification

20 checks against real DuckDB in the browser: an operation authored from two generic Attribute steps, placed, and run over 25,000 rows; arguments reaching the generated SQL; the result changing correctly when the percentage doubles and when the column is retargeted; two placements chained into one another keeping separate arguments; "run up to this operation" resolving to its last expanded step; the operation surviving a project save/reopen with its parameters; an unknown operation reported rather than compiled around; and both injection attempts refused.

**One real bug, caught only end to end.** `expandFragments` copied the edge *array* but not the edge *objects*, then rewired `source`/`target` on them — so every compile silently rewrote the user's canvas, and the second compile of the same graph produced a broken workflow. It surfaced as `Attribute node "op-a__step-1" has no source` on an unrelated check. There are now tests that the input graph is unchanged and that compiling twice gives the same answer.

---

## Workstream 5 — Engine and persistence

### 5.1 Resumable projects · **done, but not by moving the database**

The proposal was to open DuckDB on an `opfs://` path so the database itself persists. Investigating first showed why that would not work, and what does.

**Parquet and CSV uploads never enter the database.** Ingestion registers the file and creates a *view* over it — confirmed by reading the catalogue of a loaded project:

```text
need_london            VIEW         CREATE VIEW need_london AS
                                    SELECT * FROM read_parquet('1785593226135_need_london.parquet');
__alur_mvt_need_london BASE TABLE
```

Only the derived tile table is real. So persisting the database would save a catalogue of views pointing at file registrations that died with the page: the project would appear to reopen and then fail on the first query — worse than plainly asking for the file. Moving the database also brings multi-tab lock contention and a persistent-corruption failure mode, for a benefit it does not actually deliver.

**Persisting the source files does deliver it.** [sourceCache.ts](../src/services/sourceCache.ts) keeps a copy of every ingested file in OPFS, keyed by the same `name + size + lastModified` triple `sourceMatchesFile` uses to accept a manual relink — so the cache can never admit a file the relink check would have rejected. On open, [restoreSourcesFromCache](../src/services/projectService.ts) re-attaches what is held and leaves the rest to the existing relink prompt, which was already built and until now always had to be used.

Restoring runs through `ingestFile`, the same path a manual relink uses. That matters: a separate restore path would be a second way for a dataset to come into existence, and only one of them would be tested.

Measurements that shaped it: writing 51 MB to OPFS takes ~540 ms and `getFile()` 1 ms, so caching is cheap enough to do on every ingest (unawaited — the user is waiting on the map, not on a cache); Chromium offered a 6.4 GB quota, of which the cache claims 1.5 GB with least-recently-used eviction; and `navigator.storage.persist()` was **refused** in testing, so this is a cache the browser may evict, never storage. Every caller treats a miss as normal.

Settings gains a "Cached data files" row with its size and a Clear button, because writing hundreds of megabytes to someone's disk unasked has to be visible and reversible from somewhere obvious.

**One real bug, found only end to end.** Restoring re-ingests the cached file, and ingestion caches what it ingests — so the restore rewrote the very OPFS file DuckDB was reading, and `createWritable()` truncates on open. The result was `NotReadableError: … after a reference to a file was acquired`, several seconds into a load that looked fine. `cacheSource` now returns early when an entry with the same key exists; since size and timestamp are part of the key, a match means the bytes are already the right ones. Unit tests could not have caught this — nothing is wrong with any single function.

Still open: **"load project from URL" does not carry its data**, since a shared link reaches a browser whose cache has never seen those files.

### 5.2 `SUMMARIZE` · **measured, not adopted**

The proposal was to replace the hand-rolled profiling in [visualAnalyticsService.ts:610-645](../src/services/visualAnalyticsService.ts#L610-L645) with one `SUMMARIZE` statement. Measured against the real engine, that would be a downgrade on all three axes:

| | `SUMMARIZE` | Existing profiler |
| --- | --- | --- |
| Numeric column stored as text | `min "1000"`, **`max "9900"`** — ordered lexically | `TRY_CAST` gives the true 1000–50000 |
| Mean, stddev, median of that column | `null` — it will not cast | computed |
| 40 columns over 25,000 rows | 730 ms | 405 ms |

The lexical maximum is the decisive one. CSV upload is a first-class path in ALUR and every column arrives as `VARCHAR`, so adopting `SUMMARIZE` would silently report a wrong maximum on the most common shape of input. The existing profiler is also semantically typed, so it does not compute numeric statistics on a text column that merely happens to be castable.

Two things worth keeping from the exercise: `SUMMARIZE` returns `null_percentage` as a `DECIMAL` that arrives through Arrow as a scaled string (`"3188"` meaning 31.88%), which is a trap for anything that consumes it; and `std` is a genuine gap in our own profile, cheaply added as one more aggregate. **Recommendation: keep the hand-rolled profiler, add standard deviation to it.**

### 5.3 `duckdb_functions()` instead of a hardcoded catalogue · **premise partly wrong**

The stated worry was silent drift. Measured: the engine exposes **157** distinct `ST_*` functions, the catalogue has **158** entries, nothing catalogued is missing from the engine, and only `st_expand` is missing from the catalogue. The names have not drifted, and `function_type` matches `category` for every single entry.

What *is* wrong is the arity. `requiredInputCount` — which the workflow engine uses to decide how many geometry inputs a node needs — disagrees with the engine's own signatures for roughly two dozen functions. `ST_Point` and `ST_GeomFromText` are marked as taking a geometry input when they construct one from numbers or text; `ST_LocateAlong` is marked as taking two geometries when it takes one plus a measure.

But deriving that number automatically is subtle too: counting geometry-typed parameters misclassifies the functions taking `GEOMETRY[]`, so a naive generated catalogue would swap known-wrong values for differently-wrong ones. **Recommendation: let the engine own existence, category, description and signatures; keep `requiredInputCount` as a small curated overlay, because it encodes a UI concept rather than a property of the signature — and add a check that fails when the two lists diverge.** Not yet done.

### 5.4 The community h3 extension · **done**

The comment at duckdb.ts documented a duckdb-wasm **1.28** bug where a loaded community extension broke `registerFileHandle` for the rest of the session, so no file could be opened afterwards. **Retested on 1.32: fixed.** `INSTALL h3 FROM community` succeeds, 74 h3 functions become available, and files register normally afterwards — verified across repeated loads in a browser.

**Loaded lazily, never at startup.** It costs a measured 1.8–2.9s network round trip, and ALUR otherwise runs entirely offline once loaded; a session that never draws a hexbin should not pay for it. `ensureH3()` returns `false` rather than throwing when the fetch fails, because every caller has a working fallback and being offline is not an error.

**Hexbinning now uses real H3 cells**, aggregated inside the engine, with the Mercator implementation kept as the fallback. Two things change:

- **Cells are equal-area.** A Mercator hexagon at latitude 60 covers roughly a quarter of the ground that a hexagon of the same drawn size covers at the equator, so counts across a wide area were never comparable. The panel now states which grid produced the cells, because that changes what the numbers mean. The Mercator path also silently discarded everything above 85° latitude; H3 does not.
- **The grouping happens in SQL.** What crosses into JS is one row per occupied cell rather than one row per point — 393 rows instead of 25,000 on the test data. This is a scaling change, not a speed one: at 25,000 rows the engine-side query is actually slower in wall-clock terms.

Two traps found and handled. An H3 index is a 64-bit integer and many exceed 2^53, so reading a cell id as a JS number silently rounds it and distinct cells collide — ids cross as their canonical string form. And H3 resolutions step by a factor of about 2.6, so the panel's "2 km" and "1 km" options genuinely produce the same grid; rather than pretend otherwise, the panel reports the resolution and the cell size actually used.

This also revives `create_h3_grid`, a copilot tool that had been permanently unreachable because `isH3Loaded` was always false.

### 5.5 Parameter binding for user-authored expressions

Attribute expressions, Filter conditions and the field calculator are string-concatenated into SQL. `PREPARE`/bound parameters where the shape allows it removes an injection surface and lets DuckDB cache plans.

### 5.6 Push the remaining JS statistics into SQL

`classifyNumericValues` sorts a full array in JS to compute quantile breaks ([classification.ts:119](../src/utils/classification.ts#L119)). `QUANTILE_CONT(x, [0.2,0.4,0.6,0.8])` does it in the engine. Related unused aggregates worth having available: `CORR`, `REGR_SLOPE`, `REGR_R2` (for the sensitivity views and for any "does X explain Y" question), `ARG_MAX`/`ARG_MIN` ("which unit scored highest in each ward"), `MODE`, `ENTROPY`, and `HISTOGRAM(x)` for a one-call binning.

### 5.7 `ASOF JOIN`

Aligns records to the nearest preceding timestamp rather than requiring exact matches. This is the correct primitive for `ComparisonAlignment.mode === 'temporal'`, which currently has no real implementation behind it.

### 5.9 Found while measuring, not fixed

- **Node preview races file registration.** Loading a second file logs `Input node "…" has no table loaded` from the preview effect in [useAttributeTable.ts:175](../src/hooks/useAttributeTable.ts#L175) — the effect fires before the input node's table exists. Transient and self-correcting, so nothing is visibly broken, but it is noise in the console and a real ordering bug. Confirmed pre-existing and unrelated to the h3 work.
- **E2E runs must reach the engine through `window.__alurDuckdb`**, now exposed in dev alongside `__alurStore` and `__alurMap`. Importing `/src/services/duckdb.ts` by path from `page.evaluate` used to work, but after any edit Vite serves that module under a cache-busting query string, so the import constructs a *second, uninitialised* service and every query fails with "DuckDB not initialized". This cost real time to diagnose and would silently invalidate any future verification run.

### 5.8 Recursive CTEs — noted, not scheduled

`WITH RECURSIVE` can express iterative constrained allocation (propose → check capacity → scale → repeat). It is the only way to do multi-pass reconciliation inside a single query. **Recommendation: do not build a UI for this.** Explicit per-phase node chains are more legible and are what an analyst can actually debug. Keep recursion available to anyone writing SQL by hand and leave it out of the node set.

---

## Workstream 6 — Lineage in Explain

The Explain/story machinery is the strongest part of the codebase and needs little. Two small additions:

- **Surface variant assumptions.** `AnalysisVariant.assumptions` is captured and never displayed anywhere. Render it on Explain cards derived from a variant. Cheapest possible improvement to "explain how this came to be".
- **A scenario lineage card.** Renders the variant tree — what branched from what, which parameters differ at each branch. The data is already in the store; only the view is missing.

---

## Workstream 7 — Copilot coverage

**Generic pitch:** the assistant can drive every part of the app, and can see what it did.

The copilot has 13 tools ([toolDefinitions.ts](../src/utils/toolDefinitions.ts)) and they all point at the same half of the product: build a workflow node, connect nodes, style a layer, filter or select rows, zoom. Nothing addresses charts, KPIs, cohorts, comparisons, variants, bookmarks or the report. Half the app is unreachable by conversation, and it is precisely the analytical half.

### 7.1 Cover the rest of the surface

Add tools for what already exists: create and update a chart, pin a KPI, define and compare cohorts, build and run a comparison, create a scoring variant, branch it, pin evidence to the report, write a finding. Most of these are thin wrappers over store actions that already exist and are already tested — the work is schema design and prompt guidance, not new capability.

### 7.2 Give the assistant read tools

This is the more important half, and it is a genuine gap rather than missing coverage.

Every tool today is a **write**. The assistant can apply a filter but cannot see how many rows survived; it can rank candidates but cannot notice that the top twenty fall in one ward; it can build a comparison but cannot read the result and say which group came out ahead. So it can act on instruction and it can narrate its own actions, but it cannot observe consequences — which means it cannot help with evaluation or suggest a revision, only execute one.

Add read tools returning bounded, already-computed summaries: dataset profile (`SUMMARIZE`), current filter state and surviving row count, a layer's numeric and category summaries under active filters, top-N rows by a column, comparison results, and the divergence explanation that `SelectionExplain` already computes. All exist as service functions; none is exposed to the model.

The change this makes is qualitative. "I've raised the equity weight to 0.45 — the top-ranked cluster has moved north. Keep, revert, or compare?" requires the assistant to have *looked*. Without read tools that sentence can only ever be a fabrication.

### 7.3 Ground the assistant in a bounded context

With reads available, the risk shifts from ignorance to overconfidence. Two rules worth building in rather than prompting for: the assistant reports denominators and missing-value counts whenever it quotes a number, because the services already return them; and it distinguishes what it observed from what it inferred. The Explain card model already separates `claim`, `interpretation` and `caveat` — assistant-authored findings should populate all three or none.

### 7.4 Note on the suggestion effect

Chapter 9's companion discussion flags that a natural-language interface does not only reduce friction, it *suggests* — and may narrow the framing a user brings to a problem. Worth treating as a design constraint here: when the assistant proposes criteria or weights, it should say what it is not proposing, or offer more than one framing. Cheap to do, and it is the difference between a tool that expands the explored space and one that anchors it.

---

## Sequencing

| Order | Work | Rationale |
| --- | --- | --- |
| ~~1~~ | ~~W0 repairs~~ **done** | W0.1 blocked Workstreams 1 and 2; W0.3 left a score compiler that 1.1 builds on |
| ~~2~~ | ~~W2 aggregate, allocate, top-N~~ **done** | Biggest product hole, no design risk; verified against real DuckDB in the browser |
| ~~3~~ | ~~W1 composite score~~ **done** | Highest analytical leverage; flips Prioritise's diagnostic |
| ~~4~~ | ~~W3 filter transparency~~ **done** | Independent, moderate cost; flips Filter's diagnostic |
| ~~6a~~ | ~~W5.4 h3~~ **done** | Retested and fixed upstream; unblocks equal-area hexbins and revives a dead copilot tool |
| ~~6b~~ | ~~W5.1 resumable projects~~ **done** | Delivered by caching source files in OPFS, not by moving the database; W5.2 measured and rejected, W5.3 reduced to a drift check |
| 7 | W0.4 temporal view, W5.7 ASOF | Together they make time comparison real |
| ~~8~~ | ~~W4 named operations~~ **done** | Built by expanding saved subgraphs, not by DuckDB macros; flips Intervene's diagnostic |
| 9 | W6 lineage | Small, do last |
| — | W7 copilot coverage | Per workstream: add the tools for a surface as that surface stabilises, rather than as one pass at the end |

Deliberately unscheduled: **feature creation** (drawing or placing a new geometry as a dataset row). Nothing in the workflow can create a feature — it only transforms existing rows. See the case-study note below for why this may not need solving.

---

## Appendix A — SIL coverage map

Which generic capability discharges which obligation from the pattern. Read right-to-left when assessing; left-to-right when building.

| Generic capability | Workstream | SIL obligation discharged |
| --- | --- | --- |
| Filter provenance, constraint funnel, hard/soft predicates | W3 | **Filter** — "can the user explain why a location is excluded?" |
| Composite score with live weights, contribution breakdown, sensitivity | W1 | **Prioritise** — "can the user see why one candidate is ranked above another?" |
| Attribute nodes + named parameterised operations + running-total allocation | W2.2, W4 | **Intervene** — "can the user construct a scenario?"; resource limits made visible |
| Compare workspace (exists) + numeric aggregate + temporal view | W0.4, W2.1, W5.7 | **Evaluate** — "can the user judge whether the scenario is good, fair, feasible?" |
| Variant branching, analysis history, Explain provenance, lineage card | W0.1, W0.2, W6 | **Refine** — "can the user explain how this scenario came to be?" |
| Assistant tools covering the whole surface, and reads as well as writes | W7 | Cuts across all five — an assistant that cannot observe consequences cannot help evaluate or revise |

Standing at the time of assessment: Filter capable but failing its diagnostic; Prioritise failing; Intervene partial and resource-blind; **Evaluate already passing**; Refine with the machinery in place but a broken link.

Standing now, after W0 to W4: **all five stages pass their diagnostic.**

**Filter** — an excluded row states which named conditions removed it, and the funnel says how much each one is actually doing. **Prioritise** — weights are manipulable, their effect is immediate, and each candidate's rank decomposes into what produced it. **Intervene** — an intervention is a named operation with typed, checked values, authored by the user and carried in their project rather than shipped by the platform. **Evaluate** — already passing before this work began. **Refine** — the broken link is repaired, though the lineage *view* in W6 is still outstanding, so this is the one stage passing on machinery rather than on presentation.

The claim under test was that a well-designed generic platform can support the pattern without being built for it. Nothing added here is stated in planning language, and nothing in the UI names a stage. The one honest qualification is the taxonomy in B.1: attribute assignment is reached comfortably, **feature creation is not reached at all** — no workflow node can bring a new spatial object into existence. That is a finding about the pattern's demands rather than a gap to paper over.

---

## Appendix B — Notes for the case-study document

`Case-Studies.md` is being carried forward to a paper. Three changes would make it match what a generic platform can actually be asked to demonstrate.

### B.1 Distinguish two kinds of intervention

The five cases silently mix two structurally different operations:

- **Attribute assignment** — change a property of an existing spatial unit. Retrofit an LSOA's EPC, assign a segment to a delivery phase, upgrade a cell's capacity. Cases 1, 2 (partly) and 3.
- **Feature creation** — introduce a new spatial object that did not exist. Place a food hub, site a branch surgery, define a mobile market route. Cases 4 and 5, and case 2's pocket parks.

This is worth naming explicitly. It is a real taxonomy distinction inside the Intervene stage, it predicts implementation difficulty, and the dissertation does not draw it (chapter 9 lists "install PV on selected roofs" and "assigning buildings to delivery phases" side by side without separating them). A generic platform reaches attribute assignment easily and feature creation only with a dedicated authoring surface — which is itself a finding about the pattern, not a limitation to hide.

Cases 4 and 5 can often be **reframed** as attribute assignment without loss: "designate these LSOAs as hub-served, with a service radius attribute" rather than "place a hub point". If the reframing is stated deliberately, it strengthens the argument rather than dodging it.

### B.2 Reconsider Case 1 as the stress case

Case 1's multi-phase `propose → aggregate → reconcile → persist` sequence is genuinely harder than the other four, and the document already says so (section H). Worth making that explicit as its role: cases 2 and 3 demonstrate the pattern holding on a generic platform, and case 1 is where the platform's DAG model meets its limit and the analyst has to drop to SQL. Reporting that boundary is more useful than reporting five uniform successes, and it directly tests the dissertation's claim that SIL "accommodates varying levels of implementation complexity within each stage".

### B.3 Two claims that will attract scrutiny

- Line 707 states that early prototyping sessions "produced two to three times as many candidate scenarios per hour as equivalent slider-driven sessions, and users reported higher confidence". That is a quantitative empirical claim; the Limitations section says the cross-domain mappings are illustrative and not stakeholder-validated. Either source it or soften it before submission.
- The document is written as if `interactive-scenario-modeller` is the implementation vehicle. If ALUR is the vehicle for the case studies, the relationship between the two needs stating — the dissertation does not mention ALUR anywhere, so the paper is where that link gets established for the first time.
