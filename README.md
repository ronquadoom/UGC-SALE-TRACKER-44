# UGC Snap — $0 UGC Limited deal radar

UGC Snap is a fully free scanner for **sold-out, user-created Roblox UGC
Limiteds**. It judges every deal from the **live resale book**: a card only
appears when a cheap first seller is surrounded by two close, normal-priced
sellers.

## Why the deal rule is what it is

**Rolimons RAP is not used to judge deals.** RAP is stale or inflated for most
UGC limiteds (one outlier sale can drag it far from reality), and anchoring
the discount and the 2nd/3rd "depth band" to it made the scanner reject real
undercuts — the classic "0 deals" failure. Rolimons is used for exactly one
thing: **sales volume (past 30 days)**, as a ranking signal.

## Non-negotiable deal rules

Every card returned by the server passes all of these, computed from live
Roblox reseller prices:

1. **UGC only.** The Roblox catalog must explicitly identify the asset with
   the `Collectible` restriction. Classic Roblox Limited/LimitedUnique rows
   are rejected outright, even when another endpoint returns a
   `collectibleItemId` for them.
2. **Sold out.** The original supply has zero units available.
3. **Real market value.** The 2nd and 3rd lowest individual serial listings
   must be **close to each other** (within 25% by default,
   `LADDER_MAX_RATIO`). Their average is the item's real market value. If
   they disagree, the market is unclear and the item is rejected — a crashed
   market or a single outlier cannot fake a bargain.
4. **Deep first listing.** The lowest listing must be at least **70% below
   that market value** (i.e. at or under 30% of it) — the "70-80%+" sweet
   spot. Bigger cuts are ranked higher.
5. **Real resale book.** Duplicate serial rows are removed, but separate
   serials at the same price still count. Two cheap copies at the floor do
   not masquerade as a one-copy undercut; a single price level is rejected.

Presentation tiers are `70%+` (deal), `75%+` (strong) and `80%+` (hot) below
the market value. The 70% floor cannot be relaxed through environment
variables (stricter is allowed).

Items with 1,500+ copies and stronger 30-day sales volume are ranked higher.
Volume is a preference, never a gate — public volume data is not available
for every UGC collectible, and such items are shown as "projected".

RAP may be **displayed** on the card as a muted reference (when Rolimons
tracks one), but it plays no role in gating, ranking or the deal %.

## Architecture (everything $0)

| Layer | Choice | Out-of-pocket cost |
|---|---|---|
| Frontend + serverless backend | **Next.js 14 App Router** | $0 |
| Hosting + free public URL | **Vercel** (`*.vercel.app`) or **Render** (`*.onrender.com`) | $0 |
| Scheduled scans | Vercel Cron or GitHub Actions calling the cron route | $0 |
| Database | None required; optional Supabase/Turso adapter | $0 |
| Notifications | Browser Web Notifications | $0 |

### Free public data pipeline

1. **Roblox catalog search** (`catalog.roblox.com`) discovers assets and
   reads `itemRestrictions` (the authoritative UGC flag),
   `collectibleItemId`, creator, supply, sold-out state and reseller state.
2. **Rolimons live deal/sale activity** seeds recently active assets; each
   seed is resolved with a single catalog-details call and admitted only when
   the explicit UGC collectible shape is confirmed.
3. **Roblox collectible resellers**
   (`apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers`)
   supplies the live sorted resale book. The scanner builds the first three
   individual serial listings after removing duplicate serial rows.
4. **Rolimons item pages** provide 30-day sales volume (and RAP as a display
   reference). These are scraped **only for items that already passed the
   live-ladder market gate** — volume is the final ranking step, never the
   decision.
5. **Roblox thumbnails** supplies free item images.

The scan is budgeted (~40s for a full scan) so a cold serverless boot
completes inside the platform timeout instead of 503-looping, and a failed
scan serves the previous snapshot rather than an error. Results are cached in
memory with best-effort JSON persistence (Render persistent disk). No paid
API key is required.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/deals` | Current hard-filtered UGC deal snapshot (`?force=1` rescans, `?mate=1` answers during a scan). |
| `POST /api/refresh` | Force a fresh scan; protected by `CRON_SECRET` when configured. |
| `GET /api/cron` | Scheduled scan entry point for Vercel/GitHub Actions. |
| `GET /api/asset/[id]` | Live single-item price-depth refresh. |
| `GET /api/item/[id]` | Rolimons volume/supply details for an item. |

The live refresh also removes a cached card if its floor, 2nd/3rd ladder or
70%-below-market rule no longer passes.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run harness      # offline end-to-end fixture test
npm run typecheck    # tsc --noEmit
```

Set `CRON_SECRET` to protect `/api/cron` and `/api/refresh`.

> Demo mode: `DEMO_MODE=1 npm run dev` serves strict sample UGC rows instantly.
> It does not contact Roblox and is clearly labelled in the dashboard.

## Deploy for free

### Vercel

1. Push the repository to GitHub.
2. Import it at [vercel.com](https://vercel.com) as a Next.js project.
3. Deploy. The free Hobby plan supplies a `*.vercel.app` URL.
4. Optionally set `CRON_SECRET` and configure a daily Hobby cron.

### Render

The repository includes `render.yaml` for the free Blueprint flow at
[render.com](https://render.com). Render's persistent disk can retain the
best-effort JSON snapshot between restarts.

### GitHub Actions scheduling

Copy `deploy/gha-cron.example.yml` to `.github/workflows/cron.yml` and add
`CRON_SECRET` and `CRON_URL` as repository secrets. GitHub Actions can call
the free cron route every 15–30 minutes.

## Repository layout

```
dev/pipeline.harness.cjs ← offline end-to-end scan test (market rules)
src/lib/config.ts       ← hard 70/75/80 + 25% ladder rules (stricter OK)
src/lib/filter.ts       ← UGC, sold-out, market-value and undercut gates
src/lib/scan.ts         ← discovery → UGC shortlist → live ladder → score
src/lib/roblox.ts       ← Roblox catalog, reseller and thumbnail adapter
src/lib/rolimons.ts     ← 30-day sales volume (+RAP reference) adapter
src/app/components/     ← clean UGC deal cards and dashboard
```

## Disclaimer

Uses public Roblox/Rolimon endpoints and is not affiliated with either
service. Prices and public endpoint behavior can change. Profit figures are
approximate and assume Roblox resale tax; always verify an item on Roblox
before buying. This is not financial advice.
