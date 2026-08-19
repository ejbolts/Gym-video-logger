import type { TrackedWorkout } from './types';

const DATABASE_NAME = 'gym-video-logger-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'snapshots';
const WORKOUT_CACHE_KEY = 'workouts-v1';

export interface CachedWorkoutSnapshot {
  revision: string;
  workouts: TrackedWorkout[];
}

function openCacheDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readWorkoutCache(): Promise<CachedWorkoutSnapshot | null> {
  try {
    const database = await openCacheDatabase();
    if (!database) return null;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(WORKOUT_CACHE_KEY);
      request.onsuccess = () =>
        resolve((request.result as CachedWorkoutSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

export async function writeWorkoutCache(snapshot: CachedWorkoutSnapshot): Promise<void> {
  try {
    const database = await openCacheDatabase();
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot, WORKOUT_CACHE_KEY);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // IndexedDB can be unavailable or full. The API remains the safe fallback.
  }
}

export function cachedWorkoutsForRevision(
  cached: CachedWorkoutSnapshot | null,
  revision: string,
): TrackedWorkout[] | null {
  return cached?.revision === revision ? cached.workouts : null;
}
