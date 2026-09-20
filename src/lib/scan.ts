/** The orchestrator: discover, filter, score, cache.
 *
 *  Free data pipeline (all keyless public endpoints):
 *  1. Roblox catalog search (best-selling 30d / recently updated / trending,
 *     collectibles only, IncludeNotForSale) — discovery + the authoritative
 *     `itemRestrictions` UGC flag.
 *  2. Rolimons live deal/sale activity — seeds of the freshest hot items.
 *  3. Roblox collectible resellers endpoint — the true 1st/2nd/3rd price ladder.
 *  4. Rolimons item pages — sales volume (past 30 days) ONLY, and RAP as a
 *     display reference. Rolimons never judges a deal.
 *
 *  Deal decision (RAP-independent): the 2nd and 3rd lowest listings must be
 *  close to each other (their average = real market value) and the lowest
 *  listing must be at least 70% below that market value. See filter.ts.
 *
 *  The scan is budgeted to finish well inside serverless timeouts (~40s full)
 *  so a first cold boot cannot get stuck in a 503 "scanning" loop.
 */
import { CONFIG } from "./config";
import { cacheGet, cacheSet } from "./cache";
import {
  catalogSearch,
  getCatalogItemDetails,
  getResellers,
  getRobloxDetails,
  getThumbnails,
  isUgcLimitedEntry,
  type CatalogEntry,
  type CatalogItemDetails,
} from "./roblox";
import {
  getItemPage,
  getRolimonsDealActivity,
  getRolimonsIndex,
  getRolimonsSaleActivity,
  pageRap,
  pageSales30d,
} from "./rolimons";
import {
  discountPct,
  evaluate,
  ladderClose,
  marketValue,
  projectedProfit,
  tierFor,
} from "./filter";
import { persistSnapshot } from "./storage";
import type { DealRecord, DealTier, DealsResponse, PriceTuple } from "./types";

// Bump the snapshot namespace so a pre-market-rule snapshot can never be
// served after this version is deployed.
const SNAP_KEY = "ugc-deals-v14";
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
  name: string;
  acronym: string;
  /** Display reference only — never used to gate a deal. */
  rap: number;
  value: number;
}

interface ShallowMeta {
  soldOut: boolean;
  offSale: boolean;
  totalCopies: number;
  availableCopies: number;
  offSaleDeadline: string | null;
  numListings: number;
}

/**
 * Build the 1st/2nd/3rd listing ladder from the resale book.
 *
 * The second and third checks intentionally use individual serial listings,
 * not just distinct price levels. If two or three sellers are all at the same
 * crashed floor, the item must be rejected. Duplicate serial rows are removed
 * because Roblox can repeat the same listing in a response; duplicate prices
 * from different serials remain meaningful market evidence.
 */
function priceDepth(listings: { price: number; serialNumber: number | null }[]): {
  tuples: PriceTuple;
  numListings: number;
  floorCopies: number;
} {
  const seenSerial = new Set<number>();
  const valid: { price: number; serialNumber: number | null }[] = [];
  const perLevel = new Map<number, number>();
  const sorted = listings
    .filter((l) => Number.isFinite(l.price) && l.price > 0)
    .slice()
    .sort((a, b) => a.price - b.price);

  for (const l of sorted) {
    if (l.serialNumber != null) {
      if (seenSerial.has(l.serialNumber)) continue;
      seenSerial.add(l.serialNumber);
    }
    valid.push(l);
    perLevel.set(l.price, (perLevel.get(l.price) ?? 0) + 1);
  }

  const [a = 0, b = 0, c = 0] = valid.map((l) => l.price);
  return {
    tuples: [a, b, c],
    numListings: valid.length,
    floorCopies: a > 0 ? perLevel.get(a) ?? 0 : 0,
  };
}

async function loadOrigins(): Promise<Map<number, OrigItem>> {
  const map = new Map<number, OrigItem>();
  try {
    const idx = await getRolimonsIndex();
    for (const e of idx.values()) {
      map.set(e.id, {
        assetId: e.id,
        name: e.name,
        acronym: e.acronym,
        rap: e.rap,
        value: e.value > 0 ? e.value : e.rap,
      });
    }
  } catch {
    /* Rolimons index is a nice-to-have (names, RAP reference), not a gate. */
  }
  return map;
}

