# ALUR SIL Readiness Plan — Scenario Portfolio, Provenance, Iteration, Geometry

**Date:** 2026-08-05 · **Status:** W1–W4 done and verified in the browser; W5 proposed. W3 and W4 were built ahead of a case study because no case-study data exists yet — their scope should be revisited once Case 3 has been run. · **Companion to** [improvement-plan.md](improvement-plan.md), which took all five SIL diagnostics to passing. This plan addresses what running the case studies needs that passing the diagnostics did not.

## Framing

Same discipline as the improvement plan, and for the same reason. Every capability below is stated as a **generic visual-analytics capability**, justifiable to a user who has never heard of spatial intervention planning. A project holding several lines of enquiry is how any analyst works; an event log of what happened is what every tool that supports "how did I get here" records; running a pipeline over several parameter sets is a parameter sweep; drawing a dataset is what every geospatial tool offers. The mapping to the Spatial Intervention Loop is in [Appendix A](#appendix-a--sil-coverage-map) and is a *consequence* of the work, not its motivation.

The claim under test is unchanged: **a well-designed generic platform supports the pattern without being built for it.** Every feature that only makes sense in planning language weakens that claim. [Appendix B](#appendix-b--the-domain-neutrality-guard) makes that testable rather than aspirational, because this plan adds the two features most at risk of smuggling domain vocabulary in.

Source of the borrowed design: `D:\Dissertation\laep-dashboard`, the prototype the pattern was originally abstracted from. Its `sessions → scenarios → interventions` bundle and its PROV-shaped event log are the two things ALUR does not have. What ALUR already has — `AnalysisVariant` with `parentVariantId`, `parameters`, `assumptions`, `operations` and per-variant provenance — turns out to be most of a LAEP scenario already, so three of the five workstreams are extensions rather than new structures.

**Deferred, deliberately:** H3 beyond the equal-area hexbins already shipped (administrative units are the spatial unit for the case studies, and chapter 5 records that LSOA attachment is what local authorities actually want); the copilot / W7 (no SIL diagnostic mentions natural language, and an assistant driving the session confounds the platform claim); mutable scenario state (the derived-dataset model is better and already works).

---

## Workstream 1 — Session tier · **done**

**Generic pitch:** a project holds more than one line of enquiry, and they don't contaminate each other.

**As built.** `AnalysisSession` lives in `VisualAnalyticsState` alongside `variants`, with `activeSessionId`; the store gained `createSession`, `updateSession`, `removeSession` and `setActiveSession`. Manifest is v3, and `migrateV2ToV3` gives a v2 project one session named after it, holding every variant it already had. The UI is a *Line of enquiry* block at the top of the variant panel — selector, question field, and a new-enquiry button — and the variant list, comparison scope and account view all narrow to the open enquiry.

Three decisions worth recording:

- **`sessionId` is stamped, not required.** `addVariant` fills it from whatever enquiry is open, and `recordProvenanceEvent` does the same for every event, so no call site can forget which question its work belonged to. The field stays optional in the type only because pre-v3 projects have variants without one.
- **A branch stays in its parent's enquiry**, not whichever one happens to be open. Branching is a move within a question.
- **Deleting an enquiry deletes its variants but not its account.** The record of a line of enquiry is precisely what should survive abandoning it — that is the Refine diagnostic.

**A latent bug was fixed on the way.** `migrateProjectManifest` returned the v0→v1 result directly instead of chaining, so a v0 project stopped at version 1 and never saw the v1→v2 migration — its legacy dashboard was silently dropped rather than becoming an Explain document. Migrations now chain to the current version. Two tests that asserted the old behaviour were updated with a note saying why.

Today `AnalysisVariant` is scoped to a `baselineDatasetId` inside a single flat project manifest. Running a case study means several sittings over the same data, each with its own set of variants, and needing to compare across them. LAEP solved this with a `sessions[]` tier above `scenarios[]`.

### 1.1 Introduce `AnalysisSession`

```ts
export type AnalysisSession = {
  id: string;
  name: string;
  question: string;          // what this line of enquiry is asking
  baselineDatasetId: string;
  createdAt: number;
  provenanceId: string;      // stable across rename; see W2
};
```

`AnalysisVariant` gains `sessionId: string`. Variants continue to carry `parentVariantId`, so branching lineage is unchanged — the session is a grouping tier, not a replacement for it.

`question` is the one field worth arguing about. It is generic (every analyst starts from a question), it is user-authored, and it is what makes a session self-describing in the account. It ships empty and is never required.

### 1.2 Manifest v3 and migration

`PROJECT_MANIFEST_VERSION` goes to 3. Reading a v1/v2 project synthesises one session named after the project, assigns every existing variant to it, and writes v3 on next save. No project becomes unreadable — the same forward-migration contract W5.1 already established.

### 1.3 Session switching in the workspace

A session selector alongside the existing variant controls. Switching a session swaps the active variant set and the comparison scope. The `compare` workspace mode gains a cross-session mode: compare variant A from session 1 against variant B from session 2, provided they share a baseline dataset.

**Cost:** moderate. Touches the manifest, the store, the compare workspace, and the variant UI.

---

## Workstream 2 — Provenance event log · **done**

**Generic pitch:** the app can say what happened, not only what the state currently is.

**As built.** [`types/provenance.ts`](../src/types/provenance.ts) and [`utils/provenance.ts`](../src/utils/provenance.ts) hold the event and its summariser; the log lives on the store as `provenanceEvents` and travels in the project manifest as an optional top-level array, versioned separately. Emission points: variant create/branch/rename/delete, operation create/apply/update/remove, filter apply/clear, weight change, workflow run, project load/export, and undo/redo. [`SessionAccount.tsx`](../src/components/Explain/SessionAccount.tsx) renders it, and it can be pinned into an Explain document as an `account` card that freezes its events so a shared story carries its own account.

Two departures from this plan, both deliberate:

- **`operation.created` was added to the vocabulary.** The plan mapped LAEP's `intervention.added` to `operation.applied`, but authoring an operation and placing one are different acts — an operation is defined once and placed many times, and an account that called both "applied" could not tell them apart.
- **Events carry an optional `coalesceKey`.** Dragging a weight slider arrives as dozens of store updates. Events sharing a key within 700 ms — the same window the undo stack uses — replace their predecessor, so the log records where a gesture landed rather than every frame on the way. The log is still append-only with respect to *actions*; it just does not mistake one action for hundreds.

This is the highest-value workstream and the one with the clearest external justification.

ALUR has two provenance mechanisms today and neither is an event log. `analysisHistory` is an undo/redo snapshot stack (`past`/`future`) — it records *states*, and states are destroyed by redo. `AnalysisVariant.provenance` is a per-variant reference to `workflowNodeIds` — it records *derivation*, but only for actions that produced a variant. Nothing records an action the analyst took that did not produce a variant, and nothing survives the undo stack being truncated.

### 2.1 Append-only event stream

Adopt LAEP's event shape, which is W3C PROV-O influenced — `activity`, `agent`, `used`, `generated`, `entityType`, `entityId`. That lineage is worth keeping because it is citable, and because it makes the log interoperable rather than bespoke.

```ts
export const PROVENANCE_SCHEMA_VERSION = 1;

export type ProvenanceEvent = {
  schemaVersion: number;
  id: string;
  timestamp: string;         // ISO
  activity: ProvenanceActivity;
  agent: { type: 'user' | 'assistant'; id: string; label: string };
  sessionId: string | null;
  variantId: string | null;
  entityType: 'session' | 'variant' | 'dataset' | 'operation' | 'layer';
  entityId: string | null;
  used: string[];            // entity ids consumed
  generated: string[];       // entity ids produced
  payload: Record<string, unknown>;
  summary: string;           // human-readable, generated at write time
  appVersion: string;
};
```

Append-only, versioned independently of the project manifest, and carried in the manifest as a top-level `provenanceEvents[]` — the same arrangement as LAEP's bundle.

### 2.2 Activity vocabulary

LAEP's vocabulary, generalised out of planning language. Its `intervention.*` events become `operation.*`, since ALUR's equivalent is a named saved operation rather than a planning intervention:

| LAEP | ALUR | Notes |
| --- | --- | --- |
| `session.created` | `session.created` `session.renamed` | W1 |
| `scenario.created` `.branched` `.renamed` `.deleted` | `variant.created` `.branched` `.renamed` `.deleted` | existing concept |
| `scenario.saved` `.loaded` `.imported` `.exported` | `project.saved` `.loaded` `.imported` `.exported` | ALUR persists projects, not scenarios |
| `intervention.added` `.updated` `.deleted` `.reordered` | `operation.applied` `.updated` `.removed` | saved operations, W4 of the previous plan |
| `simulation.ran` | `workflow.ran` | plus `sweep.ran`, W3 |
| — | `filter.applied` `filter.cleared` | ALUR has named filter conditions; LAEP did not |
| — | `weights.changed` | composite score panel |
| — | `dataset.created` | W4 geometry authoring |

Every activity carries a generated `summary` string. That is what makes the log readable without a decoder, and it is the same trick LAEP uses in `summarizeScenarioAction`.

### 2.3 Relationship to `analysisHistory`

They stay separate and do different jobs. Undo mutates state and truncates the future; the event log never rewinds. An undo is itself an event (`history.undone`). Do not attempt to unify them — the previous plan's Explain panel can read from both.

### 2.4 Session account

A readable rendering of the log for the active session: what was asked, what was tried, what was branched from what, what changed at each branch. This subsumes and strengthens the existing lineage card, and it is the artifact a case-study reader will actually cite.

**Cost:** moderate. The event emission points are numerous but each is one line; the account view is the real work.

---

## Workstream 3 — Variant runner · **done, ahead of its case study**

**Generic pitch:** run the same pipeline over several parameter sets and collect the results side by side.

**As built.** [`utils/workflowParameters.ts`](../src/utils/workflowParameters.ts) resolves `{ $param: 'name' }` references anywhere in a node config; `buildWorkflowSQL` applies them immediately after fragment expansion, so an operation's own steps can name a parameter too. [`services/variantSweepService.ts`](../src/services/variantSweepService.ts) runs the graph once per variant, sequentially, and returns a per-variant outcome. The variant panel gained a *Run across N variants* button that names which parameters a sweep will vary.

Decisions worth recording:

- **References may declare a `default`.** Without one, adding a reference makes the workflow unrunnable outside a sweep — a trap rather than a safeguard.
- **A failing variant does not abort the sweep.** One variant failing is a finding about that variant. The account records `Ran the workflow across 3 variants, 1 failing`.
- **3.3 (`reconcile`) is still not built**, as planned. Case 1's `propose → aggregate → reconcile → persist` needs a fixed point the DAG cannot express; reporting that boundary remains more useful than hiding it behind a general iterator.

**Two defects found by the browser run and fixed:**

- **Sweep results were mis-attributed.** `registerWorkflowResult` binds an output to *every* variant whose `provenance.workflowNodeIds` contains the terminal node — which is right for a single run and catastrophic for a sweep, since each iteration overwrote the last and all three variants ended up pointing at the final dataset. It now takes an optional `variantId` that scopes the binding to the run that produced it.
- **Parameterised graphs could not be previewed.** The schema fetcher and node preview compiled strictly, so a reference without a default broke every downstream preview and column list while the graph was still being built. Both now compile with `indicativeParameters` — the first variant that defines each value. A preview has always been one view of the data rather than the result, so this is honest as well as necessary.

This is the answer to the iteration gap the previous plan named ("what is missing is *iteration*, not mutation") and it is smaller than it looks, because the representation already exists: `AnalysisVariant.parameters: Record<string, unknown>` is already a parameter set, and LAEP already demonstrates the shape — a scenario is a *specification* that a separate runner executes (`useScenarioSimulation`, `useScenarioModellerRunner`), rather than being the pipeline itself.

### 3.1 Parameterised workflow nodes

Node configs gain the ability to reference a variant parameter rather than a literal: `{ threshold: { $param: 'cloudThreshold' } }`. Resolution happens at execution against the active variant's `parameters`. Unreferenced configs behave exactly as now.

### 3.2 Sweep execution

Run the workflow once per selected variant, collecting outputs into a comparison dataset keyed by `variantId`. Sequential execution is fine — DuckDB-Wasm is single-threaded and the case studies are tens of variants, not thousands.

### 3.3 The reconcile step

Case 1's `propose → aggregate → reconcile → persist` needs the aggregate output to feed back as an input to the next round. A sweep does not close that loop. **Two rounds run manually, with the reconciliation expressed in SQL, is an acceptable and reportable outcome** — the previous plan already identified Case 1 as the case where the DAG model meets its limit and the analyst drops to SQL. Do not build a general fixed-point iterator to avoid reporting that boundary. Reporting it is the more useful result.

**Cost:** small-to-moderate for 3.1 and 3.2. 3.3 is explicitly not built.

---

## Workstream 4 — Geometry authoring · **done**

**Generic pitch:** create a dataset by drawing it, not only by loading it.

**As built.** [`utils/drawnFeatures.ts`](../src/utils/drawnFeatures.ts) holds the model — points, lines, polygons, and columns the analyst names and types. [`Flow/GeometryNode.tsx`](../src/components/Flow/GeometryNode.tsx) is the node: three draw modes, a feature list, a schema editor, *Create dataset*, and GeoJSON/Parquet export. Drawing itself is a mode on the map — click to add a vertex, Enter or double-click to finish, Backspace to take one back, Escape to leave — with the shape in progress rendered live.

Decisions worth recording:

- **No drawing dependency was added.** Point, line and polygon capture is a few dozen lines against MapLibre's own events, and owning it keeps the schema editor and the preview in one model. Vertex editing after the fact is *not* supported — a feature is deleted and redrawn. That is the honest limit of this pass.
- **Committing routes through `ingestFile`.** A drawn layer is a GeoJSON FeatureCollection, so going through the loading path inherits geometry conversion, CRS detection, the dataset registry entry, the map layer and the source cache — and puts drawn data on exactly the same footing as loaded data. Everything downstream works without being taught that drawing exists, which is also the domain-neutrality argument: nothing in the node knows what a drawn feature means.
- **The drawn layer lives in the node's config**, so it travels in the project manifest, survives undo, and duplicates with the node — all things node configs already do. The shape *in progress* lives in UI state instead, because a half-drawn polygon is not part of the project.

**A defect found by the browser run and fixed:** the preview tracked which node to render in a React ref, which does not survive the map unmounting when the workflow drawer is maximised — so geometry drawn while the map was hidden never reappeared. It is now derived from the nodes themselves, rendering every geometry node that has features and has not yet been committed (committed ones are already real map layers, and drawing them twice would double-render every feature).

The previously reported hard limit — no workflow node can bring a new spatial object into existence — is now in scope, because the dissertation's EVCP work treats charge-point placement plus simulation output as SIL. Note that this exposes a genuine inconsistency in the source material: `Case-Studies.md` defines Intervene as "applying planning actions **to selected spatial units**", which excludes feature creation, while the EVCP chapter depends on it. **Resolve that in the paper explicitly**; do not let the implementation silently pick a side.

No drawing dependency exists in the project today, so this is greenfield.

### 4.1 A `geometry` node type

Add `'geometry'` to `WorkflowNode['data']['type']`. It is an *input-class* node — it produces a dataset with no upstream edge, exactly like `input`.

- Draw point, line and polygon on the map; edit and delete existing features.
- A user-defined attribute schema: the analyst names the columns and picks types. Nothing is pre-named.
- Rows editable in the existing table surface, so a drawn dataset is an ordinary ALUR dataset.
- Snapping and CRS handling stay out of scope; MapLibre coordinates in EPSG:4326, reprojected downstream by DuckDB `spatial` if needed.

### 4.2 Output is an ordinary dataset

The node registers a `DatasetDescriptor` like any other source. Everything downstream — filter, score, allocate, join, hexbin, charts, cohorts, variants — works with no further change. That is the whole point, and it is also the domain-neutrality argument: nothing about the node knows what the geometry means.

### 4.3 Export

GeoJSON first, GeoParquet second via the existing DuckDB `spatial` path. A drawn layer must be able to leave ALUR as a real geospatial file, or the case study cannot hand its output to anything else.

**Cost:** the largest workstream. A drawing interaction layer over MapLibre plus a schema editor is most of it.

---

## Workstream 5 — Case-study evidence harness

**Generic pitch:** hand someone a link and they see what you saw, including how you got there.

Small, and mostly assembly of things that exist.

- `load project from url` and resumable projects already ship. Confirm a project round-trips with its session tier and event log intact.
- Export the session account (W2.4) as Markdown, so a case study produces a citable written artifact alongside the live link.
- One fixture project per case study, checked into `data_sample`, so the runs are reproducible by a reviewer.

---

## Sequencing

| Order | Workstream | Why here |
| --- | --- | --- |
| 1 | **W2** provenance log | Everything else should emit events from the moment it exists. Retrofitting emission is worse than building against it. |
| 2 | **W1** session tier | W2's events need a `sessionId`; do these close together, W2 first only by a few days. |
| 3 | **Run Case 3 (active travel, LSOA)** | Pure attribute assignment. Exercises all five stages with no dependency on W3 or W4. **Do not build further until this has been run.** |
| 4 | **W3** variant runner | Scope it against what Case 3 actually made painful, not against what this document guesses. |
| 5 | **W4** geometry authoring | Largest cost, and the second case study is what justifies it. |
| 6 | **Run the EVCP-style placement case** | Uses W4. Has a published precedent in the dissertation, so the framing is already defensible. |
| 7 | **W5** evidence harness | Assembly, once there is something to assemble. |

The instruction embedded in step 3 is the important one. Building W3 and W4 before running a case study is guessing at requirements you are two weeks from knowing.

---

## Appendix A — SIL coverage map

Which generic capability discharges which obligation. Read right-to-left when assessing, left-to-right when building. This extends the previous plan's table rather than replacing it.

| Generic capability | Workstream | SIL obligation discharged |
| --- | --- | --- |
| Drawn datasets with user-defined schema, exportable | W4 | **Intervene** — extends it from attribute assignment to feature creation, which the EVCP case requires |
| Parameterised nodes and multi-variant sweep | W3 | **Intervene / Evaluate** — the loop becomes iterative in execution, not only in representation |
| Session tier, cross-session comparison | W1 | **Evaluate / Refine** — several lines of enquiry coexist and can be set against each other |
| Append-only PROV-shaped event log, session account | W2 | **Refine** — "can the user explain how this scenario came to be?" answered from a record rather than reconstructed from state |
| Shareable project link plus exported account | W5 | Cuts across all five — the diagnostics become externally checkable rather than author-attested |

**Standing after W4:** the previous plan's finding that **feature creation is not reached at all** is retired. Record in the paper that it *was* the boundary of a generic platform until a generic geometry-authoring surface was added, and that the surface required no planning vocabulary. That sequence is a stronger result than either endpoint alone.

---

## Appendix B — The domain-neutrality guard

Two workstreams here can quietly break the central claim. This is the test.

**The rule:** a capability is admissible if it can be fully documented without naming a planning domain, an intervention type, or a policy instrument.

Applied:

| Admissible | Not admissible |
| --- | --- |
| Draw a polygon; name a column `capacity_kw` yourself | A "place EV charge point" tool |
| A saved operation the user authored and named | A shipped palette of pocket parks, heat pumps, cycle lanes |
| `question` on a session, free text | A "planning objective" dropdown with fixed options |
| `operation.applied` in the event log | `intervention.applied` in the event log |
| Sweep over user-named parameters | A "delivery phase" parameter type |

The vocabulary rename in W2.2 is not cosmetic. If the event log says `intervention`, the platform has planning vocabulary baked into its persistence format, and any reviewer reading the exported JSON will find it.

**Standing check:** no string in shipped UI or persisted schema names a SIL stage, an intervention type, or a planning domain. The previous plan held this line through four workstreams; W4 is where it is most likely to slip.

---

## Appendix C — Notes carried forward for the paper

Unchanged from the previous plan's Appendix B, plus:

- **The vehicle relationship still needs stating.** `Case-Studies.md` is written as if `interactive-scenario-modeller` is the implementation, and the dissertation never mentions ALUR. The strongest framing is two arms: ISM as SIL implemented deliberately as a library, ALUR as SIL discharged incidentally by a generic platform. LAEP is the third point — the prototype the pattern was abstracted *from*. Three systems, one pattern, decreasing intentionality, is a better paper than one system passing five tests.
- **The Intervene definition is inconsistent between sources** (W4 above). Resolve, do not inherit.
- **Line 707's unsourced 2–3× claim** should be softened or sourced wherever it is repeated. Running these case studies does not source it; that needs instrumented sessions with real planners.
