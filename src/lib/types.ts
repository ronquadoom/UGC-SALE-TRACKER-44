/** Shared type definitions for UGC Snap. */

export type PriceTuple = [number, number, number];

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
  } | null;
  /** True while a scan is in flight (first-boot state). */
  scanning: boolean;
}

/** A fully-scored deal record. */
export interface DealRecord {
  id: string;
  assetId: number;
  name: string;
  acronym: string;
  url: string;
  thumbUrl: string | null;
  /** Recent Average Price (rolimons current RAP). */
  rap: number;
  /** Rolimons "Value" (projected/community value). */
  value: number | null;
  lowest: number;
  second: number;
  third: number;
  /** 0–100 (e.g. 87 = 87% off RAP). */
  discountPct: number;
  /** 1st → 3rd spread multiplier, null if not computable. */
  spreadX: number | null;
  /** sales in last 30 days (0 if unknown). */
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
  /** 0 = classic limited, 1 = limited unique, 2 = collectible. */
  limitedType: number;
  updatedAt: number;
  firstSeenAt: number;
  failReasons: string[];
  passOverrides: { premiumOnly?: boolean; projectableOnly?: boolean };
}
