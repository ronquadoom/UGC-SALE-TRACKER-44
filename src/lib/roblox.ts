/** Adapter for Roblox's public (keyless) web APIs. */
import { fetchJson } from "./fetch";

export const ROBLOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Catalog "details" search result. Only the fields we use. */
export interface CatalogEntry {
  id: number;
  itemType: string;
  assetType: number;
  name: string;
  description: string;
  price: number | null;
  lowestPrice: number | null;
  lowestResalePrice: number | null;
  priceStatus: string | null;
  unitsAvailableForConsumption: number;
  favoriteCount: number;
  totalQuantity: number;
  collectibleItemId: string | null;
  creatorType: string;
  creatorName: string;
  saleLocationType: string | null;
  hasResellers: boolean;
  offSaleDeadline: string | null;
  /**
   * Roblox's own restriction flags. UGC limiteds come back as
   * ["Collectible"], classic limiteds as ["Limited"] — the most reliable
   * UGC/classic signal we can read straight off discovery results.
   */
  itemRestrictions: string[];
}

/** economy.roblox.com/v1/assets/{id}/resale-data */
export interface ResaleData {
  sales: number;
  recentAveragePrice: number;
  originalPrice: number | null;
  priceDataPoints: { value: number; date: string }[];
}

export interface RobloxDetails {
  Sales: number;
  Name: string;
  IsForSale: boolean;
  IsLimited: boolean;
  IsLimitedUnique: boolean;
  Remaining: number | null;
  PriceInRobux: number | null;
  CollectibleItemId: string | null;
  CollectiblesItemDetails?: {
    CollectibleLowestResalePrice: number | null;
    TotalQuantity: number;
    IsLimited: boolean;
    IsForSale: boolean;
  };
}

export interface ResellerListing {
  price: number;
  sellerId: number;
  serialNumber: number | null;
  sellerName: string;
}

export interface CollectibleMeta {
  totalQuantity: number;
  available: number;
  offSaleDeadline: string | null;
  lowestResalePrice: number | null;
}

/**
 * Search the Roblox catalog across several sort modes. This is the primary
 * *discovery* surface: it returns brand-new UGC limiteds, best-selling items,
 * trending items and (with IncludeNotForSale) sold-out items.
 */
export async function catalogSearch(opts: {
  cursor?: string;
  sortType: number; // 0 relevance, 1 favorited, 2 sales, 3 updated, 4 price asc, 5 desc
  sortAggregation?: number; // 1 day, 3 week, 4 month, 5 alltime
  limit?: number;
  includeNotForSale?: boolean;
  keyword?: string;
  minPrice?: number;
  salesTypeFilter?: number; // 1 all, 2 collectibles/limited
}): Promise<{ data: CatalogEntry[]; nextPageCursor: string | null }> {
  const params = new URLSearchParams();
  params.set("Category", "11"); // Accessories
  params.set("SalesTypeFilter", String(opts.salesTypeFilter ?? 2));
  params.set("SortType", String(opts.sortType));
  if (opts.sortAggregation != null)
    params.set("SortAggregation", String(opts.sortAggregation));
  params.set("Limit", String(opts.limit ?? 28));
  if (opts.cursor) params.set("Cursor", opts.cursor);
  if (opts.includeNotForSale) params.set("IncludeNotForSale", "true");
  if (opts.keyword) params.set("Keyword", opts.keyword);
  if (opts.minPrice != null) params.set("MinPrice", String(opts.minPrice));

  const url = `https://catalog.roblox.com/v1/search/items/details?${params.toString()}`;
  const j = await fetchJson(url, {}, { retries: 2, timeoutMs: 12000 });
  if (!j || j.errors) return { data: [], nextPageCursor: null };
  const data = Array.isArray(j.data) ? (j.data as any[]) : [];
  return {
    data: data.map(mapCatalogEntry).filter((e) => e !== null) as CatalogEntry[],
    nextPageCursor:
      typeof j.nextPageCursor === "string" ? j.nextPageCursor : null,
  };
}

