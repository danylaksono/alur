import type {
  OperationManifest,
  OperationParameter,
} from './types';
import { parameterOptionValues } from './types';
import { OPERATION_CONTRACT_REVISION, type PluginManifest } from './plugin';

/**
 * Every way a manifest can be wrong, reported together.
 *
 * Lives in this package rather than in ALUR so an author can run the same checks
 * ALUR will run, in their own test suite, before anything is served. The
 * referential checks are the ones that matter: a change naming an input that
 * does not exist, or a measure naming a field no output emits, produces an
 * interface ALUR cannot generate, and the failure would otherwise surface as an
 * empty form the analyst cannot act on.
 */

const ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

const SEMANTIC_TYPES = new Set([
  'numeric',
  'categorical',
  'boolean',
  'temporal',
  'identifier',
  'geometry',
  'unknown',
]);

const duplicates = (values: string[]) => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
};

const parameterErrors = (parameters: OperationParameter[], where: string) => {
  const errors: string[] = [];
  for (const parameter of parameters) {
    if (!parameter.id) errors.push(`${where}: a parameter is missing an id.`);
    if (parameter.type === 'choice') {
      const values = parameterOptionValues(parameter);
      if (!values.length) errors.push(`${where}: choice parameter "${parameter.id}" declares no options.`);
      // Caught here because the renderer shows an option's value as its label
      // when no label is given, and an object arriving where a string was
      // expected renders as "[object Object]" rather than failing.
      for (const value of values) {
        if (typeof value !== 'string' || !value) {
          errors.push(`${where}: choice parameter "${parameter.id}" has an option that is not a string or {value, label}.`);
          break;
        }
      }
      const fallback = parameter.defaultValue;
      if (fallback !== undefined && !values.includes(String(fallback))) {
        errors.push(`${where}: choice parameter "${parameter.id}" defaults to "${String(fallback)}", which is not one of its options.`);
      }
    }
  }
  for (const id of duplicates(parameters.map((parameter) => parameter.id))) {
    errors.push(`${where}: parameter id "${id}" is declared twice.`);
  }
  return errors;
};

export const operationManifestErrors = (manifest: OperationManifest): string[] => {
  const errors: string[] = [];

  if (!ID_PATTERN.test(manifest.id || '')) {
    errors.push(`Provider id "${manifest.id}" must be lower-case, dot- or dash-separated.`);
  }
  if (!manifest.label?.trim()) errors.push('A provider needs a label.');
  if (!manifest.version?.trim()) errors.push('A provider needs a version.');
  if (!manifest.inputs?.length) errors.push('A provider needs at least one input.');
  if (!manifest.outputs?.length) errors.push('A provider needs at least one output.');

  const inputs = manifest.inputs ?? [];
  const outputs = manifest.outputs ?? [];
  const accepts = manifest.accepts ?? [];

  for (const id of duplicates(inputs.map((input) => input.id))) {
    errors.push(`Input id "${id}" is declared twice.`);
  }
  for (const id of duplicates(outputs.map((output) => output.id))) {
    errors.push(`Output id "${id}" is declared twice.`);
  }
  for (const id of duplicates(accepts.map((change) => change.id))) {
    errors.push(`Change id "${id}" is declared twice.`);
  }

  errors.push(...parameterErrors(manifest.parameters ?? [], 'Provider parameters'));

  const inputIds = new Set(inputs.map((input) => input.id));
  for (const input of inputs) {
    for (const id of duplicates(input.fields.map((field) => field.id))) {
      errors.push(`Input "${input.id}": field role "${id}" is declared twice.`);
    }
    for (const role of input.fields) {
      if (!SEMANTIC_TYPES.has(role.semanticType)) {
        errors.push(
          `Input "${input.id}": field role "${role.id}" declares semantic type "${role.semanticType}", which is not one of ${[...SEMANTIC_TYPES].join(', ')}.`,
        );
      }
    }
  }

  for (const change of accepts) {
    if (!inputIds.has(change.inputId)) {
      errors.push(`Change "${change.id}" names input "${change.inputId}", which is not declared.`);
    } else if (change.targetFieldRole) {
      const input = inputs.find((candidate) => candidate.id === change.inputId)!;
      if (!input.fields.some((role) => role.id === change.targetFieldRole)) {
        errors.push(`Change "${change.id}" targets field role "${change.targetFieldRole}", which input "${change.inputId}" does not declare.`);
      }
    }
    if (change.referent === 'rows' && change.targetFieldRole === undefined) {
      const input = inputs.find((candidate) => candidate.id === change.inputId);
      const identifier = input?.fields.find((role) => role.required && role.semanticType === 'identifier');
      if (input && !identifier) {
        errors.push(`Change "${change.id}" applies to rows of "${change.inputId}", which declares no required identifier and no targetFieldRole.`);
      }
    }
    errors.push(...parameterErrors(change.parameters ?? [], `Change "${change.id}"`));
  }

  for (const output of outputs) {
    if (output.kind === 'join' && !output.joinInputId) {
      errors.push(`Output "${output.id}" joins, but names no input to join to.`);
    }
    if (output.kind === 'join' && output.joinInputId && !inputIds.has(output.joinInputId)) {
      errors.push(`Output "${output.id}" joins to input "${output.joinInputId}", which is not declared.`);
    }
    if (output.kind === 'dataset' && output.joinInputId) {
      errors.push(`Output "${output.id}" is a new dataset but also names a join input.`);
    }
    if (output.kind === 'join' && output.joinFieldRole && output.joinInputId) {
      const input = inputs.find((candidate) => candidate.id === output.joinInputId);
      if (input && !input.fields.some((role) => role.id === output.joinFieldRole)) {
        errors.push(`Output "${output.id}" keys on field role "${output.joinFieldRole}", which input "${output.joinInputId}" does not declare.`);
      }
    }
  }

  if (manifest.measure) {
    const output = outputs.find((candidate) => candidate.id === manifest.measure!.outputId);
    if (!output) {
      errors.push(`The measure names output "${manifest.measure.outputId}", which is not declared.`);
    } else if (!output.fields.some((field) => field.name === manifest.measure!.field)) {
      errors.push(`The measure names field "${manifest.measure.field}", which output "${output.id}" does not emit.`);
    }
  }

  return errors;
};

