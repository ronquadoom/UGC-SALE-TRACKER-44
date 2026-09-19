import { NextRequest, NextResponse } from "next/server";
import { refreshAssetPrices } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Live price-depth refresh for a single item (watchlist watchdog / "live" button). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const assetId = Number(params.id);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }
  try {
    const tup = await refreshAssetPrices(assetId);
    if (!tup) {
      return NextResponse.json({ error: "no_resellers" }, { status: 404 });
    }
    return NextResponse.json({ assetId, prices: tup, at: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
