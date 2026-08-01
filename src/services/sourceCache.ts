import type { ProjectSourceDescriptor } from '../types/project';

/**
 * Keeps a copy of every ingested source file in the browser's private storage,
 * so reopening a project does not mean hunting down and re-picking each file.
 *
 * Why the files and not the database. A Parquet or CSV upload becomes a *view*
 * over the registered file — `CREATE VIEW x AS SELECT * FROM read_parquet(…)`
 * — so the rows never enter the DuckDB catalogue at all. Persisting the
 * database itself would therefore save a catalogue of views pointing at file
 * handles that died with the page: the project would appear to reopen and then
 * fail on the first query, which is worse than plainly asking for the file.
 * Keeping the bytes lets the existing ingestion path rebuild everything
 * exactly as it was built the first time.
 *
 * This is a cache, not storage. The browser may evict it under pressure and
 * `navigator.storage.persist()` is frequently refused, so every caller must
 * treat a miss as normal — the manual relink prompt remains the fallback.
 */

const DIRECTORY = 'alur-sources';
const INDEX_FILE = 'index.json';

/**
 * How much of the origin's quota to spend on cached sources. Chromium offered
 * about 6 GB in testing; taking a fraction leaves room for the rest of the
 * app's storage and makes eviction our decision rather than the browser's.
 */
export const SOURCE_CACHE_BUDGET_BYTES = 1_500_000_000;

export type CachedSourceEntry = {
  key: string;
  name: string;
  size: number;
  lastModified?: number;
  format?: string;
  cachedAt: number;
  lastUsedAt: number;
};

type CacheIndex = { entries: CachedSourceEntry[] };

const isAvailable = () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

export const isSourceCacheAvailable = () => isAvailable();

/**
 * Identifies a file by what the project manifest already records about it.
 *
 * Deliberately the same triple `sourceMatchesFile` uses to accept a manual
 * relink, so a file restored from cache is one the user could equally have
 * re-picked by hand — the cache never admits a file the relink check would
 * have rejected.
 */
export const sourceCacheKey = (input: { name: string; size?: number; lastModified?: number }) => {
  const parts = [input.name, input.size ?? 'x', input.lastModified ?? 'x'].join('|');
  // A short, stable, filesystem-safe digest. Collisions across a handful of a
  // user's files are not a practical concern, and a wrong hit is caught by the
  // size check on the way out.
  let hash = 0x811c9dc5;
  for (let index = 0; index < parts.length; index += 1) {
    hash ^= parts.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Dots are collapsed along with everything else: the prefix exists only so a
  // human poking at OPFS can tell the files apart, and a name containing ".."
  // is a path-traversal shape no storage API should be handed.
  return `${input.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}-${hash.toString(36)}`;
};

const directory = async (create = false) => {
  if (!isAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIRECTORY, { create });
  } catch {
    return null;
  }
};

const readIndex = async (dir: FileSystemDirectoryHandle): Promise<CacheIndex> => {
  try {
    const handle = await dir.getFileHandle(INDEX_FILE);
    const parsed = JSON.parse(await (await handle.getFile()).text());
    return Array.isArray(parsed?.entries) ? { entries: parsed.entries } : { entries: [] };
  } catch {
    return { entries: [] };
  }
};

const writeIndex = async (dir: FileSystemDirectoryHandle, index: CacheIndex) => {
  const handle = await dir.getFileHandle(INDEX_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(index)], { type: 'application/json' }));
  await writable.close();
};

/** Entries to drop so the cache fits its budget, oldest use first. */
export const evictionPlan = (entries: CachedSourceEntry[], incomingBytes: number, budget = SOURCE_CACHE_BUDGET_BYTES) => {
  const ordered = [...entries].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const evict: CachedSourceEntry[] = [];
  let total = entries.reduce((sum, entry) => sum + entry.size, 0) + incomingBytes;
  for (const entry of ordered) {
    if (total <= budget) break;
    evict.push(entry);
    total -= entry.size;
  }
  return evict;
};

/**
 * Stores a copy of an ingested file. Never throws: failing to cache is a lost
 * convenience, not a lost dataset, and must not break an otherwise good load.
 */
export const cacheSource = async (
  file: File,
  meta: { format?: string } = {},
): Promise<CachedSourceEntry | null> => {
  const dir = await directory(true);
  if (!dir) return null;
  try {
    // A file larger than the whole budget would evict everything and still not
    // fit, so it is not worth writing at all.
    if (file.size > SOURCE_CACHE_BUDGET_BYTES) return null;

    const index = await readIndex(dir);
    const key = sourceCacheKey(file);

    const existing = index.entries.find((entry) => entry.key === key);
    if (existing) {
      // Already held, and rewriting it would be actively harmful: restoring a
      // project re-ingests the cached file, and `createWritable()` truncates
      // the OPFS entry — so writing it back would blank the bytes DuckDB is
      // in the middle of reading. Since size and timestamp are part of the
      // key, a match means the contents are the ones we already have.
      existing.lastUsedAt = Date.now();
      await writeIndex(dir, index);
      return existing;
    }

    const others = index.entries;

    for (const victim of evictionPlan(others, file.size)) {
      await dir.removeEntry(victim.key).catch(() => null);
      others.splice(others.indexOf(victim), 1);
    }

    const handle = await dir.getFileHandle(key, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();

    const entry: CachedSourceEntry = {
      key,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      format: meta.format,
      cachedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    await writeIndex(dir, { entries: [...others, entry] });
    // Ask once we actually have something worth keeping. Often refused, which
    // is why nothing here depends on the answer.
    navigator.storage.persist?.().catch(() => false);
    return entry;
  } catch {
    return null;
  }
};

/**
 * Returns the cached file for a manifest source, or null.
 *
 * The size is re-checked against the manifest on the way out: a cache is a
 * place for stale data to hide, and handing back the wrong file would rebuild
 * a project that looks right and is not.
 */
export const cachedSource = async (source: ProjectSourceDescriptor): Promise<File | null> => {
  const dir = await directory();
  if (!dir) return null;
  try {
    const key = sourceCacheKey(source);
    const file = await (await dir.getFileHandle(key)).getFile();
    if (source.size !== undefined && file.size !== source.size) return null;

    const index = await readIndex(dir);
    const entry = index.entries.find((item) => item.key === key);
    if (entry) {
      entry.lastUsedAt = Date.now();
      await writeIndex(dir, index);
    }
    // getFile() gives a real File, so the ordinary ingestion path accepts it
    // with no special case — restoring and re-picking are the same operation.
    return new File([file], source.name, { lastModified: source.lastModified ?? file.lastModified });
  } catch {
    return null;
  }
};

export const listCachedSources = async (): Promise<CachedSourceEntry[]> => {
  const dir = await directory();
  if (!dir) return [];
  return (await readIndex(dir)).entries;
};

export const sourceCacheUsage = async () => {
  const entries = await listCachedSources();
  return { count: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
};

export const clearSourceCache = async () => {
  const dir = await directory();
  if (!dir) return;
  for (const entry of await readIndex(dir).then((index) => index.entries)) {
    await dir.removeEntry(entry.key).catch(() => null);
  }
  await writeIndex(dir, { entries: [] });
};
