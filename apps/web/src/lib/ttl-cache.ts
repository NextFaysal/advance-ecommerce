/**
 * Tiny in-process TTL cache (speed wave batch 2, 2026-10-26).
 *
 * Stores PROMISES in a module-level Map so concurrent callers share
 * a single in-flight load instead of stampeding the DB/Redis. A
 * rejected load is evicted immediately, so the next caller retries
 * rather than serving a cached failure for the whole TTL window.
 *
 * Process-local and DISPLAY-GRADE only: values may lag up to ttlMs
 * behind the DB. Never use for auth, money, stock or anything a
 * checkout/payment path depends on — those reads stay live. (The
 * catalog public reads have their own cache in
 * src/catalog/server-read.ts; this helper is for everything else.)
 */
const store = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise as Promise<T>;
  const promise = load();
  store.set(key, { expiresAt: Date.now() + ttlMs, promise: promise as Promise<unknown> });
  // Evict failures so a transient error doesn't poison the TTL.
  promise.catch(() => {
    if (store.get(key)?.promise === (promise as Promise<unknown>)) store.delete(key);
  });
  return promise;
}
