# Building your first calculation

A walk through writing a calculation ALUR does not contain, from an empty folder
to something running in the toolbox. About half an hour.

This is the tutorial. [Authoring a calculation provider](authoring-a-calculation-provider.md)
is the reference — every field, every rule, every limit — and this page links
into it rather than repeating it.

The finished example lives in [`examples/visit-order/`](examples/visit-order/).
It runs, it is tested, and a test in ALUR's own suite keeps it honest against the
contract. Copy that directory and replace the middle.

---

## First: should this be a calculation at all?

A calculation is the most expensive of ALUR's three extension points. Take the
cheapest one that does the job.

| Reach for | When |
| --- | --- |
| **A workflow node** | It is SQL. Filters, joins, aggregations, window functions, anything DuckDB's `spatial` extension already does. |
| **A saved operation** | You want to name and reuse a run of nodes with fill-in-the-blank values. No code, authored in the app. |
| **A calculation** | It cannot be expressed as SQL over the data. |

The honest test for that last row: **does the answer for one row depend on the
answers already given for other rows?** If yes, no single `SELECT` can produce
it and you need a calculation. Routing, capacity that runs out, greedy selection
under a constraint, anything transitive, anything iterative, any optimiser, any
simulation with state.

The example here passes that test. It orders stops into a visiting sequence by
repeatedly going to the nearest place not yet visited — where you go next depends
on everywhere you have already been.

If you find yourself writing a calculation that emits one `SELECT`, write a
saved operation instead.

---

## The shape of it

Three files. No build step, no framework, no registration in ALUR.

```
my-calculation/
├── alur.plugin.json   what the package is, and what is inside it
├── index.js           plain ESM, exporting `providers`
└── verify.mjs         drives the contract before anything is served
```

A calculation is two halves: a **manifest** that declares what it needs and
produces, and a **factory** that builds a running instance.

```js
export const providers = [{
  manifest: { /* declarative, serialisable */ },
  async create({ inputs, parameters }) {
    return {
      async setParameters(values) {},
      async setChanges(changes) {},
      async evaluate() { return { outputs: {} }; },
      dispose() {},
    };
  },
}];
```

**ALUR builds its entire interface from the manifest.** You contribute no UI and
there is no hook for contributing any — a calculation that needed a bespoke panel
would be one ALUR had to know something about, and then the toolbox could only
hold calculations ALUR already knew.

### Get the types

```sh
npm i -D @alur/operation-contract
```

Not required, and worth it. The first plugin written against the prose contract
shipped two mistakes nothing caught: `options` declared as `{value, label}`
objects where the renderer wanted strings, and a `semanticType` of
`"quantitative"`, which is not one of the seven ALUR has. Both are type errors
now.

In plain JavaScript one comment gets you the same checking with no runtime
dependency, which is what the example does:

```js
/** @type {import('@alur/operation-contract').OperationManifest} */
const manifest = { /* … */ };
```

---

## Step 1 — Say what you read

Declare each relation your calculation reads, and describe its columns by the
**role they play**, never by the name they happen to have:

```js
inputs: [
  {
    id: "stops",
    label: "Stops",
    description: "The places to visit. Any geometry; areas are reduced to a representative point.",
    geometry: "any",
    multiple: true,
    fields: [
      { id: "id", label: "Identifier", semanticType: "identifier", required: true },
    ],
  },
]
```

The analyst binds each role to a column in their own data and ALUR hands you the
mapping. **Read through that mapping, never by column name:**

```js
const id = feature.properties[input.fields.id];   // right
const id = feature.properties.stop_code;          // wrong
```

This is not a style preference. `multiple: true` lets an analyst bind *several*
datasets to one input — a layer they drew alongside a table they loaded — and
each one names its columns differently. ALUR projects every bound role onto a
canonical property and points `fields` at it, so reading through `fields` is what
makes the two unify. Reading by column name works until someone binds a second
dataset, then silently returns `undefined`.

Use `geometry: "any"` unless you genuinely cannot cope. Real data is rarely
points — an administrative unit arrives as a boundary — and demanding conversion
first makes your calculation unusable against the data it exists for. Reduce to a
representative point yourself and say so in the description.

### The coordinates you get are WGS84

Longitude and latitude, degrees. ALUR reprojects on the way out, so you can
measure distances without asking where the data came from.

Worth stating plainly because it was not always true. ALUR used to hand over
whatever the dataset was stored in, so a projected file arrived as Web Mercator
**metres** wearing a GeoJSON coat, and every distance calculation was confidently
wrong with no way to notice. If you are reading an older plugin that carries a
CRS guess, that is why; it does not need one now.

---

## Step 2 — Say what can be adjusted

Two different things, kept strictly apart.

**Parameters** are settings — a value that applies everywhere and has no
location:

```js
parameters: [
  { id: "returnToStart", label: "Return to the first stop at the end",
    type: "choice", defaultValue: "no",
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
]
```

Types are `number`, `field` or `choice`. Free text is deliberately absent: these
values reach both SQL and a plugin boundary, and an unconstrained string would be
a way to smuggle anything into either.

