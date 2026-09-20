/** Runtime configuration — all optional, all with safe hard-rule defaults. */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined ? d : v === "true" || v === "1";

/*
 * Hard deal rules — market based, RAP independent.
 *
 * A card only exists when the LIVE resale book proves it:
 *
 *   1. the 2nd and 3rd lowest individual listings are close to each other
 *      (within LADDER_MAX_RATIO, i.e. 25% by default). That makes their
 *      average a reliable "real market value" — a crashed copy or a whale
 *      outlier on either side cannot distort it;
 *   2. the lowest listing is at least MARKET_DISCOUNT_FLOOR% below that
 *      market value (70% by default — the user's "70-80%+" sweet spot).
 *
 * Rolimons RAP plays no part in the decision: it is stale or inflated for
 * most UGC limiteds. Rolimons is used for 30-day sales volume only.
 *
 * Environment variables can make the rules STRICTER, never looser, and the
 * old broad classic-limited / RAP-anchored scan cannot be accidentally
 * redeployed through them.
 */
const requestedDealMin = num(
  process.env.DEAL_MIN ?? process.env.DISCOUNT_FLOOR,
  70
);
const dealMin = Math.max(70, requestedDealMin);
const strongMin = Math.max(dealMin, num(process.env.STRONG_MIN, 75));
const hotMin = Math.max(strongMin, num(process.env.HOT_MIN, 80));
const ladderMaxRatio = Math.min(
  1.5,
  Math.max(1.1, num(process.env.LADDER_MAX_RATIO, 1.25))
);

export const CONFIG = {
  // ---- Auth token for cron / admin refresh endpoints. Set on Vercel/Render.
  CRON_SECRET: process.env.CRON_SECRET || process.env.UGC_CRON_SECRET || "",
  // ---- Optional Supabase (free tier). If unset we run stateless + localStorage.
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  SUPABASE_SERVICE_KEY:
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",

  // ---- Discovery budgets (kept small so a full scan fits in ~40s on serverless)
  CATALOG_PAGES: Math.max(4, num(process.env.CATALOG_PAGES, 12)),
  CATALOG_PAGE_LIMIT: 28, // Roblox only accepts 10 / 28 / 30 here.
  /** How many live Rolimons activity items to seed per scan. */
  MAX_ACTIVITY_SEEDS: Math.max(0, num(process.env.MAX_ACTIVITY_SEEDS, 40)),
  /** Cap on live reseller-book (1st/2nd/3rd) checks per scan. */
  MAX_DEPTH_CHECKS: Math.max(10, num(process.env.MAX_DEPTH_CHECKS, 100)),
  /** Cap on Rolimons item-page scrapes (sales volume only) per scan. */
  MAX_VOLUME_CHECKS: Math.max(0, num(process.env.MAX_VOLUME_CHECKS, 40)),
  MYSTERY_SEARCH_TERMS: (process.env.MYSTERY_TERMS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // ---- Hard deal rules (market based; RAP never gates a deal)
  PREMIUM_COPIES: num(process.env.PREMIUM_COPIES, 1500),
  VOLUME_FLOOR: num(process.env.VOLUME_FLOOR, 7),
  /** Minimum discount vs the 2nd/3rd market value: 70% = lowest ≤ 30% of it. */
  DEAL_MIN: dealMin,
  MARKET_DISCOUNT_FLOOR: dealMin,
  /** Lowest listing may not exceed this fraction of the market value. */
  MAX_LOWEST_MARKET_RATIO: (100 - dealMin) / 100,
  /** Optional presentation tiers; all are stricter than the 70% deal floor. */
  STRONG_MIN: strongMin,
  HOT_MIN: hotMin,
  /** 2nd and 3rd listings must be within this ratio of each other (1.25 = 25%). */
  LADDER_MAX_RATIO: ladderMaxRatio,
  /** How many resale listings to pull when building the ladder. */
  RESELLER_FETCH_LIMIT: Math.max(3, num(process.env.RESELLER_FETCH_LIMIT, 12)),

  // ---- Caching / freshness
  CACHE_TTL_MS: num(process.env.CACHE_TTL_MS, 20 * 60 * 1000),
  REFRESH_MIN_MS: num(process.env.REFRESH_MIN_MS, 3 * 60 * 1000),
  SNAPSHOT_STALE_MS: num(process.env.SNAPSHOT_STALE_MS, 8 * 60 * 60 * 1000),

  // ---- Feature switches
  NOTIFICATIONS_ENABLED: bool(process.env.NOTIFICATIONS_ENABLED, true),
  PREMIUM_ONLY: bool(process.env.PREMIUM_ONLY, false),
  DEMO_MODE: bool(process.env.DEMO_MODE, false),
} as const;

export type Config = typeof CONFIG;
