import type {
  OperationChange,
  OperationInputData,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
  PluginManifest,
} from '../types/operations';
import {
  operationManifestErrors,
  pluginContentErrors,
  pluginManifestErrors,
} from '../types/operations';

/**
 * The half of the provider host that does not need a Worker to exist.
 *
 * Split out for two reasons. It is testable — a Worker cannot be constructed in
 * the node environment the test suite runs in, and mocking `postMessage` would
 * test the mock rather than the logic. And it keeps the worker file thin enough
 * to read: everything that could hide a bug is here, and the worker is a wire.
 *
 * Loading is injected rather than imported so the same core serves a real
 * dynamic import in the browser and a fixture in a test, without either knowing
 * about the other.
 */

export type OperationHostRequest =
  | { kind: 'installed'; id: number }
  | { kind: 'load'; id: number; url: string }
  | { kind: 'loadPlugin'; id: number; url: string }
  | { kind: 'create'; id: number; providerId: string; inputs: OperationInputData[]; parameters: Record<string, unknown> }
  | { kind: 'setChanges'; id: number; handle: string; changes: OperationChange[] }
  | { kind: 'setParameters'; id: number; handle: string; values: Record<string, unknown> }
  | { kind: 'evaluate'; id: number; handle: string }
  | { kind: 'dispose'; id: number; handle: string };

export type OperationHostResponse =
  | { kind: 'ok'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string };

/** What a provider package must expose. Checked, because it comes from outside. */
export type ProviderModule = {
  providers?: OperationProvider[];
  provider?: OperationProvider;
  default?: OperationProvider;
};

/** What a loaded plugin reports back, so the panel can show it without re-fetching. */
export type LoadedPlugin = {
  plugin: PluginManifest;
  /** Absolute URL the entry was resolved to, kept so a run can reload it. */
  entryUrl: string;
  calculations: OperationManifest[];
};

export type OperationHostCore = {
  handle(request: OperationHostRequest): Promise<OperationHostResponse>;
  /** Instances still alive. Exposed so a test can prove `dispose` actually disposes. */
  liveHandles(): string[];
};

const isProvider = (candidate: unknown): candidate is OperationProvider =>
  Boolean(candidate) &&
  typeof (candidate as OperationProvider).create === 'function' &&
  Boolean((candidate as OperationProvider).manifest);

/**
 * Every provider a module exports.
 *
 * Three shapes are accepted, and the single-provider ones are not legacy debt:
 * a package with one calculation should not have to write a one-element array,
 * and the modules written before packaging existed keep working untouched.
 */
const providersFrom = (module: unknown): OperationProvider[] => {
  const candidate = module as ProviderModule;
  if (Array.isArray(candidate?.providers)) {
    const found = candidate.providers.filter(isProvider);
    if (found.length !== candidate.providers.length) {
      throw new Error('One of the exported providers has no manifest or no create().');
    }
    if (found.length) return found;
  }
  const single = candidate?.provider ?? candidate?.default;
  if (isProvider(single)) return [single];
  throw new Error(
    'The module exports no calculation. Export `providers` as an array, or `provider` / default for a single one.',
  );
};

