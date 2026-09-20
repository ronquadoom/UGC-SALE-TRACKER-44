/** The strict UGC deal filtering / scoring rules. */
import { CONFIG } from "./config";
import type { DealRecord, DealTier } from "./types";

export interface FilterOutcome {
  /** Clears every hard rule: UGC, sold out, 80%+ off, and healthy depth. */
  passesHard: boolean;
  /** Volume unknown → shown as a projected deal with a warning. */
  projectableOnly: boolean;
  reasons: string[];
}

/** Presentation tiers. Every tier still requires the 80% hard discount rule. */
export function tierFor(discountPct: number): DealTier | null {
  if (!Number.isFinite(discountPct)) return null;
  if (discountPct >= CONFIG.HOT_MIN) return "hot";
  if (discountPct >= CONFIG.STRONG_MIN) return "strong";
  if (discountPct >= CONFIG.DEAL_MIN) return "deal";
  return null;
}

/**
 * True only when the 2nd and 3rd individual reseller listings are both in the
 * healthy RAP band. The lower bound rejects a crashed market; the upper bound
 * keeps the comparison close to the current RAP rather than an outlier.
 */
export function depthVerified(
  rap: number,
  second: number,
  third: number,
  ratio = CONFIG.SECOND_MIN_RAP_RATIO,
  maxRatio = CONFIG.SECOND_MAX_RAP_RATIO
): boolean {
  if (rap <= 0 || second <= 0 || third <= 0) return false;
  const secondRatio = second / rap;
  const thirdRatio = third / rap;
  return (
    secondRatio >= ratio &&
    secondRatio <= maxRatio &&
    thirdRatio >= ratio &&
    thirdRatio <= maxRatio
  );
}

/**
 * Evaluate the complete hard gate. This is deliberately independent of the UI
 * filters so an old cache or a future client cannot make an invalid item show.
 */
export function evaluate(rec: DealRecord): FilterOutcome {
  const reasons: string[] = [];
  const tier = tierFor(rec.discountPct);
  const lowRatio = rec.rap > 0 && rec.lowest > 0 ? rec.lowest / rec.rap : 0;

  if (rec.limitedType !== 2) {
    reasons.push("not a UGC collectible");
  }
  if (!rec.soldOut) reasons.push("not sold out");
  if (rec.rap <= 0) reasons.push("RAP unknown");
  if (rec.lowest <= 0) reasons.push("no resale listings");

  // Use the raw price ratio, not rounded discountPct, at the boundary.
  if (
    rec.rap > 0 &&
    rec.lowest > 0 &&
    lowRatio > CONFIG.MAX_LOWEST_RAP_RATIO
  ) {
    reasons.push("lowest listing is not at least 80% off RAP");
  }
  if (rec.rap > 0 && rec.lowest > 0 && !tier) {
    reasons.push(`discount below ${CONFIG.DEAL_MIN}% floor`);
  }

  if (rec.rap > 0 && !depthVerified(rec.rap, rec.second, rec.third)) {
    reasons.push("2nd and 3rd listings are not both 70–100% of RAP");
  }

  const passesHard =
    rec.limitedType === 2 &&
    rec.soldOut &&
    rec.rap > 0 &&
    rec.lowest > 0 &&
    lowRatio <= CONFIG.MAX_LOWEST_RAP_RATIO &&
    tier !== null &&
    depthVerified(rec.rap, rec.second, rec.third);

  return {
    passesHard,
    projectableOnly: rec.sales30d <= 0,
    reasons,
  };
}

/** Profit after Roblox's approximate 30% resale tax at the 3rd listing. */
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
