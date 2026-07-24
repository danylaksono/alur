import type { ProjectManifest } from '../types/project';

const DB_NAME = 'alur-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
export const MAX_RECOVERY_SNAPSHOTS = 5;

export type RecoverySnapshot = {
  id: string;
  createdAt: number;
  manifest: ProjectManifest;
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

export const retainNewestSnapshots = (snapshots: RecoverySnapshot[], limit = MAX_RECOVERY_SNAPSHOTS) =>
  [...snapshots].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

export const saveRecoverySnapshot = async (manifest: ProjectManifest) => {
  const db = await openRecoveryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const snapshot: RecoverySnapshot = {
      id: `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      manifest,
    };
    store.put(snapshot);
    const existing = await requestResult(store.getAll()) as RecoverySnapshot[];
    const keep = new Set(retainNewestSnapshots([...existing, snapshot]).map((item) => item.id));
    for (const item of existing) if (!keep.has(item.id)) store.delete(item.id);
    await transactionDone(transaction);
    return snapshot;
  } finally {
    db.close();
  }
};

export const listRecoverySnapshots = async () => {
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

export const latestRecoverySnapshot = async () => (await listRecoverySnapshots())[0] || null;

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
