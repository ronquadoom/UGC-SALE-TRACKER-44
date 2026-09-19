/** The orchestrator: discover, filter, score, cache.
 *
 *  Free data pipeline:
 *  1. Rolimons full limited index (names + RAP for every tracked limited).
 *  2. Roblox catalog search "details" — sold-out, best-selling, trending,
 *     keyword sweeps + broad paginated crawl (this is how NEW limiteds appear).
 *  3. Rolimons deal/sale activity firehose for hot new items.
 *  4. Roblox collectible resellers endpoint for true 1st/2nd/3rd lowest price.
 *  5. Roblox economy details/resale-data for sales volume & supply.
 */
import { CONFIG } from "./config";
import { cacheGet, cacheSet } from "./cache";
import { fetchJson } from "./fetch";
import {
  catalogSearch,
  getResaleData,
  getResellers,
  getRobloxDetails,
  getThumbnails,
  type CatalogEntry,
} from "./roblox";
import {
  estimateSales30d,
  getItemPage,
  getRolimonsDealActivity,
  getRolimonsIndex,
  getRolimonsSaleActivity,
} from "./rolimons";
import { evaluate, projectedProfit, discountPct } from "./filter";
import { persistSnapshot } from "./storage";
import type { DealRecord, DealsResponse, PriceTuple } from "./types";

const SNAP_KEY = "ugc-deals-v11";
const RUN_KEY = "ugc-run";

/** Global (per warm instance) scan lock so concurrent requests don't stampede. */
declare global {
  // eslint-disable-next-line no-var
  var __ugcScan: Promise<void> | null;
}

function scanLock(run: () => Promise<void>): Promise<void> {
  if (globalThis.__ugcScan) return globalThis.__ugcScan;
  const p = run().finally(() => {
    if (globalThis.__ugcScan === p) globalThis.__ugcScan = null;
  });
  globalThis.__ugcScan = p;
  return p;
}

interface OrigItem {
  assetId: number;
  acronym: string;
  limitedType: number;
  rap: number;
  value: number;
}

interface ShallowMeta {
  value: number | null;
  soldOut: boolean;
  offSale: boolean;
  totalCopies: number;
  availableCopies: number;
  offSaleDeadline: string | null;
  numListings: number;
  sales: number;
}

/** Extract distinct lowest prices ignoring duplicate serials. */
function priceDepth(listings: { price: number; serialNumber: number | null }[]): {
  tuples: PriceTuple;
  numListings: number;
} {
  const seen = new Set<number>();
  const prices: number[] = [];
  for (const l of listings) {
    if (l.serialNumber != null) {
      if (seen.has(l.serialNumber)) continue;
      seen.add(l.serialNumber);
    } else if (prices.includes(l.price)) {
      continue;
    }
    prices.push(l.price);
    if (prices.length >= 3) break;
  }
  const [a = 0, b = 0, c = 0] = prices;
  return { tuples: [a, b, c], numListings: prices.length };
}

async function loadOrigins(): Promise<Map<number, OrigItem>> {
  const map = new Map<number, OrigItem>();
  try {
    const idx = await getRolimonsIndex();
    for (const e of idx.values()) {
      map.set(e.id, {
        assetId: e.id,
        acronym: e.acronym,
        limitedType: e.limitedType,
        rap: e.rap,
        value: e.value > 0 ? e.value : e.rap,
      });
    }
  } catch {
    /* fall through */
  }
  return map;
}

/** 1st pass over search results: keep plausible sold-out UGC limiteds. */
async function shallowMeta(e: CatalogEntry): Promise<ShallowMeta> {
  const soldOut =
    (e.priceStatus !== null &&
      e.priceStatus !== "Free" &&
      typeof e.unitsAvailableForConsumption === "number" &&
      e.unitsAvailableForConsumption <= 0) ||
    (e.totalQuantity > 0 && e.unitsAvailableForConsumption <= 0);
  const offSale =
    e.priceStatus === "Off Sale" ||
    (e.price != null && e.price <= 0 && e.unitsAvailableForConsumption <= 0);

  // The catalog "details" already returns lowestResalePrice; use it to skip
  // items that could never clear an 80% discount floor cheaply.
  return {
    value: null,
    soldOut,
    offSale,
    totalCopies: e.totalQuantity || 0,
    availableCopies: e.unitsAvailableForConsumption || 0,
    offSaleDeadline: e.offSaleDeadline,
    numListings: 0,
    sales: 0,
  };
}

