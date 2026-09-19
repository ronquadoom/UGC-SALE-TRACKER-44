"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DealsResponse, DealRecord } from "@/lib/types";
import { fmt, timeAgo } from "@/lib/ui";
import DealCard from "./DealCard";

type SortKey = "premium" | "discount" | "profit" | "sales" | "rap";

type TierFilter = "all" | "hot" | "strong" | "deal";

const TIER_FILTERS: { key: TierFilter; label: string; hint: string }[] = [
  { key: "all", label: "All deals", hint: "every tier" },
  { key: "hot", label: "🔥 Hot", hint: "≥70% off RAP" },
  { key: "strong", label: "Strong", hint: "≥50% off RAP" },
  { key: "deal", label: "Deal", hint: "≥35% off RAP" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "premium", label: "Best score" },
  { key: "discount", label: "Best discount" },
  { key: "profit", label: "Highest profit" },
  { key: "sales", label: "Most sales" },
  { key: "rap", label: "Highest RAP" },
];

interface UiFilters {
  minSales: number;
  minCopies: number;
  minDiscount: number;
  minRap: number;
  soldOutOnly: boolean;
  premiumCopies: boolean;
  hideProjected: boolean;
}

/**
 * Defaults line up with the scan's own tier floor (deal ≥35% off RAP) and do
 * not hide volume-unverified rows — that combination is what used to leave the
 * dashboard showing "0 deals" even when the scan had found some.
 */
function defaultFilters(): UiFilters {
  return {
    minSales: 0,
    minCopies: 0,
    minDiscount: 35,
    minRap: 0,
    soldOutOnly: true,
    premiumCopies: false,
    hideProjected: false,
  };
}

function loadWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem("ugcsnap:watch") || "[]");
  } catch {
    return [];
  }
}

function saveWatchlist(v: string[]) {
  try {
    localStorage.setItem("ugcsnap:watch", JSON.stringify(v));
  } catch {}
}

