// Drives the contract the way ALUR's worker host does, before any of it is
// served. Run it from this directory:
//
//   node verify.mjs
//
// The point is not that the arithmetic is right — it is that the *contract* is
// honoured: the manifest is well formed, the lifecycle works, replaying a change
// list reproduces its result, and missing values come back as null.

import { visitOrder, providers } from "./index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = JSON.parse(readFileSync(join(here, "alur.plugin.json"), "utf8"));

const check = (label, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

/** Four stops in a line, one degree of longitude apart, given out of order. */
const collection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { code: "a" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3, 0] }, properties: { code: "d" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 0] }, properties: { code: "b" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [2, 0] }, properties: { code: "c" } },
    { type: "Feature", geometry: null, properties: { code: "nowhere" } },
  ],
};

const inputs = [{ inputId: "stops", fields: { id: "code" }, geojson: JSON.stringify(collection) }];

const startAt = (code, sequence = 0) => ({
  id: `op-${sequence}`,
  changeId: "start-here",
  sequence,
  target: { kind: "rows", datasetId: "stops", rowIds: [code] },
  values: {},
});

const run = async (changes = [], parameters = {}) => {
  const instance = await visitOrder.create({ inputs, parameters });
  await instance.setChanges(changes);
  const result = await instance.evaluate();
  instance.dispose();
  return result;
};

/** Routed stops only, keyed in a stable order so two runs compare cleanly. */
const orderOf = (result) =>
  result.outputs.route.rows
    .filter((row) => row.visit_order !== null)
    .sort((a, b) => a.visit_order - b.visit_order)
    .map((row) => row.key)
    .join(' → ');

// --- what the package says about itself -------------------------------------

check(
  "the package lists exactly what the entry exports",
  JSON.stringify(plugin.calculations.map((c) => c.id)) ===
    JSON.stringify(providers.map((p) => p.manifest.id)),
);
check("the manifest survives structuredClone", (() => {
  try { structuredClone(visitOrder.manifest); return true; } catch { return false; }
})());

// --- the calculation ---------------------------------------------------------

const baseline = await run();
console.log(`\nbaseline order: ${JSON.stringify(orderOf(baseline))}`);
for (const warning of baseline.warnings ?? []) console.log(`  warning: ${warning}`);

check("every stop has a row", baseline.outputs.route.rows.length === collection.features.length);
check("rows are keyed with strings", baseline.outputs.route.rows.every((r) => typeof r.key === "string"));
check("it walks the line in order", orderOf(baseline) === 'a → b → c → d');
check("the first leg is null, not zero", baseline.outputs.route.rows.find((r) => r.key === "a").leg_km === null);
check("a stop with no geometry reports null", baseline.outputs.route.rows.find((r) => r.key === "nowhere").visit_order === null);
check("a stop with no geometry is reported", (baseline.warnings ?? []).some((w) => w.includes("no usable geometry")));

// --- what the analyst can assert --------------------------------------------

const fromD = await run([startAt("d")]);
console.log(`starting at d:  ${orderOf(fromD)}`);
check("starting elsewhere reverses the walk", orderOf(fromD) === 'd → c → b → a');

const changedMind = await run([startAt("d", 0), startAt("b", 1)]);
check("the last record about the start wins", orderOf(changedMind).startsWith('b'));

// --- the property the contract rests on --------------------------------------

const replayed = await run();
check("replaying the empty list reproduces the baseline exactly",
  JSON.stringify(replayed.outputs.route.rows) === JSON.stringify(baseline.outputs.route.rows));

const replayedStart = await run([startAt("d")]);
check("replaying a change reproduces its result exactly",
  JSON.stringify(replayedStart.outputs.route.rows) === JSON.stringify(fromD.outputs.route.rows));

// --- settings are a separate channel ----------------------------------------

const looped = await run([], { returnToStart: "yes" });
const total = (r) => r.outputs.route.rows.reduce((sum, row) => sum + (row.leg_km ?? 0), 0);
check("a setting changes the answer without touching the change list",
  total(looped) === total(baseline) && (looped.warnings ?? []).some((w) => w.includes("return leg")));

console.log(process.exitCode ? "\nsomething failed" : "\nall checks passed");
