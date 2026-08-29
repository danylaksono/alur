import { describe, expect, it } from 'vitest';
import { operationManifestErrors, pluginContentErrors, pluginManifestErrors } from '../types/operations';
import type { OperationProvider, PluginManifest } from '../types/operations';
// @ts-expect-error - the example is plain JavaScript on purpose. It is what a
// plugin author actually writes, and adding types to it here would mean testing
// a different file from the one the tutorial tells people to copy.
import { providers as exported } from '../../docs/examples/visit-order/index.js';
import plugin from '../../docs/examples/visit-order/alur.plugin.json';

/**
 * The worked example in the docs.
 *
 * Documentation that is never run is documentation that rots, and a tutorial
 * that teaches a contract it no longer satisfies is worse than none. This puts
 * the shipped example through exactly the checks ALUR runs on load, so the two
 * cannot drift apart quietly.
 */

const providers = exported as OperationProvider[];
const manifest = plugin as PluginManifest;

describe('the documented example plugin', () => {
  it('declares a manifest ALUR would accept', () => {
    for (const provider of providers) {
      expect({ id: provider.manifest.id, errors: operationManifestErrors(provider.manifest) })
        .toEqual({ id: provider.manifest.id, errors: [] });
    }
  });

  it('declares a package ALUR would accept', () => {
    expect(pluginManifestErrors(manifest)).toEqual([]);
  });

  it('lists exactly what it exports, in both directions', () => {
    expect(pluginContentErrors(manifest, providers.map((provider) => provider.manifest))).toEqual([]);
  });

  it('demonstrates every part of the contract a tutorial needs to show', () => {
    // If any of these stops being true the example has been trimmed too far and
    // the tutorial is teaching from something that no longer illustrates it.
    const [only] = providers;
    expect(only.manifest.inputs[0].fields.some((role) => role.required)).toBe(true);
    expect(only.manifest.parameters.length).toBeGreaterThan(0);
    expect(only.manifest.accepts.length).toBeGreaterThan(0);
    expect(only.manifest.accepts[0].targetFieldRole).toBeTruthy();
    expect(only.manifest.outputs.some((output) => output.kind === 'join')).toBe(true);
    expect(only.manifest.measure).toBeTruthy();
    expect(only.manifest.group).toBeTruthy();
  });
});
