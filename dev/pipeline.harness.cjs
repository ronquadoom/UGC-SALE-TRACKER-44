/**
 * Dev harness: runs the REAL scan pipeline against captured-endpoint fixtures
 * so discovery → shortlist → depth-check → volume → filter can be verified
 * without outbound TLS (the sandbox blocks it).
 *
 * The fixtures mirror the *live* endpoint shapes verified during development:
 *   • api.rolimons.com/items/v2/itemdetails        (11-col rows, UGC included)
 *   • www.rolimons.com/itemapi/itemdetails         (10-col rows, classic only)
 *   • api.rolimons.com/market/v1/dealactivity      [[ts, kind, itemId, price]]
 *   • catalog.roblox.com/v1/search/items/details   (itemRestrictions/collectibleItemId)
 *   • catalog.roblox.com/v1/catalog/items/{id}/details
 *   • economy.roblox.com/v2/assets/{id}/details
 *   • apis.roblox.com/marketplace-sales/v1/item/{cid}/resellers
 *
 * Run:  npm run harness      (compiles src/lib → .libjs, then executes this)
 */
const path = require("path");

// ---------------------------------------------------------------- fixtures --
const UGC_ID = 111222333444555; // discovered ONLY through the activity feed
const CLASSIC_ID = 1080949;
const BELOW_FLOOR_ID = 7654321;
const SINGLE_LEVEL_ID = 2233445566;
const NO_RESELLERS_ID = 118010101060840;

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
      id: BELOW_FLOOR_ID, itemType: "Asset", assetType: 8, name: "Too Cheap To Be A Deal",
      description: "", productId: 3, itemStatus: [], itemRestrictions: ["Limited"],
      creatorType: "User", creatorName: "Roblox", price: 800,
      lowestResalePrice: 800, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 1200, totalQuantity: 4000,
      collectibleItemId: "aaaa1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: SINGLE_LEVEL_ID, itemType: "Asset", assetType: 8, name: "One Price Level Only",
      description: "", productId: 4, itemStatus: [], itemRestrictions: ["Collectible"],
      creatorType: "User", creatorName: "someone", price: 300,
      lowestResalePrice: 300, priceStatus: "Off Sale",
      unitsAvailableForConsumption: 0, favoriteCount: 900, totalQuantity: 2000,
      collectibleItemId: "bbbb1111-2222-3333-4444-555566667777",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
  ],
};

