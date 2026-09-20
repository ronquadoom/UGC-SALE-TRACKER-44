/**
 * Dev harness: runs the REAL scan pipeline against captured-endpoint fixtures
 * so discovery → shortlist → ladder-check → market-gate → volume can be
 * verified without outbound TLS (the sandbox blocks it).
 *
 * The fixtures mirror the *live* endpoint shapes verified against Roblox and
 * Rolimon's:
 *   • api.rolimons.com/items/v2/itemdetails        (11-col rows, UGC included)
 *   • api.rolimons.com/market/v1/dealactivity      [[ts, kind, itemId, price]]
 *   • api.rolimons.com/market/v1/saleactivity      [[ts, itemId, …]]
 *   • catalog.roblox.com/v1/search/items/details   (itemRestrictions/collectibleItemId)
 *   • catalog.roblox.com/v1/catalog/items/{id}/details
 *   • apis.roblox.com/marketplace-sales/v1/item/{cid}/resellers
 *   • www.rolimons.com/item/{id}                   (sales volume page)
 *
 * Run:  npm run harness      (compiles src/lib → .libjs, then executes this)
 */
const path = require("path");

// ---------------------------------------------------------------- fixtures --
const UGC_ID = 111222333444555; // discovered ONLY through the activity feed
const CLASSIC_ID = 1080949; // Bunny Ears — classic Limited, must never show
const INFLATED_ID = 66001122334455; // UGC, RAP wildly inflated by one outlier sale
const SHALLOW_ID = 66001122334456; // UGC, floor only 46% below market → no deal
const SPREAD_ID = 66001122334457; // UGC, 2nd/3rd far apart → no market value
const CRASHED_ID = 66001122334458; // UGC, whole book cheap → not a bargain
const SINGLE_LEVEL_ID = 2233445566; // UGC, one price level → rejected
const NO_RESELLERS_ID = 118010101060840; // UGC, no book → rejected