**Changes** are assertions the analyst makes about a *place*:

```js
accepts: [
  { id: "start-here", label: "Start from this stop",
    inputId: "stops", referent: "rows", targetFieldRole: "id", parameters: [] },
]
```

`referent` decides how they point at it — `rows` for a selection of units that
already exist, `point` or `geometry` for placing something that was not there.
Declaring one is all it takes to get a working editor: a selection or a placement
mode, a form built from `parameters`, and a persisted record.

Set `targetFieldRole` on any `rows` change. ALUR then translates the selection
from the dataset's own row-id column into that role's values before handing it to
you, so you match on the same property you read everywhere else.

Keeping these apart matters beyond tidiness: a change is recorded in the
analyst's history as something they asserted about somewhere, and a setting is
not. An account that showed them alike would misreport what happened.

---

## Step 3 — Say what you produce

```js
outputs: [
  { id: "route", label: "Visiting order",
    kind: "join", joinInputId: "stops", joinFieldRole: "id",
    fields: [
      { name: "visit_order", type: "INTEGER" },
      { name: "leg_km", type: "DOUBLE" },
      { name: "cumulative_km", type: "DOUBLE" },
    ] },
]
```

- **`join`** — a value per unit. Return rows carrying a `key`; ALUR merges them
  onto the input's geometry.
- **`dataset`** — geometry your calculation invented, which becomes an ordinary
  ALUR dataset.

Every output becomes a normal dataset, so charts, filters, cohorts, the map, the
DAG and the comparison view all reach it without being taught you exist. That is
the whole payoff of the contract: you write the arithmetic, and everything ALUR
can already do applies to the result.

Optionally nominate a **measure**, and the comparison view wires itself up:

```js
measure: { outputId: "route", field: "leg_km", label: "Total distance",
           unit: "km", aggregation: "sum", preferredDirection: "lower" },
```

---

## Step 4 — Write the instance

```
create → setParameters / setChanges → evaluate → dispose
                    ↑______________________|
```

Split because real engines are expensive to load and cheap to re-run. Do the
expensive work in `create` and keep it: building a routable graph from a national
road extract costs seconds, and recomputing after one edit costs milliseconds.

### The one rule that matters

> **`setChanges` receives the whole ordered list and must make your state equal
> exactly that list — not add to it.**

Clear, then replay:

```js
async setChanges(changes) {
  this.startIndex = null;                                   // clear
  for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
    /* replay */
  }
}
```

This is what makes undo honest: state at position *n* is a pure function of the
first *n* records, so undoing and re-applying cannot drift.

It also decides what happens when two records disagree. In the example the last
`start-here` wins, so an analyst changing their mind is one more record rather
than a special case. If your calculation has two changes that answer the same
question — include and exclude, say — put them in **one** map so the later record
overrules the earlier one. Holding them in separate sets is a common mistake and
a quiet one: both orderings then produce the same answer, and the ordering the
contract promises becomes a fiction.

### Returning results

```js
return {
  outputs: { route: { kind: "join", rows } },
  warnings: ["…"],   // optional, shown to the analyst verbatim
};
```

Two habits worth forming now:

**Return `null`, never `0`, for "no answer".** A stop that is not on the route
has no position and no leg length. Zero would render on a map as *visited first,
at no cost* — the best possible result — rather than as no data. ALUR carries
nulls through to the map as no-data.

**Report boundaries as `warnings` rather than throwing.** A stop with no geometry
is worth telling the analyst about. It is not worth abandoning the other
forty-nine over.

---

## Step 5 — Verify before you serve

Drive the contract directly, against data you can reason about, before wiring any
of it into ALUR. [`verify.mjs`](examples/visit-order/verify.mjs) is the pattern:

```js
const instance = await provider.create({ inputs, parameters: {} });

await instance.setChanges([]);
const baseline = await instance.evaluate();

await instance.setChanges([someChange]);
const changed = await instance.evaluate();

await instance.setChanges([]);                    // the check that matters
assert.deepEqual(await instance.evaluate(), baseline);
```

That last one is worth more than the rest combined. If replaying an earlier
change list does not reproduce its result byte for byte, your `setChanges`
accumulates somewhere, and undo will drift in a way no one notices until a
scenario cannot be reproduced.

Then run it against **real** data, which will tell you two things nothing else
will:

- **The geometry is not the kind you assumed.** Declaring `point` for
  destinations produced zero results against settlement boundaries.
- **A hand-picked test case proves nothing.** Locate your cases from the data —
  a vertex on an arterial road, the worst-served unit, the highest-yielding
  candidate — or your assertions pass while the numbers barely move. One example
  here picked an arbitrary unit for a ramp assertion; that unit's value happened
  to be zero, so the ramp was flat and the test passed for entirely the wrong
  reason.

---

## Step 6 — Package it

`alur.plugin.json` at the root of whatever you serve, beside the tree your entry
imports from:

