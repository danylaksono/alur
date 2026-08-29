import type {
  OperationInputBinding,
  OperationInputData,
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
 * Read one bound input out of DuckDB in the shape its declaration asked for.
 *
 * Spatial inputs travel as GeoJSON text rather than parsed objects: every
 * provider seen so far parses it itself (the wasm boundary takes a string
 * anyway), and stringifying once here is cheaper than handing over an object
 * graph that `postMessage` would clone.
 */
export const collectInput = async (
  manifest: OperationManifest,
  binding: OperationInputBinding,
  dataset: DatasetDescriptor,
  featureCap: number,
): Promise<{ input: OperationInputData; collection: GeoJSON.FeatureCollection | null; warning?: string }> => {
  const spec = manifest.inputs.find((candidate) => candidate.id === binding.inputId);
  if (!spec) throw new Error(`"${binding.inputId}" is not an input of ${manifest.label}.`);

  const relation = relationForDataset(dataset) ?? dataset.originTableName;
  if (!relation) throw new Error(`${spec.label} is bound to a dataset with no readable table.`);

  if (spec.geometry === 'none') {
    const result = await duckdbService.query(`SELECT * FROM "${relation.replace(/"/g, '""')}" LIMIT ${featureCap};`);
    const rows = result.toArray().map((row: any) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));
    return {
      input: { inputId: binding.inputId, fields: binding.fields, rows },
      collection: null,
      warning: rows.length >= featureCap ? `${spec.label} was truncated at ${featureCap} rows.` : undefined,
    };
  }

  const collection = await duckdbService.getGeoJSONFromTable(relation, featureCap);
  if (!collection || !collection.features.length) {
    throw new Error(`${spec.label} ("${dataset.name}") returned no geometry.`);
  }

  return {
    input: { inputId: binding.inputId, fields: binding.fields, geojson: JSON.stringify(collection) },
    collection,
    warning: collection.features.length >= featureCap
      ? `${spec.label} was truncated at ${featureCap} features, so the result is partial.`
      : undefined,
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

  const binding = bindings.find((candidate) => candidate.inputId === input.id);
  const column = binding?.fields[role.id];
  if (!column) throw new Error(`Output "${output.id}" needs ${role.label} bound on ${input.label}.`);
  return column;
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
  return ingestFile(file, { sourceKind: 'clipboard' });
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

export type OperationRunRequest = {
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
    const dataset = request.datasets[binding.datasetId];
    if (!dataset) throw new Error(`A bound dataset is no longer loaded.`);
    const collected = await collectInput(request.manifest, binding, dataset, featureCap);
    inputs.push(collected.input);
    collections[binding.inputId] = collected.collection;
    if (collected.warning) warnings.push(collected.warning);
  }

  await operationHost.load(request.providerUrl);
  const handle = await operationHost.create(request.manifest.id, inputs, request.parameters);

  try {
    await operationHost.setChanges(handle, toOperationChanges(request.operations, request.manifest.id));
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