function mapCatalogEntry(raw: any): CatalogEntry | null {
  if (!raw || raw.itemType !== "Asset") return null;
  return {
    id: Number(raw.id),
    itemType: raw.itemType,
    assetType: Number(raw.assetType) || 0,
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    price: raw.price != null ? Number(raw.price) : null,
    lowestPrice: raw.lowestPrice != null ? Number(raw.lowestPrice) : null,
    lowestResalePrice:
      raw.lowestResalePrice != null ? Number(raw.lowestResalePrice) : null,
    priceStatus: raw.priceStatus ? String(raw.priceStatus) : null,
    unitsAvailableForConsumption: Number(raw.unitsAvailableForConsumption) || 0,
    favoriteCount: Number(raw.favoriteCount) || 0,
    totalQuantity: Number(raw.totalQuantity) || 0,
    collectibleItemId: raw.collectibleItemId ? String(raw.collectibleItemId) : null,
    creatorType: String(raw.creatorType ?? raw.creator?.type ?? ""),
    creatorName: String(raw.creatorName ?? raw.creator?.name ?? ""),
    saleLocationType: raw.saleLocationType ? String(raw.saleLocationType) : null,
    hasResellers: raw.hasResellers === true,
    offSaleDeadline: raw.offSaleDeadline ? String(raw.offSaleDeadline) : null,
    itemRestrictions: Array.isArray(raw.itemRestrictions)
      ? raw.itemRestrictions.map((r: any) => String(r))
      : [],
  };
}

/**
 * True only for an explicitly identified UGC collectible.
 *
 * A classic Roblox Limited can also expose a collectibleItemId through some
 * catalog/economy responses. The id by itself is therefore not a UGC signal;
 * the catalog restriction must say Collectible and must not say Limited (or
 * LimitedUnique). Ambiguous rows are rejected rather than guessed into the
 * results.
 */
export function isUgcLimitedEntry(e: {
  collectibleItemId?: string | null;
  itemRestrictions?: string[];
}): boolean {
  const restrictions = (e.itemRestrictions ?? []).map((r) =>
    String(r).trim().toLowerCase()
  );
  const explicitlyUgc = restrictions.includes("collectible");
  const explicitlyClassic = restrictions.some((r) =>
    ["limited", "limitedunique", "limited unique"].includes(r)
  );
  return explicitlyUgc && !explicitlyClassic && Boolean(e.collectibleItemId);
}

/** Backwards-compatible name for callers outside the scanner. */
export const isCollectibleEntry = isUgcLimitedEntry;

export interface CatalogItemDetails {
  id: number;
  collectibleItemId: string | null;
  itemRestrictions: string[];
  creatorType: string;
  creatorName: string;
  lowestResalePrice: number | null;
  hasResellers: boolean;
  totalQuantity: number | null;
  unitsAvailableForConsumption: number | null;
  priceStatus: string | null;
  isOffSale: boolean;
}

/**
 * Per-item catalog details — used to resolve the collectibleItemId for items
 * that were discovered through the Rolimons activity feed (and therefore never
 * came back from a catalog search), so their 2nd/3rd depth can be checked.
 */
export async function getCatalogItemDetails(
  assetId: number
): Promise<CatalogItemDetails | null> {
  try {
    const j = await fetchJson(
      `https://catalog.roblox.com/v1/catalog/items/${assetId}/details?itemType=Asset`,
      {},
      { retries: 1, timeoutMs: 9000 }
    );
    if (!j || j.errors || !j.id) return null;
    return {
      id: Number(j.id),
      collectibleItemId: j.collectibleItemId ? String(j.collectibleItemId) : null,
      itemRestrictions: Array.isArray(j.itemRestrictions)
        ? j.itemRestrictions.map((r: any) => String(r))
        : [],
      creatorType: String(j.creatorType ?? j.creator?.type ?? ""),
      creatorName: String(j.creatorName ?? j.creator?.name ?? ""),
      lowestResalePrice:
        j.lowestResalePrice != null ? Number(j.lowestResalePrice) : null,
      hasResellers: j.hasResellers === true,
      totalQuantity: j.totalQuantity != null ? Number(j.totalQuantity) : null,
      unitsAvailableForConsumption:
        j.unitsAvailableForConsumption != null
          ? Number(j.unitsAvailableForConsumption)
          : null,
      priceStatus: j.priceStatus ? String(j.priceStatus) : null,
      isOffSale: j.isOffSale === true || j.priceStatus === "Off Sale",
    };
  } catch {
    return null;
  }
}

