import type { DealRecord } from "@/lib/types";
import { fmt, fmtRobux, timeAgo } from "@/lib/ui";

const TIER_META: Record<
  NonNullable<DealRecord["tier"]>,
  { label: string; dot: string; badge: string }
> = {
  hot: {
    label: "HOT",
    dot: "bg-rose-500",
    badge: "bg-rose-500 text-white shadow-sm",
  },
  strong: {
    label: "STRONG",
    dot: "bg-amber-500",
    badge: "bg-amber-500 text-white shadow-sm",
  },
  deal: {
    label: "DEAL",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500 text-white shadow-sm",
  },
};

function tierOf(d: DealRecord) {
  return (d.tier ?? "deal") as NonNullable<DealRecord["tier"]>;
}

export default function DealCard({ deal }: { deal: DealRecord }) {
  const t = tierOf(deal);
  const meta = TIER_META[t];

  return (
    <article className="group flex flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-card transition-all hover:-translate-y-1 hover:shadow-card-hover">
      {/* Image header */}
      <div className="relative bg-gradient-to-br from-slate-50 to-slate-100 p-5 pb-3">
        {/* top pills */}
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest ${meta.badge}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
            {meta.label} · -{deal.discountPct}%
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <span className="inline-flex items-center rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
            UGC Limited
          </span>
        </div>

        <div className="mx-auto mt-6 flex justify-center">
          {deal.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={deal.thumbUrl}
              alt={deal.name}
              loading="lazy"
              className="h-28 w-28 object-contain drop-shadow-sm transition-transform group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-28 w-28 place-items-center rounded-2xl bg-white text-xs text-slate-400 ring-1 ring-slate-200">
              No image
            </div>
          )}
        </div>

        {/* name block */}
        <div className="mt-4 text-center">
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-1 text-[15px] font-bold leading-tight text-slate-900 hover:text-indigo-600"
            title={deal.name}
          >
            {deal.name || `Item ${deal.assetId}`}
          </a>
          <div className="mt-1 truncate text-xs text-slate-500">
            by {deal.creator || "Unknown creator"}
            {deal.acronym ? ` · ${deal.acronym}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white">
              {deal.totalCopies ? `${fmt(deal.totalCopies)} copies` : "Limited"}
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Sold out
            </span>
            {deal.floorCopies > 1 && (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                {deal.floorCopies}× at floor
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Prices */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Market
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900">
              {fmt(deal.marketValue)}
            </div>
            <div className="text-[10px] text-slate-400">2nd·3rd avg</div>
          </div>
          <div className="rounded-2xl bg-slate-900 p-3 text-center text-white shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">
              Deal price
            </div>
            <div className="mt-1 font-mono text-sm font-bold">{fmt(deal.lowest)}</div>
            <div className="text-[10px] font-semibold text-emerald-300">
              -{deal.discountPct}% off
            </div>
          </div>
          <div className="rounded-2xl bg-white p-3 text-center ring-1 ring-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              2nd · 3rd
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-700">
              {fmt(deal.second)} <span className="text-slate-300">·</span> {fmt(deal.third)}
            </div>
            <div className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              verified
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 px-2 py-2.5 ring-1 ring-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Profit
            </div>
            <div
              className={`mt-0.5 font-mono text-xs font-bold ${deal.projectedProfit > 0 ? "text-emerald-600" : "text-slate-400"}`}
            >
              {fmtRobux(deal.projectedProfit)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-2.5 ring-1 ring-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Sales 30d
            </div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-700">
              {deal.sales30d > 0 ? fmt(deal.sales30d) : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-2.5 ring-1 ring-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Spread
            </div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-700">
              {deal.spreadX ? `${deal.spreadX}×` : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-2.5 ring-1 ring-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Updated
            </div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-500">
              {timeAgo(deal.updatedAt)}
            </div>
          </div>
        </div>

        {deal.rap > 0 && (
          <div className="mt-3 text-center text-[11px] text-slate-400">
            RAP <span className="font-mono font-medium text-slate-500">{fmt(deal.rap)}</span>{" "}
            <span className="text-slate-400">· for reference only, not used</span>
          </div>
        )}

        {deal.passOverrides.projectableOnly && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            Volume unverified — projected deal. Verify on Roblox before buying.
          </div>
        )}

        <a
          href={deal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
        >
          View on Roblox
          <span className="text-white/60">↗</span>
        </a>

        <div className="mt-2 text-center text-[10px] font-medium uppercase tracking-widest text-slate-400">
          {deal.numListings} listings · market verified ✓
        </div>
      </div>
    </article>
  );
}
