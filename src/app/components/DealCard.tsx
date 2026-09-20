import type { DealRecord } from "@/lib/types";
import { fmt, fmtRobux, timeAgo } from "@/lib/ui";

const TIER_LABEL: Record<NonNullable<DealRecord["tier"]>, string> = {
  hot: "Hot",
  strong: "Strong",
  deal: "80%+",
};

/** Every card has already passed the server-side UGC, sold-out and depth gates. */
function tierOf(deal: DealRecord): NonNullable<DealRecord["tier"]> {
  return deal.tier ?? "deal";
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
  const t = tierOf(deal);
  const accent =
    t === "hot"
      ? "border-accent/50 shadow-[0_0_30px_-10px_rgba(34,211,238,0.45)]"
      : t === "strong"
      ? "border-profit/30"
      : "border-white/10";
  const badge =
    t === "hot"
      ? "bg-accent text-ink-950"
      : t === "strong"
      ? "bg-profit/80 text-ink-950"
      : "bg-warn/70 text-ink-950";

  return (
    <article
      className={`card flex flex-col gap-3 p-4 transition-transform hover:-translate-y-0.5 ${accent}`}
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
            <div className="grid h-16 w-16 place-items-center rounded-lg bg-ink-800 text-xs text-slate-500">
              —
            </div>
          )}
          <span
            className={`absolute -right-1.5 -top-1.5 rounded px-1 text-[10px] font-bold uppercase tracking-wide ${badge}`}
          >
            {TIER_LABEL[t]}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <a
                href={deal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-semibold text-slate-100 hover:text-accent"
                title={deal.name}
              >
                {deal.name || `Item ${deal.assetId}`}
              </a>
              <div className="mt-0.5 truncate text-[11px] text-slate-400" title={deal.creator}>
                by {deal.creator || "Unknown creator"}
              </div>
            </div>
            <button
              onClick={() => onWatch(deal.id)}
              className="shrink-0 text-lg leading-none text-slate-500 transition-colors hover:text-warn"
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
              aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
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
            <span className="chip bg-accent/10 text-accent">UGC Limited</span>
            <span className="chip bg-warn/10 text-warn">-{deal.discountPct}% RAP</span>
            <span className="chip bg-slate-500/10 text-slate-400">
              stock {deal.totalCopies ? fmt(deal.totalCopies) : "?"}
            </span>
            <span className="chip bg-danger/10 text-danger">Sold out</span>
            <span
              className="chip bg-profit/10 text-profit"
              title="The 2nd and 3rd individual reseller listings are 70–100% of RAP"
            >
              depth ✓
            </span>
            {deal.floorCopies > 1 && (
              <span className="chip bg-warn/10 text-warn">
                {deal.floorCopies}× at floor
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The first price is the opportunity; the next two prove it is not a crashed market. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-ink-900/70 p-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">RAP</div>
          <div className="font-mono text-sm font-semibold text-slate-200">{fmt(deal.rap)}</div>
        </div>
        <div className="rounded-lg bg-profit/10 p-2 ring-1 ring-profit/30">
          <div className="text-[10px] uppercase tracking-wider text-profit/70">Deal price</div>
          <div className="font-mono text-sm font-semibold text-profit">{fmt(deal.lowest)}</div>
        </div>
        <div className="rounded-lg bg-ink-900/70 p-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">2nd · 3rd</div>
          <div className="font-mono text-sm font-semibold text-slate-300">
            {fmt(deal.second)} <span className="text-slate-600">·</span> {fmt(deal.third)}
          </div>
        </div>
      </div>

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
          <div className="font-mono font-semibold text-slate-400">{timeAgo(deal.updatedAt)}</div>
        </div>
      </div>

      {deal.passOverrides.projectableOnly && (
        <div className="text-[11px] text-warn/90">
          Volume unverified — projected deal, verify before buying.
        </div>
      )}

      <a
        href={deal.url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary mt-auto w-full justify-center"
      >
        Buy on Roblox ↗
      </a>
    </article>
  );
}