export async function runScan(opts?: {
  quick?: boolean;
  onProgress?: (msg: string) => void;
  /** Soft deadline in ms; beyond it the scan stops crawling and caches partials. */
  deadlineMs?: number;
}): Promise<void> {
  const q = opts?.quick ?? false;
  const startMs = Date.now();
  const deadline = startMs + (opts?.deadlineMs ?? 40_000);
  const over = () => Date.now() > deadline;
  const report = (m: string) => opts?.onProgress?.(m);

  report("Loading Rolimons index…");
  const origins = await loadOrigins();

  report("Crawling catalog…");
  const discovered = new Map<
    number,
    { entry: CatalogEntry; meta: ShallowMeta; limitedType: number; acronym: string }
  >();

  const sortModes: Array<{ sortType: number; agg?: number; pages: number; incl?: boolean }> = [
    { sortType: 2, agg: 4, pages: Math.min(q ? 4 : CONFIG.CATALOG_PAGES, CONFIG.CATALOG_PAGES), incl: true }, // best-selling (30d)
    { sortType: 3, pages: Math.min(q ? 4 : 8, 8) }, // recently updated
    { sortType: 1, agg: 4, pages: 4 }, // most favorited (30d)
    { sortType: 0, pages: 3 }, // relevance/trending
  ];

  const add = async (entry: CatalogEntry, limit: { type: number; acronym: string }) => {
    if (discovered.has(entry.id)) return;
    const meta = await shallowMeta(entry);
    discovered.set(entry.id, { entry, meta, limitedType: limit.type, acronym: limit.acronym });
  };

  for (const mode of sortModes) {
    let cursor: string | undefined;
    for (let p = 0; p < mode.pages; p++) {
      if (over()) break;
      try {
        const res = await catalogSearch({
          sortType: mode.sortType,
          sortAggregation: mode.agg,
          includeNotForSale: mode.incl,
          limit: CONFIG.CATALOG_PAGE_LIMIT,
          cursor,
        });
        if (!res.data.length) break;
        for (const e of res.data) {
          const o = origins.get(e.id);
          await add(e, {
            type: o?.limitedType ?? (e.collectibleItemId ? 2 : 0),
            acronym: o?.acronym ?? "",
          });
        }
        if (!res.nextPageCursor) break;
        cursor = res.nextPageCursor;
      } catch (e) {
        report(`catalog page error: ${(e as Error)?.message}`);
        break;
      }
    }
  }

  // Keyword sweeps ("mystery" hunt) to pull emerging limiteds not yet ranked.
  const terms = CONFIG.MYSTERY_SEARCH_TERMS;
  for (const kw of terms.slice(0, 8)) {
    if (over()) break;
    try {
      const res = await catalogSearch({ keyword: kw, sortType: 2, sortAggregation: 5, limit: 28 });
      for (const e of res.data) {
        const o = origins.get(e.id);
        await add(e, { type: o?.limitedType ?? (e.collectibleItemId ? 2 : 0), acronym: o?.acronym ?? "" });
      }
    } catch {
      /* non-fatal */
    }
  }

  // activity firehose
  const [dealActs, saleActs] = await Promise.all([
    getRolimonsDealActivity(),
    getRolimonsSaleActivity(),
  ]);
  const activityIds = new Set<number>();
  for (const a of dealActs) activityIds.add(a.itemId);
  for (const a of saleActs) activityIds.add(a.itemId);
  for (const id of activityIds) {
    if (over()) break;
    if (discovered.has(id)) continue;
    const o = origins.get(id);
    const limitType = o?.limitedType ?? (id > 1_000_000_000 ? 2 : 0);
    const details = await getRobloxDetails(id);
    if (!details) continue;
    const entry: CatalogEntry = {
      id,
      itemType: "Asset",
      assetType: 8,
      name: "",
      description: "",
      price: null,
      lowestPrice: null,
      lowestResalePrice: details.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null,
      priceStatus: details.IsForSale ? "For Sale" : "Off Sale",
      unitsAvailableForConsumption: details.Remaining ?? 0,
      favoriteCount: 0,
      totalQuantity: details.CollectiblesItemDetails?.TotalQuantity ?? 0,
      collectibleItemId: null,
      creatorType: "",
      creatorName: "",
      saleLocationType: null,
      hasResellers:
        (details.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? 0) > 0,
      offSaleDeadline: null,
    };
    await add(entry, { type: limitType, acronym: o?.acronym ?? "" });
  }

  report(`Discovered ${discovered.size} candidate items…`);

  // ---- Filter shortlisting BEFORE any per-item network cost ----------------
  const shorts: {
    entry: CatalogEntry;
    meta: ShallowMeta;
    limitedType: number;
    acronym: string;
  }[] = [];

  for (const d of discovered.values()) {
    const o = origins.get(d.entry.id);
    const limitedType = d.limitedType || o?.limitedType || 0;
    const isUgc = limitedType === 2;

    if (!isUgc) continue; // volume API only covers limiteds precisely

    const soldOut = d.meta.soldOut;
    if (!soldOut) continue; // hard rule #1
    if (d.meta.offSale && d.meta.totalCopies <= 1) continue; // freebie/1-copy junk

    // Skip obvious non-deals using the catalog's own lowestResalePrice when present.
    const catLow = d.entry.lowestResalePrice;
    const oRap = o ? Math.max(o.rap, o.value) : 0;
    if (typeof catLow === "number" && catLow > 0 && oRap > 0) {
      if (catLow > oRap * 0.28) continue; // cannot be ≥80% off
    }

    shorts.push({ entry: d.entry, meta: d.meta, limitedType, acronym: d.acronym ?? o?.acronym ?? "" });
  }

  report(`Shortlisted ${shorts.length} sold-out UGC limiteds…`);

  const rolimons = await getRolimonsIndex();
  // prioritized depth checks
  const values = new Map<number, PriceTuple>();
  const counts = new Map<number, number>();
  const metas = new Map<number, ShallowMeta>();

  // note IDs needing collectible ids from the entry we already hold
  const qDepth = shorts
    .map((s) => s.entry)
    .slice(0, q ? 220 : shorts.length);

  let checked = 0;
  const BATCH = 10;
  for (let i = 0; i < qDepth.length; i += BATCH) {
    if (over()) break;
    const slice = qDepth.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (entry) => {
        try {
          if (!entry.collectibleItemId) return;
          const listings = await getResellers(entry.collectibleItemId, 10);
          const { tuples, numListings } = priceDepth(listings);
          values.set(entry.id, tuples);
          counts.set(entry.id, numListings);
          const shallow = discovered.get(entry.id)?.meta;
          if (shallow) {
            metas.set(entry.id, { ...shallow, numListings });
          }
        } catch {
          /* non-fatal */
        }
      })
    );
    checked += slice.length;
  }
  report(`Priced ${checked} items (depth ${values.size})…`);

  // ---- Volume + supply pass (bounded) ------------------------------------
  const volume = new Map<number, number>();
  const salesSorted = [...shorts].sort(
    (a, b) => (b.entry.favoriteCount || 0) - (a.entry.favoriteCount || 0)
  );
  const volumeTargets = salesSorted.slice(
    0,
    q ? 150 : CONFIG.MAX_OFFSALE_VOLUME_CHECKS
  );
  let vchecked = 0;
  for (let i = 0; i < volumeTargets.length; i += BATCH) {
    if (over()) break;
    const slice = volumeTargets.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (s) => {
        const id = s.entry.id;
        if (!values.has(id)) return;
        const [a] = values.get(id)!;
        if (a <= 0) return;

        // Primary volume signal: Rolimons item page "tracked N sales over D days".
        const page = await getItemPage(id);
        if (page) {
          if (page.salesRecent != null && page.salesDays != null) {
            const est = estimateSales30d(page.salesRecent, page.salesDays);
            if (est > 0) volume.set(id, est);
          }
          const snap = metas.get(id);
          if (snap && page.totalCopies != null) {
            metas.set(id, { ...snap, totalCopies: page.totalCopies });
          }
          return;
        }

        // Fallback: classic limiteds expose cumulative sales via resale-data.
        const rd = await getResaleData(id);
        if (rd && rd.sales > 0) {
          volume.set(id, rd.sales);
          return;
        }

        // Last resort: supply + economy details.
        const det = await getRobloxDetails(id);
        const c = det?.CollectiblesItemDetails;
        if (c) {
          const snap = metas.get(id);
          if (snap) {
            metas.set(id, {
              ...snap,
              totalCopies: c.TotalQuantity || snap.totalCopies,
              soldOut: !c.IsForSale && c.CollectibleLowestResalePrice != null,
            });
          }
        }
      })
    );
    vchecked += slice.length;
  }
  report(`Volume checked ${vchecked} items…`);

  // ---- Build deal records -------------------------------------------------
  const out: DealRecord[] = [];
  const now = Date.now();

  for (const s of shorts) {
    const id = s.entry.id;
    const tup = values.get(id);
    if (!tup) continue;
    const [a, b, c] = tup;
    if (a <= 0) continue;

    const rd = rolimons.get(id);
    const o = origins.get(id);
    const meta = metas.get(id) || s.meta;
    const rap = rd ? Math.max(rd.rap, 0) : o ? Math.max(o?.rap ?? 0, 0) : 0;
    const value = rd && rd.value > 0 ? rd.value : null;
    const disc = discountPct(rap, a);
    const vol = volume.get(id) ?? 0;
    const spreadX = a > 0 && b > 0 ? Math.round((b / a) * 100) / 100 : null;
    const profit = projectedProfit(c, a);

    const rec: DealRecord = {
      id: String(id),
      assetId: id,
      name: s.entry.name || rd?.name || "",
      acronym: s.acronym.trim(),
      url: `https://www.roblox.com/catalog/${id}`,
      thumbUrl: null,
      rap,
      value,
      lowest: a,
      second: b,
      third: c,
      discountPct: disc,
      spreadX,
      sales30d: vol,
      originalSales: 0,
      totalCopies: meta.totalCopies || 0,
      availableCopies: meta.availableCopies || 0,
      soldOut: meta.soldOut,
      offSale: meta.offSale,
      projectable: b < rap * 0.7 || c < rap * 0.7 ? false : true,
      projectedProfit: profit,
      projectedProfitPct: rap > 0 ? Math.round((profit / rap) * 100) : 0,
      premiumScore: scorePremium({ cop: meta.totalCopies, vol, rap, disc, spreadX }),
      numListings: meta.numListings || counts.get(id) || 0,
      limitedType: s.limitedType,
      updatedAt: now,
      firstSeenAt: now,
      failReasons: [],
      passOverrides: {},
    };

    const ev = evaluate(rec);
    rec.failReasons = ev.reasons;
    rec.passOverrides = {
      premiumOnly: ev.premiumOnly,
      projectableOnly: ev.projectableOnly,
    };

    if (!ev.passesHard) continue;

    out.push(rec);
  }

  report(`Filtered to ${out.length} deals…`);

  // ---- thumbnails ---------------------------------------------------------
  const ids = out.map((d) => d.assetId);
  const thumbs = await getThumbnails(ids);
  const ttl = CONFIG.CACHE_TTL_MS;
  const key = `${SNAP_KEY}:deals`;
  cacheSet(
    key,
    {
      deals: out,
      total: out.length,
      generatedAt: Date.now(),
      ttlMs: ttl,
      snapshotKey: key,
      fromCache: false,
      scan: {
        lastFullScanAt: Date.now(),
        lastFullScanMs: Date.now() - startMs,
        lastRefreshAt: Date.now(),
        sourceInfos: discovered.size,
        refreshQueue: 0,
        canRefresh: true,
      },
      sourceStats: {
        catalog: discovered.size,
        rolimons: rolimons.size,
        activity: activityIds.size,
        candidates: shorts.length,
        filtered: out.length,
        depthChecks: values.size,
        volumeChecks: volume.size,
      },
    } as DealsResponse,
    ttl
  );
  cacheSet(RUN_KEY, { at: Date.now(), ms: 0 }, 24 * 60 * 60 * 1000);
  persistSnapshot(cacheGet<DealsResponse>(key)!);
  report(`Done: ${out.length} deals cached.`);
}

