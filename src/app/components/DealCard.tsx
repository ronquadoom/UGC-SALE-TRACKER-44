import type { DealRecord } from "@/lib/types";
import { fmt, fmtRobux, timeAgo } from "@/lib/ui";

function tier(deal: DealRecord): "premium" | "good" | "watch" {
  const strong = deal.discountPct >= 85;
  const vol = deal.sales30d >= 80;
  const proof = (deal.spreadX ?? 0) >= 2.5;
  if (strong && vol && proof) return "premium";
  if (strong && (vol || proof)) return "good";
  return "watch";
}

export default function DealCard({
  deal,
  watched,
  onWatch,
}: {
  deal: DealRecord;
  watched: boolean;
  onWatch: (id: string) => void;
}) {
  const t = tier(deal);
  const accent =
    t === "premium"
      ? "border-accent/50 shadow-[0_0_30px_-10px_rgba(34,211,238,0.45)]"
      : t === "good"
      ? "border-profit/30"
      : "border-white/10";

  return (
    <div
      className={`card p-4 flex flex-col gap-3 transition-transform hover:-translate-y-0.5 ${accent}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {deal.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={deal.thumbUrl}
              alt={deal.name}
              loading="lazy"
              className="h-16 w-16 rounded-lg bg-ink-800 object-contain"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-ink-800 grid place-items-center text-xs text-slate-500">
              —
            </div>
          )}
          {t === "premium" && (
            <span className="absolute -top-1.5 -right-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-950 bg-accent rounded px-1">
              Hot
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <a
              href={deal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-100 hover:text-accent truncate"
              title={deal.name}
            >
              {deal.name || `Item ${deal.assetId}`}
            </a>
            <button
              onClick={() => onWatch(deal.id)}
              className="shrink-0 text-lg leading-none text-slate-500 hover:text-warn transition-colors"
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
            >
              {watched ? "★" : "☆"}
            </button>
          </div>
          {deal.acronym && (
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {deal.acronym}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="chip bg-warn/10 text-warn">
              -{deal.discountPct}% RAP
            </span>
            <span className="chip bg-slate-500/10 text-slate-400">
              {deal.totalCopies ? `~${fmt(deal.totalCopies)} copies` : "copies?"}
            </span>
            <span className="chip bg-slate-500/10 text-slate-400">
              {fmt(deal.numListings)} listings
            </span>
            {deal.soldOut && (
              <span className="chip bg-danger/10 text-danger">Sold out</span>
            )}
          </div>
        </div>
      </div>

      {/* price grid */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-ink-900/70 p-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            RAP
          </div>
          <div className="font-mono text-sm font-semibold text-slate-200">
            {fmt(deal.rap)}
          </div>
        </div>
        <div className="rounded-lg bg-profit/10 p-2 ring-1 ring-profit/30">
          <div className="text-[10px] uppercase tracking-wider text-profit/70">
            Lowest
          </div>
          <div className="font-mono text-sm font-semibold text-profit">
            {fmt(deal.lowest)}
          </div>
        </div>
        <div className="rounded-lg bg-ink-900/70 p-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            2nd / 3rd
          </div>
          <div className="font-mono text-sm font-semibold text-slate-300">
            {fmt(deal.second)}
            <span className="text-slate-600"> · </span>
            {fmt(deal.third)}
          </div>
        </div>
      </div>

      {/* stats row */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <div className="text-[10px] uppercase text-slate-500">Profit</div>
          <div className={`font-mono font-semibold ${deal.projectedProfit > 0 ? "text-profit" : "text-slate-500"}`}>
            {fmtRobux(deal.projectedProfit)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">30d sales</div>
          <div className="font-mono font-semibold text-slate-300">
            {deal.sales30d > 0 ? fmt(deal.sales30d) : "–"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Spread</div>
          <div className="font-mono font-semibold text-slate-300">
            {deal.spreadX ? `${deal.spreadX}×` : "–"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Updated</div>
          <div className="font-mono font-semibold text-slate-400">
            {timeAgo(deal.updatedAt)}
          </div>
        </div>
      </div>

      {deal.passOverrides.projectableOnly && (
        <div className="text-[11px] text-warn/90">
          Volume unverified — projected deal, verify before buying.
        </div>
      )}
      {deal.passOverrides.premiumOnly && (
        <div className="text-[11px] text-warn/90">Legacy limited (not UGC).</div>
      )}
    </div>
  );
}
