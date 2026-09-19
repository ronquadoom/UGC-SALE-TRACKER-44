/** Adapter for Rolimon's free, public JSON endpoints. */
import { fetchJson, fetchText } from "./fetch";
import { cacheGet, cacheSet } from "./cache";

export interface RolimonsIndexEntry {
  id: number;
  name: string;
  acronym: string;
  rap: number;
  value: number;
  demand: number; // 0-4, -1 unknown
  trend: number; // -1 none, 0 lowering, 1 unstable, 2 stable, 3 raising, 4 fluctuating
  projected: boolean;
  rare: boolean;
  hyped: boolean;
  /** 0 = classic limited, 1 = limited-unique, 2 = collectible (UGC limited). */
  limitedType: number;
}

const TTL = 8 * 60 * 1000;

let indexPromise: Promise<Map<number, RolimonsIndexEntry>> | null = null;

/**
 * Column layout (documented by Rolimon's, both hosts):
 *   [Name, Acronym, Rap, Value, DefaultValue, Demand, Trend, Projected, Hyped, Rare, Type?]
 * The 11th "Type" column is only present on the v2 host: 1 = classic limited,
 * 2 = UGC/collectible limited. The v1 (www) host omits UGC items entirely.
 */
function parseIdx(raw: unknown): Map<number, RolimonsIndexEntry> {
  const map = new Map<number, RolimonsIndexEntry>();
  if (!raw || typeof raw !== "object") return map;
  const items =
    (raw as any).items &&
    typeof (raw as any).items === "object"
      ? (raw as any).items
      : null;
  if (!items) return map;
  for (const key of Object.keys(items)) {
    const id = Number(key);
    const arr = items[key];
    if (!Array.isArray(arr) || !Number.isFinite(id) || !arr.length) continue;
    const name = typeof arr[0] === "string" ? arr[0] : "";
    const acronym = typeof arr[1] === "string" ? arr[1] : "";
    const rap = Number(arr[2]) || 0;
    const value = Number(arr[3]) || 0;
    const demand = Number(arr[5]);
    const trend = Number(arr[6]);
    const typeCol = arr.length >= 11 ? Number(arr[10]) : -1;
    // 11th column when present; otherwise fall back to the id range heuristic.
    const limitedType =
      typeCol === 2
        ? 2
        : typeCol === 1
        ? 0
        : id >= 100_000_000_000
        ? 2
        : id >= 100_000_000
        ? 1
        : 0;
    map.set(id, {
      id,
      name,
      acronym,
      rap,
      value: value > 0 ? value : -1,
      demand: demand > 0 ? demand : -1,
      trend: Number.isFinite(trend) ? trend : -1,
      projected: Number(arr[7]) === 1,
      rare: Number(arr[9]) === 1,
      hyped: Number(arr[8]) === 1,
      limitedType,
    });
  }
  return map;
}

/**
 * Full Rolimons limited index (name/rap/value).
 *
 * Order matters: the v2 host is a superset that *includes UGC limiteds with
 * their RAP*, while the legacy www host only carries classic limiteds — using
 * it first left every UGC item with rap=0 (and therefore a 0% discount), which
 * is how the dashboard ended up empty.
 */
