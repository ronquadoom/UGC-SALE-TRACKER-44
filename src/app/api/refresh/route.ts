import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { getDeals } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const want = CONFIG.CRON_SECRET;
  if (!want) return true; // no secret configured → permissive (self-hosted)
  const auth = req.headers.get("authorization") || "";
  const token = req.nextUrl.searchParams.get("token") || "";
  return auth === `Bearer ${want}` || token === want;
}

/** Force a fresh scan. Locked by CRON_SECRET when configured. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await getDeals({ force: true });
    return NextResponse.json({
      ok: true,
      total: data.total,
      generatedAt: data.generatedAt,
      fromCache: data.fromCache,
      sourceStats: data.sourceStats,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
