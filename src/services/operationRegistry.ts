import type {
  OperationChange,
  OperationChangeSpec,
  OperationInputBinding,
  OperationManifest,
  OperationProvider,
} from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';
import type { FragmentParameter } from '../utils/workflowFragments';

/**
 * The open registry of calculation providers.
 *
 * Deliberately a mutable module-level map rather than store state. A provider is
 * code, not project data — it does not travel in the manifest, it is not undone,
 * and a project that references one which is not registered has to say so rather
 * than silently resurrect it. That last case is the whole reason the registry
 * exists as a lookup with a miss: an open ecosystem means opening a project
 * whose provider you do not have is normal, not corrupt.
 */

const providers = new Map<string, OperationProvider>();

const ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

const duplicates = (values: string[]) => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
};

const parameterErrors = (parameters: FragmentParameter[], where: string) => {
  const errors: string[] = [];
  for (const parameter of parameters) {
    if (!parameter.id) errors.push(`${where}: a parameter is missing an id.`);
    if (parameter.type === 'choice' && !parameter.options?.length) {
      errors.push(`${where}: choice parameter "${parameter.id}" declares no options.`);
    }
  }
  for (const id of duplicates(parameters.map((parameter) => parameter.id))) {
    errors.push(`${where}: parameter id "${id}" is declared twice.`);
  }
  return errors;
};

/**
 * Every way a manifest can be wrong, reported together.
 *
 * Checked rather than trusted because a provider may arrive from outside this
 * repository. The referential checks are the ones that matter: a change naming
 * an input that does not exist, or a measure naming a field no output emits,
 * produces an interface ALUR cannot generate, and the failure would otherwise
 * surface as an empty form the analyst cannot act on.
 */
export const operationManifestErrors = (manifest: OperationManifest): string[] => {
  const errors: string[] = [];

  if (!ID_PATTERN.test(manifest.id || '')) {
    errors.push(`Provider id "${manifest.id}" must be lower-case, dot- or dash-separated.`);
  }
  if (!manifest.label?.trim()) errors.push('A provider needs a label.');
  if (!manifest.version?.trim()) errors.push('A provider needs a version.');
  if (!manifest.inputs.length) errors.push('A provider needs at least one input.');
  if (!manifest.outputs.length) errors.push('A provider needs at least one output.');

  for (const id of duplicates(manifest.inputs.map((input) => input.id))) {
    errors.push(`Input id "${id}" is declared twice.`);
  }
  for (const id of duplicates(manifest.outputs.map((output) => output.id))) {
    errors.push(`Output id "${id}" is declared twice.`);
  }
  for (const id of duplicates(manifest.accepts.map((change) => change.id))) {
    errors.push(`Change id "${id}" is declared twice.`);
  }

  errors.push(...parameterErrors(manifest.parameters, 'Provider parameters'));

  const inputIds = new Set(manifest.inputs.map((input) => input.id));
  for (const input of manifest.inputs) {
    for (const id of duplicates(input.fields.map((field) => field.id))) {
      errors.push(`Input "${input.id}": field role "${id}" is declared twice.`);
    }
  }

  for (const change of manifest.accepts) {
    if (!inputIds.has(change.inputId)) {
      errors.push(`Change "${change.id}" names input "${change.inputId}", which is not declared.`);
    }
    errors.push(...parameterErrors(change.parameters, `Change "${change.id}"`));
  }

  for (const output of manifest.outputs) {
    if (output.kind === 'join' && !output.joinInputId) {
      errors.push(`Output "${output.id}" joins, but names no input to join to.`);
    }
    if (output.kind === 'join' && output.joinInputId && !inputIds.has(output.joinInputId)) {
      errors.push(`Output "${output.id}" joins to input "${output.joinInputId}", which is not declared.`);
    }
    if (output.kind === 'dataset' && output.joinInputId) {
      errors.push(`Output "${output.id}" is a new dataset but also names a join input.`);
    }
  }

  if (manifest.measure) {
    const output = manifest.outputs.find((candidate) => candidate.id === manifest.measure!.outputId);
    if (!output) {
      errors.push(`The measure names output "${manifest.measure.outputId}", which is not declared.`);
    } else if (!output.fields.some((field) => field.name === manifest.measure!.field)) {
      errors.push(`The measure names field "${manifest.measure.field}", which output "${output.id}" does not emit.`);
    }
  }

  return errors;
};

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
    // An empty `datasetId` is a binding the analyst has not filled in yet, not a
    // reference to something missing. The panel seeds one entry per input the
    // moment a provider loads, so without this every fresh provider would open
    // claiming its data had been deleted.
    if (!binding || !binding.datasetId) {
      errors.push(`${input.label} needs a dataset.`);
      continue;
    }

    const dataset = datasets[binding.datasetId];
    if (!dataset) {
      errors.push(`${input.label} names a dataset that is no longer loaded.`);
      continue;
    }
    if (input.geometry !== 'none' && !dataset.spatial) {
      errors.push(`${input.label} needs a dataset with geometry.`);
    }
    if (input.geometry !== 'none' && input.geometry !== 'any' && dataset.geometryKind && dataset.geometryKind !== input.geometry) {
      errors.push(`${input.label} needs ${input.geometry} geometry; "${dataset.name}" is ${dataset.geometryKind}.`);
    }

    const columns = new Set(dataset.fields.map((field) => field.name));
    for (const role of input.fields) {
      const column = binding.fields[role.id];
      if (!column) {
        if (role.required) errors.push(`${input.label}: choose a column for ${role.label}.`);
        continue;
      }
      if (!columns.has(column)) {
        errors.push(`${input.label}: "${dataset.name}" has no column "${column}" for ${role.label}.`);
      }
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
    if (parameter.type === 'choice' && !parameter.options?.includes(String(value))) {
      errors.push(`${parameter.label} must be one of ${parameter.options?.join(', ')}.`);
    }
  }

  return errors;
};
