import { NextRequest, NextResponse } from "next/server";
import { getDeals } from "@/lib/scan";
import { hydrateFromDisk } from "@/lib/storage";
import { CONFIG } from "@/lib/config";
import { demoSnapshot } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // Vercel Hobby caps at 60s; keep us well under it.

export async function GET(req: NextRequest) {
  try {
    hydrateFromDisk();
    if (CONFIG.DEMO_MODE) {
      return NextResponse.json(demoSnapshot(), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const mate = req.nextUrl.searchParams.get("mate") === "1";
    const force = req.nextUrl.searchParams.get("force") === "1";
    const data = await getDeals({ force, mate });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "scan_unavailable",
        message: "First scan is still warming up. Retry in ~30s.",
        detail: String(e?.message ?? e),
      },
      { status: 503 }
    );
  }
}
