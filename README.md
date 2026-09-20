# UGC Snap — $0 UGC Limited deal radar

UGC Snap is a fully free scanner for **sold-out, user-created Roblox UGC
Limiteds**. It only shows a listing when a cheap first seller is surrounded by
normal-priced sellers in the live resale book, so a market-wide crash is not
presented as a bargain.

## Non-negotiable deal rules

Every card returned by the server passes all of these rules:

1. **UGC only.** The Roblox catalog must explicitly identify the asset with the
   `Collectible` restriction. Classic Roblox Limited/LimitedUnique rows are
   rejected, even when another endpoint happens to return a
   `collectibleItemId` for them.
2. **Sold out.** The original supply has zero units available.
3. **Deep first listing.** The lowest live reseller price is at most **20% of
   RAP**, which is an **80%+ discount**.
4. **Healthy price depth.** The 2nd and 3rd individual serial listings must
   each be between **70% and 100% of RAP**. If the second or third listing is
   also extremely cheap, the item is rejected.
5. **Real resale book.** Duplicate serial rows are removed, but separate serials
   at the same price still count. This means two cheap copies at the floor do
   not masquerade as a temporary one-copy undercut.

Items with 1,500+ copies and stronger recent sales volume are ranked higher.
Volume is a ranking signal rather than a hard gate, because public volume data
is not available for every new UGC collectible.

Presentation tiers are `80%+` (deal), `85%+` (strong), and `90%+` (hot). The
80% floor cannot be relaxed through environment variables.

## Architecture (everything $0)

| Layer | Choice | Out-of-pocket cost |
|---|---|---|
| Frontend + serverless backend | **Next.js 14 App Router** | $0 |
| Hosting + free public URL | **Vercel** (`*.vercel.app`) or **Render** (`*.onrender.com`) | $0 |
| Scheduled scans | Vercel Cron or GitHub Actions calling the cron route | $0 |
| Database | None required; optional Supabase/Turso adapter | $0 |
| Notifications | Browser Web Notifications | $0 |

### Free public data pipeline

1. **Roblox catalog search** (`catalog.roblox.com`) discovers assets and reads
   `itemRestrictions`, `collectibleItemId`, creator, supply, sold-out state and
   catalog hints. The UGC classifier requires the explicit `Collectible`
   restriction and rejects classic `Limited`/`LimitedUnique` flags.
2. **Rolimons bulk index and item pages** provide RAP, value, supply and recent
   sales estimates. These are used as supporting data; they never override the
   UGC classifier.
3. **Rolimons deal/sale activity** seeds recently active assets. Activity rows
   are resolved through Roblox economy/catalog details and are admitted only
   when the explicit UGC collectible shape is confirmed.
4. **Roblox collectible resellers**
   (`apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers`)
   supplies the live sorted resale book. The scanner builds the first three
   individual listings after removing duplicate serial rows.
5. **Roblox thumbnails** supplies free item images.

The scan is bounded and cached in memory, with best-effort JSON persistence on
Render. No paid API key is required.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/deals` | Current hard-filtered UGC deal snapshot (`?force=1` rescans, `?mate=1` answers during a scan). |
| `POST /api/refresh` | Force a fresh scan; protected by `CRON_SECRET` when configured. |
| `GET /api/cron` | Scheduled scan entry point for Vercel/GitHub Actions. |
| `GET /api/asset/[id]` | Live single-item price-depth refresh. |
| `GET /api/item/[id]` | Rolimons volume/supply details for an item. |

The live refresh also removes a cached card if its first listing, 2nd/3rd
ladder, or 80% rule no longer passes.

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
`CRON_SECRET` and `CRON_URL` as repository secrets. GitHub Actions can call the
free cron route every 15–30 minutes.

## Repository layout

```
dev/pipeline.harness.cjs ← offline end-to-end scan test
src/lib/config.ts       ← hard 80% / 70–100% rules
src/lib/filter.ts       ← UGC, sold-out, discount and depth gates
src/lib/scan.ts         ← discovery → UGC shortlist → reseller ladder → score
src/lib/roblox.ts       ← Roblox catalog, reseller and thumbnail adapter
src/lib/rolimons.ts     ← RAP, volume and supply adapter
src/app/components/     ← clean UGC deal cards and dashboard
```

## Disclaimer

Uses public Roblox/Rolimon endpoints and is not affiliated with either service.
Prices and public endpoint behavior can change. Profit figures are approximate
and assume Roblox resale tax; always verify an item on Roblox before buying.
This is not financial advice.
