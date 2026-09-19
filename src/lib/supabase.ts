/** Optional Supabase free-tier adapter (REST via anon/service key).
 *  If no keys are configured the app runs fully stateless (localStorage only)
 *  and every function is a no-op. */
import { CONFIG } from "./config";

const enabled = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

function baseHeaders(write: boolean) {
  const h: Record<string, string> = {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (write) {
    h["Authorization"] = `Bearer ${CONFIG.SUPABASE_SERVICE_KEY || CONFIG.SUPABASE_ANON_KEY}`;
    h["Prefer"] = "resolution=merge-duplicates";
  }
  return h;
}

export async function dbUpsertDeals(rows: any[]): Promise<boolean> {
  if (!enabled() || !rows.length) return false;
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/deals?on_conflict=id`, {
      method: "POST",
      headers: baseHeaders(true),
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dbGetDeals(limit = 500): Promise<any[]> {
  if (!enabled()) return [];
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/deals?select=*&order=premiumScore.desc&limit=${limit}`,
      { headers: baseHeaders(false), signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function dbSetWatch(assetId: number, on: boolean): Promise<void> {
  if (!enabled()) return;
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/watchlist`, {
      method: "POST",
      headers: baseHeaders(true),
      body: JSON.stringify({ asset_id: assetId, on, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    /* noop */
  }
}

export async function dbFingerprint(itemId: number): Promise<string | null> {
  if (!enabled()) return stringFingerprint(itemId);
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/fingerprints?item_id=eq.${itemId}&select=*&limit=1`,
      { headers: baseHeaders(false), signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return stringFingerprint(itemId);
    const rows = await res.json();
    return `${res.status}:${Array.isArray(rows) ? rows.length : "x"}:${stringFingerprint(itemId)}`;
  } catch {
    return stringFingerprint(itemId);
  }
}

/** Cheap local surrogate so deduping works without any DB. */
export function stringFingerprint(itemId: number): string {
  return `local:${itemId}`;
}