function scorePremium(p: { cop: number; vol: number; rap: number; disc: number; spreadX: number | null }): number {
  let s = 0;
  s += Math.min(p.cop / CONFIG.PREMIUM_COPIES, 2) * 25; // ≤50
  s += Math.min(p.vol / CONFIG.VOLUME_FLOOR, 10) * 2.5; // ≤25
  s += Math.min(p.rap / 1000, 10) * 1.5; // ≤15
  s += ((p.disc - CONFIG.DISCOUNT_FLOOR) / 20) * 10; // ≤10
  if (p.spreadX && p.spreadX >= 3) s += 8;
  else if (p.spreadX && p.spreadX >= 2) s += 4;
  return Math.round(s * 10) / 10;
}

/** Return the freshest snapshot of deals, optionally triggering a refresh. */
export async function getDeals(opts?: {
  force?: boolean;
  /** The `mate` endpoint answers instantly when a scan is already running. */
  mate?: boolean;
}): Promise<DealsResponse> {
  const key = `${SNAP_KEY}:deals`;
  const cached = cacheGet<DealsResponse>(key);

  // If a scan is in flight and the caller is a "mate" probe, answer instantly
  // with whatever we have (possibly null → scanning state).
  if (opts?.mate && globalThis.__ugcScan) {
    if (cached) return { ...cached, fromCache: true };
    return emptySnapshot();
  }
  // Promise coalescing: if another request is already scanning, join it.
  if (globalThis.__ugcScan) {
    await globalThis.__ugcScan;
    const snap = cacheGet<DealsResponse>(key);
    if (snap) return { ...snap, fromCache: true };
  }

  const fresh = cached && Date.now() - cached.generatedAt < CONFIG.CACHE_TTL_MS;
  if (fresh && !opts?.force) {
    return { ...cached, fromCache: true };
  }

  if (opts?.force) {
    await scanLock(() => runScan({ quick: false, deadlineMs: 55_000 }));
    return (cacheGet<DealsResponse>(key)) || emptySnapshot();
  }

  if (cached && CacheTTLOk(cached.generatedAt)) {
    // Stale-but-usable: serve it and kick a background refresh (not awaited).
    if (!globalThis.__ugcScan) {
      void scanLock(() => runScan({ quick: true })).catch(() => {});
    }
    return { ...cached, fromCache: true };
  }

  // Absent → rescan inline (first boot).
  await scanLock(() => runScan({ quick: false, deadlineMs: 55_000 }));
  const freshSnap = cacheGet<DealsResponse>(key);
  return freshSnap || emptySnapshot();
}