/** v2 index: [name, acronym, rap, value, defaultValue, demand, trend, projected, hyped, rare, type] */
const ROLIMONS_V2 = {
  [CLASSIC_ID]: ["Bunny Ears", "", 15164, 16000, 16000, 4, 2, -1, -1, -1, 1],
  [BELOW_FLOOR_ID]: ["Too Cheap To Be A Deal", "", 1000, -1, 1000, -1, -1, -1, -1, 1],
  [SINGLE_LEVEL_ID]: ["One Price Level Only", "", 3000, -1, 3000, -1, -1, -1, -1, 2],
};
for (let i = 0; i < 250; i++) {
  ROLIMONS_V2[String(2000000 + i)] = [`Filler ${i}`, "", 500 + i, -1, 500 + i, -1, -1, -1, -1, 1];
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

const ECONOMY_DETAILS = {
  [UGC_ID]: {
    TargetId: UGC_ID, Name: "Activity Only UGC Limited", AssetTypeId: 8,
    PriceInRobux: 0, Sales: 0, IsForSale: false, IsLimited: false, IsLimitedUnique: true,
    Remaining: 0, CollectibleItemId: "cid-activity-ugc",
    CollectiblesItemDetails: {
      CollectibleLowestResalePrice: 200, TotalQuantity: 3000, IsLimited: true, IsForSale: false,
    },
  },
  [SINGLE_LEVEL_ID]: {
    TargetId: SINGLE_LEVEL_ID, Name: "One Price Level Only", AssetTypeId: 8,
    PriceInRobux: 0, Sales: 0, IsForSale: false, IsLimited: false, IsLimitedUnique: true,
    Remaining: 0, CollectibleItemId: "bbbb1111-2222-3333-4444-555566667777",
    CollectiblesItemDetails: {
      CollectibleLowestResalePrice: 300, TotalQuantity: 2000, IsLimited: true, IsForSale: false,
    },
  },
  [BELOW_FLOOR_ID]: {
    TargetId: BELOW_FLOOR_ID, Name: "Too Cheap To Be A Deal", AssetTypeId: 8,
    PriceInRobux: 0, Sales: 0, IsForSale: false, IsLimited: true, IsLimitedUnique: false,
    Remaining: 0, CollectibleItemId: "aaaa1111-2222-3333-4444-555566667777",
    CollectiblesItemDetails: {
      CollectibleLowestResalePrice: 800, TotalQuantity: 4000, IsLimited: true, IsForSale: false,
    },
  },
};

/** catalog items/{id}/details — used when discovery had no collectibleItemId. */
const CATALOG_DETAILS = {
  [UGC_ID]: {
    id: UGC_ID, itemType: "Asset", assetType: 8, name: "Activity Only UGC Limited",
    itemRestrictions: ["Collectible"], creatorType: "Group", creatorName: "Activity Creator",
    price: 0, lowestResalePrice: 200,
    priceStatus: "Off Sale", unitsAvailableForConsumption: 0, totalQuantity: 3000,
    collectibleItemId: "cid-activity-ugc", hasResellers: true, isOffSale: true,
  },
};

/**
 * Resale book. Deliberately returned UNSORTED, with a duplicated price level
 * and a duplicated serial, so the ladder has to do real work:
 *   floor 200 (one unique copy + one duplicate row) → 900 → 950 → 1200
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
  "aaaa1111-2222-3333-4444-555566667777": [
    { price: 800, serialNumber: 1, seller: { sellerId: 1, name: "i" } },
    { price: 900, serialNumber: 2, seller: { sellerId: 2, name: "j" } },
    { price: 950, serialNumber: 3, seller: { sellerId: 3, name: "k" } },
  ],
  // every listing at one price → single price level, must not become a "deal"
  "bbbb1111-2222-3333-4444-555566667777": [
    { price: 300, serialNumber: 1, seller: { sellerId: 1, name: "l" } },
    { price: 300, serialNumber: 2, seller: { sellerId: 2, name: "m" } },
    { price: 300, serialNumber: 3, seller: { sellerId: 3, name: "n" } },
  ],
};

/** Item page markup: modern heading cells for the UGC item, legacy anchors elsewhere. */
const ITEM_PAGES = {
  [UGC_ID]:
    "<html><body>" +
    "<div><h6>Best Price</h6><h5>200</h5></div>" +
    "<div><h6>RAP</h6><h5>1,000</h5></div>" +
    "<div><h6>Value</h6><h5>1,200</h5></div>" +
    "<div><h6>Avg Daily Sales</h6><h5>3.5</h5></div>" +
    "<div><h6>Total Copies</h6><h5>3,000</h5></div>" +
    "<div><h6>Available Copies</h6><h5>0</h5></div>" +
    "<div><h6>Sellers</h6><h5>12</h5></div>" +
    "</body></html>",
  [CLASSIC_ID]:
    "<html><body><a define>Best Price</a><br><a>2,000</a><br>" +
    "<a define>Sellers</a><br><a>46</a><br>" +
    "Rolimon's has tracked 1,120 sales over the past 7 days.</body></html>",
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

  const eco = u.match(/economy\.roblox\.com\/v2\/assets\/(\d+)\/details/);
  if (eco) {
    const d = ECONOMY_DETAILS[eco[1]];
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
    return js({ data: [{ targetId: CLASSIC_ID, imageUrl: "https://tr.rbxcdn.com/x.png" }] });

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
  const { tierFor, depthVerified, evaluate } = lib("filter.js");
  const { getRolimonsDealActivity } = lib("rolimons.js");

  console.log("\n=== 1. Live activity feed parsing ===");
  const acts = await getRolimonsDealActivity();
  check("activity rows parsed", acts.length === 3, acts);
  check(
    "itemId taken from index 2 (not the 0/1 flag)",
    acts.map((a) => a.itemId).join(",") === `5808105,${UGC_ID},${SINGLE_LEVEL_ID}`,
    acts
  );
  check("price captured", acts[1].price === 200, acts[1]);

  console.log("\n=== 2. Strict deal thresholds (80%+ off / 70–100% depth) ===");
  check("90% → hot", tierFor(90) === "hot");
  check("85% → strong", tierFor(85) === "strong");
  check("80% → deal", tierFor(80) === "deal");
  check("79% → null", tierFor(79) === null);
  check("depth verified at 70% of RAP", depthVerified(1000, 700, 700) === true);
  check("depth verified at 100% of RAP", depthVerified(1000, 1000, 999) === true);
  check("depth rejected below 70% of RAP", depthVerified(1000, 699, 800) === false);
  check("depth rejected above 100% of RAP", depthVerified(1000, 700, 1001) === false);

  console.log("\n=== 3. Full pipeline run ===");
  await runScan({ quick: true, onProgress: (m) => console.log("  •", m) });
  const snap = await getDeals();
  const byId = new Map(snap.deals.map((d) => [d.assetId, d]));

  console.log("\n=== 4. Results ===");
  console.log("total deals:", snap.total);
  for (const d of snap.deals) {
    console.log(
      `  ${d.name} tier=${d.tier} RAP=${d.rap} low=${d.lowest} 2nd=${d.second} 3rd=${d.third} ` +
        `disc=${d.discountPct}% floorCopies=${d.floorCopies} depth✓=${d.depthVerified} ` +
        `sales30d=${d.sales30d} creator=${d.creator}`
    );
  }

  const ugc = byId.get(UGC_ID);
  check("activity-discovered UGC item made it to the board", !!ugc);
  if (ugc) {
    check("RAP recovered from the item page (not in the bulk index)", ugc.rap === 1000, ugc.rap);
    check("80% off → deal tier", ugc.tier === "deal", ugc.tier);
    check("2nd listing = 900", ugc.second === 900, [ugc.second, ugc.third]);
    check("3rd listing = 950", ugc.third === 950, ugc.third);
    check("duplicate serial does not inflate floorCopies", ugc.floorCopies === 1, ugc.floorCopies);
    check("depth verified", ugc.depthVerified === true);
    check("30d sales from Avg Daily Sales (3.5 → 105)", ugc.sales30d === 105, ugc.sales30d);
    check("creator is present", ugc.creator === "Activity Creator", ugc.creator);
  }

  const classic = byId.get(CLASSIC_ID);
  check("classic Roblox Limited is completely excluded", !classic, classic);

  check("below-floor item excluded", !byId.has(BELOW_FLOOR_ID));
  check("single-price-level item excluded", !byId.has(SINGLE_LEVEL_ID));
  check("no-reseller item excluded", !byId.has(NO_RESELLERS_ID));
  check(
    "no deal is missing a RAP (the old empty-screen bug)",
    snap.deals.every((d) => d.rap > 0)
  );
  check(
    "no bogus item ids from the activity feed",
    snap.deals.every((d) => d.assetId > 1000)
  );
  check(
    "every listed deal is at least 80% off RAP",
    snap.deals.every((d) => d.lowest <= d.rap * 0.2 && d.discountPct >= 80)
  );
  check(
    "every listed deal has healthy 2nd/3rd depth",
    snap.deals.every((d) => d.depthVerified && d.second >= d.rap * 0.7 && d.third >= d.rap * 0.7),
    snap.deals
  );
  check(
    "every listed deal is explicitly UGC",
    snap.deals.every((d) => d.limitedType === 2)
  );
  check(
    "tier counts reported in sourceStats",
    snap.sourceStats && snap.sourceStats.tiers.deal >= 1,
    snap.sourceStats && snap.sourceStats.tiers
  );

  console.log("\n=== 5. evaluate() guard rails ===");
  check(
    "missing RAP fails hard",
    evaluate({ soldOut: true, rap: 0, lowest: 100, second: 200, third: 300, discountPct: 0, sales30d: 5, limitedType: 2 }).passesHard === false
  );
  check(
    "classic type fails hard",
    evaluate({ soldOut: true, rap: 1000, lowest: 100, second: 800, third: 900, discountPct: 90, sales30d: 5, limitedType: 0 }).passesHard === false
  );
  check(
    "single price level fails hard",
    evaluate({ soldOut: true, rap: 1000, lowest: 200, second: 0, third: 0, discountPct: 80, sales30d: 5, limitedType: 2 }).passesHard === false
  );
  check(
    "a crashed 2nd listing fails hard",
    evaluate({ soldOut: true, rap: 1000, lowest: 100, second: 300, third: 900, discountPct: 90, sales30d: 5, limitedType: 2 }).passesHard === false
  );
  check(
    "80%+ off with 70–100% depth passes",
    evaluate({ soldOut: true, rap: 1000, lowest: 200, second: 700, third: 950, discountPct: 80, sales30d: 5, limitedType: 2 }).passesHard === true
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
