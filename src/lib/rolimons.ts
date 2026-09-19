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
  trend: number;
  projected: boolean;
  rare: boolean;
  hyped: boolean;
  /** 0 = classic limited, 1 = limited-unique, 2 = collectible (UGC limited). */
  limitedType: number;
}

const TTL = 8 * 60 * 1000;

let indexPromise: Promise<Map<number, RolimonsIndexEntry>> | null = null;

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
    if (!Array.isArray(arr) || !Number.isFinite(id)) continue;
    const name = typeof arr[0] === "string" ? arr[0] : "";
    const acronym = typeof arr[1] === "string" ? arr[1] : "";
    const rap = Number(arr[2]) || 0;
    const value = Number(arr[3]) || 0;
    const demand = Number(arr[4]) || -1;
    const rare = Number(arr[5]) === 1;
    const hyped = Number(arr[6]) === 1;
    // index 8 (10th) = 1 on modern UGC limiteds; fallback by id > 1e9.
    const limitedType = Number(arr[8]) === 1 ? 2 : id > 1_000_000_000 ? 2 : id > 100_000_000 ? 1 : 0;
    map.set(id, {
      id,
      name,
      acronym,
      rap,
      value: value > 0 ? value : -1,
      demand: demand > 0 ? demand : -1,
      trend: -1,
      projected: false,
      rare,
      hyped,
      limitedType,
    });
  }
  return map;
}

/**
 * Full Rolimons limited index (name/rap/value for thousands of limiteds).
 * One bulk request. Handles both itemapi hosting shapes.
 */
export async function getRolimonsIndex(): Promise<Map<number, RolimonsIndexEntry>> {
  const cached = cacheGet<Map<number, RolimonsIndexEntry>>("roli:index");
  if (cached) return cached;
  if (!indexPromise) {
    const urls = [
      "https://www.rolimons.com/itemapi/itemdetails",
      "https://api.rolimons.com/items/v2/itemdetails",
    ];
    indexPromise = (async () => {
      let lastErr: unknown = null;
      for (const u of urls) {
        try {
          const j = await fetchJson(u, {}, { retries: 1, timeoutMs: 15000 });
          const map = parseIdx(j);
          if (map.size > 200) {
            cacheSet("roli:index", map, TTL);
            return map;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr ?? new Error("Rolimons index unavailable");
    })().finally(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/**
 * Shape:
 * GET https://www.rolimons.com/api/activity
 * {success, activities:[[id, item_id, userid, offer, rap? , ...]]}
 */
export interface RolimonsDealActivity {
  id: number;
  itemId: number;
  userId: number;
  offer: number;
  rap: number | null;
  ts: number;
}

export async function getRolimonsDealActivity(): Promise<RolimonsDealActivity[]> {
  const url = "https://www.rolimons.com/api/activity";
  try {
    const j = await fetchJson(url, {}, { retries: 1, timeoutMs: 12000 });
    const acts = j?.activities;
    if (!Array.isArray(acts)) return [];
    const out: RolimonsDealActivity[] = [];
    for (const a of acts) {
      if (!Array.isArray(a)) continue;
      const [id, itemId, userId, offer, rap] = a;
      out.push({
        id: Number(id),
        itemId: Number(itemId),
        userId: Number(userId),
        offer: Number(offer),
        rap: rap != null ? Number(rap) : null,
        ts: Math.floor(Date.now() / 1000),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Recent sale activity: [[ts, itemId, ?, ?, ?]] — used as a discovery firehose. */
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
      .filter((x: any) => Number.isFinite(x.itemId));
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
  sellers: number | null;
  soldOut: boolean;
  resaleLocked: boolean;
}

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9\-.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function metric(html: string, label: string): string | null {
  // Rolimons renders metrics as: <a define>Label</a> <a define>Value</a>
  const re = new RegExp(
    ">" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "<\\/a>[\\s\\S]{0,220}?>([^<]{1,40})<\\/a>",
    "i"
  );
  const m = html.match(re);
  if (m && m[1]) return m[1].trim();
  return null;
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

  const meta: ItemPageMeta = {
    bestPrice: num(metric(html, "Best Price")),
    rap: num(metric(html, "RAP")),
    value: num(metric(html, "Value")),
    totalCopies: num(metric(html, "Total Copies")) || num(totalMatch?.[1]),
    availableCopies: num(metric(html, "Available Copies")) || num(availMatch?.[1]),
    salesRecent,
    salesDays,
    sellers: num(metric(html, "Sellers")),
    soldOut: /Sale Status[^<]{0,40}(Off Sale|Resale Locked)/i.test(html),
    resaleLocked: /Resale Locked/i.test(html),
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