/** Lowest price (1st) via details; useful before we pay for a resellers call. */
export async function getRobloxDetails(assetId: number): Promise<RobloxDetails | null> {
  try {
    const j = await fetchJson(
      `https://economy.roblox.com/v2/assets/${assetId}/details`,
      {},
      { retries: 1, timeoutMs: 9000 }
    );
    if (!j || j.errors) return null;
    return {
      Sales: Number(j.Sales) || 0,
      Name: j.Name ? String(j.Name) : "",
      IsForSale: j.IsForSale === true,
      IsLimited: j.IsLimited === true,
      IsLimitedUnique: j.IsLimitedUnique === true,
      Remaining: j.Remaining != null ? Number(j.Remaining) : null,
      PriceInRobux: j.PriceInRobux != null ? Number(j.PriceInRobux) : null,
      CollectibleItemId: j.CollectibleItemId ? String(j.CollectibleItemId) : null,
      CollectiblesItemDetails: j.CollectiblesItemDetails || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * RAP + cumulative sales history. NOTE: only works for classic limiteds.
 * For UGC collectibles, recentAveragePrice can be derived from disposition
 * elsewhere; safest to treat this as best-effort.
 */
export async function getResaleData(assetId: number): Promise<ResaleData | null> {
  try {
    const j = await fetchJson(
      `https://economy.roblox.com/v1/assets/${assetId}/resale-data`,
      {},
      { retries: 1, timeoutMs: 9000 }
    );
    if (!j || j.errors || typeof j.recentAveragePrice === "undefined") return null;
    return {
      sales: Number(j.sales) || 0,
      recentAveragePrice: Number(j.recentAveragePrice) || 0,
      originalPrice: j.originalPrice != null ? Number(j.originalPrice) : null,
      priceDataPoints: Array.isArray(j.priceDataPoints) ? j.priceDataPoints : [],
    };
  } catch {
    return null;
  }
}

/**
 * THE critical call — full sorted reseller list for a collectible item id.
 * Public (no auth). Roblox returns the book price-ascending today, but we sort
 * defensively so the 1st/2nd/3rd ladder is never built from a stale ordering.
 */
export async function getResellers(
  collectibleItemId: string,
  limit = 12
): Promise<ResellerListing[]> {
  if (!collectibleItemId) return [];
  const url = `https://apis.roblox.com/marketplace-sales/v1/item/${encodeURIComponent(
    collectibleItemId
  )}/resellers?limit=${limit}`;
  const j = await fetchJson(url, {}, { retries: 2, timeoutMs: 12000 });
  if (!j || j.errors || !Array.isArray(j.data)) return [];
  return j.data
    .filter((x: any) => x && x.price != null && Number(x.price) > 0)
    .map((x: any) => ({
      price: Number(x.price),
      sellerId: Number(x.seller?.sellerId) || 0,
      serialNumber: x.serialNumber != null ? Number(x.serialNumber) : null,
      sellerName: String(x.seller?.name ?? ""),
    }))
    .sort((a: ResellerListing, b: ResellerListing) => a.price - b.price);
}

/** Batched free thumbnails. */
export async function getThumbnails(
  assetIds: number[],
  size = "150x150"
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!assetIds.length) return out;
  const chunks: number[][] = [];
  for (let i = 0; i < assetIds.length; i += 100) chunks.push(assetIds.slice(i, i + 100));
  for (const chunk of chunks) {
    const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(
      ","
    )}&format=Png&size=${size}&returnPolicy=PlaceHolder`;
    try {
      const j = await fetchJson(url, {}, { retries: 1, timeoutMs: 12000 });
      if (j?.data && Array.isArray(j.data)) {
        for (const d of j.data) {
          if (d?.imageUrl) out.set(Number(d.targetId), String(d.imageUrl));
        }
      }
    } catch {
      /* non-fatal */
    }
  }
  return out;
}
