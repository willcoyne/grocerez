/**
 * Rebuilds server/data/foodkeeper.json and server/data/bls-prices.json (backend/13 product lookup).
 *
 *   1. FoodKeeper-Data.xls: USDA FSIS FoodKeeper (https://catalog.data.gov/dataset/fsis-foodkeeper-data; fsis.usda.gov blocks
 *      scripts, a mirror is at github.com/BrandonChenze/FoodKeeperResearch/blob/main/datasets/FoodKeeper-Data.xls).
 *   2. BLS files ap.item and ap.data.3.Food from https://download.bls.gov/pub/time.series/ap/ (send a User-Agent with an email).
 *   3. In a scratch dir: npm i xlsx@0.18.5, then
 *      node build-lookup-data.mjs <FoodKeeper-Data.xls> <dir with ap.item + ap.data.3.Food> <server/data>
 */
import XLSX from "xlsx"; import fs from "fs";
const [xls, dir, out] = process.argv.slice(2);
// ── FoodKeeper → compact JSON, all durations converted to days (max end of each range).
const wb = XLSX.read(fs.readFileSync(xls));
const cats = Object.fromEntries(XLSX.utils.sheet_to_json(wb.Sheets.Category).map((c) => [c.ID, [c.Category_Name, c.Subcategory_Name].filter(Boolean).join(" / ")]));
const UNIT = { hours: 1 / 24, day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 };
const span = (p, key) => {
  const min = p[`${key}_Min`], max = p[`${key}_Max`], metric = String(p[`${key}_Metric`] ?? "").trim().toLowerCase();
  const tip = p[`${key}_tips`] ?? p[`${key}_Tips`] ?? null;
  if (max == null && min == null) return metric ? { note: [p[`${key}_Metric`].trim(), tip].filter(Boolean).join(": ") } : undefined;
  const u = UNIT[metric];
  if (!u) return { note: [`${min ?? ""}-${max ?? ""} ${metric}`, tip].filter(Boolean).join(": ") };
  return { minDays: Math.ceil((min ?? max) * u), maxDays: Math.ceil((max ?? min) * u), ...(tip ? { tip } : {}) };
};
const foods = XLSX.utils.sheet_to_json(wb.Sheets.Product, { defval: null }).filter((p) => p.Name).map((p) => {
  const s = {
    pantry: span(p, "Pantry") ?? span(p, "DOP_Pantry"),
    pantryOpened: span(p, "Pantry_After_Opening"),
    fridge: span(p, "Refrigerate") ?? span(p, "DOP_Refrigerate"),
    fridgeOpened: span(p, "Refrigerate_After_Opening"),
    fridgeThawed: span(p, "Refrigerate_After_Thawing"),
    freezer: span(p, "Freeze") ?? span(p, "DOP_Freeze"),
  };
  return {
    id: p.ID, name: p.Name, subtitle: p.Name_subtitle ?? null, category: cats[p.Category_ID] ?? null,
    keywords: String(p.Keywords ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    storage: Object.fromEntries(Object.entries(s).filter(([, v]) => v)),
  };
});
fs.writeFileSync(`${out}/foodkeeper.json`, JSON.stringify({
  source: "USDA FSIS FoodKeeper data (public domain)", url: "https://www.foodsafety.gov/keep-food-safe/foodkeeper-app",
  datasetUrl: "https://catalog.data.gov/dataset/fsis-foodkeeper-data", foods }));
// ── BLS average prices: latest value per (item, area) for US + the 4 census regions.
const tsv = (f) => fs.readFileSync(`${dir}/${f}`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map((x) => x.trim()));
const items = Object.fromEntries(tsv("ap.item").map(([c, n]) => [c, n]));
const AREAS = { "0000": "US", "0100": "Northeast", "0200": "Midwest", "0300": "South", "0400": "West" };
const latest = {};
for (const [sid, year, period, value] of tsv("ap.data.3.Food")) {
  const area = sid.slice(3, 7), code = sid.slice(7);
  if (!AREAS[area] || !/^M\d\d$/.test(period) || period === "M13" || !/^\d/.test(value)) continue;
  const key = `${code}|${area}`, ym = `${year}-${period.slice(1)}`;
  if (!latest[key] || latest[key].month < ym) latest[key] = { month: ym, price: Number(value), series: sid };
}
const prices = {};
for (const [key, v] of Object.entries(latest)) {
  const [code, area] = key.split("|");
  if (!items[code] || v.month < "2024-01") continue; // discontinued series
  (prices[code] ??= { code, name: items[code], areas: {} }).areas[AREAS[area]] = { usd: v.price, month: v.month, series: v.series };
}
fs.writeFileSync(`${out}/bls-prices.json`, JSON.stringify({
  source: "U.S. Bureau of Labor Statistics, CPI Average Price Data (public domain)", seriesUrl: "https://data.bls.gov/timeseries/",
  items: Object.values(prices) }));
console.log(foods.length, "foods;", Object.keys(prices).length, "price items");
