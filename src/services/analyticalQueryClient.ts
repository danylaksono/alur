export type AnalyticalQueryMetrics = {
  requests: number;
  cacheHits: number;
  deduplicated: number;
  completed: number;
  failed: number;
  stale: number;
  totalDurationMs: number;
  active: number;
  queued: number;
};

type RunOptions = {
  key: string;
  datasetId: string;
  cache?: boolean;
  generation?: { scope: string; value: number };
};

type CacheEntry = { datasetId: string; value: unknown };
type PendingTask = { run: () => void };

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
};

export const analyticalQueryKey = (kind: string, parts: Record<string, unknown>) =>
  `${kind}:${JSON.stringify(stableValue(parts))}`;

export class StaleAnalyticalQueryError extends Error {
  constructor() {
    super('A newer analytical request replaced this result.');
    this.name = 'StaleAnalyticalQueryError';
  }
}

export class AnalyticalQueryClient {
  private readonly maxEntries: number;
  private readonly concurrency: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly generations = new Map<string, number>();
  private readonly queue: PendingTask[] = [];
  private active = 0;
  private metrics: AnalyticalQueryMetrics = { requests: 0, cacheHits: 0, deduplicated: 0, completed: 0, failed: 0, stale: 0, totalDurationMs: 0, active: 0, queued: 0 };

  constructor(options: { maxEntries?: number; concurrency?: number } = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 96);
    this.concurrency = Math.max(1, options.concurrency ?? 3);
  }

  beginGeneration(scope: string) {
    const value = (this.generations.get(scope) ?? 0) + 1;
    this.generations.set(scope, value);
    return { scope, value };
  }

  private enqueue<T>(work: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        this.syncQueueMetrics();
        void work().then(resolve, reject).finally(() => {
          this.active -= 1;
          this.queue.shift()?.run();
          this.syncQueueMetrics();
        });
      };
      if (this.active < this.concurrency) start();
      else {
        this.queue.push({ run: start });
        this.syncQueueMetrics();
      }
    });
  }

  private syncQueueMetrics() {
    this.metrics.active = this.active;
    this.metrics.queued = this.queue.length;
  }

  async run<T>(options: RunOptions, query: () => Promise<T>): Promise<T> {
    this.metrics.requests += 1;
    const cached = options.cache !== false ? this.cache.get(options.key) : undefined;
    if (cached) {
      this.cache.delete(options.key);
      this.cache.set(options.key, cached);
      this.metrics.cacheHits += 1;
      return cached.value as T;
    }
    const pending = this.inFlight.get(options.key);
    if (pending) {
      this.metrics.deduplicated += 1;
      return pending as Promise<T>;
    }

    const startedAt = performance.now();
    const promise = this.enqueue(query).then((value) => {
      if (options.generation && this.generations.get(options.generation.scope) !== options.generation.value) {
        this.metrics.stale += 1;
        throw new StaleAnalyticalQueryError();
      }
      this.metrics.completed += 1;
      if (options.cache !== false) {
        this.cache.set(options.key, { datasetId: options.datasetId, value });
        while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
      }
      return value;
    }).catch((error) => {
      if (!(error instanceof StaleAnalyticalQueryError)) this.metrics.failed += 1;
      throw error;
    }).finally(() => {
      this.metrics.totalDurationMs += performance.now() - startedAt;
      this.inFlight.delete(options.key);
      if (import.meta.env.DEV && this.metrics.completed > 0 && this.metrics.completed % 25 === 0) {
        const hitRate = this.metrics.cacheHits / Math.max(1, this.metrics.requests);
        console.debug(`[analytics] ${this.metrics.completed} queries · ${(this.metrics.totalDurationMs / this.metrics.completed).toFixed(1)} ms average · ${(hitRate * 100).toFixed(0)}% cache hits`);
      }
    });
    this.inFlight.set(options.key, promise);
    return promise;
  }

  invalidateDataset(datasetId: string) {
    for (const [key, entry] of this.cache) if (entry.datasetId === datasetId) this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  snapshot(): Readonly<AnalyticalQueryMetrics> {
    return { ...this.metrics };
  }
}

export const analyticalQueryClient = new AnalyticalQueryClient();
