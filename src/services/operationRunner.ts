import type {
  OperationChange,
  OperationInputBinding,
  OperationInputData,
  OperationInputSpec,
  OperationManifest,
  OperationOutputData,
  OperationOutputSpec,
  OperationRunResult,
} from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';
import type { VariantOperation } from '../types/visualAnalytics';
import { duckdbService } from './duckdb';
import { relationForDataset } from './datasetService';
import { ingestFile } from './dataIngestion';
import { operationHost } from './operationHost';
import { toOperationChanges } from '../utils/operationRecords';
import { safeFilename } from '../utils/download';

/**
 * Moves data between DuckDB and a provider, and puts what comes back on the
 * same footing as everything else.
 *
 * Every result — a value per unit or geometry the calculation invented — becomes
 * a GeoJSON FeatureCollection and goes in through `ingestFile`, which is the
 * route drawn layers already take. That inherits geometry conversion, CRS
 * detection, the dataset registry entry, the map layer and the source cache, and
 * more importantly means nothing downstream has to be taught that providers
 * exist. Charts, filters, cohorts, comparison and the DAG all work on a
 * provider's output because they cannot tell it apart from loaded data.
 */

/**
 * How many features are read out of a table to hand to a provider.
 *
 * This is the one number in the shell chosen without knowing what the
 * calculation does, and it was flagged as a compromise before any provider
 * existed. It is deliberately generous — a road network is hundreds of thousands
 * of segments and a cap that quietly halved it would produce a plausible,
 * wrong answer — and truncation is always reported rather than absorbed.
 */
export const DEFAULT_FEATURE_CAP = 1_000_000;

export type OperationRunOptions = {
  featureCap?: number;
  /** Names the datasets produced; defaults to the provider's label. */
  runLabel?: string;
};

export type OperationRunReport = {
  /** Dataset ids and table names created, one per emitted output. */
  created: Array<{ outputId: string; label: string; tableName: string; layerId: string | null }>;
  warnings: string[];
};

const featuresOf = (collection: GeoJSON.FeatureCollection | null) => collection?.features ?? [];

/**
 * The property name a role's values are written to, whatever the source called
 * them.
 *
 * Prefixed so it cannot collide with a column the analyst's data already has —
 * `id` and `cost` are common enough that an unprefixed name would sometimes
 * overwrite real data, and the overwrite would look like a provider bug.
 */
export const canonicalRoleProperty = (roleId: string) => `__alur_role_${roleId}`;

/**
 * Copy a feature's bound columns onto canonical names, keeping everything else.
 *
 * This is what lets several datasets feed one input. Each names its own columns
 * for the same roles; after projection every feature carries the role values
 * under one agreed name, so the provider reads `properties[fields.cost]` and
 * neither knows nor cares which dataset the row came from. Original properties
 * survive untouched, so a provider that wants to look at an unbound column
 * still can.
 */
export const projectFeature = (
  feature: GeoJSON.Feature,
  fields: Record<string, string>,
  sourceLabel: string,
): GeoJSON.Feature => {
  const properties: Record<string, unknown> = { ...(feature.properties ?? {}) };
  for (const [roleId, column] of Object.entries(fields)) {
    if (!column) continue;
    properties[canonicalRoleProperty(roleId)] = properties[column] ?? null;
  }
  properties.__alur_source = sourceLabel;
  return { ...feature, properties };
};

/** Role id to the canonical property carrying it, for every bound role. */
const canonicalFields = (spec: OperationInputSpec, binding: OperationInputBinding) => {
  const bound = new Set<string>();
  for (const source of binding.sources) {
    for (const [roleId, column] of Object.entries(source.fields)) if (column) bound.add(roleId);
  }
  return Object.fromEntries([...bound].map((roleId) => [roleId, canonicalRoleProperty(roleId)]));
};

/**
 * Read one bound input out of DuckDB in the shape its declaration asked for.
 *
 * Spatial inputs travel as GeoJSON text rather than parsed objects: every
 * provider seen so far parses it itself (the wasm boundary takes a string
 * anyway), and stringifying once here is cheaper than handing over an object
 * graph that `postMessage` would clone.
 *
 * The cap is shared across an input's sources rather than applied per source, so
 * binding a second dataset cannot quietly double how much is read.
 */
