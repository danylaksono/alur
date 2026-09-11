import type {
  OperationInputBinding,
  OperationInputSpec,
  OperationManifest,
} from '../types/operations';
import type { DatasetDescriptor } from '../types/datasets';

/**
 * Whether a binding an analyst has filled in satisfies the manifest it targets.
 *
 * Manifest validation itself lives in `@alur/operation-contract`, so a plugin
 * author runs exactly the checks ALUR runs before serving anything. Providers
 * are loaded and held by `operationHostCore`, in the worker that executes them.
 */

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
