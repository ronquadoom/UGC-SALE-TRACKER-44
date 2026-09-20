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

const SNAP_KEY = "ugc-deals-v14";
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

/** Every stored deal must still satisfy the market-based hard rules:
 *  UGC + sold out + full 1st/2nd/3rd ladder + 2nd/3rd close + 70%+ below
 *  the market value. A disk can outlive a deployment — a pre-market-rule
 *  (RAP-anchored) snapshot must never be hydrated. */
function dealStillValid(d: any): boolean {
  if (
    !d ||
    d.limitedType !== 2 ||
    d.soldOut !== true ||
    d.lowest <= 0 ||
    d.second <= 0 ||
    d.third <= 0
  ) {
    return false;
  }
  const ladderRatio = Math.max(d.second, d.third) / Math.min(d.second, d.third);
  if (ladderRatio > CONFIG.LADDER_MAX_RATIO) return false;
  const market = (d.second + d.third) / 2;
  return d.lowest <= market * CONFIG.MAX_LOWEST_MARKET_RATIO;
}

export function loadSnapshot(): DealsResponse | null {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const snap = JSON.parse(raw) as DealsResponse;
    if (
      snap &&
      snap.snapshotKey === `${SNAP_KEY}:deals` &&
      Array.isArray(snap.deals) &&
      snap.deals.every(dealStillValid)
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