/** 1st pass over a search result: sold-out + resale state, no network. */
function shallowMeta(e: CatalogEntry): ShallowMeta {
  const soldOut =
    e.unitsAvailableForConsumption <= 0 &&
    (e.totalQuantity > 0 ||
      e.priceStatus === "Off Sale" ||
      e.priceStatus === "No Resellers" ||
      e.priceStatus === "Sold Out");
  const offSale =
    e.priceStatus === "Off Sale" ||
    (e.price != null && e.price <= 0 && e.unitsAvailableForConsumption <= 0);

  return {
    soldOut,
    offSale,
    totalCopies: e.totalQuantity || 0,
    availableCopies: e.unitsAvailableForConsumption || 0,
    offSaleDeadline: e.offSaleDeadline,
    numListings: 0,
  };
}

/** A catalog item-details row is a complete candidate — no 2nd call needed. */
function entryFromDetails(d: CatalogItemDetails, id: number, fallbackName: string): CatalogEntry {
  return {
    id,
    itemType: "Asset",
    assetType: 8,
    name: d.name || fallbackName,
    description: "",
    price: d.price,
    lowestPrice: d.lowestResalePrice,
    lowestResalePrice: d.lowestResalePrice,
    priceStatus: d.priceStatus,
    unitsAvailableForConsumption: d.unitsAvailableForConsumption ?? 0,
    favoriteCount: d.favoriteCount,
    totalQuantity: d.totalQuantity ?? 0,
    collectibleItemId: d.collectibleItemId,
    creatorType: d.creatorType,
    creatorName: d.creatorName,
    saleLocationType: d.saleLocationType,
    hasResellers: d.hasResellers,
    offSaleDeadline: d.offSaleDeadline,
    itemRestrictions: d.itemRestrictions,
  };
}

