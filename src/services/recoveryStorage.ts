import type { ProjectManifest } from '../types/project';

const DB_NAME = 'alur-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
/**
 * Tabs worth remembering. One row per tab now, so this is a count of recent
 * sessions rather than of saves — three covers "the tab I was in, plus the two
 * before it" without letting abandoned tabs pile up forever.
 */
const MAX_RECOVERY_SESSIONS = 3;

/**
 * Row key for a tab that cannot identify itself (sessionStorage blocked).
 * Lives only as long as the page, so such a tab still overwrites its own row
 * instead of adding one per save and evicting everybody else's.
 */
const anonymousRowId = `anon-${Math.random().toString(36).slice(2, 10)}`;

export type RecoverySnapshot = {
  id: string;
  createdAt: number;
  manifest: ProjectManifest;
  /**
   * The tab that wrote it. Absent on snapshots written before this existed,
   * which therefore never match a live session and still get the prompt.
   */
  sessionId?: string;
};

const openRecoveryDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is unavailable in this browser.'));
    return;
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open recovery storage.'));
});

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Recovery storage request failed.'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Recovery storage transaction failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('Recovery storage transaction was aborted.'));
});

/**
 * The rows to keep, newest first. Each tab owns exactly one row — its id *is*
 * the session — so trimming by age drops whole abandoned tabs and can never
 * eat into a tab that is still running next door.
 */
export const retainNewestSnapshots = (snapshots: RecoverySnapshot[], limit = MAX_RECOVERY_SESSIONS) =>
  [...snapshots].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

export const saveRecoverySnapshot = async (manifest: ProjectManifest, sessionId?: string) => {
  const db = await openRecoveryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const snapshot: RecoverySnapshot = {
      // Keyed by the tab, so each save overwrites that tab's own row. Two
      // ALUR tabs open at once no longer race each other out of storage.
      id: sessionId || anonymousRowId,
      createdAt: Date.now(),
      manifest,
      sessionId,
    };
    store.put(snapshot);
    // Requests run in order within a transaction, so this already includes the
    // row just written.
    const existing = await requestResult(store.getAll()) as RecoverySnapshot[];
    const keep = new Set(retainNewestSnapshots(existing).map((item) => item.id));
    for (const item of existing) if (!keep.has(item.id)) store.delete(item.id);
    await transactionDone(transaction);
    return snapshot;
  } finally {
    db.close();
  }
};

const listRecoverySnapshots = async () => {
  const db = await openRecoveryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const snapshots = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as RecoverySnapshot[];
    await transactionDone(transaction);
    return retainNewestSnapshots(snapshots);
  } finally {
    db.close();
  }
};

/**
 * The snapshot this tab should be offered. A tab's own row outranks a newer
 * one from a tab still running next door: coming back to your own work must
 * never hand you somebody else's.
 */
export const latestRecoverySnapshot = async (sessionId?: string) => {
  const snapshots = await listRecoverySnapshots();
  const own = sessionId ? snapshots.find((item) => item.sessionId === sessionId) : undefined;
  return own || snapshots[0] || null;
};

export const deleteRecoverySnapshot = async (id: string) => {
  const db = await openRecoveryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};
