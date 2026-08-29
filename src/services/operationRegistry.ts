import { operationManifestErrors, parameterOptionValues } from '../types/operations';
import type {
  OperationChange,
  OperationChangeSpec,
  OperationInputBinding,
  OperationInputSpec,
  OperationManifest,
  OperationProvider,
} from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';

/**
 * The open registry of calculation providers.
 *
 * Deliberately a mutable module-level map rather than store state. A provider is
 * code, not project data — it does not travel in the manifest, it is not undone,
 * and a project that references one which is not registered has to say so rather
 * than silently resurrect it. That last case is the whole reason the registry
 * exists as a lookup with a miss: an open ecosystem means opening a project
 * whose provider you do not have is normal, not corrupt.
 *
 * Manifest validation is no longer here. It lives in `@alur/operation-contract`
 * so a plugin author runs exactly the checks ALUR runs, before serving anything.
 */

const providers = new Map<string, OperationProvider>();

export { operationManifestErrors };

export class OperationRegistrationError extends Error {}

export const registerOperationProvider = (provider: OperationProvider) => {
  const errors = operationManifestErrors(provider.manifest);
  if (errors.length) {
    throw new OperationRegistrationError(`Provider "${provider.manifest.id}" is not valid. ${errors[0]}`);
  }
  if (providers.has(provider.manifest.id)) {
    throw new OperationRegistrationError(`Provider "${provider.manifest.id}" is already registered.`);
  }
  providers.set(provider.manifest.id, provider);
  return provider;
};

export const unregisterOperationProvider = (id: string) => providers.delete(id);

export const getOperationProvider = (id: string) => providers.get(id) ?? null;

export const operationProviders = () => [...providers.values()];

export const operationManifests = () => operationProviders().map((provider) => provider.manifest);

/** Providers offering at least one change, i.e. those that can be intervened on. */
export const providersAcceptingChanges = () =>
  operationProviders().filter((provider) => provider.manifest.accepts.length > 0);

/**
 * Whether one bound dataset satisfies what an input declared.
 *
 * Pulled out because an input may now bind several, and each is checked on its
 * own terms: two datasets can carry the same roles under entirely different
 * column names, which is the point of binding by role rather than by name.
 */
const sourceErrors = (
  input: OperationInputSpec,
  source: { datasetId: string; fields: Record<string, string> },
  datasets: Record<string, DatasetDescriptor>,
): string[] => {
  const errors: string[] = [];
  const dataset = datasets[source.datasetId];
  if (!dataset) {
    errors.push(`${input.label} names a dataset that is no longer loaded.`);
    return errors;
  }

  if (input.geometry !== 'none' && !dataset.spatial) {
    errors.push(`${input.label}: "${dataset.name}" has no geometry.`);
  }
  if (
    input.geometry !== 'none' &&
    input.geometry !== 'any' &&
    dataset.geometryKind &&
    dataset.geometryKind !== input.geometry
  ) {
    errors.push(`${input.label} needs ${input.geometry} geometry; "${dataset.name}" is ${dataset.geometryKind}.`);
  }

  const columns = new Set(dataset.fields.map((field) => field.name));
  for (const role of input.fields) {
    const column = source.fields[role.id];
    if (!column) {
      if (role.required) errors.push(`${input.label}: choose a column in "${dataset.name}" for ${role.label}.`);
      continue;
    }
    if (!columns.has(column)) {
      errors.push(`${input.label}: "${dataset.name}" has no column "${column}" for ${role.label}.`);
    }
  }
  return errors;
};

/**
 * Whether a binding satisfies what an input declared.
 *
 * Separated from manifest validation because it fails for a different reason and
 * at a different time: a manifest is wrong when it is written, a binding is
 * incomplete while the analyst is still filling it in. The node stays unrunnable
 * and says why, rather than erroring on execute.
 */
export const operationBindingErrors = (
  manifest: OperationManifest,
  bindings: OperationInputBinding[],
  datasets: Record<string, DatasetDescriptor>,
): string[] => {
  const errors: string[] = [];

  for (const input of manifest.inputs) {
    const binding = bindings.find((candidate) => candidate.inputId === input.id);
    // An empty source list is a binding the analyst has not filled in yet, not a
    // reference to something missing. The panel seeds one entry per input the
    // moment a provider loads, so without this every fresh provider would open
    // claiming its data had been deleted.
    const sources = (binding?.sources ?? []).filter((source) => source.datasetId);
    if (!sources.length) {
      errors.push(`${input.label} needs a dataset.`);
      continue;
    }
    if (sources.length > 1 && !input.multiple) {
      errors.push(`${input.label} takes one dataset, but ${sources.length} are bound.`);
      continue;
    }

    // Every source is checked in full rather than stopping at the first bad one:
    // an analyst who added a drawn layer to an input wants to know which of the
    // two is wrong, and "one of your datasets is wrong" does not say.
    for (const source of sources) {
      errors.push(...sourceErrors(input, source, datasets));
    }
  }

  return errors;
};

/** Whether one recorded change is well-formed against the spec it instantiates. */
export const operationChangeErrors = (spec: OperationChangeSpec, change: OperationChange): string[] => {
  const errors: string[] = [];

  if (spec.referent === 'rows') {
    if (change.target.kind !== 'rows') errors.push(`${spec.label} applies to selected rows.`);
    else if (!change.target.rowIds.length) errors.push(`${spec.label} needs at least one selected row.`);
  } else if (change.target.kind !== 'geometry') {
    errors.push(`${spec.label} applies to a location.`);
  } else if (spec.referent === 'point' && change.target.geometry.type !== 'Point') {
    errors.push(`${spec.label} applies to a point.`);
  }

  for (const parameter of spec.parameters) {
    const value = change.values[parameter.id];
    const missing = value === undefined || value === '' || value === null;
    if (missing && parameter.defaultValue === undefined) {
      errors.push(`${spec.label} needs a value for ${parameter.label}.`);
      continue;
    }
    if (missing) continue;
    if (parameter.type === 'number' && !Number.isFinite(Number(value))) {
      errors.push(`${parameter.label} must be a number.`);
    }
    if (parameter.type === 'choice') {
      const permitted = parameterOptionValues(parameter);
      if (!permitted.includes(String(value))) {
        errors.push(`${parameter.label} must be one of ${permitted.join(', ')}.`);
      }
    }
  }

  return errors;
};
