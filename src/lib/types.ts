/** Shared type definitions for UGC Snap. */

export type PriceTuple = [number, number, number];

/** Deal strength, derived from the discount vs RAP. */
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
    /** Items whose RAP had to come from a Rolimons item page (not in the bulk index). */
    rapFromPage: number;
    /** Deals whose 2nd/3rd price levels were verified to hold up vs RAP. */
    depthVerified: number;
    /** Per-tier counts of the returned deals. */
    tiers: { hot: number; strong: number; deal: number };
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
  /** 1st / 2nd / 3rd lowest *distinct* resale prices. */
  lowest: number;
  second: number;
  third: number;
  /** 0–100 (e.g. 87 = 87% off RAP). */
  discountPct: number;
  /** 1st → 2nd spread multiplier, null if not computable. */
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
  /** 0 = classic limited, 1 = limited unique, 2 = UGC collectible. */
  limitedType: number;
  /** hot ≥70% off RAP · strong ≥50% · deal ≥35%. */
  tier: DealTier | null;
  /** How many listings sit at the floor price (>1 = the cheap copy isn't unique). */
  floorCopies: number;
  /** True when the 2nd and 3rd price levels still hold ≥70% of RAP. */
  depthVerified: boolean;
  updatedAt: number;
  firstSeenAt: number;
  failReasons: string[];
  passOverrides: {
    /** Volume could not be verified — shown as a projected deal. */
    projectableOnly?: boolean;
    /** Classic (non-UGC) limited that still clears every rule. */
    legacyClassic?: boolean;
  };
}
