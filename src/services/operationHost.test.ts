import { describe, expect, it, vi } from 'vitest';
import { referenceProvider } from '../providers/reference/referenceProvider';
import { OperationHost, OperationHostError, type OperationTransport } from './operationHost';
import { createOperationHostCore, type OperationHostRequest, type OperationHostResponse } from './operationHostCore';

/**
 * A transport that runs the real core in-process. Nothing here is a stand-in for
 * the logic under test — only for `postMessage`, which node has no opinion about.
 */
const localTransport = (load: (url: string) => Promise<unknown>) => {
  const core = createOperationHostCore(load);
  let handler: ((response: OperationHostResponse) => void) | null = null;
  const terminate = vi.fn();

  const transport: OperationTransport = {
    post: (request: OperationHostRequest) => {
      void core.handle(request).then((response) => handler?.(response));
    },
    onMessage: (next) => {
      handler = next;
    },
    terminate,
  };

  return { transport, core, terminate };
};

/**
 * A fresh core per connection, because that is what constructing a Worker does.
 * A fixture that reused one would hide the fact that terminating loses every
 * loaded provider — the one thing the shutdown tests are here to pin down.
 */
const localTransportFactory = (load: (url: string) => Promise<unknown>) => {
  const connections: Array<ReturnType<typeof localTransport>> = [];
  return {
    create: () => {
      const connection = localTransport(load);
      connections.push(connection);
      return connection.transport;
    },
    latest: () => connections[connections.length - 1],
  };
};

const loadReference = async (url: string) => {
  if (url === 'reference') return { provider: referenceProvider };
  throw new Error(`nothing at ${url}`);
};

const hostWith = (load: (url: string) => Promise<unknown> = loadReference) => {
  const factory = localTransportFactory(load);
  const host = new OperationHost(factory.create);
  return {
    host,
    get core() {
      return factory.latest().core;
    },
    get terminate() {
      return factory.latest().terminate;
    },
  };
};

const rowsInput = (keys: string[]) => [
  { inputId: 'units', fields: { key: 'id' }, rows: keys.map((id) => ({ id })) },
];

const change = (id: string, rowIds: string[], amount: number, sequence: number) => ({
  id,
  changeId: 'adjust',
  sequence,
  target: { kind: 'rows' as const, datasetId: 'dataset-1', rowIds },
  values: { amount },
});

const valuesOf = (result: { outputs: Record<string, unknown> }) => {
  const output = result.outputs.values as { kind: string; rows: Array<Record<string, unknown>> };
  return Object.fromEntries(output.rows.map((row) => [String(row.key), Number(row.reference_value)]));
};

describe('loading', () => {
  it('returns what a provider declares', async () => {
    const { host } = hostWith();
    const manifest = await host.load('reference');
    expect(manifest.id).toBe('reference.tally');
    expect(manifest.accepts.map((accepted) => accepted.id)).toEqual(['adjust', 'place']);
  });

  it('reports a URL that has nothing at it', async () => {
    const { host } = hostWith();
    await expect(host.load('nowhere')).rejects.toThrow(/nothing at nowhere/);
  });

  it('refuses a module that exports no provider', async () => {
    const { host } = hostWith(async () => ({ somethingElse: true }));
    await expect(host.load('bad')).rejects.toThrow(/exports no provider/);
  });

  it('refuses a provider whose manifest is invalid, rather than loading it', async () => {
    const broken = { ...referenceProvider, manifest: { ...referenceProvider.manifest, id: 'Not Safe' } };
    const { host } = hostWith(async () => ({ provider: broken }));
    await expect(host.load('broken')).rejects.toThrow(/invalid manifest/);
  });

  it('accepts a default export as well as a named one', async () => {
    const { host } = hostWith(async () => ({ default: referenceProvider }));
    await expect(host.load('default-export')).resolves.toMatchObject({ id: 'reference.tally' });
  });
});

