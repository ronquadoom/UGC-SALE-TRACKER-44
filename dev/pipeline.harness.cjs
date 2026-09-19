/**
 * Dev harness: runs the REAL scan pipeline against captured-endpoint fixtures
 * so we can prove discovery → shortlist → depth-check → volume → filter
 * without the sandbox's outbound-TLS restriction. Not shipped/deployed.
 * Run:  node dev/pipeline.harness.cjs  (after its lib compile step below)
 */
const path = require("path");

// ---- fixtures (shapes captured from the real public APIs during dev) ------
const CATALOG_PAGE = {
  data: [
    {
      id: 85342009352071, itemType: "Asset", assetType: 8, name: "White Domino Crown",
      description: "", price: 495, lowestPrice: 495, lowestResalePrice: 150,
      priceStatus: "For Sale", unitsAvailableForConsumption: 0, favoriteCount: 403,
      totalQuantity: 3000, collectibleItemId: "d4ec8c5f-be25-4700-8b56-33c64ccfa89d",
      creatorType: "Group", creatorName: "What's Cooking UGC",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
    {
      id: 117252717656262, itemType: "Asset", assetType: 8, name: "Black Gold Domino Crown",
      description: "", price: 95, lowestPrice: 95, lowestResalePrice: 0,
      priceStatus: "For Sale", unitsAvailableForConsumption: 2770, favoriteCount: 354,
      totalQuantity: 3000, collectibleItemId: "842247a1-2865-444b-8a37-1d925b86fbf4",
      creatorType: "Group", creatorName: "FLLProduction",
      saleLocationType: "ShopAndAllExperiences", hasResellers: false, offSaleDeadline: null,
    },
    {
      id: 12803855954, itemType: "Asset", assetType: 8, name: "Glossy Red Baseball Cap",
      description: "", price: 105, lowestPrice: 105, lowestResalePrice: 105,
      priceStatus: "For Sale", unitsAvailableForConsumption: 9508722, favoriteCount: 73151,
      totalQuantity: 10000000, collectibleItemId: "18d8f997-0218-495a-bf40-2bac0d4772d4",
      creatorType: "User", creatorName: "Roblox",
      saleLocationType: "ShopAndAllExperiences", hasResellers: true, offSaleDeadline: null,
    },
  ],
  nextPageCursor: null,
};

const ROLIMONS_BASE = {
  "85342009352071": ["White Domino Crown", "WDC", 1420, 1650, 1420, 2, -1, -1, -1, 1],
  "12803855954": ["Glossy Red Baseball Cap", "", 105, -1, 105, -1, -1, -1, -1, 1],
  "117252717656262": ["Black Gold Domino Crown", "", 95, -1, 95, -1, -1, -1, -1, 1],
};
// pad to 250 so the bulk-index sanity guard (map.size > 200) passes, like prod.
const ROLIMONS_ITEMS = { ...ROLIMONS_BASE };
for (let i = 0; i < 247; i++) {
  ROLIMONS_ITEMS[String(2000000 + i)] = [`Filler ${i}`, "", 500 + i, -1, 500 + i, -1, -1, -1, -1, 1];
}

const RESELLERS = {
  data: [
    { collectibleProductId: "a", collectibleItemInstanceId: "1", seller: { sellerId: 1, name: "a" }, price: 150, serialNumber: 118 },
    { collectibleProductId: "b", collectibleItemInstanceId: "2", seller: { sellerId: 2, name: "b" }, price: 1250, serialNumber: 119 },
    { collectibleProductId: "c", collectibleItemInstanceId: "3", seller: { sellerId: 3, name: "c" }, price: 1390, serialNumber: 58 },
    { collectibleProductId: "d", collectibleItemInstanceId: "4", seller: { sellerId: 4, name: "d" }, price: 1500, serialNumber: 74 },
  ],
  previousPageCursor: "",
  nextPageCursor: "",
};

// --------------------------------------------------------------- shim ----
globalThis.fetch = async (url) => {
  const u = String(url);
  const js = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("rolimons.com/itemapi/itemdetails") || u.includes("api.rolimons.com/items/v2/itemdetails"))
    return js({ success: true, item_count: Object.keys(ROLIMONS_ITEMS).length, items: ROLIMONS_ITEMS });
  if (u.includes("catalog.roblox.com/v1/search/items/details")) return js(CATALOG_PAGE);
  if (u.includes("apis.roblox.com/marketplace-sales/v1/item/85342009352071") ||
      u.includes("apis.roblox.com/marketplace-sales/v1/item/d4ec8c5f"))
    return js(RESELLERS);
  if (u.includes("apis.roblox.com/marketplace-sales/v1/item/"))
    return js({ data: [], previousPageCursor: "", nextPageCursor: "" });
  if (u.includes("rolimons.com/item/85342009352071")) {
    return new Response(
      "<html><body>Best Price</a> 150</a> RAP 1420</a> Value 1650</a> Total Copies</a>3,000</a> " +
        "Units Available</a>0</a> Sellers</a>44</a> Sale Status</a>Off Sale</a> " +
        "Rolimon's has tracked 1,142 sales over the past 7 days.</body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    );
  }
  if (u.includes("rolimons.com/item/")) return new Response("<html>no</html>", { status: 200, headers: { "content-type": "text/html" } });
  if (u.includes("thumbnails.roblox.com")) return js({ data: [{ targetId: 85342009352071, imageUrl: "https://tr.rbxcdn.com/x.png" }] });
  if (u.includes("rolimons.com/api/activity") || u.includes("/market/v1/")) return js({ success: true, activities: [] });
  return js({ errors: [{ code: 5, message: "invalid" }] });
};

async function main() {
  const { runScan } = require(path.join(__dirname, "..", ".libjs", "scan.js"));
  const { getDeals } = require(path.join(__dirname, "..", ".libjs", "scan.js"));
  await runScan({ quick: true, onProgress: (m) => console.log("  •", m) });
  const snap = await getDeals();
  console.log("\n=== RESULT ===");
  console.log("total deals:", snap.total);
  for (const d of snap.deals) {
    console.log(
      `  ${d.name}  RAP=${d.rap} low=${d.lowest} 2nd=${d.second} 3rd=${d.third} ` +
        `discount=${d.discountPct}% spread=${d.spreadX}x sales30d=${d.sales30d} copies=${d.totalCopies} profit=${d.projectedProfit} score=${d.premiumScore}`
    );
  }
  process.exit(0);
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
