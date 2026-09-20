"use client";

import { useCallback, useEffect, useState } from "react";
import type { DealsResponse } from "@/lib/types";
import { timeAgo } from "@/lib/ui";
import DealCard from "./DealCard";

export default function Dashboard() {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mate: boolean) => {
    try {
      const res = await fetch(`/api/deals${mate ? "?mate=1" : ""}`, {
        cache: "no-store",
      });
      if (res.status === 503) {
        return false;
      }
      const j: DealsResponse = await res.json();
      setData(j);
      setError(
        j.total === 0 && !j.scanning
          ? "No qualifying deals right now — scanner is hunting the live resale book."
          : null
      );
      return !j.scanning;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    (async () => {
      setLoading(true);
      while (!cancelled && attempts < 8) {
        const done = await load(attempts > 0);
        attempts++;
        if (done) break;
        if (!cancelled) await new Promise((r) => setTimeout(r, 3200));
      }
      if (!cancelled) setLoading(false);
    })();

    // Auto-refresh every 45s in background, plus on tab focus
    const iv = setInterval(() => {
      if (!cancelled && !document.hidden) load(true);
    }, 45_000);

    const onFocus = () => {
      if (!document.hidden) load(true);
    };
    const onVis = () => {
      if (!document.hidden) load(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const deals = data?.deals ?? [];
  const isScanning = data?.scanning && deals.length === 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white shadow-sm">
              <span className="text-[15px] font-black tracking-tighter">◈</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-bold tracking-tight text-slate-900">
                  UGC Snap
                </h1>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-700 ring-1 ring-emerald-200">
                  LIVE
                </span>
              </div>
              <p className="hidden text-xs leading-none text-slate-500 sm:block">
                Sold-out UGC Limiteds • 70%+ below real market
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm sm:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-slate-600">
                Auto-updates every 45s
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-slate-900">
                {loading ? "Scanning…" : `${deals.length} deals live`}
              </div>
              <div className="text-[11px] text-slate-500">
                {data?.generatedAt ? `Updated ${timeAgo(data.generatedAt)}` : "—"}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-5 pb-6 pt-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[28px]">
              Real undercuts.{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                Verified live.
              </span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              Every card is a sold-out UGC Limited where the cheapest listing is{" "}
              <span className="font-semibold text-slate-900">70%+ below</span> the
              2nd &amp; 3rd lowest prices. No RAP, no fake volume — just the live
              resale ladder.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-slate-700 shadow-card ring-1 ring-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Hot 80%+
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-slate-700 shadow-card ring-1 ring-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Strong 75%+
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-slate-700 shadow-card ring-1 ring-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Deal 70%+
            </span>
          </div>
        </div>

        {/* Subtle stats bar */}
        {data && !loading && (
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-900 px-3 py-1.5 font-semibold text-white">
              {deals.length} verified deals
            </span>
            {data.sourceStats && (
              <>
                <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200">
                  Scanned {data.sourceStats.catalog.toLocaleString()} items
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200">
                  {data.sourceStats.depthVerified} market-verified
                </span>
                {data.sourceStats.tiers && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200">
                    🔥 {data.sourceStats.tiers.hot} · ✨ {data.sourceStats.tiers.strong} · ✓{" "}
                    {data.sourceStats.tiers.deal}
                  </span>
                )}
              </>
            )}
            <span className="ml-auto hidden items-center gap-1.5 text-slate-400 sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live scan • 1500+ copies preferred • ranked by volume & depth
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        {/* Scanning state */}
        {isScanning && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
              <div>
                <div className="text-sm font-semibold text-indigo-900">
                  Hunting for undercuts…
                </div>
                <div className="text-xs text-indigo-700/70">
                  Checking the live resale ladder across hundreds of sold-out UGC Limiteds. This takes ~30s on first load.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Demo banner */}
        {data?.snapshotKey === "demo" && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <span className="font-semibold">Demo mode</span> — sample data. Set{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">DEMO_MODE=0</code> for live scans.
          </div>
        )}

        {error && !isScanning && deals.length === 0 && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {error}
          </div>
        )}

        {/* Skeleton */}
        {loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card overflow-hidden p-0">
                <div className="h-36 animate-pulse bg-slate-100" />
                <div className="space-y-3 p-5">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                    <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                    <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : deals.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        ) : (
          !loading &&
          !isScanning && (
            <div className="card p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white">
                ◈
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">
                No deals right now
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                Nothing is 70%+ below its 2nd &amp; 3rd listings at the moment.
                The scanner rechecks the live resale book automatically every 45 seconds — just leave this tab open.
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                Auto-refreshing…
              </div>
            </div>
          )
        )}

        {/* Explainer */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-600">How it works</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">2nd &amp; 3rd price = real value</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              If the 2nd and 3rd cheapest listings are close, their average is the market. A single floor undercut below that is a real deal.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">No RAP guessing</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">Rolimons only for volume</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              RAP is often inflated for UGC. We display it for reference but never use it to judge a deal — only 30-day sales.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-bold uppercase tracking-widest text-amber-600">1500+ copies preferred</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">Ranked, not gated</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Higher copies and stronger sales rank higher. Every deal shown is already sold-out and 70%+ below market.
            </p>
          </div>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-6 text-center text-xs leading-relaxed text-slate-400">
          Data from public Roblox &amp; Rolimons endpoints. Not affiliated with Roblox or Rolimons.
          <br />
          Profit is estimated after ~30% Roblox resale tax. Verify on Roblox before buying. Not financial advice.
          <br />
          <span className="mt-2 inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Updates automatically • 100% free (Next.js + serverless)
          </span>
        </footer>
      </div>
    </div>
  );
}
