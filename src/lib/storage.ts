/**
 * Optional persistent snapshot store.
 *
 * Vercel's serverless filesystem is read-only except /tmp (ephemeral), so this
 * is best-effort on Vercel; on Render (persistent disk) it genuinely persists
 * between deploys. Without it the app is still fully functional — served from
 * the in-memory cache and, on the browser, localStorage.
 */
import fs from "fs";
import path from "path";
import type { DealsResponse } from "./types";
import { cacheGet, cacheSet } from "./cache";
import { CONFIG } from "./config";

const SNAP_KEY = "ugc-deals-v13";
const DATA_DIR = (() => {
  if (process.env.UGC_DATA_DIR) return process.env.UGC_DATA_DIR;
  if (process.env.RENDER === "1" || process.env.RENDER) {
    return path.join((process.env.RENDER_DATA_DIR as string) || "/var/data", "ugc-snap");
  }
  return "/tmp/ugc-snap";
})();

function filePath(): string {
  return path.join(DATA_DIR, "deals.json");
}

export function persistSnapshot(snap: DealsResponse): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(snap));
  } catch {
    /* read-only FS (Vercel) — ignore */
  }
}

export function loadSnapshot(): DealsResponse | null {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const snap = JSON.parse(raw) as DealsResponse;
    // A Render disk can outlive a deployment. Never hydrate a pre-UGC-only
    // snapshot (for example, the old v12 snapshot that contained classics).
    if (
      snap &&
      snap.snapshotKey === `${SNAP_KEY}:deals` &&
      Array.isArray(snap.deals) &&
      snap.deals.every(
        (d) =>
          d?.limitedType === 2 &&
          d.soldOut === true &&
          d.rap > 0 &&
          d.lowest > 0 &&
          d.lowest <= d.rap * 0.2 &&
          d.second >= d.rap * 0.7 &&
          d.third >= d.rap * 0.7 &&
          d.second <= d.rap &&
          d.third <= d.rap
      )
    ) {
      return snap;
    }
    return null;
  } catch {
    return null;
  }
}

/** Best-effort: fill in-memory cache from disk once per instance. */
export function hydrateFromDisk(): void {
  if (cacheGet(SNAP_KEY + ":deals")) return;
  const snap = loadSnapshot();
  if (snap) {
    cacheSet(SNAP_KEY + ":deals", snap, Math.max(CONFIG.CACHE_TTL_MS, 60_000));
  }
}
