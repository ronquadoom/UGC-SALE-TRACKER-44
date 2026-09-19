/** In-memory TTL cache shared across hot serverless invocations. */

export interface CacheEntry<T> {
  value: T;
  at: number;
  ttl: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ugcCache: Map<string, CacheEntry<any>> | undefined;
}

function store(): Map<string, CacheEntry<any>> {
  if (!globalThis.__ugcCache) globalThis.__ugcCache = new Map();
  return globalThis.__ugcCache;
}

export function cacheGet<T>(key: string): T | undefined {
  const e = store().get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > e.ttl) {
    store().delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttl: number): void {
  const s = store();
  // Gentle size cap to avoid unbounded growth in a warm lambda.
  if (s.size > 400) {
    const now = Date.now();
    for (const [k, v] of s) if (now - v.at > v.ttl) s.delete(k);
  }
  s.set(key, { value, at: Date.now(), ttl });
}

export function cacheHas(key: string): boolean {
  const e = store().get(key);
  if (!e) return false;
  if (Date.now() - e.at > e.ttl) {
    store().delete(key);
    return false;
  }
  return true;
}