export async function runScan(opts?: {
  quick?: boolean;
  onProgress?: (msg: string) => void;
  /** Soft deadline in ms; beyond it the scan stops crawling and keeps what it has. */
  deadlineMs?: number;
}): Promise<void> {
  const q = opts?.quick ?? false;
  const startMs = Date.now();
  // A full scan must stay under the serverless timeout (60s) with headroom.
  const deadline = startMs + (opts?.deadlineMs ?? (q ? 25_000 : 40_000));
  const over = () => Date.now() > deadline;
  const report = (m: string) => opts?.onProgress?.(m);

  report("Loading Rolimons index (names + RAP reference)…");
  const origins = await loadOrigins();

  // ---- Discovery -----------------------------------------------------------
  report("Crawling Roblox catalog…");
  const discovered = new Map<number, { entry: CatalogEntry; meta: ShallowMeta }>();

  const sortModes: Array<{ sortType: number; agg?: number; pages: number; incl?: boolean }> = [
    // Best-selling collectibles (30d) — sold-out UGC surfaces here via
    // IncludeNotForSale; this is where most deal candidates live.
    { sortType: 2, agg: 4, pages: q ? 4 : CONFIG.CATALOG_PAGES, incl: true },
    // Recently updated — resurfaced / re-listed sold-out items.
    { sortType: 3, pages: q ? 2 : 4, incl: true },
    // Relevance/trending.
    { sortType: 0, pages: q ? 2 : 3 },
  ];

  const add = async (entry: CatalogEntry) => {
    if (discovered.has(entry.id)) return;
    discovered.set(entry.id, { entry, meta: shallowMeta(entry) });
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
        for (const e of res.data) await add(e);
        if (!res.nextPageCursor) break;
        cursor = res.nextPageCursor;
      } catch (e) {
        report(`catalog page error: ${(e as Error)?.message}`);
        break;
      }
    }
  }

  // Keyword sweeps ("mystery" hunt) for emerging limiteds not yet ranked.
  const terms = CONFIG.MYSTERY_SEARCH_TERMS;
  for (const kw of terms.slice(0, 8)) {
    if (over()) break;
    try {
      const res = await catalogSearch({ keyword: kw, sortType: 2, sortAggregation: 5, limit: 28 });
      for (const e of res.data) await add(e);
    } catch {
      /* non-fatal */
    }
  }

  // ---- Live activity seeds (Rolimons: what just sold / got listed) ---------
  // One catalog-details call per seed: it carries the authoritative
  // itemRestrictions, collectibleItemId, creator, supply and reseller state.
  const [dealActs, saleActs] = await Promise.all([
    getRolimonsDealActivity(),
    getRolimonsSaleActivity(),
  ]);
  const activityIds = new Set<number>();
  for (const a of dealActs) activityIds.add(a.itemId);
  for (const a of saleActs) activityIds.add(a.itemId);

  const seeds = [...activityIds].slice(0, Math.max(0, CONFIG.MAX_ACTIVITY_SEEDS));
  let seeded = 0;
  for (let i = 0; i < seeds.length; i += 10) {
    if (over()) break;
    await Promise.all(
      seeds.slice(i, i + 10).map(async (id) => {
        if (discovered.has(id)) return;
        const catalog = await getCatalogItemDetails(id);
        if (
          !catalog ||
          !isUgcLimitedEntry({
            collectibleItemId: catalog.collectibleItemId,
            itemRestrictions: catalog.itemRestrictions,
          })
        ) {
          return; // classic limited or unknown → never enters the candidate set
        }
        const o = origins.get(id);
        await add(entryFromDetails(catalog, id, o?.name ?? ""));
        seeded++;
      })
    );
  }

  report(
    `Discovered ${discovered.size} candidate items… (${seeded} seeded from Rolimons activity)`
  );

  // ---- Shortlist: UGC + sold out + has a live book -------------------------
  // No RAP anywhere in this gate — that was the old zero-deals bug.
  const shorts: { entry: CatalogEntry; meta: ShallowMeta; acronym: string }[] = [];
  for (const d of discovered.values()) {
    // Only the explicit catalog `Collectible` restriction counts as UGC.
    // Classic Roblox Limited/LimitedUnique rows are rejected outright.
    if (!isUgcLimitedEntry(d.entry)) continue;
    if (!d.meta.soldOut) continue; // hard rule: must be sold out
    if (d.meta.offSale && d.meta.totalCopies <= 1) continue; // 1-copy junk
    if (d.entry.hasResellers === false) continue; // no book → no ladder
    if ((d.entry.lowestResalePrice ?? 0) <= 0) continue; // nothing listed
    const o = origins.get(d.entry.id);
    shorts.push({ entry: d.entry, meta: d.meta, acronym: o?.acronym ?? "" });
  }

  // Items seen in live activity get first crack at the depth budget.
  shorts.sort(
    (a, b) =>
      Number(activityIds.has(b.entry.id)) - Number(activityIds.has(a.entry.id)) ||
      (b.entry.favoriteCount || 0) - (a.entry.favoriteCount || 0)
  );

  report(`Shortlisted ${shorts.length} sold-out UGC collectibles…`);

  // ---- Depth pass: live 1st/2nd/3rd ladder (bounded) -----------------------
  const qDepth = shorts.slice(0, q ? 60 : CONFIG.MAX_DEPTH_CHECKS);
  const values = new Map<number, PriceTuple>();
  const counts = new Map<number, number>();
  /** copies sitting at the floor price */
  const floors = new Map<number, number>();
  const metas = new Map<number, ShallowMeta>();

  let checked = 0;
  const BATCH = 12;
  for (let i = 0; i < qDepth.length; i += BATCH) {
    if (over()) break;
    const slice = qDepth.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (s) => {
        try {
          const entry = s.entry;
          let cid = entry.collectibleItemId;
          let creator = entry.creatorName;
          if (!cid || !creator) {
            const det = await getCatalogItemDetails(entry.id);
            if (det && det.itemRestrictions.length > 0) {
              // Re-check the authoritative catalog details before spending a
              // reseller request. Never let an ambiguous/classic row through.
              if (
                !isUgcLimitedEntry({
                  collectibleItemId: det.collectibleItemId ?? cid,
                  itemRestrictions: det.itemRestrictions,
                })
              ) {
                return;
              }
            }
            cid = det?.collectibleItemId ?? cid;
            if (det?.creatorName) {
              creator = det.creatorName;
              entry.creatorName = creator;
            }
          }
          if (!cid) return;

          const listings = await getResellers(cid, CONFIG.RESELLER_FETCH_LIMIT);
          const { tuples, numListings, floorCopies } = priceDepth(listings);
          if (numListings === 0 || tuples[0] <= 0) return;

          values.set(entry.id, tuples);
          counts.set(entry.id, numListings);
          floors.set(entry.id, floorCopies);
          metas.set(entry.id, {
            ...s.meta,
            numListings,
            totalCopies: metas.get(entry.id)?.totalCopies ?? s.meta.totalCopies,
          });
        } catch {
          /* non-fatal */
        }
      })
    );
    checked += slice.length;
  }
  report(`Priced ${checked} items (ladders ${values.size})…`);

  // ---- Market gate BEFORE any volume cost ----------------------------------
  // Only items whose live ladder already proves a deep undercut pay for a
  // Rolimons item-page scrape. This is what keeps the scan fast AND means
  // Rolimons volume is the last, ranking-only step — never the gate.
  interface Passer {
    entry: CatalogEntry;
    meta: ShallowMeta;
    acronym: string;
    tup: PriceTuple;
    market: number;
    disc: number;
    tier: DealTier;
    verified: boolean;
  }
  const passers: Passer[] = [];
  for (const s of shorts) {
    const tup = values.get(s.entry.id);
    if (!tup) continue;
    const [a, b, c] = tup;
    if (a <= 0 || b <= 0 || c <= 0) continue; // need a full 1st/2nd/3rd ladder
    const market = marketValue(b, c);
    if (market <= 0) continue;
    if (!ladderClose(b, c)) continue; // 2nd/3rd not close → no market value
    const disc = discountPct(market, a);
    const tier = tierFor(disc);
    if (!tier) continue; // below the 70% floor
    passers.push({
      entry: s.entry,
      meta: s.meta,
      acronym: s.acronym,
      tup,
      market,
      disc,
      tier,
      verified: ladderClose(b, c),
    });
  }
  report(`${passers.length} items pass the 70%-below-market gate…`);

  // ---- Volume pass: Rolimons pages, sales only (bounded) -------------------
  const volume = new Map<number, number>();
  /** RAP (display reference) recovered from item pages for items missing from the index. */
  const pageRaps = new Map<number, number>();
  const pageValues = new Map<number, number>();
  const volTargets = [...passers]
    .sort(
      (x, y) =>
        Number(activityIds.has(y.entry.id)) - Number(activityIds.has(x.entry.id)) ||
        y.disc - x.disc
    )
    .slice(0, q ? 20 : CONFIG.MAX_VOLUME_CHECKS);
  let vchecked = 0;
  for (let i = 0; i < volTargets.length; i += 8) {
    if (over()) break;
    const slice = volTargets.slice(i, i + 8);
    await Promise.all(
      slice.map(async (p) => {
        const id = p.entry.id;
        const page = await getItemPage(id);
        if (!page) return;
        const est = pageSales30d(page);
        if (est > 0) volume.set(id, est);
        const rap = pageRap(page);
        if (rap > 0 && (origins.get(id)?.rap ?? 0) <= 0) pageRaps.set(id, rap);
        if (page.value != null && page.value > 0) pageValues.set(id, page.value);
        if (page.totalCopies) metas.get(id) && metas.set(id, { ...metas.get(id)!, totalCopies: page.totalCopies });
        if (page.availableCopies != null) metas.get(id) && metas.set(id, { ...metas.get(id)!, availableCopies: page.availableCopies });
      })
    );
    vchecked += slice.length;
  }
  report(`Volume checked ${vchecked} items (Rolimons, sales only)…`);

  // ---- Build deal records ---------------------------------------------------
  const out: DealRecord[] = [];
  const tierCounts = { hot: 0, strong: 0, deal: 0 };
  let verifiedCount = 0;
  const now = Date.now();

  for (const p of passers) {
    const id = p.entry.id;
    const [a, b, c] = p.tup;
    const o = origins.get(id);
    const meta = metas.get(id) || p.meta;
    const vol = volume.get(id) ?? 0;

    // RAP: index → item page → 0. Display reference ONLY; 0 never blocks a
    // deal (that was the old "0 deals" bug).
    const rap = Math.max(o?.rap ?? 0, pageRaps.get(id) ?? 0);
    const value =
      o && o.value > 0 ? o.value : pageValues.get(id) ?? null;
    const spreadX = a > 0 && b > 0 ? Math.round((b / a) * 100) / 100 : null;
    const profit = projectedProfit(c, a, b);

    const rec: DealRecord = {
      id: String(id),
      assetId: id,
      name: p.entry.name || o?.name || "",
      acronym: p.acronym.trim(),
      creator: p.entry.creatorName.trim() || "Unknown creator",
      url: `https://www.roblox.com/catalog/${id}`,
      thumbUrl: null,
      rap,
      value,
      lowest: a,
      second: b,
      third: c,
      marketValue: p.market,
      discountPct: p.disc,
      spreadX,
      sales30d: vol,
      originalSales: null,
      totalCopies: meta.totalCopies || 0,
      availableCopies: meta.availableCopies || 0,
      soldOut: meta.soldOut,
      offSale: meta.offSale,
      projectable: p.verified,
      projectedProfit: profit,
      projectedProfitPct:
        p.market > 0 ? Math.round((profit / p.market) * 100) : 0,
      premiumScore: scorePremium({
        cop: meta.totalCopies,
        vol,
        disc: p.disc,
        spreadX,
        tier: p.tier,
        verified: p.verified,
      }),
      numListings: meta.numListings || counts.get(id) || 0,
      limitedType: 2,
      tier: p.tier,
      floorCopies: floors.get(id) ?? 0,
      depthVerified: p.verified,
      updatedAt: now,
      firstSeenAt: now,
      failReasons: [],
      passOverrides: {},
    };

    // Defense in depth: the record must survive the independent hard gate.
    const ev = evaluate(rec);
    rec.failReasons = ev.reasons;
    rec.passOverrides = { projectableOnly: ev.projectableOnly };
    if (!ev.passesHard) continue;

    tierCounts[p.tier]++;
    if (p.verified) verifiedCount++;
    out.push(rec);
  }

  // Best deals first: tier, then deepest undercut, then score.
  const tierRank: Record<DealTier, number> = { hot: 3, strong: 2, deal: 1 };
  out.sort(
    (x, y) =>
      tierRank[y.tier as DealTier] - tierRank[x.tier as DealTier] ||
      y.discountPct - x.discountPct ||
      y.premiumScore - x.premiumScore
  );

  report(
    `Filtered to ${out.length} deals (hot ${tierCounts.hot} · strong ${tierCounts.strong} · deal ${tierCounts.deal})…`
  );

  // ---- thumbnails + cache ---------------------------------------------------
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
        rolimons: origins.size,
        activity: activityIds.size,
        candidates: shorts.length,
        filtered: out.length,
        depthChecks: values.size,
        volumeChecks: volume.size,
        rapFromPage: pageRaps.size,
        depthVerified: verifiedCount,
        tiers: { ...tierCounts },
      },
    } as DealsResponse,
    ttl
  );
  cacheSet(RUN_KEY, { at: Date.now(), ms: 0 }, 24 * 60 * 60 * 1000);
  const snap = cacheGet<DealsResponse>(key);
  if (snap) persistSnapshot(snap);
  report(`Done: ${out.length} deals cached in ${Math.round((Date.now() - startMs) / 1000)}s.`);
}