describe('lifecycle across the boundary', () => {
  it('creates, changes and evaluates', async () => {
    const { host } = hostWith();
    await host.load('reference');
    const handle = await host.create('reference.tally', rowsInput(['1', '2']), { start: 0 });

    await host.setChanges(handle, [change('a', ['1'], 2, 0), change('b', ['1', '2'], 3, 1)]);
    expect(valuesOf(await host.evaluate(handle))).toEqual({ '1': 5, '2': 3 });
  });

  it('keeps two instances of one provider apart', async () => {
    const { host } = hostWith();
    await host.load('reference');
    const left = await host.create('reference.tally', rowsInput(['1']), { start: 0 });
    const right = await host.create('reference.tally', rowsInput(['1']), { start: 100 });

    await host.setChanges(left, [change('a', ['1'], 5, 0)]);
    expect(valuesOf(await host.evaluate(left))).toEqual({ '1': 5 });
    expect(valuesOf(await host.evaluate(right))).toEqual({ '1': 100 });
  });

  it('applies settings without disturbing recorded changes', async () => {
    const { host } = hostWith();
    await host.load('reference');
    const handle = await host.create('reference.tally', rowsInput(['1']), { start: 0 });

    await host.setChanges(handle, [change('a', ['1'], 2, 0)]);
    await host.setParameters(handle, { start: 10 });
    expect(valuesOf(await host.evaluate(handle))).toEqual({ '1': 12 });
  });

  it('carries geometry output back across the boundary', async () => {
    const { host } = hostWith();
    await host.load('reference');
    const handle = await host.create('reference.tally', rowsInput(['1']), {});
    await host.setChanges(handle, [
      {
        id: 'p',
        changeId: 'place',
        sequence: 0,
        target: { kind: 'geometry', geometry: { type: 'Point', coordinates: [110.3, -7.8] } },
        values: { amount: 4 },
      },
    ]);

    const placed = (await host.evaluate(handle)).outputs.placed;
    expect(placed.kind).toBe('dataset');
    if (placed.kind !== 'dataset') throw new Error('expected a dataset output');
    expect(placed.geojson.features[0].geometry).toEqual({ type: 'Point', coordinates: [110.3, -7.8] });
  });

  it('rejects work against an unknown provider', async () => {
    const { host } = hostWith();
    await expect(host.create('never.loaded', rowsInput(['1']), {})).rejects.toThrow(/No calculation named/);
  });

  it('rejects work against a disposed instance', async () => {
    const fixture = hostWith();
    const { host } = fixture;
    await host.load('reference');
    const handle = await host.create('reference.tally', rowsInput(['1']), {});

    await host.dispose(handle);
    expect(fixture.core.liveHandles()).toEqual([]);
    await expect(host.evaluate(handle)).rejects.toThrow(/No live calculation/);
  });

  it('tolerates disposing twice', async () => {
    const { host } = hostWith();
    await host.load('reference');
    const handle = await host.create('reference.tally', rowsInput(['1']), {});
    await host.dispose(handle);
    await expect(host.dispose(handle)).resolves.toBeNull();
  });
});

describe('shutdown', () => {
  it('rejects in-flight work rather than leaving it hanging', async () => {
    // A transport that accepts requests and never answers, which is what a
    // crashed worker looks like from here.
    const silent: OperationTransport = { post: () => {}, onMessage: () => {}, terminate: vi.fn() };
    const host = new OperationHost(() => silent);

    const pending = host.load('reference');
    host.terminate();
    await expect(pending).rejects.toThrow(OperationHostError);
  });

  it('terminates the transport and reconnects on next use', async () => {
    const fixture = hostWith();
    const { host } = fixture;
    await host.load('reference');
    const terminated = fixture.terminate;
    host.terminate();
    expect(terminated).toHaveBeenCalled();

    // The provider registry lives in the worker, so a reconnect starts empty —
    // worth asserting, because silently losing loaded providers would look like
    // a caching bug rather than a restart.
    await expect(host.create('reference.tally', rowsInput(['1']), {})).rejects.toThrow(/No calculation named/);
  });
});