export const collectInput = async (
  manifest: OperationManifest,
  binding: OperationInputBinding,
  datasets: Record<string, DatasetDescriptor>,
  featureCap: number,
): Promise<{ input: OperationInputData; collection: GeoJSON.FeatureCollection | null; warnings: string[] }> => {
  const spec = manifest.inputs.find((candidate) => candidate.id === binding.inputId);
  if (!spec) throw new Error(`"${binding.inputId}" is not an input of ${manifest.label}.`);

  const sources = binding.sources.filter((source) => source.datasetId);
  if (!sources.length) throw new Error(`${spec.label} has no dataset bound.`);
  if (sources.length > 1 && !spec.multiple) {
    throw new Error(`${spec.label} takes one dataset, but ${sources.length} are bound.`);
  }

  const fields = canonicalFields(spec, binding);
  const warnings: string[] = [];
  const used: OperationInputData['sources'] = [];
  let remaining = featureCap;

  if (spec.geometry === 'none') {
    const rows: Array<Record<string, unknown>> = [];
    for (const source of sources) {
      const dataset = datasets[source.datasetId];
      if (!dataset) throw new Error(`${spec.label} is bound to a dataset that is no longer loaded.`);
      const relation = relationForDataset(dataset) ?? dataset.originTableName;
      if (!relation) throw new Error(`${spec.label} is bound to a dataset with no readable table.`);
      if (remaining <= 0) {
        warnings.push(`${spec.label}: "${dataset.name}" was not read; the ${featureCap} row cap was already reached.`);
        continue;
      }

      const result = await duckdbService.query(
        `SELECT * FROM "${relation.replace(/"/g, '""')}" LIMIT ${remaining};`,
      );
      const read = result.toArray().map((row: any) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));
      for (const row of read) {
        const projected: Record<string, unknown> = { ...row };
        for (const [roleId, column] of Object.entries(source.fields)) {
          if (column) projected[canonicalRoleProperty(roleId)] = row[column] ?? null;
        }
        projected.__alur_source = dataset.name;
        rows.push(projected);
      }
      used.push({ datasetId: dataset.id, label: dataset.name, count: read.length });
      remaining -= read.length;
    }

    if (remaining <= 0) warnings.push(`${spec.label} was truncated at ${featureCap} rows.`);
    return { input: { inputId: binding.inputId, fields, rows, sources: used }, collection: null, warnings };
  }

  const features: GeoJSON.Feature[] = [];
  for (const source of sources) {
    const dataset = datasets[source.datasetId];
    if (!dataset) throw new Error(`${spec.label} is bound to a dataset that is no longer loaded.`);
    const relation = relationForDataset(dataset) ?? dataset.originTableName;
    if (!relation) throw new Error(`${spec.label} is bound to a dataset with no readable table.`);
    if (remaining <= 0) {
      warnings.push(`${spec.label}: "${dataset.name}" was not read; the ${featureCap} feature cap was already reached.`);
      continue;
    }

    // Reprojected to WGS84 on the way out. A provider is handed GeoJSON, GeoJSON
    // is WGS84 by definition, and a plugin measuring distance has no way to
    // discover that the numbers it was given are projected metres — it just
    // returns a wrong answer confidently.
    const collection = await duckdbService.getGeoJSONFromTable(relation, remaining, dataset.geometryCrs);
    if (!collection || !collection.features.length) {
      throw new Error(`${spec.label} ("${dataset.name}") returned no geometry.`);
    }
    for (const feature of collection.features) features.push(projectFeature(feature, source.fields, dataset.name));
    used.push({ datasetId: dataset.id, label: dataset.name, count: collection.features.length });
    remaining -= collection.features.length;
  }

  if (remaining <= 0) {
    warnings.push(`${spec.label} was truncated at ${featureCap} features, so the result is partial.`);
  }

  const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  return {
    input: { inputId: binding.inputId, fields, geojson: JSON.stringify(collection), sources: used },
    collection,
    warnings,
  };
};

/**
 * Which bound column a join output's `key` values correspond to.
 *
 * The manifest may say outright. Where it does not, the input's first required
 * identifier role is the only sensible reading, and a provider with no such role
 * cannot be joined at all — which is worth an error rather than an empty join.
 */
export const joinColumnFor = (
  manifest: OperationManifest,
  output: OperationOutputSpec,
  bindings: OperationInputBinding[],
): string => {
  const input = manifest.inputs.find((candidate) => candidate.id === output.joinInputId);
  if (!input) throw new Error(`Output "${output.id}" joins to an input that is not declared.`);

  const role = output.joinFieldRole
    ? input.fields.find((field) => field.id === output.joinFieldRole)
    : input.fields.find((field) => field.required && field.semanticType === 'identifier');
  if (!role) throw new Error(`Output "${output.id}" joins to "${input.label}", which declares no identifier to join on.`);

  // The canonical property, not the analyst's column: the collection this joins
  // onto is the projected one, and with several datasets bound there is no
  // single original column name to use.
  const binding = bindings.find((candidate) => candidate.inputId === input.id);
  const bound = binding?.sources.some((source) => source.fields[role.id]);
  if (!bound) throw new Error(`Output "${output.id}" needs ${role.label} bound on ${input.label}.`);
  return canonicalRoleProperty(role.id);
};