function scorePremium(p: {
  cop: number;
  vol: number;
  disc: number;
  spreadX: number | null;
  tier: DealTier;
  verified: boolean;
}): number {
  let s = 0;
  // Preferences (not gates): big copy counts, decent sales volume, deep cut.
  s += Math.min(p.cop / CONFIG.PREMIUM_COPIES, 2) * 20; // ≤40 — 1500+ copies
  s += Math.min(p.vol / CONFIG.VOLUME_FLOOR, 10) * 2; // ≤20 — sales volume
  s += p.tier === "hot" ? 18 : p.tier === "strong" ? 10 : 4;
  s += Math.min(Math.max(p.disc - CONFIG.DEAL_MIN, 0) / 4, 15); // ≤15
  if (p.verified) s += 7;
  if (p.spreadX && p.spreadX >= 5) s += 5;
  else if (p.spreadX && p.spreadX >= 3) s += 3;
  return Math.round(s * 10) / 10;
}

/** Return the freshest snapshot of deals, optionally triggering a refresh.
 *
 *  Never throws for a failed scan: a stale snapshot is served instead, so a
 *  cold serverless boot can never get stuck returning 503 forever.
 */
export async function getDeals(opts?: {
  force?: boolean;
  /** The `mate` endpoint answers instantly when a scan is already running. */
  mate?: boolean;
}): Promise<DealsResponse> {
  const key = `${SNAP_KEY}:deals`;
  const cached = cacheGet<DealsResponse>(key);

  // If a scan is in flight and the caller is a "mate" probe, answer instantly
  // with whatever we have (possibly nothing → scanning state).
  if (opts?.mate && globalThis.__ugcScan) {
    if (cached) return { ...cached, fromCache: true };
    return emptySnapshot();
  }
  // Promise coalescing: if another request is already scanning, join it.
  if (globalThis.__ugcScan) {
    await globalThis.__ugcScan.catch(() => {});
    const snap = cacheGet<DealsResponse>(key);
    if (snap) return { ...snap, fromCache: true };
  }

  const fresh = cached && Date.now() - cached.generatedAt < CONFIG.CACHE_TTL_MS;
  if (fresh && !opts?.force) {
    return { ...cached, fromCache: true };
  }

  try {
    if (opts?.force) {
      await scanLock(() => runScan({ quick: false, deadlineMs: 45_000 }));
      return cacheGet<DealsResponse>(key) || emptySnapshot();
    }
    if (cached && Date.now() - cached.generatedAt < CONFIG.SNAPSHOT_STALE_MS) {
      // Stale-but-usable: serve it and kick a background refresh (not awaited).
      if (!globalThis.__ugcScan) {
        void scanLock(() => runScan({ quick: true })).catch(() => {});
      }
      return { ...cached, fromCache: true };
    }
    // Absent → rescan inline (first boot), budgeted to fit the timeout.
    await scanLock(() => runScan({ quick: false, deadlineMs: 40_000 }));
  } catch (e) {
    // Scan failed (network hiccups, timeout, …): fall through and serve
    // whatever snapshot exists rather than 503.
    reportScanFailure(e);
  }
  return cacheGet<DealsResponse>(key) || emptySnapshot();
}

