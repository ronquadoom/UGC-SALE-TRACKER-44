# UGC Snap — $0 UGC Limited deal radar

A fully self-funded (free) web app that **actively discovers** sold-out Roblox
UGC Limiteds listed **below RAP** and — unlike Rolimon's deals page — **verifies
the price is real** by building the full **1st / 2nd / 3rd lowest price ladder**
from the live resale book.

Deals are tiered by how far the floor price sits below RAP:

| Tier | Discount vs RAP |
|---|---|
| 🔥 **Hot** | **≥ 70%** |
| **Strong** | **≥ 50%** |
| **Deal** | **≥ 35%** |

```
Sold-out collectible  +  floor ≤ (100 − tier)% of RAP  +  a real 2nd price level  =  deal
```

---

## Architecture (everything $0)

| Layer | Choice | Out-of-pocket cost |
|---|---|---|
| Frontend + serverless backend | **Next.js 14 (App Router)** | $0 |
| Hosting + free public URL | **Vercel** (`*.vercel.app`) or **Render** (`*.onrender.com`) | $0 |
| Scheduled scans | Vercel Cron (free) **or** GitHub Actions workflow poking a protected cron route | $0 |
| Database | **None required** — runs from in-memory snapshot + browser `localStorage`. Optional **Supabase/Turso free tier** adapter is included. | $0 |
| Notifications | Browser Web Notifications (no push service) | $0 |

### Data source pipeline (100% public, keyless)

1. **Rolimon's bulk limited index** — `GET api.rolimons.com/items/v2/itemdetails`
   → names, acronyms, RAP and value for **2,500+ tracked limiteds** in one call,
   *including UGC limiteds* (the legacy `www.rolimons.com/itemapi/itemdetails`
   host is classic-only and is used purely as a fallback — reading it first left
   every UGC item with `rap = 0`, which is what emptied the dashboard).
   Rows are `[name, acronym, rap, value, defaultValue, demand, trend, projected,
   hyped, rare, type]`; `type = 2` marks a UGC/collectible limited.
2. **Roblox catalog search (details)** — `GET catalog.roblox.com/v1/search/items/details`
   paginated across *Best-Selling (30d)*, *Recently Updated*, *Most Favorited*
   and *Relevance* sort modes + keyword sweeps + `IncludeNotForSale` → this is
   what keeps discovery **broad and continuous** (new limiteds appear here
   automatically). Each record carries `priceStatus`, `totalQuantity`,
   `unitsAvailableForConsumption`, `hasResellers`, the `collectibleItemId` and
   `itemRestrictions` (`["Collectible"]` = UGC, `["Limited"]` = classic).
3. **Rolimon's live deal activity** — `api.rolimons.com/market/v1/dealactivity`
   (`[[time, kind, itemId, price]]`) plus `…/saleactivity` → the freshest signal
   of what is moving right now. Activity items are seeded **first**, before the
   catalog crawl, and their `collectibleItemId` is resolved from
   `catalog.roblox.com/v1/catalog/items/{id}/details` / `economy.roblox.com/v2/assets/{id}/details`
   so they can actually be depth-checked.
4. **Roblox collectible resellers (THE legitimacy check)** —
   `GET apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers`
   → the full resale book (public, no auth needed). Duplicate serials are
   dropped, then the ladder is built from **distinct price levels** so three
   copies sitting at the floor cannot masquerade as the 2nd/3rd price.
