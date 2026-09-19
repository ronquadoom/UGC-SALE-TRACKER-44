/** The filtering / scoring engine. This encodes the user's *strict* rules. */
import { CONFIG } from "./config";
import type { DealRecord } from "./types";

export interface FilterOutcome {
  passesHard: boolean; // passes hard filters OR legacy premium whitelist
  premiumOnly: boolean; // legacy classic limited that meets every other rule
  projectableOnly: boolean; // volume unknown → discounted rank (not shown by default)
  reasons: string[];
}

export function evaluate(rec: DealRecord): FilterOutcome {
  const reasons: string[] = [];
  const isUgc = rec.limitedType === 2;

  // 1. Sold out, and not excluded by off-sale UGC (freebies).
  if (!rec.soldOut) reasons.push("not sold out");
  if (isUgc && rec.offSale && rec.rap <= 0) reasons.push("off-sale with no RAP");

  // 2. Discount >= 80% off RAP.
  const discountOk =
    rec.rap > 0 && rec.lowest > 0 && rec.discountPct >= CONFIG.DISCOUNT_FLOOR;
  if (rec.rap > 0 && rec.lowest > 0 && !discountOk) reasons.push("discount below floor");

  // 3. Legitimacy: 2nd and 3rd must stay high (>= 70% of RAP).
  const secondOk =
    rec.rap > 0 && rec.second > 0 && rec.second >= rec.rap * CONFIG.SECOND_MIN_RAP_RATIO;
  const thirdOk =
    rec.rap > 0 && rec.third > 0 && rec.third >= rec.rap * CONFIG.SECOND_MIN_RAP_RATIO;
  if (!secondOk || !thirdOk) reasons.push("2nd/3rd price also low");
  const legit = secondOk && thirdOk;

  const volumeKnown = rec.sales30d > 0;
  const volumePass = volumeKnown && rec.sales30d > CONFIG.VOLUME_FLOOR;

  const legacyPremium =
    !isUgc && rec.soldOut && discountOk && legit && rec.lowest > 0 && rec.rap >= 1;

  let passesHard = false;
  let premiumOnly = false;
  let projectableOnly = false;

  if (isUgc) {
    if (volumeKnown) {
      // Sold-out UGC limiteds are the primary target; lower-volume items pass
      // (ranked lower) as long as every other rule holds.
      passesHard = rec.soldOut && discountOk && legit && rec.rap > 10;
    } else {
      // Volume unknown: keep but demote to a clearly-labelled "projected" pool
      // unless volume checks could not run at all.
      projectableOnly = true;
      passesHard = rec.soldOut && discountOk && legit && rec.projectedProfit > 0;
    }
  } else {
    premiumOnly = legacyPremium;
    passesHard = legacyPremium;
  }

  return { passesHard, premiumOnly, projectableOnly, reasons };
}

/** Compute profit after Roblox's ~30% resale tax, using the 3rd price floor. */
export function projectedProfit(third: number, lowest: number): number {
  if (lowest <= 0 || third <= 0) return 0;
  // If the 1st is the anomaly and the 3rd is the realistic floor, buying the
  // cheap 1st, reselling at 2nd (≈ third) yields (third*0.7 - lowest).
  const gross = Math.min(third, Math.max(third, 0)) * 0.7 - lowest;
  return gross > 0 ? Math.round(gross) : 0;
}

export function discountPct(rap: number, lowest: number): number {
  if (rap <= 0 || lowest <= 0) return 0;
  return Math.round((1 - lowest / rap) * 100);
}
