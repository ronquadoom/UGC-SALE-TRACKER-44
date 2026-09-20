/** Shared type definitions for UGC Snap. */

export type PriceTuple = [number, number, number];

/** Deal strength, derived from the discount vs the 2nd/3rd market value. */
export type DealTier = "hot" | "strong" | "deal";

export interface DealsResponse {
  deals: DealRecord[];
  total: number;
  generatedAt: number;
  ttlMs: number;
  snapshotKey: string;
  fromCache: boolean;
  scan: {
    lastFullScanAt: number | null;
    lastFullScanMs: number | null;
    lastRefreshAt: number | null;
    sourceInfos: number;
    refreshQueue: number;
    canRefresh: boolean;
  } | null;
  sourceStats: {
    catalog: number;
    rolimons: number;
    activity: number;
    candidates: number;
    filtered: number;
    depthChecks: number;
    volumeChecks: number;
    /** Items whose RAP (display reference) came from a Rolimons item page. */
    rapFromPage: number;
    /** Returned deals whose 2nd/3rd listings are close = real market value. */
    depthVerified: number;
    /** Per-tier counts of the returned deals. */
    tiers: { hot: number; strong: number; deal: number };
  } | null;
  /** True while a scan is in flight (first-boot state). */
  scanning: boolean;
}

/** A fully-scored, hard-filtered UGC deal record. */
export interface DealRecord {
  id: string;
  assetId: number;
  name: string;
  acronym: string;
  /** Roblox catalog creator name. */
  creator: string;
  url: string;
  thumbUrl: string | null;
  /**
   * Rolimons RAP — DISPLAY REFERENCE ONLY. It is stale or inflated for most
   * UGC limiteds and is never used to judge whether something is a deal.
   * 0 when Rolimons does not track a RAP for the item.
   */
  rap: number;
  /** Rolimons "Value" (community value, display reference only). */
  value: number | null;
  /** 1st / 2nd / 3rd lowest individual resale listings (live book). */
  lowest: number;
  second: number;
  third: number;
  /**
   * Real market value: the average of the 2nd and 3rd lowest listings.
   * The deal % is measured against this — never against RAP.
   */
  marketValue: number;
  /** 0–100: how far the lowest listing is below the market value (e.g. 78 = 78% below). */
  discountPct: number;
  /** 2nd listing ÷ lowest listing (how much steeper the next price is). */
  spreadX: number | null;
  /** Sales in last 30 days from Rolimons (0 if unknown). Rolimons' only job here. */
  sales30d: number;
  originalSales: number | null;
  totalCopies: number;
  availableCopies: number;
  soldOut: boolean;
  offSale: boolean;
  projectable: boolean;
  projectedProfit: number;
  projectedProfitPct: number;
  premiumScore: number;
  numListings: number;
  /** 2 = UGC collectible. The scanner never emits classic limited types. */
  limitedType: 2;
  /** Presentation tier; every tier requires 70%+ below the market value. */
  tier: DealTier | null;
  /** How many serial listings sit at the floor price. */
  floorCopies: number;
  /** True when the 2nd/3rd listings are close to each other = real market value. */
  depthVerified: boolean;
  updatedAt: number;
  firstSeenAt: number;
  failReasons: string[];
  passOverrides: {
    /** Volume could not be verified — shown as a projected deal. */
    projectableOnly?: boolean;
  };
}
