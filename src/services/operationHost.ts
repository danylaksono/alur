import type {
  OperationChange,
  OperationInputData,
  OperationManifest,
  OperationRunResult,
} from '../types/operations';
import type { LoadedPlugin, OperationHostRequest, OperationHostResponse } from './operationHostCore';

/**
 * The main thread's handle on calculations running in a worker.
 *
 * Mirrors `OperationInstance` deliberately, so calling code reads the same
 * whether a provider happens to be in-process or across a boundary. The
 * boundary is a fact about deployment, not about the contract, and the day a
 * provider is loaded from someone else's URL nothing above this file changes.
 */

export type OperationTransport = {
  post(request: OperationHostRequest): void;
  onMessage(handler: (response: OperationHostResponse) => void): void;
  terminate(): void;
};

/**
 * The default transport: a module worker created from a URL vite rewrites at
 * build time. Constructed lazily so that importing this module in a test — or
 * anywhere without `Worker` — costs nothing.
 */
const workerTransport = (): OperationTransport => {
  const worker = new Worker(new URL('../workers/operationWorker.ts', import.meta.url), { type: 'module' });
  return {
    post: (request) => worker.postMessage(request),
    onMessage: (handler) => {
      worker.onmessage = (event: MessageEvent<OperationHostResponse>) => handler(event.data);
    },
    terminate: () => worker.terminate(),
  };
};

export class OperationHostError extends Error {}

/**
 * `Omit` applied across a union rather than to it.
 *
 * Plain `Omit<Union, 'id'>` collapses to the keys every member shares, which
 * here is none of them — so every request would fail to typecheck against a
 * shape that permits nothing.
 */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class OperationHost {
  private transport: OperationTransport | null = null;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private counter = 0;

  constructor(private readonly createTransport: () => OperationTransport = workerTransport) {}

  private connect() {
    if (this.transport) return this.transport;
    const transport = this.createTransport();
    transport.onMessage((response) => {
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      if (response.kind === 'ok') waiting.resolve(response.value);
      else waiting.reject(new OperationHostError(response.message));
    });
    this.transport = transport;
    return transport;
  }

  private send<T>(request: WithoutId<OperationHostRequest>): Promise<T> {
    const transport = this.connect();
    const id = (this.counter += 1);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      transport.post({ ...request, id } as OperationHostRequest);
    });
  }

  /** The plugins compiled into the app, available without fetching anything. */
  installed() {
    return this.send<LoadedPlugin[]>({ kind: 'installed' });
  }

  /** Load a bare provider module and return every calculation it exports. */
  load(url: string) {
    return this.send<OperationManifest[]>({ kind: 'load', url });
  }

  /**
   * Load a plugin package by the URL of its `alur.plugin.json`.
   *
   * Preferred over `load`, because the manifest is checked as data before the
   * entry is imported, and the entry resolves relative to the manifest rather
   * than to whatever the analyst pasted.
   */
  loadPlugin(url: string) {
    return this.send<LoadedPlugin>({ kind: 'loadPlugin', url });
  }

  create(providerId: string, inputs: OperationInputData[], parameters: Record<string, unknown>) {
    return this.send<string>({ kind: 'create', providerId, inputs, parameters });
  }

  setChanges(handle: string, changes: OperationChange[]) {
    return this.send<null>({ kind: 'setChanges', handle, changes });
  }

  setParameters(handle: string, values: Record<string, unknown>) {
    return this.send<null>({ kind: 'setParameters', handle, values });
  }

  evaluate(handle: string) {
    return this.send<OperationRunResult>({ kind: 'evaluate', handle });
  }

  dispose(handle: string) {
    return this.send<null>({ kind: 'dispose', handle });
  }

  /**
   * Drop the worker entirely.
   *
   * Every in-flight request is rejected rather than left hanging: a promise that
   * never settles is worse than a failure, because the caller has no way to
   * notice and the loading state never clears.
   */
  terminate() {
    for (const [, waiting] of this.pending) {
      waiting.reject(new OperationHostError('The calculation host was shut down.'));
    }
    this.pending.clear();
    this.transport?.terminate();
    this.transport = null;
  }
}

export const operationHost = new OperationHost();