/**
 * The canonical property a `rows` change's ids are expressed in.
 *
 * The gap this closes: a row target carries the dataset's own row-id column, and
 * a provider had no declared way to know which column that was. `targetFieldRole`
 * says it; where a spec omits it, the input's first required identifier is the
 * only sensible reading.
 */
export const targetColumnFor = (
  manifest: OperationManifest,
  changeId: string,
): string | null => {
  const spec = manifest.accepts.find((candidate) => candidate.id === changeId);
  if (!spec || spec.referent !== 'rows') return null;
  const input = manifest.inputs.find((candidate) => candidate.id === spec.inputId);
  if (!input) return null;
  const role = spec.targetFieldRole
    ? input.fields.find((field) => field.id === spec.targetFieldRole)
    : input.fields.find((field) => field.required && field.semanticType === 'identifier');
  return role ? canonicalRoleProperty(role.id) : null;
};

/**
 * Merge a provider's per-unit values onto the geometry they belong to.
 *
 * Done against the collection already read for the provider rather than by a
 * fresh SQL join, because the shell is holding it anyway and a second read would
 * be a second chance for the two to disagree. Features the provider returned no
 * row for keep their properties and gain nothing — a missing value is a real
 * answer and must not become a zero.
 */
export const mergeJoinOutput = (
  collection: GeoJSON.FeatureCollection,
  rows: Array<Record<string, unknown>>,
  joinColumn: string,
  fields: Array<{ name: string }>,
): { collection: GeoJSON.FeatureCollection; matched: number } => {
  const byKey = new Map(rows.map((row) => [String(row.key), row]));
  let matched = 0;

  const features = collection.features.map((feature) => {
    const key = String(feature.properties?.[joinColumn]);
    const row = byKey.get(key);
    if (row) matched += 1;
    const added: Record<string, unknown> = {};
    for (const field of fields) added[field.name] = row ? row[field.name] ?? null : null;
    return { ...feature, properties: { ...feature.properties, ...added } };
  });

  return { collection: { type: 'FeatureCollection', features }, matched };
};

const ingestCollection = async (collection: GeoJSON.FeatureCollection, name: string) => {
  const file = new File([JSON.stringify(collection)], `${safeFilename(name, 'operation-output')}.geojson`, {
    type: 'application/geo+json',
  });
  // `sourceKind: 'clipboard'` for the same reason drawn layers use it: the bytes
  // were generated in the browser and there is no file or URL to point back at.
  // `generated` says the same thing to the size guard, which is there to bound
  // parsing documents from outside — a result computed from rows DuckDB already
  // holds is not one, and 25,000 features of real data comfortably exceeds it.
  return ingestFile(file, { sourceKind: 'clipboard', generated: true });
};

/**
 * Turn what a provider returned into datasets.
 *
 * Kept separate from running so a caller can inspect a result before committing
 * it, and so the merging can be tested without DuckDB.
 */
export const materialiseOutputs = async (
  manifest: OperationManifest,
  result: OperationRunResult,
  bindings: OperationInputBinding[],
  collections: Record<string, GeoJSON.FeatureCollection | null>,
  runLabel: string,
): Promise<OperationRunReport> => {
  const report: OperationRunReport = { created: [], warnings: [...(result.warnings ?? [])] };

  for (const spec of manifest.outputs) {
    const output: OperationOutputData | undefined = result.outputs[spec.id];
    if (!output) {
      report.warnings.push(`${manifest.label} declared "${spec.label}" but returned nothing for it.`);
      continue;
    }

    let collection: GeoJSON.FeatureCollection;

    if (output.kind === 'dataset') {
      if (!output.geojson.features.length) {
        report.warnings.push(`${spec.label} came back empty.`);
        continue;
      }
      collection = output.geojson;
    } else {
      const source = collections[spec.joinInputId ?? ''];
      if (!source) {
        report.warnings.push(`${spec.label} could not be joined: its input carried no geometry.`);
        continue;
      }
      const joinColumn = joinColumnFor(manifest, spec, bindings);
      const merged = mergeJoinOutput(source, output.rows, joinColumn, spec.fields);
      collection = merged.collection;

      if (!merged.matched) {
        report.warnings.push(
          `${spec.label} matched none of the ${featuresOf(source).length} features on "${joinColumn}". Check which column is bound as the identifier.`,
        );
      } else if (merged.matched < featuresOf(source).length) {
        report.warnings.push(`${spec.label} matched ${merged.matched} of ${featuresOf(source).length} features.`);
      }
    }

    const name = `${runLabel} · ${spec.label}`;
    const ingested = await ingestCollection(collection, name);
    if (!ingested) {
      report.warnings.push(`${spec.label} could not be loaded as a dataset.`);
      continue;
    }
    report.created.push({ outputId: spec.id, label: name, ...ingested });
  }

  return report;
};

