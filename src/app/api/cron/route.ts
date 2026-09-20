import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { getDeals } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel / GitHub Actions cron entry point.
 *
 * Vercel Hobby only allows cron schedules >= once/day; Vercel calls the route
 * with `Authorization: Bearer $CRON_SECRET` automatically. GitHub Actions can
 * poke this endpoint on any schedule (still free) via curl.
 */
export async function GET(req: NextRequest) {
  const want = CONFIG.CRON_SECRET;
  // Vercel injects CRON_SECRET as a Bearer token; accept it or a query token.
  const auth = req.headers.get("authorization") || "";
  const okAuth = !want || auth === `Bearer ${want}` || req.nextUrl.searchParams.get("token") === want;
  if (!okAuth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await getDeals({ force: true });
    return NextResponse.json({
      ok: true,
      total: data.total,
      generatedAt: data.generatedAt,
      sourceStats: data.sourceStats,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