/**
 * Whether a plugin manifest is well-formed, checked before its entry is
 * imported.
 *
 * The order matters: this runs against fetched JSON, so a malformed or hostile
 * package is rejected without executing any of its code.
 */
export const pluginManifestErrors = (manifest: PluginManifest): string[] => {
  const errors: string[] = [];

  if (manifest?.contract !== OPERATION_CONTRACT_REVISION) {
    errors.push(
      `This plugin declares contract revision ${String(manifest?.contract)}; this version of ALUR speaks revision ${OPERATION_CONTRACT_REVISION}.`,
    );
  }
  if (!ID_PATTERN.test(manifest?.name || '')) {
    errors.push(`Plugin name "${manifest?.name}" must be lower-case, dot- or dash-separated.`);
  }
  if (!manifest?.label?.trim()) errors.push('A plugin needs a label.');
  if (!manifest?.version?.trim()) errors.push('A plugin needs a version.');
  if (!manifest?.entry?.trim()) errors.push('A plugin needs an entry module.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(manifest?.entry ?? '')) {
    // Anchoring `entry` to the manifest is the reason this file exists; an
    // absolute URL opts out of it and can point anywhere, so it is refused.
    errors.push(`Plugin entry "${manifest.entry}" must be a relative path, so it resolves against the plugin manifest.`);
  }
  if (!manifest?.calculations?.length) errors.push('A plugin needs at least one calculation.');

  for (const id of duplicates((manifest?.calculations ?? []).map((calculation) => calculation.id))) {
    errors.push(`Calculation id "${id}" is listed twice.`);
  }
  for (const calculation of manifest?.calculations ?? []) {
    if (!ID_PATTERN.test(calculation.id || '')) {
      errors.push(`Calculation id "${calculation.id}" must be lower-case, dot- or dash-separated.`);
    }
    if (!calculation.label?.trim()) errors.push(`Calculation "${calculation.id}" needs a label.`);
  }

  return errors;
};

/**
 * Whether what a package advertised matches what it exports.
 *
 * Kept apart from the two validators above because it can only run once the code
 * has been imported, and because it fails for a different reason: not a
 * malformed package, but a dishonest one. A catalogue nobody checks becomes a
 * catalogue that lies.
 */
export const pluginContentErrors = (manifest: PluginManifest, exported: OperationManifest[]): string[] => {
  const errors: string[] = [];
  const found = new Set(exported.map((calculation) => calculation.id));

  for (const calculation of manifest.calculations) {
    if (!found.has(calculation.id)) {
      errors.push(`"${manifest.label}" advertises "${calculation.id}" but its entry does not export it.`);
    }
  }
  const advertised = new Set(manifest.calculations.map((calculation) => calculation.id));
  for (const calculation of exported) {
    if (!advertised.has(calculation.id)) {
      errors.push(`"${manifest.label}" exports "${calculation.id}" without listing it in its manifest.`);
    }
  }
  return errors;
};
