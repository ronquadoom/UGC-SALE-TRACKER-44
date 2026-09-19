/** The filtering / scoring engine. This encodes the *strict* rules. */
import { CONFIG } from "./config";
import type { DealRecord, DealTier } from "./types";

export interface FilterOutcome {
  /** Clears every hard rule and has a usable 2nd price level. */
  passesHard: boolean;
  /** Classic (non-UGC) limited — still listed, but labelled. */
  legacyClassic: boolean;
  /** Volume unknown → shown as a "projected" deal with a warning. */
  projectableOnly: boolean;
  reasons: string[];
}

/**
 * Discount tiers — the realistic replacement for the old flat 80% floor.
 * 80% off RAP almost never survives a 2nd/3rd-price depth check, which is
 * what produced the "0 deals" screen.
 */
export function tierFor(discountPct: number): DealTier | null {
  if (!Number.isFinite(discountPct)) return null;
  if (discountPct >= CONFIG.HOT_MIN) return "hot";
  if (discountPct >= CONFIG.STRONG_MIN) return "strong";
  if (discountPct >= CONFIG.DEAL_MIN) return "deal";
  return null;
}

export function evaluate(rec: DealRecord): FilterOutcome {
  const reasons: string[] = [];
  const tier = tierFor(rec.discountPct);

  // 1. Sold out.
  if (!rec.soldOut) reasons.push("not sold out");
  // 2. Needs a RAP to measure the discount against and a real resale floor.
  if (rec.rap <= 10) reasons.push("RAP unknown");
  if (rec.lowest <= 0) reasons.push("no resale listings");
  // 3. Discount must clear the tier floor (deal ≥35% by default).
  if (rec.rap > 0 && rec.lowest > 0 && !tier) {
    reasons.push(`discount below ${CONFIG.DEAL_MIN}% floor`);
  }
  // 4. Working depth check: we need at least a 2nd *price level* to know the
  //    floor isn't the whole market. (2nd/3rd themselves only raise quality.)
  const hasSecond = rec.second > 0;
  if (!hasSecond) reasons.push("single price level (depth unverified)");

  const passesHard =
    rec.soldOut && rec.rap > 10 && rec.lowest > 0 && tier !== null && hasSecond;

  const projectableOnly = rec.sales30d <= 0;

  return {
    passesHard,
    legacyClassic: rec.limitedType !== 2,
    projectableOnly,
    reasons,
  };
}

/** True when the 2nd & 3rd distinct price levels still hold up vs RAP. */
export function depthVerified(
  rap: number,
  second: number,
  third: number,
  ratio = CONFIG.SECOND_MIN_RAP_RATIO
): boolean {
  if (rap <= 0 || second <= 0) return false;
  const secondOk = second >= rap * ratio;
  const thirdOk = third > 0 ? third >= rap * ratio : false;
  return secondOk && thirdOk;
}

/**
 * Profit after Roblox's ~30% resale tax, using the realistic exit (3rd price
 * when we have it, otherwise 2nd). Buying the cheap 1st and reselling there
 * yields (exit * 0.7 - lowest).
 */
export function projectedProfit(
  third: number,
  lowest: number,
  second = 0
): number {
  const exit = third > 0 ? third : second;
  if (lowest <= 0 || exit <= 0) return 0;
  const gross = exit * 0.7 - lowest;
  return gross > 0 ? Math.round(gross) : 0;
}

export function discountPct(rap: number, lowest: number): number {
  if (rap <= 0 || lowest <= 0) return 0;
  return Math.max(0, Math.round((1 - lowest / rap) * 100));
}