export const createOperationHostCore = (
  load: (url: string) => Promise<unknown>,
  fetchJson: (url: string) => Promise<unknown> = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read ${url} (${response.status} ${response.statusText}).`);
    return response.json();
  },
  /**
   * Plugins compiled into the app rather than fetched.
   *
   * They are registered here, in the worker, rather than on the main thread, so
   * that a bundled calculation runs by exactly the same route as a fetched one.
   * Two execution paths for the same contract would be two sets of bugs, and the
   * bundled path — being the one under our own eye — is the one whose bugs would
   * go unnoticed.
   */
  installed: Array<{ plugin: PluginManifest; providers: OperationProvider[] }> = [],
): OperationHostCore => {
  const providers = new Map<string, OperationProvider>();
  const instances = new Map<string, OperationInstance>();
  let counter = 0;

  const instance = (handle: string) => {
    const found = instances.get(handle);
    if (!found) throw new Error(`No live calculation for handle "${handle}". It may already have been disposed.`);
    return found;
  };

  // Registered eagerly: the toolbox lists what is installed before the analyst
  // has chosen anything, so there is nothing to defer until.
  const preinstalled: LoadedPlugin[] = [];
  for (const entry of installed) {
    for (const provider of entry.providers) {
      const errors = operationManifestErrors(provider.manifest);
      // A bundled provider with a bad manifest is a programming error, but it
      // must not stop the other ones from being available.
      if (errors.length) continue;
      providers.set(provider.manifest.id, provider);
    }
    preinstalled.push({
      plugin: entry.plugin,
      entryUrl: '',
      calculations: entry.providers
        .filter((provider) => !operationManifestErrors(provider.manifest).length)
        .map((provider) => provider.manifest),
    });
  }

  const run = async (request: OperationHostRequest): Promise<unknown> => {
    switch (request.kind) {
      case 'installed':
        return preinstalled satisfies LoadedPlugin[];

      case 'load': {
        // The bare-module path: still supported, and now returns every
        // calculation a module exports rather than only the first.
        const loaded = providersFrom(await load(request.url));
        for (const provider of loaded) {
          const errors = operationManifestErrors(provider.manifest);
          if (errors.length) {
            throw new Error(`The calculation at ${request.url} declares an invalid manifest. ${errors[0]}`);
          }
          providers.set(provider.manifest.id, provider);
        }
        return loaded.map((provider) => provider.manifest) satisfies OperationManifest[];
      }

      case 'loadPlugin': {
        // Fetched and checked as data first, so a malformed or hostile package
        // is refused without any of its code being imported.
        const plugin = (await fetchJson(request.url)) as PluginManifest;
        const manifestErrors = pluginManifestErrors(plugin);
        if (manifestErrors.length) {
          throw new Error(`${request.url} is not a valid plugin. ${manifestErrors[0]}`);
        }

        // Resolved against the plugin manifest, never against what was typed.
        // This is what lets an entry import `../dist/index.js` without the
        // analyst having to serve from exactly the right directory.
        const entryUrl = new URL(plugin.entry, request.url).href;
        const loaded = providersFrom(await load(entryUrl));

        for (const provider of loaded) {
          const errors = operationManifestErrors(provider.manifest);
          if (errors.length) {
            throw new Error(`"${plugin.label}" declares an invalid calculation. ${errors[0]}`);
          }
        }

        const contentErrors = pluginContentErrors(plugin, loaded.map((provider) => provider.manifest));
        if (contentErrors.length) throw new Error(contentErrors[0]);

        for (const provider of loaded) providers.set(provider.manifest.id, provider);
        return {
          plugin,
          entryUrl,
          calculations: loaded.map((provider) => provider.manifest),
        } satisfies LoadedPlugin;
      }

      case 'create': {
        const provider = providers.get(request.providerId);
        if (!provider) throw new Error(`No calculation named "${request.providerId}" is loaded.`);
        // AbortSignal cannot cross a worker boundary, so cancellation is
        // `dispose` rather than a signal. A provider that wants to be
        // interruptible has to check for disposal itself.
        const created = await provider.create({ inputs: request.inputs, parameters: request.parameters });
        const handle = `instance-${(counter += 1)}`;
        instances.set(handle, created);
        return handle;
      }

      case 'setChanges':
        await instance(request.handle).setChanges(request.changes);
        return null;

      case 'setParameters':
        await instance(request.handle).setParameters(request.values);
        return null;

      case 'evaluate':
        return (await instance(request.handle).evaluate()) satisfies OperationRunResult;

      case 'dispose': {
        const found = instances.get(request.handle);
        // Disposing twice is not an error: the host disposes on teardown, and a
        // caller that already tidied up should not have to remember it did.
        found?.dispose();
        instances.delete(request.handle);
        return null;
      }
    }
  };

  return {
    async handle(request) {
      try {
        return { kind: 'ok', id: request.id, value: await run(request) };
      } catch (error) {
        // Errors do not survive `postMessage` as Error instances, so the message
        // is extracted here rather than at the far end where it would arrive as
        // an empty object.
        return { kind: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) };
      }
    },
    liveHandles: () => [...instances.keys()],
  };
};