export default function Dashboard() {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UiFilters>(defaultFilters);
  const [sort, setSort] = useState<SortKey>("premium");
  const [search, setSearch] = useState("");
  const [watch, setWatch] = useState<string[]>([]);
  const [showWatchOnly, setShowWatchOnly] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [notif, setNotif] = useState<"off" | "denied" | "on">("off");
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [spin, setSpin] = useState(false);

  // ---- load deals (self-healing retry for first boot) --------------------
  const load = useCallback(async (mate: boolean) => {
    try {
      const res = await fetch(`/api/deals${mate ? "?mate=1" : ""}`, {
        cache: "no-store",
      });
      if (res.status === 503) {
        setError("First scan still running — retrying…");
        return false;
      }
      const j: DealsResponse = await res.json();
      setData(j);
      setError(j.total === 0 ? "No qualifying deals yet. Watchlist & refresh will keep checking." : null);
      return !j.scanning;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return false;
    }
  }, []);

  useEffect(() => {
    setWatch(loadWatchlist());
    let cancelled = false;
    let attempts = 0;
    (async () => {
      setLoading(true);
      while (!cancelled && attempts < 6) {
        const done = await load(attempts > 0);
        attempts++;
        if (done) break;
        if (!cancelled) await new Promise((r) => setTimeout(r, 3500));
      }
      if (!cancelled) setLoading(false);
      if (!cancelled && attempts >= 6) setError("Could not reach the scan engine.");
    })();

    // background freshen every 60s (served from cache)
    const iv = setInterval(async () => {
      if (!cancelled) await load(true);
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [load]);

  // ---- notifications ------------------------------------------------------
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") setNotif("on");
    else if (Notification.permission === "denied") setNotif("denied");
  }, []);

  const enableNotifs = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotif(p === "granted" ? "on" : p === "denied" ? "denied" : "off");
  };

  // fire a toast on genuinely new strong deals vs a remembered baseline
  const prevTop = useRef<string | null>(null);
  useEffect(() => {
    if (!data || data.total === 0) return;
    const hot = data.deals
      .filter((d) => d.tier === "hot" && d.depthVerified)
      .map((d) => d.id)
      .sort()
      .join(",");
    if (prevTop.current && prevTop.current !== hot && notif === "on") {
      try {
        const newest = data.deals[0];
        new Notification("🔥 New deep discount spotted", {
          body: `${newest.name || "UGC limited"} is ${newest.discountPct}% off RAP (R$ ${fmt(newest.lowest)}).`,
        });
      } catch {}
    }
    prevTop.current = hot;
  }, [data, notif]);

  // ---- watchlist ----------------------------------------------------------
  const toggleWatch = (id: string) => {
    setWatch((w) => {
      const next = w.includes(id) ? w.filter((x) => x !== id) : [...w, id];
      saveWatchlist(next);
      return next;
    });
  };

  // ---- processing ---------------------------------------------------------
  const deals = useMemo(() => {
    if (!data) return [];
    let list = data.deals.slice();
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((d) => d.name.toLowerCase().includes(q) || d.acronym.toLowerCase().includes(q));

    if (tierFilter !== "all") list = list.filter((d) => d.tier === tierFilter);
    if (filters.soldOutOnly) list = list.filter((d) => d.soldOut);
    if (filters.hideProjected) list = list.filter((d) => !d.passOverrides.projectableOnly);
    if (filters.premiumCopies) list = list.filter((d) => d.totalCopies >= 1500);
    list = list.filter((d) => d.sales30d >= filters.minSales || d.sales30d === 0 && filters.minSales <= 0);
    list = list.filter((d) => d.totalCopies >= filters.minCopies);
    list = list.filter((d) => d.discountPct >= filters.minDiscount);
    list = list.filter((d) => d.rap >= filters.minRap);
    if (showWatchOnly) list = list.filter((d) => watch.includes(d.id));

    const sorter: Record<SortKey, (a: DealRecord, b: DealRecord) => number> = {
      premium: (a, b) => b.premiumScore - a.premiumScore,
      discount: (a, b) => b.discountPct - a.discountPct,
      profit: (a, b) => b.projectedProfit - a.projectedProfit,
      sales: (a, b) => b.sales30d - a.sales30d,
      rap: (a, b) => b.rap - a.rap,
    };
    return list.sort(sorter[sort]);
  }, [data, search, filters, sort, showWatchOnly, watch, tierFilter]);

  const refresh = async () => {
    setSpin(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await load(true);
      setLastRefresh(Date.now());
    } catch (e: any) {
      setError(`Refresh failed: ${String(e?.message ?? e)}`);
    } finally {
      setSpin(false);
    }
  };

  const dealCount = deals.length;
  const watchDeals = deals.filter((d) => watch.includes(d.id)).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-100">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-accent">◈</span>
            UGC Snap
            <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              $0
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Sold-out UGC Limiteds from 35% off RAP — 🔥 Hot ≥70% · Strong ≥50%
            · Deal ≥35% — with 2nd &amp; 3rd lowest prices depth-checked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-xs text-slate-500">
            <div>
              {loading
                ? "scanning…"
                : `snapshot ${timeAgo(data?.generatedAt)} · scanned ${fmt(data?.sourceStats?.catalog)} items`}
            </div>
            {lastRefresh && <div className="text-slate-600">refresh {timeAgo(lastRefresh)}</div>}
          </div>
          <button onClick={refresh} disabled={spin} className="btn-ghost">
            ⟳ {spin ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={enableNotifs}
            disabled={notif === "on"}
            className="btn-ghost"
            title="Enable browser notifications for new strong deals"
          >
            🔔 {notif === "on" ? "On" : notif === "denied" ? "Blocked" : "Notify"}
          </button>
        </div>
      </header>

      {/* controls */}
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-52 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`chip cursor-pointer ${
                  sort === s.key ? "bg-accent/20 text-accent" : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {TIER_FILTERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTierFilter(t.key)}
                title={t.hint}
                className={`chip cursor-pointer ${
                  tierFilter === t.key
                    ? "bg-profit/20 text-profit"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showWatchOnly}
              onChange={(e) => setShowWatchOnly(e.target.checked)}
              className="accent-cyan-400"
            />
            Watchlist only ({watch.length})
          </label>
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/5 pt-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-400">
            Min sales
            <input
              type="number"
              min={0}
              value={filters.minSales}
              onChange={(e) => setFilters({ ...filters, minSales: Number(e.target.value) || 0 })}
              className="w-16 rounded border border-white/10 bg-ink-900 px-1.5 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            Min copies
            <input
              type="number"
              min={0}
              step={100}
              value={filters.minCopies}
              onChange={(e) => setFilters({ ...filters, minCopies: Number(e.target.value) || 0 })}
              className="w-20 rounded border border-white/10 bg-ink-900 px-1.5 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            Min discount %
            <input
              type="number"
              min={0}
              max={99}
              value={filters.minDiscount}
              onChange={(e) => setFilters({ ...filters, minDiscount: Number(e.target.value) || 0 })}
              className="w-16 rounded border border-white/10 bg-ink-900 px-1.5 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            Min RAP
            <input
              type="number"
              min={0}
              step={100}
              value={filters.minRap}
              onChange={(e) => setFilters({ ...filters, minRap: Number(e.target.value) || 0 })}
              className="w-20 rounded border border-white/10 bg-ink-900 px-1.5 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="checkbox"
              checked={filters.soldOutOnly}
              onChange={(e) => setFilters({ ...filters, soldOutOnly: e.target.checked })}
              className="accent-cyan-400"
            />
            Sold out only
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="checkbox"
              checked={filters.premiumCopies}
              onChange={(e) => setFilters({ ...filters, premiumCopies: e.target.checked })}
              className="accent-cyan-400"
            />
            ≥1,500 copies
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="checkbox"
              checked={filters.hideProjected}
              onChange={(e) => setFilters({ ...filters, hideProjected: e.target.checked })}
              className="accent-cyan-400"
            />
            Hide unverified volume
          </label>
        </div>
      </div>

      {/* status banners */}
      {bootstrapping && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          First scan is running — discovering and verifying sold-out UGC limiteds across Roblox. This can take a few seconds…
        </div>
      )}
      {data?.snapshotKey === "demo" && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          DEMO_MODE is on — these rows are sample data, not live scan results.
          Set <code className="font-mono">DEMO_MODE=0</code> to scan Roblox &amp;
          Rolimon&apos;s for real.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          {error}
        </div>
      )}

      {/* count */}
      <div className="mb-3 text-xs text-slate-500">
        {dealCount} deal{dealCount === 1 ? "" : "s"}
        {data?.sourceStats?.tiers
          ? ` · hot ${data.sourceStats.tiers.hot} · strong ${data.sourceStats.tiers.strong} · deal ${data.sourceStats.tiers.deal}`
          : ""}
        {data?.sourceStats?.depthVerified != null
          ? ` · depth-verified ${data.sourceStats.depthVerified}`
          : ""}{" "}
        · {watchDeals} on watchlist
      </div>

      {/* grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} watched={watch.includes(d.id)} onWatch={toggleWatch} />
        ))}
      </div>

      {!loading && dealCount === 0 && !error && (
        <div className="card mt-4 p-8 text-center text-sm text-slate-500">
          No deals match your filters right now.
          <br />
          The scanner keeps looking for sold-out &amp; mispriced limiteds in the
          background — loosen “Min discount %” below 35 or select “All deals”
          to see everything the last scan found.
        </div>
      )}

      {/* footer */}
      <footer className="mt-8 border-t border-white/5 pt-4 text-xs text-slate-600">
        Data: public Roblox &amp; Rolimon endpoints. 100% free stack (Next.js + serverless cron).
        Profit shown is approximate (R$ minus ~30% resale tax). Not financial advice.
      </footer>
    </div>
  );
}