function reportScanFailure(e: unknown): void {
  try {
    // Serverless logs are the only reliable sink; never let logging throw.
    // eslint-disable-next-line no-console
    console.error("[ugc-snap] scan failed:", (e as Error)?.message ?? e);
  } catch {
    /* ignore */
  }
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

/** Serves the "latest price" endpoint used by the browser watchdog fallback. */
export async function getLatestPrices(assetId: number): Promise<PriceTuple | null> {
  const key = `ugc-price-${assetId}`;
  const cached = cacheGet<PriceTuple>(key);
  if (cached) return cached;
  try {
    const det = await getRobloxDetails(assetId);
    let cid = det?.CollectibleItemId || null;
    if (!cid) {
      const c = await getCatalogItemDetails(assetId);
      cid = c?.collectibleItemId ?? null;
    }
    if (!cid) return null;
    const listings = await getResellers(cid, 10);
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

/** Refresh a single asset's price ladder in place (used by the watchdog). */
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
        const updated = snap.deals.filter((d) => {
          if (d.assetId !== assetId) return true;

          d.lowest = tup[0];
          d.second = tup[1];
          d.third = tup[2];
          const mv = marketValue(tup[1], tup[2]);
          d.marketValue = mv;
          d.discountPct = discountPct(mv, tup[0]);
          d.tier = tierFor(d.discountPct);
          d.depthVerified = ladderClose(tup[1], tup[2]);
          d.projectable = d.depthVerified;
          d.spreadX =
            tup[0] > 0 && tup[1] > 0
              ? Math.round((tup[1] / tup[0]) * 100) / 100
              : null;
          d.projectedProfit = projectedProfit(tup[2], tup[0], tup[1]);
          d.projectedProfitPct =
            mv > 0 ? Math.round((d.projectedProfit / mv) * 100) : 0;
          d.updatedAt = Date.now();

          // A live refresh can invalidate a previously cached deal (floor
          // bought, 2nd/3rd drifted apart, …). Never keep showing it merely
          // because it passed an older snapshot.
          return evaluate(d).passesHard;
        });
        snap.deals = updated;
        snap.total = updated.length;
        cacheSet(key, snap, snap.ttlMs);
      }
    }
    return tup;
  } finally {
    refreshing.delete(String(assetId));
  }
}