function emptySnapshot(): DealsResponse {
  return {
    deals: [],
    total: 0,
    generatedAt: Date.now(),
    ttlMs: CONFIG.CACHE_TTL_MS,
    snapshotKey: `${SNAP_KEY}:deals`,
    fromCache: false,
    scan: {
      lastFullScanAt: null,
      lastFullScanMs: null,
      lastRefreshAt: null,
      sourceInfos: 0,
      refreshQueue: 0,
      canRefresh: false,
    },
    sourceStats: null,
    scanning: true,
  };
}

function CacheTTLOk(at: number): boolean {
  return Date.now() - at < CONFIG.SNAPSHOT_STALE_MS;
}

/** Serves the "latest price" endpoint used by the browser watchdog fallback. */
export async function getLatestPrices(assetId: number): Promise<PriceTuple | null> {
  const key = `ugc-price-${assetId}`;
  const cached = cacheGet<PriceTuple>(key);
  if (cached) return cached;
  try {
    const det = await getRobloxDetails(assetId);
    let cid = det?.CollectibleItemId || null;
    if (!cid) {
      const c = await fetchJson(
        `https://catalog.roblox.com/v1/catalog/items/${assetId}/details?itemType=Asset`,
        {},
        { retries: 1, timeoutMs: 8000 }
      );
      cid = c?.collectibleItemId ? String(c.collectibleItemId) : null;
    }
    if (!cid) return null;
    const listings = await getResellers(String(cid), 10);
    const { tuples } = priceDepth(listings);
    if (tuples[0] <= 0) return null;
    cacheSet(key, tuples, 15 * 60 * 1000);
    return tuples;
  } catch {
    return null;
  }
}

/** How long since the last full scan (0 if unknown). */
export function sinceLastScan(): number {
  const r = cacheGet<{ at: number }>(RUN_KEY);
  return r ? r.at : 0;
}

const refreshing = new Set<string>();

/** Refresh a single asset's price depth in place (used by the watchdog). */
export async function refreshAssetPrices(assetId: number): Promise<PriceTuple | null> {
  if (refreshing.has(String(assetId))) return null;
  refreshing.add(String(assetId));
  try {
    const tup = await getLatestPrices(assetId);
    if (tup) {
      // Update the cached deal price fields if present.
      const key = `${SNAP_KEY}:deals`;
      const snap = cacheGet<DealsResponse>(key);
      if (snap) {
        const d = snap.deals.find((x) => x.assetId === assetId);
        if (d) {
          d.lowest = tup[0];
          d.second = tup[1];
          d.third = tup[2];
          d.discountPct = discountPct(d.rap, tup[0]);
          d.projectable = tup[2] >= d.rap * 0.7;
          d.projectedProfit = projectedProfit(tup[2], tup[0]);
          d.updatedAt = Date.now();
          cacheSet(key, snap, snap.ttlMs);
        }
      }
    }
    return tup;
  } finally {
    refreshing.delete(String(assetId));
  }
}
