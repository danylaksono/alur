import { describe, expect, it } from 'vitest';
import type { OperationManifest } from './types';
import type { PluginManifest } from './plugin';
import { operationManifestErrors, pluginContentErrors, pluginManifestErrors } from './validate';

/**
 * The checks an author runs before serving anything.
 *
 * Several of these exist because a real plugin got them wrong against the prose
 * version of the contract and was accepted anyway — the point of moving
 * validation into a package the author can install is that those become errors
 * where they are written rather than surprises where they are rendered.
 */

const manifest = (patch: Partial<OperationManifest> = {}): OperationManifest => ({
  id: 'example.calculation',
  label: 'Example',
  description: 'A calculation.',
  version: '1.0.0',
  inputs: [
    {
      id: 'units',
      label: 'Units',
      geometry: 'any',
      fields: [{ id: 'key', label: 'Identifier', semanticType: 'identifier', required: true }],
    },
  ],
  parameters: [],
  accepts: [],
  outputs: [
    {
      id: 'values',
      label: 'Values',
      kind: 'join',
      joinInputId: 'units',
      joinFieldRole: 'key',
      fields: [{ name: 'value', type: 'DOUBLE' }],
    },
  ],
  ...patch,
});

const plugin = (patch: Partial<PluginManifest> = {}): PluginManifest => ({
  contract: 1,
  name: 'example',
  label: 'Example plugin',
  version: '0.1.0',
  entry: './index.js',
  calculations: [{ id: 'example.calculation', label: 'Example' }],
  ...patch,
});

describe('calculation manifests', () => {
  it('accepts a well-formed manifest', () => {
    expect(operationManifestErrors(manifest())).toEqual([]);
  });

  it('rejects a semantic type that is not one of the seven', () => {
    // "quantitative" reads plausible and is not a semantic type ALUR has. A
    // served plugin declared it, and nothing objected.
    const wrong = manifest({
      inputs: [
        {
          id: 'units',
          label: 'Units',
          geometry: 'any',
          fields: [{ id: 'key', label: 'Identifier', semanticType: 'quantitative' as never, required: true }],
        },
      ],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('quantitative'));
  });

  it('rejects choice options that are neither a string nor {value, label}', () => {
    // The renderer shows an option's value as its label, so an object arrives on
    // screen as "[object Object]" rather than failing.
    const wrong = manifest({
      parameters: [
        { id: 'mode', label: 'Mode', type: 'choice', options: [{ nope: true } as never] },
      ],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('not a string or {value, label}'));
  });

  it('accepts both option forms', () => {
    const both = manifest({
      parameters: [
        { id: 'a', label: 'A', type: 'choice', options: ['yes', 'no'], defaultValue: 'yes' },
        { id: 'b', label: 'B', type: 'choice', options: [{ value: 'hi', label: 'Higher first' }], defaultValue: 'hi' },
      ],
    });
    expect(operationManifestErrors(both)).toEqual([]);
  });

  it('rejects a default that is not one of the options', () => {
    const wrong = manifest({
      parameters: [{ id: 'mode', label: 'Mode', type: 'choice', options: ['a', 'b'], defaultValue: 'c' }],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('defaults to "c"'));
  });

  it('rejects a target field role the input does not declare', () => {
    const wrong = manifest({
      accepts: [{ id: 'edit', label: 'Edit', inputId: 'units', referent: 'rows', targetFieldRole: 'nope', parameters: [] }],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('targets field role "nope"'));
  });

  it('rejects a rows change on an input with no identifier and no target role', () => {
    const wrong = manifest({
      inputs: [
        { id: 'units', label: 'Units', geometry: 'any', fields: [{ id: 'v', label: 'V', semanticType: 'numeric', required: true }] },
      ],
      accepts: [{ id: 'edit', label: 'Edit', inputId: 'units', referent: 'rows', parameters: [] }],
      outputs: [{ id: 'out', label: 'Out', kind: 'dataset', geometry: 'point', fields: [] }],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('no required identifier and no targetFieldRole'));
  });

  it('rejects a join keyed on a role the input does not declare', () => {
    const wrong = manifest({
      outputs: [
        { id: 'values', label: 'Values', kind: 'join', joinInputId: 'units', joinFieldRole: 'nope', fields: [{ name: 'v', type: 'DOUBLE' }] },
      ],
    });
    expect(operationManifestErrors(wrong)).toContainEqual(expect.stringContaining('keys on field role "nope"'));
  });
});

describe('plugin manifests', () => {
  it('accepts a well-formed plugin', () => {
    expect(pluginManifestErrors(plugin())).toEqual([]);
  });

  it('refuses a contract revision it does not speak', () => {
    expect(pluginManifestErrors(plugin({ contract: 99 }))).toContainEqual(expect.stringContaining('revision 99'));
  });

  it('refuses an absolute entry, which would opt out of manifest-relative resolution', () => {
    // Anchoring the entry to the manifest is the reason the manifest is a
    // separate fetch; an absolute URL could point anywhere.
    expect(pluginManifestErrors(plugin({ entry: 'https://elsewhere.example/evil.js' })))
      .toContainEqual(expect.stringContaining('must be a relative path'));
  });

  it('refuses a plugin that lists no calculations', () => {
    expect(pluginManifestErrors(plugin({ calculations: [] })))
      .toContainEqual(expect.stringContaining('at least one calculation'));
  });
});

describe('what a plugin advertises against what it exports', () => {
  it('accepts a package that exports exactly what it lists', () => {
    expect(pluginContentErrors(plugin(), [manifest()])).toEqual([]);
  });

  it('reports a calculation that is advertised but missing', () => {
    expect(pluginContentErrors(plugin(), [])).toContainEqual(expect.stringContaining('does not export it'));
  });

  it('reports a calculation that is exported but unlisted', () => {
    const extra = manifest({ id: 'example.extra' });
    expect(pluginContentErrors(plugin(), [manifest(), extra]))
      .toContainEqual(expect.stringContaining('without listing it'));
  });
});