```json
{
  "contract": 1,
  "name": "example",
  "label": "Example plugin",
  "version": "1.0.0",
  "entry": "./index.js",
  "calculations": [
    { "id": "example.visit-order", "label": "Order into a visiting sequence", "group": "Routing" }
  ]
}
```

`calculations` must match what the entry exports, exactly and in both directions
— ALUR checks, because a catalogue nobody checks becomes a catalogue that lies.
`group` is what makes your calculations browsable once someone has more than a
handful installed.

The manifest is fetched and validated **as data before any of your code runs**,
which is also why `entry` resolves relative to it rather than to whatever the
analyst pasted.

---

## Step 7 — Serve and load

Over HTTP, with CORS allowed.

```sh
npx serve --cors -l 8733 .
```

Then paste `http://localhost:8733/alur.plugin.json` into the toolbox's **Add a
plugin** box. Your calculations appear in the tree, grouped, searchable, with a
generated dialog behind each one.

`python -m http.server` will not do. It sends no `Access-Control-Allow-Origin`,
and the failure surfaces as a bare `net::ERR_FAILED` that reads exactly like a
missing file. This has cost more than one afternoon.

---

## Step 8 — Your calculation as a step in a workflow

You get this one free. The same manifest that generates the dialog also places a
node on the workflow canvas — the button beside your calculation in the toolbox
adds it — and nothing in your code changes between the two.

What differs is where the data comes from. In the dialog the analyst picks
datasets; on the canvas your inputs are **handles**, one per declared input, and
whatever is wired into a handle is what you get. So a manifest with two inputs
gets two handles, and an input with `multiple: true` accepts several edges into
the same one. That is the whole of the wiring.

Two consequences worth designing for:

**Your input may be a mid-pipeline result, not a file.** It has been filtered,
joined and scored on the way to you, and it very likely carries no unique column
at all. ALUR fills a required `identifier` role with a row number when the
analyst binds nothing, so your calculation runs — but if you can do something
better with a real identifier, say so in the role's `description`, because that
text is what the analyst reads when deciding whether to bind one.

**Your result becomes a table the graph reads from.** Only one declared output
can be passed downstream; the analyst chooses which, and the rest still register
as datasets exactly as they do from the dialog. If one of your outputs is
obviously the one people will build on, declare it first.

You do not need to do anything for staleness. ALUR fingerprints the compiled SQL
above your node, the bindings, the settings, your `version`, and the scenario —
and tells the analyst when the held result no longer follows. It never re-runs
you on its own. Bumping your `version` is enough to mark every held result in
every saved project as needing a re-run, which is the honest thing to do when
your answer changes.

---

## When it does not work

| What you see | What it usually is |
| --- | --- |
| `net::ERR_FAILED`, looks like a missing file | No CORS header. Not `python -m http.server`. |
| "declares an invalid calculation" | Run `operationManifestErrors` yourself; it names the field. |
| "advertises X but its entry does not export it" | `calculations` and `providers` disagree. |
| "matched none of the N features" | Your `key` values are not the values of the role in `joinFieldRole`. |
| Every distance is absurd | You are reading coordinates by column name instead of through `fields`, or from an unbound column. |
| Works with one dataset, breaks with two | Same cause. Read roles through `fields`. |
| The result is right but the map shows the worst-possible colour everywhere | You returned `0` where you meant `null`. |
| Undo produces a different answer than the first time | `setChanges` accumulates instead of replacing. |

---

## Limits worth knowing now

- **ALUR reads at most 1,000,000 features per input** and warns when it
  truncates. If your engine needs more, say so in your README — it is not
  something ALUR can infer.
- **Instances are not yet held open across edits.** The runner creates, runs and
  disposes per run, which throws away the lifecycle's advantage. Design for the
  lifecycle anyway: it is the contract, and keeping instances warm is the next
  improvement rather than a change to your calculation.
- **A saved project remembers the configuration, not your code.** Bindings,
  settings and your `version` travel in the project file; your plugin does not.
  Opening a project whose plugin is not installed is a normal thing that says so
  clearly, rather than an error — which is why the id you choose is a lasting
  public name, and why changing what an id means is worse than adding a new one.
- **You are in a worker.** No DOM, no map, no store — enforced by the runtime
  rather than by your good intentions. The manifest must survive
  `structuredClone`: no functions, no class instances.

---

## Where to look next

| | |
| --- | --- |
| [Authoring a calculation provider](authoring-a-calculation-provider.md) | The reference. Every field and every rule. |
| [`examples/visit-order/`](examples/visit-order/) | This tutorial's finished code, tested. |
| [`src/providers/bundled/`](../src/providers/bundled/) | The calculations ALUR ships. Three real ones, each sequential or transitive. |
| [`reach-ops`](https://github.com/danylaksono/reach-ops) | A Rust engine compiled to wasm, wrapped in ~250 lines. |
| [`interactive-scenario-modeller`](https://github.com/danylaksono/interactive-scenario-modeller) | A TypeScript simulation library exposed as one calculation. |

The last two share no domain, no language and no output shape, and neither
required a line of ALUR to change. If yours does, that is worth raising as a
contract gap rather than working around.
