import { describe, expect, it, vi } from 'vitest';
import { AnalyticalQueryClient, StaleAnalyticalQueryError, analyticalQueryKey } from './analyticalQueryClient';

describe('AnalyticalQueryClient', () => {
  it('builds stable keys independently of object property order', () => {
    expect(analyticalQueryKey('chart', { dataset: 'a', filters: [{ field: 'x', kind: 'category' }] }))
      .toBe(analyticalQueryKey('chart', { filters: [{ kind: 'category', field: 'x' }], dataset: 'a' }));
  });

  it('deduplicates in-flight reads and reuses bounded cached results', async () => {
    const client = new AnalyticalQueryClient({ maxEntries: 2 });
    const query = vi.fn(async () => 42);
    const options = { key: 'count:a', datasetId: 'a' };
    const [first, second] = await Promise.all([client.run(options, query), client.run(options, query)]);
    expect([first, second]).toEqual([42, 42]);
    expect(await client.run(options, query)).toBe(42);
    expect(query).toHaveBeenCalledTimes(1);
    expect(client.snapshot()).toMatchObject({ cacheHits: 1, deduplicated: 1 });
  });

  it('invalidates a dataset without evicting unrelated results', async () => {
    const client = new AnalyticalQueryClient();
    const queryA = vi.fn(async () => 'a');
    const queryB = vi.fn(async () => 'b');
    await client.run({ key: 'a', datasetId: 'a' }, queryA);
    await client.run({ key: 'b', datasetId: 'b' }, queryB);
    client.invalidateDataset('a');
    await client.run({ key: 'a', datasetId: 'a' }, queryA);
    await client.run({ key: 'b', datasetId: 'b' }, queryB);
    expect(queryA).toHaveBeenCalledTimes(2);
    expect(queryB).toHaveBeenCalledTimes(1);
  });

  it('rejects results superseded by a newer request generation', async () => {
    const client = new AnalyticalQueryClient();
    const generation = client.beginGeneration('chart:one');
    const pending = client.run({ key: 'slow', datasetId: 'a', generation }, async () => {
      await Promise.resolve();
      return 1;
    });
    client.beginGeneration('chart:one');
    await expect(pending).rejects.toBeInstanceOf(StaleAnalyticalQueryError);
  });

  it('limits concurrent expensive work', async () => {
    const client = new AnalyticalQueryClient({ concurrency: 1 });
    let release!: () => void;
    const first = client.run({ key: 'first', datasetId: 'a' }, () => new Promise<number>((resolve) => { release = () => resolve(1); }));
    const secondQuery = vi.fn(async () => 2);
    const second = client.run({ key: 'second', datasetId: 'a' }, secondQuery);
    await Promise.resolve();
    expect(secondQuery).not.toHaveBeenCalled();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  });
});
