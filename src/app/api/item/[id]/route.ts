import { NextRequest, NextResponse } from "next/server";
import { getItemPage, estimateSales30d } from "@/lib/rolimons";
import { getDeals } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

/** Deep-ish look at one item: volume/supply from Rolimons + whether it's a current deal. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const assetId = Number(params.id);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }
  const page = await getItemPage(assetId);
  const snaps = await getDeals({ mate: true });
  const deal = snaps.deals.find((d) => d.assetId === assetId) || null;
  const stats = page
    ? {
        bestPrice: page.bestPrice,
        rap: page.rap,
        value: page.value,
        totalCopies: page.totalCopies,
        availableCopies: page.availableCopies,
        sellers: page.sellers,
        salesRecent: page.salesRecent,
        salesDays: page.salesDays,
        sales30dEstimate:
          page.salesRecent != null && page.salesDays != null
            ? estimateSales30d(page.salesRecent, page.salesDays)
            : null,
        soldOut: page.soldOut,
        resaleLocked: page.resaleLocked,
      }
    : null;
  return NextResponse.json({ assetId, stats, deal });
}
