/**
 * A folder kept in IndexedDB: for browsers that cannot write their own
 * private storage from a page (Safari), and the iPad app's own data. Its
 * files are held in memory (memory-fs.ts) and every change is written through.
 */
import { MemoryFileSystem, type MemoryEntry, type Persist } from "./memory-fs";

const DATABASE = "lumiere-files";
const ENTRIES = "entries";
/** Between a folder's name and a path in a key: no path holds it. */
const SEPARATOR = "\u0000";

export async function indexedDbFolder(name: string): Promise<MemoryFileSystem> {
  const db = await open();
  const entries = await load(db, name);
  return new MemoryFileSystem(entries, keepIn(db, name));
}

/**
 * Writes each change in its own transaction, done only once IndexedDB has
 * committed it: a request's success is not yet stored, and a quota error can
 * still abort the transaction after it.
 */
export function keepIn(db: IDBDatabase, name: string): Persist {
  return (path, entry) =>
    new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ENTRIES, "readwrite");
      const store = transaction.objectStore(ENTRIES);
      const key = `${name}${SEPARATOR}${path}`;
      const failed = () =>
        reject(
          transaction.error ??
            new Error(`Lumière could not keep ${path} in IndexedDB`),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = failed;
      transaction.onabort = failed;
      if (entry) {
        store.put(entry, key);
      } else {
        store.delete(key);
      }
    });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ENTRIES);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function load(
  db: IDBDatabase,
  name: string,
): Promise<Map<string, MemoryEntry>> {
  const range = IDBKeyRange.bound(
    `${name}${SEPARATOR}`,
    `${name}${SEPARATOR}￿`,
  );
  return new Promise((resolve, reject) => {
    const entries = new Map<string, MemoryEntry>();
    const cursor = db
      .transaction(ENTRIES)
      .objectStore(ENTRIES)
      .openCursor(range);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve(entries);
        return;
      }
      const path = String(current.key).slice(name.length + 1);
      entries.set(path, current.value as MemoryEntry);
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}
