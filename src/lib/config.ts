/** Runtime configuration — all optional, all with safe hard-rule defaults. */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined ? d : v === "true" || v === "1";

/*
 * These values intentionally cannot be relaxed through environment variables.
 * The scanner's contract is to return only real UGC deals: an 80%+ discount,
 * followed by a healthy 2nd/3rd listing ladder. Operators can make the rules
 * stricter, but never accidentally deploy the old broad classic-limited scan.
 */
const requestedDealMin = num(
  process.env.DEAL_MIN ?? process.env.DISCOUNT_FLOOR,
  80
);
const dealMin = Math.max(80, requestedDealMin);
const strongMin = Math.max(dealMin, num(process.env.STRONG_MIN, 85));
const hotMin = Math.max(strongMin, num(process.env.HOT_MIN, 90));
const depthMin = Math.min(
  1,
  Math.max(0.7, num(process.env.SECOND_MIN_RAP_RATIO, 0.7))
);
const depthMax = Math.min(
  1,
  Math.max(depthMin, num(process.env.SECOND_MAX_RAP_RATIO, 1))
);

export const CONFIG = {
  // ---- Auth token for cron / admin refresh endpoints. Set on Vercel/Netlify.
  CRON_SECRET: process.env.CRON_SECRET || process.env.UGC_CRON_SECRET || "",
  // ---- Optional Supabase (free tier). If unset we run stateless + localStorage.
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  SUPABASE_SERVICE_KEY:
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",

  // ---- Discovery sizes
  CATALOG_PAGES: num(process.env.CATALOG_PAGES, 30),
  CATALOG_PAGE_LIMIT: 28, // Roblox only accepts 10 / 28 / 30 here.
  MAX_OFFSALE_VOLUME_CHECKS: num(process.env.MAX_OFFSALE_VOLUME_CHECKS, 400),
  MAX_RANDOM_VOLUME_CHECKS: num(process.env.MAX_RANDOM_VOLUME_CHECKS, 120),
  /** How many live Rolimons deal-activity items to pull in per scan. */
  MAX_ACTIVITY_SEEDS: num(process.env.MAX_ACTIVITY_SEEDS, 60),
  MYSTERY_SEARCH_TERMS: (process.env.MYSTERY_TERMS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // ---- Hard deal rules / scoring
  PREMIUM_COPIES: num(process.env.PREMIUM_COPIES, 1500),
  VOLUME_FLOOR: num(process.env.VOLUME_FLOOR, 7),
  /** Minimum discount: 80% means lowest listing <=20% of RAP. */
  DISCOUNT_FLOOR: dealMin,
  /** Minimum discount tier. Kept separate for readable filter logic. */
  DEAL_MIN: dealMin,
  /** Optional presentation tiers; all are stricter than the 80% deal floor. */
  HOT_MIN: hotMin,
  STRONG_MIN: strongMin,
  /** Lowest listing may not exceed this fraction of RAP. */
  MAX_LOWEST_RAP_RATIO: 0.2,
  /** The 2nd/3rd listings must each be in this RAP band. */
  SECOND_MIN_RAP_RATIO: depthMin,
  SECOND_MAX_RAP_RATIO: depthMax,
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
