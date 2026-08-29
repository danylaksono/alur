import type { OperationManifest, OperationProvider } from './types';
import type { PluginManifest } from './plugin';
import { operationManifestErrors, pluginManifestErrors } from './validate';

/**
 * Identity helpers that exist for their types.
 *
 * A plain object literal assigned to nothing is checked against nothing, which
 * is how a `semanticType` of `"quantitative"` and `options` given as objects
 * both reached a served plugin. Wrapping the literal in a call gives the
 * compiler a target to check it against, at no runtime cost beyond returning
 * the argument.
 */

export const defineManifest = (manifest: OperationManifest): OperationManifest => manifest;

export const defineProvider = (provider: OperationProvider): OperationProvider => provider;

export const definePlugin = (manifest: PluginManifest): PluginManifest => manifest;

export class OperationContractError extends Error {}

/**
 * Throw on anything ALUR would reject, for use in an author's own test run.
 *
 * Deliberately louder than the validators it wraps: a plugin's verification
 * script wants to stop, and reporting every problem at once is what makes one
 * run enough to fix them all.
 */
export const assertValidManifest = (manifest: OperationManifest): OperationManifest => {
  const errors = operationManifestErrors(manifest);
  if (errors.length) {
    throw new OperationContractError(
      `"${manifest.id}" would be rejected by ALUR:\n  - ${errors.join('\n  - ')}`,
    );
  }
  return manifest;
};

export const assertValidPlugin = (manifest: PluginManifest): PluginManifest => {
  const errors = pluginManifestErrors(manifest);
  if (errors.length) {
    throw new OperationContractError(
      `Plugin "${manifest?.name}" would be rejected by ALUR:\n  - ${errors.join('\n  - ')}`,
    );
  }
  return manifest;
};