/** catalog search "details" page (fields as returned live). */
const CATALOG_PAGE = {
  keyword: null,
  previousPageCursor: null,
  nextPageCursor: null,
  data: [
    {
      id: CLASSIC_ID, itemType: "Asset", assetType: 8, name: "Bunny Ears",
      description: "", productId: 1, itemStatus: [], itemRestrictions: ["Limited"],
      creatorType: "User", creatorName: "Roblox", price: 2424,
      lowestPrice: 15997, lowestResalePrice: 2000, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 40848, totalQuantity: 56574,
      collectibleItemId: "37dc69c8-6111-4c3f-bffe-ee1924770b4a",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: NO_RESELLERS_ID, itemType: "Asset", assetType: 8, name: "Black Cat Beanie",
      description: "", productId: 2, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "Group", creatorName: "Medal TV", price: 0,
      lowestResalePrice: 0, priceStatus: "No Resellers",
      unitsAvailableForConsumption: 0, favoriteCount: 392, totalQuantity: 5000,
      collectibleItemId: "cbd7b44d-6a5c-4c69-b646-76ec7f2bfad2",
      saleLocationType: "ExperiencesDevApiOnly", hasResellers: false, offSaleDeadline: null,
    },
    {
      id: INFLATED_ID, itemType: "Asset", assetType: 8, name: "Inflated RAP Crown",
      description: "", productId: 3, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "Group", creatorName: "Crown Co", price: 0,
      lowestResalePrice: 300, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 2500, totalQuantity: 3000,
      collectibleItemId: "cccc1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: SHALLOW_ID, itemType: "Asset", assetType: 8, name: "Shallow Undercut",
      description: "", productId: 4, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "Group", creatorName: "Crown Co", price: 0,
      lowestResalePrice: 500, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 900, totalQuantity: 2000,
      collectibleItemId: "dddd1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: SPREAD_ID, itemType: "Asset", assetType: 8, name: "Wide Ladder Spread",
      description: "", productId: 5, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "Group", creatorName: "Crown Co", price: 0,
      lowestResalePrice: 200, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 800, totalQuantity: 1800,
      collectibleItemId: "eeee1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: CRASHED_ID, itemType: "Asset", assetType: 8, name: "Crashed Market Beanie",
      description: "", productId: 6, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "Group", creatorName: "Crown Co", price: 0,
      lowestResalePrice: 200, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 700, totalQuantity: 1500,
      collectibleItemId: "ffff1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: SINGLE_LEVEL_ID, itemType: "Asset", assetType: 8, name: "One Price Level Only",
      description: "", productId: 7, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "User", creatorName: "someone", price: 300,
      lowestResalePrice: 300, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 900, totalQuantity: 2000,
      collectibleItemId: "bbbb1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
  ],
};

/** v2 index: [name, acronym, rap, value, defaultValue, demand, trend, projected, hyped, rare, type].
 *  The INFLATED row carries the classic stale/inflated RAP that made the old
 *  scanner reject a real deal (RAP 10,000 vs a ~1,550 live market). */
const ROLIMONS_V2 = {
  [CLASSIC_ID]: ["Bunny Ears", "", 15164, 16000, 16000, 4, 2, -1, -1, -1, 1],
  [INFLATED_ID]: ["Inflated RAP Crown", "IRC", 10000, -1, 10000, -1, -1, -1, -1, -1, 2],
  [SHALLOW_ID]: ["Shallow Undercut", "", 1000, -1, 1000, -1, -1, -1, -1, -1, 2],
  [SPREAD_ID]: ["Wide Ladder Spread", "", 1000, -1, 1000, -1, -1, -1, -1, -1, 2],
  [CRASHED_ID]: ["Crashed Market Beanie", "", 1000, -1, 1000, -1, -1, -1, -1, -1, 2],
  [SINGLE_LEVEL_ID]: ["One Price Level Only", "", 3000, -1, 3000, -1, -1, -1, -1, -1, 2],
};
// UGC_ID is deliberately ABSENT from the index — no RAP anywhere. The old
// scanner skipped it entirely (rap 0 → continue); the new scanner must keep it.
for (let i = 0; i < 250; i++) {
  ROLIMONS_V2[String(2000000 + i)] = [`Filler ${i}`, "", 500 + i, -1, 500 + i, -1, -1, -1, -1, -1, 1];
}

/** Live deal-activity shape: [purchased_time, kind, item_id, price]. */
const DEAL_ACTIVITY = {
  success: true,
  activities: [
    [1789861209, 0, 5808105, 3143],
    [1789861223, 0, UGC_ID, 200],           // the UGC item we must surface
    [1789861224, 1, SINGLE_LEVEL_ID, 300],
  ],
};
const SALE_ACTIVITY = {
  success: true,
  activities: [[1789861274, CLASSIC_ID, 14000, 13500, 8571781]],
  activities_count: 1,
};

/** catalog items/{id}/details — resolves the activity seed in ONE call. */
const CATALOG_DETAILS = {
  [UGC_ID]: {
    id: UGC_ID, itemType: "Asset", assetType: 8, name: "Activity Only UGC Limited",
    itemRestrictions: ["Collectible"], creatorType: "Group", creatorName: "Activity Creator",
    price: 0, lowestResalePrice: 200, favoriteCount: 1200,
    priceStatus: "Off Sale", unitsAvailableForConsumption: 0, totalQuantity: 3000,
    collectibleItemId: "cid-activity-ugc", hasResellers: true, isOffSale: true,
    saleLocationType: "ExperiencesDevApiOnly", offSaleDeadline: null,
  },
};

/**
 * Resale books (returned UNSORTED where noted, with duplicate serial rows so
 * the ladder has to do real work):
 *
 *  • cid-activity-ugc: 200 (×3 rows, one serial) → 900 → 950 → 1200
 *      market = 925, discount = 78% → STRONG (passes; RAP unknown everywhere)
 *  • INFLATED: 300 → 1500 → 1600
 *      market = 1550, discount = 81% → HOT (passes despite RAP 10,000)
 *  • SHALLOW: 500 → 900 → 950 → discount only 46% → rejected
 *  • SPREAD: 200 → 300 → 950 → 2nd/3rt 3.2× apart → rejected
 *  • CRASHED: 200 → 250 → 260 → close 2nd/3rd but floor only 22% below → rejected
 *  • SINGLE: 300 → 300 → 300 → one level → rejected
 */
const RESELLERS = {
  "cid-activity-ugc": [
    { price: 900, serialNumber: 7, seller: { sellerId: 1, name: "a" } },
    { price: 200, serialNumber: 3, seller: { sellerId: 2, name: "b" } },
    { price: 1200, serialNumber: 4, seller: { sellerId: 3, name: "c" } },
    { price: 200, serialNumber: 3, seller: { sellerId: 2, name: "b" } },
    { price: 200, serialNumber: 3, seller: { sellerId: 2, name: "b" } }, // duplicate serial
    { price: 950, serialNumber: 6, seller: { sellerId: 5, name: "e" } },
  ],
  "37dc69c8-6111-4c3f-bffe-ee1924770b4a": [
    { price: 13000, serialNumber: 9, seller: { sellerId: 9, name: "f" } },
    { price: 2000, serialNumber: 8, seller: { sellerId: 8, name: "g" } },
    { price: 12000, serialNumber: 10, seller: { sellerId: 10, name: "h" } },
  ],
  "cccc1111-2222-3333-4444-555566667777": [
    { price: 1600, serialNumber: 11, seller: { sellerId: 11, name: "q" } },
    { price: 300, serialNumber: 12, seller: { sellerId: 12, name: "w" } },
    { price: 1500, serialNumber: 13, seller: { sellerId: 13, name: "e" } },
  ],
  "dddd1111-2222-3333-4444-555566667777": [
    { price: 500, serialNumber: 14, seller: { sellerId: 14, name: "r" } },
    { price: 900, serialNumber: 15, seller: { sellerId: 15, name: "t" } },
    { price: 950, serialNumber: 16, seller: { sellerId: 16, name: "y" } },
  ],
  "eeee1111-2222-3333-4444-555566667777": [
    { price: 200, serialNumber: 17, seller: { sellerId: 17, name: "u" } },
    { price: 300, serialNumber: 18, seller: { sellerId: 18, name: "i" } },
    { price: 950, serialNumber: 19, seller: { sellerId: 19, name: "o" } },
  ],
  "ffff1111-2222-3333-4444-555566667777": [
    { price: 200, serialNumber: 20, seller: { sellerId: 20, name: "p" } },
    { price: 250, serialNumber: 21, seller: { sellerId: 21, name: "a" } },
    { price: 260, serialNumber: 22, seller: { sellerId: 22, name: "s" } },
  ],
  // every listing at one price → single price level, must not become a "deal"
  "bbbb1111-2222-3333-4444-555566667777": [
    { price: 300, serialNumber: 1, seller: { sellerId: 1, name: "l" } },
    { price: 300, serialNumber: 2, seller: { sellerId: 2, name: "m" } },
    { price: 300, serialNumber: 3, seller: { sellerId: 3, name: "n" } },
  ],
};

/** Rolimons item pages — sales volume only (RAP shown on one page as reference).
 *  UGC page deliberately has NO RAP cell: the deal must not need it. */
const ITEM_PAGES = {
  [UGC_ID]:
    "<html><body>" +
    "<div><h6>Best Price</h6><h5>200</h5></div>" +
    "<div><h6>Units Available</h6><h5>0</h5></div>" +
    "<div><h6>Total Quantity</h6><h5>3,000</h5></div>" +
    "<div><h6>Avg Daily Sales</h6><h5>3.5</h5></div>" +
    "<div><h6>Sellers</h6><h5>12</h5></div>" +
    "</body></html>",
  [SHALLOW_ID]:
    "<html><body><a define>Best Price</a><br><a>500</a><br>" +
    "Rolimon's has tracked 210 resales over the past 7 days.</body></html>",
  [INFLATED_ID]:
    "<html><body><a define>RAP</a><br><a>10,000</a><br>" +
    "<a define>Best Price</a><br><a>300</a><br></body></html>",
};

// ------------------------------------------------------------------ shim ----
globalThis.fetch = async (url) => {
  const u = String(url);
  const js = (o) =>
    new Response(JSON.stringify(o), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const text = (s) =>
    new Response(s, { status: 200, headers: { "content-type": "text/html" } });

  if (u.includes("api.rolimons.com/items/v2/itemdetails"))
    return js({ success: true, item_count: Object.keys(ROLIMONS_V2).length, items: ROLIMONS_V2 });
  if (u.includes("rolimons.com/itemapi/itemdetails"))
    return text("<html>gone</html>"); // legacy host excluded UGC → must not be needed
  if (u.includes("market/v1/dealactivity")) return js(DEAL_ACTIVITY);
  if (u.includes("market/v1/saleactivity")) return js(SALE_ACTIVITY);
  if (u.includes("rolimons.com/api/activity")) return text("<html>error page</html>");
  if (u.includes("catalog.roblox.com/v1/search/items/details")) return js(CATALOG_PAGE);

  const catDetails = u.match(/catalog\.roblox\.com\/v1\/catalog\/items\/(\d+)\/details/);
  if (catDetails) {
    const d = CATALOG_DETAILS[catDetails[1]];
    return d ? js(d) : js({ errors: [{ code: 5, message: "not found" }] });
  }

  const resellers = u.match(/marketplace-sales\/v1\/item\/([^/]+)\/resellers/);
  if (resellers) {
    const cid = decodeURIComponent(resellers[1]);
    return js({ data: RESELLERS[cid] || [], nextPageCursor: null });
  }

  const page = u.match(/rolimons\.com\/item\/(\d+)/);
  if (page) return text(ITEM_PAGES[page[1]] || "<html><body>no metrics</body></html>");

  if (u.includes("thumbnails.roblox.com"))
    return js({ data: [{ targetId: INFLATED_ID, imageUrl: "https://tr.rbxcdn.com/x.png" }] });

  return js({ errors: [{ code: 5, message: "invalid" }] });
};

// ------------------------------------------------------------- assertions ---
let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${extra ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

async function main() {
  const lib = (m) => require(path.join(__dirname, "..", ".libjs", m));
  const { runScan, getDeals } = lib("scan.js");
  const { tierFor, ladderClose, marketValue, discountPct, evaluate } = lib("filter.js");
  const { getRolimonsDealActivity, getItemPage, pageSales30d } = lib("rolimons.js");

  console.log("\n=== 1. Live activity feed parsing ===");
  const acts = await getRolimonsDealActivity();
  check("activity rows parsed", acts.length === 3, acts);
  check(
    "itemId taken from index 2 (not the 0/1 flag)",
    acts.map((a) => a.itemId).join(",") === `5808105,${UGC_ID},${SINGLE_LEVEL_ID}`,
    acts
  );
  check("price captured", acts[1].price === 200, acts[1]);

  console.log("\n=== 2. Market-based deal rules (RAP never involved) ===");
  check("81% → hot", tierFor(81) === "hot");
  check("78% → strong", tierFor(78) === "strong");
  check("70% → deal", tierFor(70) === "deal");
  check("69% → null", tierFor(69) === null);
  check("ladder close at 25%", ladderClose(1500, 1600) === true);
  check("ladder close boundary", ladderClose(1200, 1500) === true);
  check("ladder rejected at 30% apart", ladderClose(1500, 1950) === false);
  check("ladder rejected when spread (300 vs 950)", ladderClose(300, 950) === false);
  check("ladder rejected on zero", ladderClose(0, 950) === false);
  check("market value = avg of 2nd/3rd", marketValue(1500, 1600) === 1550);
  check("market value zero without 3rd", marketValue(1500, 0) === 0);
  check("discount 81% vs market", discountPct(1550, 300) === 81);

  console.log("\n=== 3. Rolimons volume (resales wording + daily avg) ===");
  const shallowPage = await getItemPage(SHALLOW_ID);
  check(
    "'tracked 210 resales over the past 7 days' → 900/30d",
    shallowPage && pageSales30d(shallowPage) === 900,
    shallowPage && pageSales30d(shallowPage)
  );
  const ugcPage = await getItemPage(UGC_ID);
  check(
    "'Avg Daily Sales 3.5' → 105/30d, and no RAP on page → rap null",
    ugcPage && pageSales30d(ugcPage) === 105 && (ugcPage.rap ?? null) === null,
    ugcPage && { sales: pageSales30d(ugcPage), rap: ugcPage.rap }
  );

  console.log("\n=== 4. Full pipeline run ===");
  await runScan({ quick: true, onProgress: (m) => console.log("  •", m) });
  const snap = await getDeals();
  const byId = new Map(snap.deals.map((d) => [d.assetId, d]));

  console.log("\n=== 5. Results ===");
  console.log("total deals:", snap.total);
  for (const d of snap.deals) {
    console.log(
      `  ${d.name} tier=${d.tier} low=${d.lowest} 2nd=${d.second} 3rd=${d.third} ` +
        `market=${d.marketValue} disc=${d.discountPct}% rap(ref)=${d.rap} ` +
        `floorCopies=${d.floorCopies} sales30d=${d.sales30d} creator=${d.creator}`
    );
  }

  check("exactly the 2 real deals surface", snap.total === 2, snap.deals.map((d) => d.assetId));

  const inflated = byId.get(INFLATED_ID);
  check("inflated-RAP item IS surfaced (the old zero-deals bug)", !!inflated);
  if (inflated) {
    check("hot tier (81% below market)", inflated.tier === "hot", inflated.tier);
    check("81% discount vs market", inflated.discountPct === 81, inflated.discountPct);
    check("market value 1550 (2nd/3rd avg)", inflated.marketValue === 1550, inflated.marketValue);
    check("RAP 10,000 shown as reference only", inflated.rap === 10000, inflated.rap);
    check("depth verified (1500/1600 close)", inflated.depthVerified === true);
    check("volume unknown → projected flag", inflated.passOverrides.projectableOnly === true);
  }

  const ugc = byId.get(UGC_ID);
  check("activity-discovered UGC item made it to the board", !!ugc);
  if (ugc) {
    check("78% discount → strong tier", ugc.tier === "strong", ugc.tier);
    check("market value 925", ugc.marketValue === 925, ugc.marketValue);
    check("2nd listing = 900", ugc.second === 900, [ugc.second, ugc.third]);
    check("3rd listing = 950", ugc.third === 950, [ugc.second, ugc.third]);
    check("duplicate serial does not inflate floorCopies", ugc.floorCopies === 1, ugc.floorCopies);
    check("depth verified", ugc.depthVerified === true);
    check("30d sales from Avg Daily Sales (3.5 → 105)", ugc.sales30d === 105, ugc.sales30d);
    check("creator is present", ugc.creator === "Activity Creator", ugc.creator);
  }

  check("classic Roblox Limited is completely excluded", !byId.has(CLASSIC_ID));
  check("shallow undercut (46%) excluded", !byId.has(SHALLOW_ID));
  check("wide 2nd/3rd spread excluded", !byId.has(SPREAD_ID));
  check("crashed market (floor only 22% below) excluded", !byId.has(CRASHED_ID));
  check("single-price-level item excluded", !byId.has(SINGLE_LEVEL_ID));
  check("no-reseller item excluded", !byId.has(NO_RESELLERS_ID));

  check(
    "hot deal sorts first",
    snap.deals.length === 2 && snap.deals[0].assetId === INFLATED_ID,
    snap.deals.map((d) => d.assetId)
  );
  check(
    "no deal needs a RAP (unknown RAP must not hide a deal)",
    snap.deals.every((d) => d.lowest > 0 && d.marketValue > 0)
  );
  check(
    "every listed deal is 70%+ below the 2nd/3rd market value",
    snap.deals.every((d) => d.discountPct >= 70 && d.lowest <= d.marketValue * 0.3),
    snap.deals
  );
  check(
    "every listed deal has a close 2nd/3rd ladder",
    snap.deals.every((d) => d.depthVerified && Math.max(d.second, d.third) / Math.min(d.second, d.third) <= 1.25),
    snap.deals
  );
  check(
    "every listed deal is explicitly UGC + sold out",
    snap.deals.every((d) => d.limitedType === 2 && d.soldOut === true)
  );
  check(
    "no bogus item ids from the activity feed",
    snap.deals.every((d) => d.assetId > 1000)
  );
  check(
    "tier counts reported in sourceStats",
    snap.sourceStats && snap.sourceStats.tiers.hot === 1 && snap.sourceStats.tiers.strong === 1,
    snap.sourceStats && snap.sourceStats.tiers
  );

  console.log("\n=== 6. evaluate() guard rails ===");
  const base = { limitedType: 2, soldOut: true, lowest: 300, second: 1500, third: 1600, sales30d: 5 };
  check("RAP absence passes (RAP is irrelevant now)", evaluate({ ...base, rap: 0 }).passesHard === true);
  check("classic type fails hard", evaluate({ ...base, limitedType: 0 }).passesHard === false);
  check("not sold out fails hard", evaluate({ ...base, soldOut: false }).passesHard === false);
  check("missing 3rd listing fails hard", evaluate({ ...base, third: 0 }).passesHard === false);
  check("wide 2nd/3rd spread fails hard", evaluate({ ...base, second: 300, third: 950 }).passesHard === false);
  check("shallow discount fails hard", evaluate({ ...base, lowest: 500, second: 900, third: 950 }).passesHard === false);
  check("crashed book fails hard", evaluate({ ...base, lowest: 200, second: 250, third: 260 }).passesHard === false);
  check(
    "deep undercut with close 2nd/3rd passes",
    evaluate({ ...base }).passesHard === true
  );

  console.log(
    failures === 0
      ? "\nALL CHECKS PASSED ✅"
      : `\n${failures} CHECK(S) FAILED ❌`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
