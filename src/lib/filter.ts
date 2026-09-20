/** The strict UGC deal filtering / scoring rules.
 *
 *  The deal decision is 100% market based, built from the LIVE resale book:
 *
 *    • the 2nd and 3rd lowest individual listings must be close to each
 *      other (ladderClose) — that average is the item's real market value;
 *    • the lowest listing must be a deep undercut of that market value
 *      (at least DEAL_MIN = 70% below it).
 *
 *  Rolimons RAP is deliberately not part of any check: it is often stale or
 *  inflated for UGC limiteds, which is exactly what made the old scanner
 *  reject real deals (and show 0).
 */
import { CONFIG } from "./config";
import type { DealRecord, DealTier } from "./types";

export interface FilterOutcome {
  /** Clears every hard rule: UGC, sold out, close 2nd/3rd ladder, deep undercut. */
  passesHard: boolean;
  /** Volume unknown → shown as a projected deal with a warning. */
  projectableOnly: boolean;
  reasons: string[];
}

/**
 * Real market value: the average of the 2nd and 3rd lowest individual
 * listings. Zero when the ladder is incomplete (the item cannot be judged).
 */
export function marketValue(second: number, third: number): number {
  if (second <= 0 || third <= 0) return 0;
  return Math.round((second + third) / 2);
}

/**
 * True when the 2nd and 3rd lowest listings are "close" — within
 * LADDER_MAX_RATIO of each other (25% by default). A close pair is what
 * makes their average a reliable market price: one side cannot be a crashed
 * copy or a whale outlier.
 */
export function ladderClose(
  second: number,
  third: number,
  maxRatio = CONFIG.LADDER_MAX_RATIO
): boolean {
  if (second <= 0 || third <= 0 || !(maxRatio > 1)) return false;
  return Math.max(second, third) / Math.min(second, third) <= maxRatio;
}

/** 0–100: how far below the market value (2nd/3rd average) the lowest is. */
export function discountPct(market: number, lowest: number): number {
  if (market <= 0 || lowest <= 0) return 0;
  return Math.max(0, Math.round((1 - lowest / market) * 100));
}

/** Presentation tiers. Every tier still requires the 70% hard discount rule. */
export function tierFor(discountPct: number): DealTier | null {
  if (!Number.isFinite(discountPct)) return null;
  if (discountPct >= CONFIG.HOT_MIN) return "hot";
  if (discountPct >= CONFIG.STRONG_MIN) return "strong";
  if (discountPct >= CONFIG.DEAL_MIN) return "deal";
  return null;
}

type EvaluationInput = Pick<
  DealRecord,
  "limitedType" | "soldOut" | "lowest" | "second" | "third" | "sales30d"
>;

/**
 * Evaluate the complete hard gate. This is deliberately independent of the
 * UI filters so an old cache or a future client cannot make an invalid item
 * show. RAP is not even read — the gate cannot depend on it.
 */
export function evaluate(rec: EvaluationInput): FilterOutcome {
  const reasons: string[] = [];

  if (rec.limitedType !== 2) {
    reasons.push("not a UGC collectible");
  }
  if (!rec.soldOut) reasons.push("not sold out");
  if (rec.lowest <= 0) reasons.push("no resale listings");
  if (rec.second <= 0 || rec.third <= 0)
    reasons.push("needs 2nd and 3rd lowest listings");

  const market = marketValue(rec.second, rec.third);
  let close = false;
  let deep = false;
  if (market > 0) {
    close = ladderClose(rec.second, rec.third);
    if (!close) {
      reasons.push(
        "2nd and 3rd listings are not close (no reliable market value)"
      );
    }
    deep = rec.lowest / market <= CONFIG.MAX_LOWEST_MARKET_RATIO;
    if (!deep) {
      reasons.push(
        `lowest listing is not at least ${CONFIG.DEAL_MIN}% below market value`
      );
    }
  }

  const passesHard =
    rec.limitedType === 2 &&
    rec.soldOut &&
    rec.lowest > 0 &&
    rec.second > 0 &&
    rec.third > 0 &&
    close &&
    deep;

  return {
    passesHard,
    projectableOnly: rec.sales30d <= 0,
    reasons,
  };
}

/**
 * Profit after Roblox's approximate 30% resale tax, buying at the floor and
 * exiting at the 3rd listing (the next price a serious seller would pay).
 */
export function projectedProfit(third: number, lowest: number, second = 0): number {
  const exit = third > 0 ? third : second;
  if (lowest <= 0 || exit <= 0) return 0;
  const gross = exit * 0.7 - lowest;
  return gross > 0 ? Math.round(gross) : 0;
}