5. **RAP + sales volume & supply** — the v2 index covers most tracked limiteds,
   and for the rest the Rolimon's item page (`www.rolimons.com/item/{id}`)
   supplies `RAP` / `RAP After Sale`, `Value`, `Best Price`, `Avg Daily Sales`
   (×30 for a 30-day estimate, with the legacy "tracked N sales over the past D
   days" phrasing still parsed) and Total/Available copies. `resale-data` remains
   the classic-limited fallback.
6. **Thumbnails** — `thumbnails.roblox.com/v1/assets` (free batched, 100/req).

### Exact filtering rules (strict, encoded in `src/lib/filter.ts`)

1. A resellable collectible (UGC or classic) that is **sold out**
   (`unitsAvailableForConsumption ≤ 0`).
2. A known **RAP** and a real resale floor — without a RAP there is no discount
   to measure, so the item is skipped rather than guessed at.
3. Discount vs RAP must clear the **tier floor (≥35% by default)**:
   Hot ≥70% · Strong ≥50% · Deal ≥35% (`HOT_MIN` / `STRONG_MIN` / `DEAL_MIN`).
4. **Working depth check** — at least a 2nd *price level* must exist; when the
   2nd and 3rd levels both stay **≥70% of RAP** the deal is flagged
   `depthVerified`. `floorCopies` reports how many copies sit at the floor, so a
   thin floor (`3× at floor`) is visible instead of hidden.
5. Sales volume — **>7 sales / 30 days** ranks an item up. When volume cannot be
   resolved the deal is flagged `projectableOnly` (shown with a warning; use the
   "Hide unverified volume" toggle to filter it out).
6. Circulation — **≥1,500 copies preferred**; lower counts still pass if every
   other rule holds, but rank lower via `premiumScore`.

Scoring ranks by copies, volume, RAP, tier depth (hot > strong > deal), verified
depth and the 1st→2nd spread. Classic (non-UGC) limiteds that clear every rule
are still listed, labelled `legacyClassic`.

### API routes

| Route | Purpose |
|---|---|
| `GET /api/deals` | Snapshot of current deals (`?force=1` re-scans, `?mate=1` answers instantly during an in-flight scan). |
| `POST /api/refresh` | Force a fresh scan (locked by `CRON_SECRET` when set). |
| `GET /api/cron` | Cron entry point (Vercel Cron / GitHub Actions). |
| `GET /api/asset/[id]` | Live single-item price-depth refresh (watchlist watchdog). |
| `GET /api/item/[id]` | Rolimons volume/supply stats for one item. |

Freshness: browser auto-refreshes every 60s; a stale-but-usable snapshot triggers
a background re-scan. In-memory TTL cache is shared across warm invocations,
plus best-effort JSON persistence (persistent on Render's disk, ephemeral on Vercel).

---

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run harness      # offline pipeline test: real scan code vs live-shaped fixtures
npm run typecheck    # tsc --noEmit
```

Set `CRON_SECRET` (any random string) to protect `/api/cron` and `/api/refresh`.

> Demo mode: `DEMO_MODE=1 npm run dev` serves a sample snapshot instantly
> (useful to preview the UI without a live scan).

---

## Deploy for free

### Option A — Vercel (simplest, 2 min)

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com) → **New Project** → import the repo.
   Framework auto-detects **Next.js**. No build command needed.
3. Deploy → you get **`https://<something>.vercel.app`** for free.
4. (Optional) Add `CRON_SECRET`, then enable the cron schedule.

### Option B — Render (free subdomain + persistent disk)

The repo ships `render.yaml` for the **Blueprint** flow:
**dashboard.render.com → New → Blueprint → pick this repo** → deploy.
You get `https://<something>.onrender.com` free. Free Render spins down when
idle — the first visit cold-starts (a few seconds) and re-scans.

### Scheduling (free)

- **Vercel Hobby** cron is limited to *once/day*. That's still a real fresh scan.
  Put this in `vercel.json` → `crons`:
  `[{"path": "/api/cron", "schedule": "0 */6 * * *"}]` is disallowed on free —
  use a daily schedule (`"0 9 * * *"`) on Hobby.
- **GitHub Actions (any frequency, still free):** a tiny workflow that
  `curl -s "https://YOUR-APP/api/cron" -H "Authorization: Bearer $CRON_SECRET"`
  every 15–30 min. Copy `deploy/gha-cron.example.yml` → `.github/workflows/cron.yml`
  (auto-gitignored) and add `CRON_SECRET` + `CRON_URL` as repo secrets.
- **Self-healing fallback:** visiting the site or hitting `/api/deals` re-scans
  whenever the snapshot is stale, so freshness never depends solely on cron.

---

## Repo layout

```
dev/pipeline.harness.cjs ← offline end-to-end test of the scan pipeline
src/lib/filter.ts     ← the strict deal rules + tier thresholds + depth check
src/lib/scan.ts       ← discovery → shortlist → depth-check → volume → score
src/lib/roblox.ts     ← Roblox public API adapter (catalog, details, resellers, thumbs)
src/lib/rolimons.ts   ← Rolimon index + activity + item-page volume scraper
src/lib/supabase.ts   ← optional free-DB adapter (Supabase REST)
src/lib/storage.ts    ← best-effort JSON snapshot persistence
src/app/api/**        ← serverless functions (deals, refresh, cron, asset, item)
src/app/page.tsx      ← dashboard (client)
src/app/components/   ← DealCard + Dashboard (sort/filter/watchlist/notifications)
supabase.sql          ← optional free-tier schema
render.yaml           ← Render free blueprint
```

## Disclaimer

Uses only public Roblox/Rolimon endpoints; not affiliated with either. Profit
figures assume ~30% resale tax and the 2nd/3rd price as a realistic exit — always
verify before buying. Not financial advice. Endpoints may change without notice;
the pipeline is written to degrade gracefully (cache + heuristics) if a source moves.