/**
 * Re-express row targets in the values the provider will actually see.
 *
 * A `rows` target carries the *dataset's* row-id column, which is rarely the
 * column bound to the role a provider keys on — and a provider had no declared
 * way to find out which. Rather than making every adapter guess, the shell
 * translates: it is holding both the collection and the dataset descriptor, so
 * it is the only place that can do this without guessing at all.
 *
 * Ids that match nothing are dropped and reported. Silently passing them through
 * would leave a provider matching against a column it was never told about,
 * which is exactly the failure this replaces.
 */
export const resolveRowTargets = (
  manifest: OperationManifest,
  changes: OperationChange[],
  collections: Record<string, GeoJSON.FeatureCollection | null>,
  datasets: Record<string, DatasetDescriptor>,
): { changes: OperationChange[]; warnings: string[] } => {
  const warnings: string[] = [];

  const resolved = changes.map((change) => {
    if (change.target.kind !== 'rows') return change;

    const spec = manifest.accepts.find((candidate) => candidate.id === change.changeId);
    const targetColumn = targetColumnFor(manifest, change.changeId);
    const collection = spec ? collections[spec.inputId] : null;
    const dataset = datasets[change.target.datasetId];
    if (!spec || !targetColumn || !collection || !dataset) return change;

    const rowIdColumn = dataset.rowIdColumn;
    const lookup = new Map<string, string>();
    for (const feature of collection.features) {
      const properties = feature.properties ?? {};
      // Scoped to the dataset the change names: with several datasets bound, the
      // same row-id value can legitimately appear in more than one of them.
      if (properties.__alur_source !== dataset.name) continue;
      const from = properties[rowIdColumn];
      const to = properties[targetColumn];
      if (from === null || from === undefined || to === null || to === undefined) continue;
      if (!lookup.has(String(from))) lookup.set(String(from), String(to));
    }

    // Nothing to translate — the role is already the row id column.
    if (!lookup.size) return change;

    const rowIds: string[] = [];
    let missing = 0;
    for (const rowId of change.target.rowIds) {
      const mapped = lookup.get(String(rowId));
      if (mapped === undefined) missing += 1;
      else rowIds.push(mapped);
    }
    if (missing) {
      warnings.push(
        `${spec.label}: ${missing} of ${change.target.rowIds.length} selected rows are no longer in "${dataset.name}" and were dropped.`,
      );
    }

    return { ...change, target: { ...change.target, rowIds } };
  });

  return { changes: resolved, warnings };
};

export type OperationRunRequest = {
  /**
   * Where to load the calculation from, or empty for one compiled into the app.
   *
   * A bundled calculation is already registered in the host, so there is nothing
   * to fetch. It is the same instruction either way — "make sure this is
   * loaded" — which is why this is an empty string rather than a second code
   * path through the runner.
   */
  providerUrl: string;
  manifest: OperationManifest;
  bindings: OperationInputBinding[];
  datasets: Record<string, DatasetDescriptor>;
  parameters: Record<string, unknown>;
  operations: VariantOperation[];
};

/**
 * One complete pass: read the inputs, load the provider, apply what the analyst
 * asserted, evaluate, and register the results.
 *
 * The instance is disposed at the end rather than kept. That throws away the
 * lifecycle's whole advantage and is the right default only because nothing yet
 * holds a session open across edits — see the note in the panel. Keeping it
 * would be the next real improvement, not a refactor of this function.
 */
export const runOperation = async (
  request: OperationRunRequest,
  options: OperationRunOptions = {},
): Promise<OperationRunReport> => {
  const featureCap = options.featureCap ?? DEFAULT_FEATURE_CAP;
  const inputs: OperationInputData[] = [];
  const collections: Record<string, GeoJSON.FeatureCollection | null> = {};
  const warnings: string[] = [];

  for (const binding of request.bindings) {
    const collected = await collectInput(request.manifest, binding, request.datasets, featureCap);
    inputs.push(collected.input);
    collections[binding.inputId] = collected.collection;
    warnings.push(...collected.warnings);
  }

  if (request.providerUrl) await operationHost.load(request.providerUrl);
  const handle = await operationHost.create(request.manifest.id, inputs, request.parameters);

  try {
    const targeted = resolveRowTargets(
      request.manifest,
      toOperationChanges(request.operations, request.manifest.id),
      collections,
      request.datasets,
    );
    warnings.push(...targeted.warnings);
    await operationHost.setChanges(handle, targeted.changes);
    const result = await operationHost.evaluate(handle);
    const report = await materialiseOutputs(
      request.manifest,
      result,
      request.bindings,
      collections,
      options.runLabel ?? request.manifest.label,
    );
    return { ...report, warnings: [...warnings, ...report.warnings] };
  } finally {
    await operationHost.dispose(handle).catch(() => undefined);
  }
};
