/** Runtime configuration — all optional, all with sensible free-tier defaults. */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined ? d : v === "true" || v === "1";

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
  CATALOG_PAGE_LIMIT: 28,
  MAX_OFFSALE_VOLUME_CHECKS: num(process.env.MAX_OFFSALE_VOLUME_CHECKS, 400),
  MAX_RANDOM_VOLUME_CHECKS: num(process.env.MAX_RANDOM_VOLUME_CHECKS, 120),
  MYSTERY_SEARCH_TERMS: (process.env.MYSTERY_TERMS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // ---- Scoring
  PREMIUM_COPIES: num(process.env.PREMIUM_COPIES, 1500),
  VOLUME_FLOOR: num(process.env.VOLUME_FLOOR, 7),
  DISCOUNT_FLOOR: num(process.env.DISCOUNT_FLOOR, 80),
  SECOND_MIN_RAP_RATIO: num(process.env.SECOND_MIN_RAP_RATIO, 0.7),

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
