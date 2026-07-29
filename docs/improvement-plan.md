# ALUR Improvement Plan — Analytical Depth

**Date:** 2026-07-29 · **Status:** Workstream 0 done, the rest proposed · **Supersedes nothing** (ROADMAP.md covers the prototype→product phases, all complete)

## Framing

Every item below is stated as a **generic visual-analytics capability**, and each is justifiable to a user who has never heard of spatial intervention planning. Composite scoring is how indices get built; running-total selection is how budgets get allocated in any domain; filter provenance is what every analyst means by "what did I just throw away". The mapping to the Spatial Intervention Loop is recorded in the [coverage table](#appendix-a--sil-coverage-map) at the end, and is a *consequence* of the work rather than its motivation.

That distinction is the point. The claim being tested is that a well-designed generic platform supports the pattern without being built for it. Every feature that only makes sense in planning language weakens that claim.

Three things are deliberately **not** in this plan:

- **A domain intervention palette** (pocket parks, heat pumps, cycle lanes). That is where ALUR would become a SIL platform. Workstream 4 gets the same outcome generically.
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

## Workstream 1 — Composite score

**Generic pitch:** build a weighted index from several columns, see how it ranks your rows, and see how much that ranking depends on the weights you chose.

This is the single highest-leverage addition. It is also the one place where ALUR currently claims a capability it does not have.

### 1.1 Score node

A first-class `score` node type. Config is a criteria table: field, weight, direction (higher/lower is better), normalisation, plus a missing-value policy. Emits two columns, `<name>_score` and `<name>_rank`.

Normalisation options, all one SQL expression each:

| Method | Expression |
| --- | --- |
| min-max | `(x - MIN(x) OVER ()) / NULLIF(MAX(x) OVER () - MIN(x) OVER (), 0)` |
| z-score | `(x - AVG(x) OVER ()) / NULLIF(STDDEV_POP(x) OVER (), 0)` |
| rank | `PERCENT_RANK() OVER (ORDER BY x)` |

`direction = 'lower'` inverts: `1 - n` for bounded methods, `-n` for the unbounded z-score, and a reversed window ordering for rank.

The compiler for this landed with W0.3 — [scoreModel.ts](../src/utils/scoreModel.ts) already turns a `ScoreModelSpec` into an expression, and the Variants panel uses it. What 1.1 adds is the node: a dedicated type with a criteria editor, rather than the current single-expression Attribute node, and a `_rank` column alongside the score.

### 1.2 Score panel (left rail)

The interactive surface. Weight sliders that re-run the score and re-rank live, against the currently selected dataset. Reordering in the ranked list is the feedback — this is what makes weights "manipulable parameters whose effects are immediately visualised" rather than fixed inputs.

### 1.3 Contribution breakdown

Per row, a stacked bar showing what each criterion contributed to the total. `UNPIVOT` turns the wide per-criterion contribution columns into long form in one statement:

```sql
UNPIVOT scored ON c_heat, c_imd, c_no2, c_schools
INTO NAME criterion VALUE contribution
```

This answers the "why is this ranked above that" question directly, and it is a generically useful view for any composite index.

### 1.4 Sensitivity

Perturb each weight by ±x% in turn, recompute, and report how much the ranking moved. Rank churn (how many rows enter/leave the top N) is the legible metric; Spearman correlation between the base and perturbed ranks is the compact one. Both are cheap in SQL — cross join a small weight grid, `PERCENT_RANK()`, `CORR()` on the rank columns. The `sensitivity?: number[]` field already exists in `ScoreModelSpec` and is read nowhere in the codebase.

---

## Workstream 2 — Aggregate and constraint nodes

**Generic pitch:** group-by that keeps your numbers, and "take from the top until the budget runs out".

### 2.1 Numeric Aggregate node

The current Aggregate node only aggregates geometry: [workflowEngine.ts:325](../src/utils/workflowEngine.ts#L325) emits `operation(geom) AS geom_agg` and drops every attribute, and the operation list is filtered to `category === 'Aggregate'` in `spatialFunctions`, which is entirely `ST_*`. **There is no SUM/AVG group-by anywhere in the node set.** For a DuckDB-backed analytics tool this is the most conspicuous hole in the product, independent of any planning use case.

Add: multiple measures (`SUM`, `AVG`, `COUNT`, `COUNT DISTINCT`, `MIN`, `MAX`, `MEDIAN`, `QUANTILE_CONT`, `STRING_AGG`), multiple group keys, optional geometry union alongside. `GROUP BY ALL` keeps the generated SQL readable.

### 2.2 Running-total selection node

"Order by X, accumulate Y, keep rows until the cumulative total reaches L; flag the rest." One window function:

```sql
SELECT *,
       SUM(cost) OVER (ORDER BY score DESC ROWS UNBOUNDED PRECEDING) AS cumulative_cost,
       CASE WHEN SUM(cost) OVER (ORDER BY score DESC ROWS UNBOUNDED PRECEDING) <= 10000000
            THEN 'within' ELSE 'over' END AS budget_status
FROM ranked
```

Optional partition key turns it into per-group allocation (budget per ward, capacity per substation). Optional scale-down mode emits a fractional allocation for the boundary row rather than a hard cut.

This node plus 2.1 is what makes constraint reconciliation expressible in the graph instead of in the SQL tab.

### 2.3 Top-N via `QUALIFY`

`QUALIFY` filters on a window function without a subquery, which is exactly "take the top 50 by score":

```sql
SELECT * FROM scored QUALIFY RANK() OVER (ORDER BY score DESC) <= 50
```

Fold into the Filter node as a "top N by column" mode. Currently a user has to write an Attribute node with `ROW_NUMBER()` and then a second Filter node — workable but obscure.

---

## Workstream 3 — Filter transparency

**Generic pitch:** show me what got filtered out, and which condition removed it.

Today the Filter node emits `SELECT * FROM src WHERE <condition>` and excluded rows vanish. Add a *tag* mode that keeps every row and appends a `_alur_excluded_by` list column naming the failing predicates:

```sql
SELECT *,
       list_filter([
         CASE WHEN NOT (heat_demand > 5000) THEN 'heat_demand > 5000' END,
         CASE WHEN NOT (avg_epc < 60)       THEN 'avg_epc < 60' END
       ], x -> x IS NOT NULL) AS _alur_excluded_by
FROM src
```

Downstream consumers then get this for free:

- **Constraint funnel** — rows remaining after each predicate, as a count sequence. One `COUNT(*) FILTER (WHERE …)` per predicate in a single pass.
- **Map rendering** — excluded units greyed rather than absent, with the failing condition on hover.
- **Hard vs soft** — a per-predicate flag. Hard predicates drop; soft predicates only tag and feed the score as a penalty.

Every analyst wants "why isn't this row in my result". It is also the single change that makes exclusions explainable.

---

## Workstream 4 — Parameterised workflow fragments

**Generic pitch:** save a piece of your workflow as a named operation with fill-in-the-blank parameters, and reuse it.

Select a subgraph, name it, expose chosen config values as parameters. It appears in the node palette as a single node. Implementation rests on DuckDB table macros:

```sql
CREATE OR REPLACE MACRO uplift(tbl, target_field, amount) AS TABLE
  SELECT * REPLACE (COALESCE(target_field, 0) + amount AS target_field) FROM tbl;
```

This is the answer to "how do users get an intervention palette without ALUR shipping one". A domain user authors `Retrofit(+N EPC on selected)` or `StreetTrees(N metres, M years)` out of generic nodes, names it, and shares it in the project file. ALUR ships zero domain vocabulary; the user's project carries all of it.

Secondary benefit: it makes workflows readable at a glance instead of as 15 anonymous Attribute nodes, which is a plain usability win.

---

## Workstream 5 — Engine and persistence

### 5.1 OPFS-backed persistence

duckdb-wasm 1.32 supports `opfs://` database paths and `DuckDBAccessMode.READ_WRITE` (see `DuckDBConfig.opfs` in the bundled typings). ALUR currently calls `db.instantiate()` then `db.connect()` with no path ([duckdb.ts:150-153](../src/services/duckdb.ts#L150-L153)) — the database is purely in-memory, and [recoveryStorage.ts](../src/services/recoveryStorage.ts) persists only project *manifests* to IndexedDB, never the data. Reopening a project means re-uploading every file.

Opening on OPFS makes projects genuinely resumable, makes recovery real rather than structural, and makes the "load project from URL" feature carry its data. This is the largest user-visible win in the plan relative to its cost.

### 5.2 `SUMMARIZE`

```sql
SUMMARIZE tablename
```

returns per-column type, min, max, approximate quantiles, average, standard deviation, distinct count and null percentage in one statement. It can replace a large part of the hand-rolled profiling in [visualAnalyticsService.ts:610-645](../src/services/visualAnalyticsService.ts#L610-L645) and instantly powers a proper dataset overview.

### 5.3 `duckdb_functions()` instead of a hardcoded catalogue

[spatialFunctions.ts](../src/utils/spatialFunctions.ts) is 28KB and 158 hand-maintained function entries. `SELECT function_name, parameters, description FROM duckdb_functions() WHERE function_name ILIKE 'ST_%'` enumerates what the loaded build actually has. Keep the curated descriptions and categories as an overlay; stop maintaining the list of what exists. It will drift from the engine otherwise, and silently.

### 5.4 Retest the community h3 extension

The comment at [duckdb.ts:164](../src/services/duckdb.ts#L164) documents a duckdb-wasm **1.28** bug where a loaded community extension broke `registerFileHandle` for the session. The project is now on **1.32**. If that is fixed upstream, `h3_latlng_to_cell`, `h3_cell_to_boundary_wkt`, `h3_grid_disk` and `h3_grid_distance` become available — real hexbinning instead of the Mercator approximation in [hexbinService.ts](../src/services/hexbinService.ts), and `h3_grid_disk` gives neighbourhood and dispersion operations directly. Worth an afternoon to check.

### 5.5 Parameter binding for user-authored expressions

Attribute expressions, Filter conditions and the field calculator are string-concatenated into SQL. `PREPARE`/bound parameters where the shape allows it removes an injection surface and lets DuckDB cache plans.

### 5.6 Push the remaining JS statistics into SQL

`classifyNumericValues` sorts a full array in JS to compute quantile breaks ([classification.ts:119](../src/utils/classification.ts#L119)). `QUANTILE_CONT(x, [0.2,0.4,0.6,0.8])` does it in the engine. Related unused aggregates worth having available: `CORR`, `REGR_SLOPE`, `REGR_R2` (for the sensitivity views and for any "does X explain Y" question), `ARG_MAX`/`ARG_MIN` ("which unit scored highest in each ward"), `MODE`, `ENTROPY`, and `HISTOGRAM(x)` for a one-call binning.

### 5.7 `ASOF JOIN`

Aligns records to the nearest preceding timestamp rather than requiring exact matches. This is the correct primitive for `ComparisonAlignment.mode === 'temporal'`, which currently has no real implementation behind it.

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
| 2 | W2.1 numeric aggregate | Biggest product hole, no design risk |
| 3 | W1 composite score | Highest analytical leverage; needs W0.1 to be comparable |
| 4 | W3 filter transparency | Independent, moderate cost |
| 5 | W2.2 running-total, W2.3 QUALIFY | Small once W2.1 lands |
| 6 | W5.1 OPFS, W5.2 SUMMARIZE, W5.3 duckdb_functions | Engine work, parallelisable |
| 7 | W0.4 temporal view, W5.7 ASOF | Together they make time comparison real |
| 8 | W4 workflow macros | Largest design surface; benefits from everything above existing first |
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
| Attribute nodes + named parameterised fragments + running-total allocation | W2.2, W4 | **Intervene** — "can the user construct a scenario?"; resource limits made visible |
| Compare workspace (exists) + numeric aggregate + temporal view | W0.4, W2.1, W5.7 | **Evaluate** — "can the user judge whether the scenario is good, fair, feasible?" |
| Variant branching, analysis history, Explain provenance, lineage card | W0.1, W0.2, W6 | **Refine** — "can the user explain how this scenario came to be?" |
| Assistant tools covering the whole surface, and reads as well as writes | W7 | Cuts across all five — an assistant that cannot observe consequences cannot help evaluate or revise |

Standing at the time of assessment: Filter capable but failing its diagnostic; Prioritise failing; Intervene partial and resource-blind; **Evaluate already passing**; Refine with the machinery in place but a broken link. W0 fixed the broken link and the wrong score arithmetic; the diagnostics themselves are what Workstreams 1–4 address.

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
