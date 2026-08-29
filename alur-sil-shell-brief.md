# Build brief — SIL shell in ALUR

## How to use this brief

Do the work in stages. Stop at the end of each stage and report before you
continue. Do not build any analytical module. Modules come later.

## Stage 0 — Read the codebase first

Before you write code, inspect ALUR and report:

1. How spatial data is currently loaded and stored (DuckDB tables, schemas,
   spatial extension usage).
2. How the map layer works, and how it reads data for display.
3. What selection tools exist, if any.
4. How state flows between the data layer and the UI.
5. Where module-like code could plug in without a rewrite.

Then propose where the shell components should live in the existing
structure. Wait for approval before Stage 1. The decision affects the rest of the work.

## What the shell is

The shell hosts swappable analytical modules. Each module owns one
simulation engine. The shell owns everything else: the map, the spatial
selection, the state layer, the comparison view, and the history.

The shell must not contain any code specific to one engine. This is the
main constraint. If shell code names an algorithm, the design is wrong.

## Non-goals

- Do not implement road access, shelter allocation, or any other engine.
- Do not add authentication, user accounts, or a server backend.
- Do not optimise for speed yet. Correctness of the interface comes first.

## Core concepts

**Spatial unit** — a row with an identifier, a geometry, and attributes.
Examples: a road segment, a building, a shelter, a village.

**Intervention** — a change the analyst asserts about spatial units. There
are exactly two kinds:

- _Attribute intervention_ — change a value on an existing unit.
- _Existence intervention_ — add a unit at a location, or remove a unit.

An intervention always has a spatial referent. A change with no location is
a model parameter, not an intervention. The shell must not treat parameters
as interventions.

**Scenario** — an ordered list of interventions applied to a baseline.

**Measure** — one number per unit, plus one headline number for the whole
scenario. Modules produce measures. The shell displays and compares them.

## Stage 1 — Intervention state layer

Build this first. Everything else depends on it.

Requirements:

- Baseline tables stay unchanged. Never edit them.
- A scenario is a separate, ordered set of intervention records.
- Each intervention record holds: an id, a scenario id, a sequence number,
  a target table, a target unit id or geometry, a kind (`attribute` or
  `existence`), a payload of changed values, and a timestamp.
- The layer can produce a _resolved view_ — the baseline with all
  interventions of a scenario applied, in sequence order.
- The layer can produce a _diff_ — which units differ from the baseline,
  and how.
- Interventions can be undone and redone by sequence number.
- A scenario can be exported and imported as JSON.

Use DuckDB views for the resolved state where possible. Do not copy whole
tables per scenario.

Deliver with tests that prove: apply, undo, redo, resolve, and diff all
work on both intervention kinds.

## Stage 2 — Module contract

Define one interface that every module implements:

```
describe() -> {
  id, name,
  unitTables: [...],          // which tables it reads
  acceptedInterventions: [...], // kind + target table + allowed fields
  measure: { name, unit, betterIsLowerOrHigher }
}

evaluate(resolvedState) -> {
  perUnit: [{ unitId, value }],
  headline: { value, label }
}
```

Rules:

- A module never writes to the state layer. It reads resolved state and
  returns a measure.
- A module never touches the DOM or the map.
- The shell calls `describe()` to build the intervention UI. The UI is
  generated from the module's declaration, not hand-written per module.
- A module may run synchronously, in a web worker, or via WASM. The shell
  must not care which. Treat `evaluate` as asynchronous always.

Deliver a trivial reference module for testing only — for example, one that
counts units and returns the count as the headline. Its purpose is to prove
the contract works. Do not give it any real analytical meaning.

## Stage 3 — Spatial selection

One selection tool that serves every module.

- Click a unit, draw a box, draw a polygon, or select by an existing filter.
- Returns a set of unit ids, or a point/geometry for existence
  interventions.
- The tool asks the active module (via `describe()`) which tables are
  selectable, and restricts selection to those.

## Stage 4 — Intervention UI

Generated from `describe()`. When the analyst has a selection:

- Show the intervention kinds the module accepts for those units.
- For an attribute intervention, show the allowed fields and let the
  analyst set new values.
- For an existence intervention, let the analyst place or remove a unit and
  set its required attributes.
- On confirm, write an intervention record. Do not call the module directly
  from the UI.

## Stage 5 — Loop and comparison view

Wire the full loop: filter, prioritise, intervene, evaluate, refine.

- After any state change, re-run `evaluate()` on the active scenario.
- Show the headline number for baseline and current scenario, side by side,
  with the change between them.
- Colour the map by the per-unit measure. Offer a toggle between absolute
  value and change from baseline.
- Show the intervention history as an ordered list. Each entry can be
  undone, and each entry shows the headline number at that point.
- Support at least two scenarios open for comparison.

## Acceptance criteria

The shell is done when all of these hold:

1. Swapping the active module changes nothing in the loop code, the
   selection tool, or the comparison view.
2. No file outside a module directory names any algorithm or engine.
3. The intervention UI is generated from `describe()`, with no per-module
   special cases.
4. Applying, undoing, and re-applying interventions returns identical
   measures every time.
5. The baseline tables are byte-identical before and after a session.
6. A scenario exported as JSON, re-imported, and re-evaluated gives the
   same result.

## Report at the end

Give a short design note covering: the state layer schema, the module
interface as implemented, any place where the shell had to know something
engine-specific, and why. That last point matters most — record it even if
it looks like a small compromise.
