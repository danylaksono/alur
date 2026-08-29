import type {
  OperationChange,
  OperationInputData,
  OperationInstance,
  OperationManifest,
  OperationProvider,
  OperationRunResult,
} from '../types/operations';
import { operationManifestErrors } from './operationRegistry';

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
  | { kind: 'load'; id: number; url: string }
  | { kind: 'create'; id: number; providerId: string; inputs: OperationInputData[]; parameters: Record<string, unknown> }
  | { kind: 'setChanges'; id: number; handle: string; changes: OperationChange[] }
  | { kind: 'setParameters'; id: number; handle: string; values: Record<string, unknown> }
  | { kind: 'evaluate'; id: number; handle: string }
  | { kind: 'dispose'; id: number; handle: string };

export type OperationHostResponse =
  | { kind: 'ok'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string };

/** What a provider package must expose. Checked, because it comes from outside. */
export type ProviderModule = { provider?: OperationProvider; default?: OperationProvider };

export type OperationHostCore = {
  handle(request: OperationHostRequest): Promise<OperationHostResponse>;
  /** Instances still alive. Exposed so a test can prove `dispose` actually disposes. */
  liveHandles(): string[];
};

const providerFrom = (module: unknown): OperationProvider => {
  const candidate = (module as ProviderModule)?.provider ?? (module as ProviderModule)?.default;
  if (!candidate || typeof candidate.create !== 'function' || !candidate.manifest) {
    throw new Error('The module exports no provider. Export it as `provider` or as the default export.');
  }
  return candidate;
};

export const createOperationHostCore = (
  load: (url: string) => Promise<unknown>,
): OperationHostCore => {
  const providers = new Map<string, OperationProvider>();
  const instances = new Map<string, OperationInstance>();
  let counter = 0;

  const instance = (handle: string) => {
    const found = instances.get(handle);
    if (!found) throw new Error(`No live calculation for handle "${handle}". It may already have been disposed.`);
    return found;
  };

  const run = async (request: OperationHostRequest): Promise<unknown> => {
    switch (request.kind) {
      case 'load': {
        const provider = providerFrom(await load(request.url));
        const errors = operationManifestErrors(provider.manifest);
        if (errors.length) {
          throw new Error(`The calculation at ${request.url} declares an invalid manifest. ${errors[0]}`);
        }
        providers.set(provider.manifest.id, provider);
        return provider.manifest satisfies OperationManifest;
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