export async function getRolimonsIndex(): Promise<Map<number, RolimonsIndexEntry>> {
  const cached = cacheGet<Map<number, RolimonsIndexEntry>>("roli:index");
  if (cached) return cached;
  if (!indexPromise) {
    const urls = [
      "https://api.rolimons.com/items/v2/itemdetails",
      "https://www.rolimons.com/itemapi/itemdetails",
    ];
    indexPromise = (async () => {
      let lastErr: unknown = null;
      let best: Map<number, RolimonsIndexEntry> | null = null;
      for (const u of urls) {
        try {
          const j = await fetchJson(u, {}, { retries: 1, timeoutMs: 15000 });
          const map = parseIdx(j);
          if (map.size > 200) {
            // Prefer the richest index, but don't lose a working one.
            if (!best || map.size > best.size) best = map;
            if (best.size >= 2500) break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (best) {
        cacheSet("roli:index", best, TTL);
        return best;
      }
      throw lastErr ?? new Error("Rolimons index unavailable");
    })().finally(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/**
 * Live Rolimon's deal activity ("what just sold / got listed").
 *
 * Shape (api.rolimons.com/market/v1/dealactivity):
 *   {success, activities:[[purchased_time, kind, item_id, price], …]}
 * The legacy www.rolimons.com/api/activity feed used to nest the item id at the
 * same index, but the endpoint is gone — it now returns an HTML error page.
 */
export interface RolimonsDealActivity {
  ts: number;
  kind: number;
  itemId: number;
  price: number;
}

export async function getRolimonsDealActivity(): Promise<RolimonsDealActivity[]> {
  const urls = [
    "https://api.rolimons.com/market/v1/dealactivity",
    "https://www.rolimons.com/api/activity",
  ];
  const out: RolimonsDealActivity[] = [];
  for (const url of urls) {
    try {
      const j = await fetchJson(url, {}, { retries: 1, timeoutMs: 12000 });
      const acts = j?.activities;
      if (!Array.isArray(acts)) continue;
      for (const a of acts) {
        if (!Array.isArray(a) || a.length < 3) continue;
        // [time, kind, itemId, price] — itemId is index 2 in both shapes.
        const itemId = Number(a[2]);
        const ts = Number(a[0]);
        const kind = Number(a[1]);
        const price = Number(a[3]);
        if (!Number.isFinite(itemId) || itemId <= 0) continue;
        out.push({
          ts: Number.isFinite(ts) ? Math.floor(ts) : 0,
          kind: Number.isFinite(kind) ? kind : 0,
          itemId,
          price: Number.isFinite(price) && price > 0 ? price : 0,
        });
      }
      if (out.length) break;
    } catch {
      /* try next host */
    }
  }
  return out;
}

/** Recent sale activity: [[ts, itemId, oldRap, newRap, uaid]] — discovery firehose. */
export async function getRolimonsSaleActivity(): Promise<
  { ts: number; itemId: number }[]
> {
  const url = "https://api.rolimons.com/market/v1/saleactivity";
  try {
    const j = await fetchJson(url, {}, { retries: 1, timeoutMs: 12000 });
    const acts = j?.activities;
    if (!Array.isArray(acts)) return [];
    return acts
      .filter((a: any) => Array.isArray(a) && a.length >= 2)
      .map((a: any[]) => ({ ts: Number(a[0]), itemId: Number(a[1]) }))
      .filter((x: any) => Number.isFinite(x.itemId) && x.itemId > 0);
  } catch {
    return [];
  }
}

/** Scraped from a Rolimons item page (UGC limiteds show supply + sales). */
export interface ItemPageMeta {
  bestPrice: number | null;
  rap: number | null;
  value: number | null;
  totalCopies: number | null;
  availableCopies: number | null;
  /** sales over "past X days" (converted to a 30-day estimate) */
  salesRecent: number | null;
  salesDays: number | null;
  /** "Avg Daily Sales" — the modern equivalent of the tracked-window count. */
  averageDailySales: number | null;
  /** Pre-computed 30-day estimate from whichever sales signal the page had. */
  sales30dEstimate: number | null;
  sellers: number | null;
  soldOut: boolean;
  resaleLocked: boolean;
  /** "RAP After Sale" — freshest RAP when the main cell is stale. */
  rapAfterSale: number | null;
}

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Read a metric off a Rolimon's item page.
 *
 * The markup has changed over the years (definition-list anchors, then
 * heading cells), so we match "label cell, then the first numeric cell within a
 * short window" instead of one exact tag pair. Requiring the *whole* cell to be
 * the label keeps "RAP" from matching "RAP After Sale".
 */
function metricNumber(html: string, label: string): number | null {
  const re = new RegExp(
    `>\\s*${escapeRe(label)}\\s*<[\\s\\S]{0,400}?>\\s*([0-9][0-9.,]*)\\s*<`,
    "i"
  );
  const m = html.match(re);
  return m ? num(m[1]) : null;
}

export async function getItemPage(assetId: number): Promise<ItemPageMeta | null> {
  const key = `roli:page:${assetId}`;
  const cached = cacheGet<ItemPageMeta>(key);
  if (cached) return cached;
  const html = await fetchText(`https://www.rolimons.com/item/${assetId}`, {
    retries: 1,
    timeoutMs: 12000,
  });
  if (!html) return null;

  const salesMatch = html.match(
    /tracked ([0-9,]+) sales? over the past ([0-9]+) days/i
  );
  const claimedMatch = html.match(
    /([0-9,]+) original units have been claimed over the past ([0-9]+) days/i
  );
  // "total copies"/"available copies" embedded in "Item Summary::X" style divs
  const totalMatch = html.match(/Total Quantity[^0-9]*([0-9,]+)/i);
  const availMatch = html.match(/Units Available[^0-9]*([0-9,]+)/i);

  const salesRecent =
    num(salesMatch?.[1]) || num(claimedMatch?.[1]) || null;
  const salesDays = num(salesMatch?.[2]) || num(claimedMatch?.[2]) || null;

  // Modern pages report "Avg Daily Sales" instead of a tracked-window count.
  const averageDailySales = metricNumber(html, "Avg Daily Sales");
  const salesFromDaily =
    averageDailySales != null && averageDailySales > 0
      ? Math.round(averageDailySales * 30)
      : null;

  const meta: ItemPageMeta = {
    bestPrice: metricNumber(html, "Best Price"),
    rap: metricNumber(html, "RAP"),
    value: metricNumber(html, "Value"),
    totalCopies: metricNumber(html, "Total Copies") || num(totalMatch?.[1]),
    availableCopies:
      metricNumber(html, "Available Copies") || num(availMatch?.[1]),
    salesRecent,
    salesDays,
    averageDailySales,
    sales30dEstimate:
      salesFromDaily ??
      (salesRecent != null && salesDays != null
        ? estimateSales30d(salesRecent, salesDays)
        : null),
    sellers: metricNumber(html, "Sellers"),
    soldOut: /Sale Status[^<]{0,40}(Off Sale|Resale Locked)/i.test(html),
    resaleLocked: /Resale Locked/i.test(html),
    /**
     * "RAP After Sale" is the freshest signal on pages where the plain RAP
     * cell is missing or still stale.
     */
    rapAfterSale: metricNumber(html, "RAP After Sale"),
  };
  cacheSet(key, meta, 25 * 60 * 1000);
  return meta;
}

/** Estimate 30-day sales from a "N sales over past D days" figure. */
export function estimateSales30d(
  salesRecent: number,
  salesDays: number
): number {
  if (!salesRecent || !salesDays || salesDays <= 0) return 0;
  // scale to 30d then soften: newer limiteds have short histories.
  const scaled = Math.round((salesRecent / salesDays) * 30);
  return scaled;
}

/** RAP/Value as reported on the item page (fallback when the index lacks it). */
export function pageRap(page: ItemPageMeta): number {
  return Math.max(page.rap ?? 0, page.rapAfterSale ?? 0);
}

/** Best 30-day sales estimate available on an item page (0 when unknown). */
export function pageSales30d(page: ItemPageMeta): number {
  if (page.sales30dEstimate != null && page.sales30dEstimate > 0) {
    return page.sales30dEstimate;
  }
  if (
    page.averageDailySales != null &&
    page.averageDailySales > 0
  ) {
    return Math.round(page.averageDailySales * 30);
  }
  if (page.salesRecent != null && page.salesDays != null) {
    return estimateSales30d(page.salesRecent, page.salesDays);
  }
  return 0;
}
