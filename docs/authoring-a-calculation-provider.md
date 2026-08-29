# Authoring a calculation provider

How to make a calculation ALUR does not contain callable from inside it.

**New to this? Start with [Building your first calculation](building-your-first-calculation.md)**
— a half-hour walk from an empty folder to something running in the toolbox, with
a complete worked example. This page is the reference you come back to.

The contract lives in [`@alur/operation-contract`](../packages/operation-contract),
a package you install — ALUR compiles against the same one, so the two cannot
drift.

Two worked examples exist, deliberately unalike — they share no domain, no
language and no output shape, and neither required a line of ALUR to change:

| | |
| --- | --- |
| [`reach-ops/alur-provider/`](https://github.com/danylaksono/reach-ops) | A Rust reachability engine compiled to wasm. Placements and severances on a road network; travel time per destination. |
| [`interactive-scenario-modeller/alur-provider/`](https://github.com/danylaksono/interactive-scenario-modeller) | A TypeScript simulation library. A budget spent down year by year over ranked units; what was committed when, and what it yields. |
| [`docs/examples/visit-order/`](examples/visit-order/) | The tutorial's example, deliberately the smallest complete thing: one input, one setting, one change, one output. |

Both are about 250–500 lines of plain JavaScript over an engine that already
existed.

---

## Do you need one?

Three extension points exist, and a provider is the most expensive. Take the
cheapest one that works.

| Reach for | When |
| --- | --- |
| **A workflow node** | The calculation is SQL. Filters, joins, aggregations, window functions, anything DuckDB's `spatial` extension already does. |
| **A saved operation** (fragment) | You want to name and reuse a run of nodes with fill-in-the-blank values. No code, authored in the app, travels in the project file. |
| **A provider** | The calculation cannot be expressed as SQL over the data. Routing, network flow, capacity-constrained allocation, an optimiser, a simulation with state. |

If you find yourself writing a provider that emits one `SELECT`, write a
fragment instead.

---

## Install the contract

```sh
npm i -D @alur/operation-contract
```

Types and the validators ALUR itself runs. Use them and a wrong manifest is a
compile error in your editor instead of a surprise in someone else's panel — the
first externally written plugin declared `options` as objects where the renderer
wanted strings, and a `semanticType` of `"quantitative"`, which is not one of the
seven. Both passed validation.

In plain JavaScript, a JSDoc annotation gets the same checking with no runtime
dependency:

```js
/** @type {import('@alur/operation-contract').OperationManifest} */
const manifest = { /* … */ };
```

---

## The shape of a provider

Two halves. A **manifest** describing what the calculation needs and produces,
and a **factory** that builds a running instance.

```js
export const provider = {
  manifest: { /* declarative, serialisable */ },
  async create({ inputs, parameters }) {
    return {
      async setParameters(values) {},
      async setChanges(changes) {},
      async evaluate() { return { outputs: {} }; },
      dispose() {},
    };
  },
};
export default provider;
```

ALUR builds its entire interface from the manifest. You contribute no UI, and
there is no hook for contributing any — a provider that needed a bespoke panel
would be a provider ALUR had to know something about.

---

## The manifest

### Identity

```js
id: "reach-ops.accessibility",   // lower-case, dot- or dash-separated
label: "Travel time from nearest hub",
description: "…",                 // one sentence, shown under the loader
version: "0.1.0",
```

Namespace the `id`. It is what records in a saved project point at, so it has to
stay stable and stay yours.

### Inputs — and why field *roles*

Declare each relation you read, addressed by id. Do not assume one table.

```js
inputs: [
  {
    id: "network",
    label: "Network",
    description: "Routable lines. Segments sharing exact coordinates connect.",
    geometry: "line",              // point | line | polygon | any | none
    fields: [
      { id: "id",    label: "Segment id",    semanticType: "identifier",  required: true },
      { id: "class", label: "Segment class", semanticType: "categorical", required: true },
    ],
  },
]
```

`fields` are **roles, not column names**. The analyst binds each role to a column
in their own data, and ALUR hands you the mapping. This is what makes one
provider work against data that names its columns differently:

```js
async create({ inputs }) {
  const network = inputs.find((input) => input.inputId === "network");
  const classColumn = network.fields.class;   // whatever the analyst chose
}
```

If your engine hardcodes property names — reach-ops' graph builder reads
`highway` and `osm_id` — rename on the way in. That bridging is the adapter's
job, and it is the single most useful thing an adapter does.

Use `geometry: "any"` unless you genuinely cannot cope. Real destination data is
rarely points: settlements arrive as boundaries. Reduce to a representative point
yourself and say so in the description. Requiring the analyst to convert first
makes your calculation unusable against the data it exists for.

`geometry: "none"` gets plain rows instead of GeoJSON.

#### `multiple` — several datasets, one input

```js
{ id: "units", label: "Units", geometry: "any", multiple: true, fields: [ /* … */ ] }
```

Declare it and the analyst can bind more than one dataset to the same input;
ALUR concatenates them. This is what makes "draw a few more candidates and run it
again" a binding change rather than a pipeline change — no union node, no schema
surgery.

Role binding is what makes it work. Each dataset maps its **own** column names
onto the same roles, so a three-column layer somebody drew and a sixty-column
table they loaded unify with nothing in common but the roles. Every feature gains
`__alur_source` naming the dataset it came from, so a provider that wants to tell
them apart can.

**Read roles through `fields`, never by column name.** ALUR projects every bound
role onto a canonical property and `fields` points at it:

```js
const cost = feature.properties[input.fields.cost];   // right
const cost = feature.properties.ashp_total_cost;      // wrong; only works for one dataset
```

Unbound columns still arrive under their original names, so looking at extra
columns is still possible — it just cannot be relied on across sources.

### Parameters — settings, not assertions

```js
parameters: [
  { id: "defaultSpeedKmh", label: "Fallback speed (km/h)", type: "number", defaultValue: 20 },
]
```

Types are `number`, `field`, or `choice` (with `options`). **Free text is
deliberately absent** — these values reach SQL and a provider boundary, and an
unconstrained string would be a way to smuggle anything into either.

A parameter is a value with no location. Keep it strictly apart from a change,
which is something the analyst asserted about a *place*. An account that showed
them alike would misreport what happened.

### Changes — what can be asserted

```js
accepts: [
  {
    id: "sever",
    label: "Sever the network here",
    inputId: "network",
    referent: "point",       // rows | point | geometry
    parameters: [],
  },
]
```

`referent` decides how the analyst points at the thing:

- **`rows`** — the current map/table selection, arriving as row ids. Changing an
  attribute on units that already exist.
- **`point`** / **`geometry`** — a location on the map. Placing something that
  was not there: a charge point, a camp, a break in a network.

For a `rows` change, set **`targetFieldRole`** to the role those ids should be
expressed in. ALUR translates the selection from the dataset's own row-id column
into that role's values before handing you the change, so you match on the same
property you read everywhere else. Omit it and the input's first required
identifier is assumed — which is right whenever there is one, and an error at
registration when there is not.

Declaring one of these is all it takes to get a working editor — a selection or
a placement mode, a form built from `parameters`, and a persisted record.

### Outputs

```js
outputs: [
  {
    id: "reach", label: "Travel time per destination",
    kind: "join", joinInputId: "destinations", joinFieldRole: "id",
    fields: [{ name: "duration_s", type: "DOUBLE" }],
  },
  {
    id: "network_state", label: "Network state",
    kind: "dataset", geometry: "line",
    fields: [{ name: "reached", type: "BOOLEAN" }],
  },
]
```

- **`join`** — a value per unit. Return rows carrying a `key` column; ALUR merges
  them onto the input's geometry. Set `joinFieldRole` to the role whose values
  your `key` holds, or ALUR falls back to the input's first required identifier
  role and a wrong guess joins nothing.
- **`dataset`** — geometry your calculation invented. Becomes an ordinary ALUR
  dataset through the same path a loaded file takes.

Every output becomes a normal dataset, so charts, filters, cohorts, the DAG,
comparison and map styling all reach it without being taught you exist.

### Measure

```js
measure: {
  outputId: "reach", field: "duration_s", label: "Mean travel time",
  unit: "s", aggregation: "mean", preferredDirection: "lower",
}
```

Optional. Nominates a headline so the comparison view can wire itself up.

---

## The lifecycle

```text
create → setParameters / setChanges → evaluate → dispose
                     ↑______________________|
```

Split because real engines are expensive to load and cheap to re-run. Building a
routable graph from a national road extract costs seconds; recomputing after one
segment changes costs milliseconds. Do your expensive work in `create` and keep
it.

### The one rule that matters

> **`setChanges` receives the whole ordered list and must make your state equal
> exactly that list — not add to it.**

This is what makes undo honest: the state at position *n* is a pure function of
the first *n* records, so undoing and re-applying cannot drift.

```js
async setChanges(changes) {
  const ordered = [...changes].sort((a, b) => a.sequence - b.sequence);
  this.engine.reset_breaks();          // clear, then replay
  for (const change of ordered) { /* … */ }
}
```

If you can diff against the previous list, do — but only if it is provably
equivalent. reach-ops can, and replays anyway: a few dozen replayed severances
cost a fraction of the Dijkstra that follows, and being provably right is worth
more than that.

### Evaluating

```js
async evaluate() {
  return {
    outputs: {
      reach: { kind: "join", rows: [{ key: "53.06", duration_s: 4009 }] },
      network_state: { kind: "dataset", geojson: { type: "FeatureCollection", features: [] } },
    },
    warnings: ["…"],   // optional, shown to the analyst verbatim
  };
}
```

**Return `null`, never `0`, for "no answer".** An unreachable place is not a place
with a travel time of zero. ALUR carries nulls through to the map, where they
render as no-data rather than as the best possible score.

Report boundaries you hit as `warnings` rather than throwing. A severance nowhere
near the network is worth telling the analyst about; it is not worth abandoning
every other change in the list over.

---

## Packaging and loading

A plugin is a **package manifest plus plain ESM**, loaded by URL at runtime
inside a Web Worker. No build step is required, and no registration in ALUR.

### `alur.plugin.json`

Put it at the root of whatever you serve, beside the tree your entry imports
from.

```json
{
  "contract": 1,
  "name": "ism",
  "label": "Interactive scenario modeller",
  "version": "0.2.0",
  "description": "…",
  "entry": "./alur-provider/index.js",
  "calculations": [
    { "id": "ism.phased-allocation", "label": "Phased allocation under a recurring budget" }
  ]
}
```

It earns its place three times over:

- **Several calculations behind one load.** Export `providers: [a, b, c]` and the
  panel offers a picker. A library that does a dozen useful things no longer has
  to publish a dozen URLs.
- **Nothing runs before it is checked.** The manifest is fetched and validated as
  data. A package declaring a contract revision ALUR does not speak, or
  advertising a calculation its entry does not export, is refused without any of
  its code being imported.
- **`entry` resolves against the manifest**, not against whatever was pasted. An
  entry importing `../dist/index.js` reaches the right place regardless, which is
  what makes serving from the wrong directory stop being a failure mode.

`calculations` must match what the entry exports, exactly and in both directions.
A catalogue nobody checks becomes a catalogue that lies.

### Exporting

```js
export const providers = [phasedAllocation, someOtherCalculation];
```

`provider` or a default export are still accepted for a single calculation — a
one-element array should not be mandatory, and modules written before packaging
existed keep working.

### Serving

Serve it over HTTP **with CORS allowed**. `file://` will not work, and neither
will `python -m http.server` — it sends no `Access-Control-Allow-Origin`, and the
failure surfaces as a bare `net::ERR_FAILED` that reads like a missing file.

```sh
npx serve --cors -l 8733 .
```

Then point ALUR's **Calculations** panel at
`http://localhost:8733/alur.plugin.json`.

### Being listed in the loader

ALUR ships a plugin catalogue at
[`src/data/pluginCatalogue.json`](../src/data/pluginCatalogue.json), which turns
the loader's text box into a picker. **It ships empty and should stay empty in
this repository** — ALUR contains no analytical calculation and names no
analytical domain, and entries here would put both back. Deployments fill it in:

```json
{ "name": "ism", "label": "Scenario modeller", "url": "https://…/alur.plugin.json" }
```

### wasm

`wasm-bindgen --target web` output works as-is:

```js
import init, { Engine } from "../web/pkg/my_engine.js";

async create({ inputs, parameters }) {
  await init();                     // returns immediately if already loaded
  const engine = new Engine(/* … */);
}
```

The `.wasm` is fetched relative to the glue module's own URL, so keep `pkg/`
next to your provider and serve both.

### What you may not do

You are in a worker. There is no `document`, no `window.alur`, no map, no store —
enforced by the runtime rather than by your good intentions. The manifest must
survive `structuredClone`: no functions, no class instances, no `undefined` you
care about.

---

## Verifying

Drive the contract directly, against real data, before wiring it into ALUR. See
[`alur-provider/verify.mjs`](https://github.com/danylaksono/reach-ops) for the
pattern:

```js
const instance = await provider.create({ inputs, parameters: {} });

await instance.setChanges([]);
const baseline = await instance.evaluate();

await instance.setChanges([someChange]);
const changed = await instance.evaluate();

await instance.setChanges([]);              // the check that matters
assert.deepEqual(await instance.evaluate(), baseline);
```

Two things that only real data will tell you, both of which caught reach-ops:

- **Geometry is not the kind you assumed.** Declaring `point` for destinations
  produced zero results against settlement boundaries.
- **A hand-picked test coordinate proves nothing.** Locate changes from the data
  — a vertex on an arterial, the worst-served unit — or your assertions pass
  while the numbers barely move.

---

## Limits worth knowing

**The row cap.** ALUR reads at most `DEFAULT_FEATURE_CAP` (1,000,000) features
per input to hand you, and warns when it truncates. This is the one number the
shell picks without knowing what your calculation does. If your engine needs
more, say so in your README — it is not something ALUR can infer.

**Instances are not yet held open across edits.** The runner currently creates,
runs and disposes per run, which throws away the lifecycle's advantage. Design
for the lifecycle anyway: it is the contract, and keeping instances warm is the
next improvement rather than a change to your provider. It becomes load-bearing
once calculations are workflow nodes, because a node otherwise rebuilds its
engine on every graph run.

**Binding is not remembered.** It lives in the panel's own state, so it is
re-entered after a reload and is not reused across variants. Auto-binding from
role semantics is the intended fix; nothing about your manifest changes when it
lands.

---

## Checklist

- [ ] `alur.plugin.json` lists exactly what the entry exports
- [ ] `id` is namespaced and stable
- [ ] Every input declares its field roles; nothing assumes a column name
- [ ] `geometry: "any"` unless you truly cannot cope
- [ ] Settings are `parameters`; things with a location are `accepts`
- [ ] `joinFieldRole` set on every `join` output, `targetFieldRole` on every `rows` change
- [ ] Roles read through `fields`, never by column name
- [ ] `setChanges` replaces state; it does not accumulate
- [ ] Missing values come back as `null`, not `0`
- [ ] Boundaries reported as `warnings`, not thrown
- [ ] `dispose` frees the engine
- [ ] Manifest survives `structuredClone`
- [ ] Verified against real data, with a replay check
