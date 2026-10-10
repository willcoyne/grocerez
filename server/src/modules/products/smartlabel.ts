import * as cheerio from "cheerio";
import { AppError } from "../../lib/errors.js";
import { readCapped, safeImageUrl, type ProductData } from "./common.js";
import { mapAllergens } from "../../lib/allergens.js";
import { checkUrl, guardedFetch, type FetchDeps } from "./guardedFetch.js";

export { isPrivateAddress, type FetchDeps, type LookupFn } from "./guardedFetch.js";

// ---------- SSRF guard ----------

// Exact hosts, and suffixes that allow any subdomain. Add brand hosts here as they're found while testing.
const ALLOWED_HOSTS = ["smartlabel.org", "smartlabel.labelinsight.com"];
const ALLOWED_SUFFIXES = [".smartlabel.org"];
const smartLabelHost = (h: string) => ALLOWED_HOSTS.includes(h) || ALLOWED_SUFFIXES.some((s) => h.endsWith(s));

/** Parses and checks a URL against the allowlist. Returns null if it must not be fetched. */
export const allowedSmartLabelUrl = (raw: string, base?: URL) => checkUrl(raw, smartLabelHost, base);

/** Fetches a SmartLabel page through the shared guard (5 s for the whole chain, 2 MB body cap). */
export async function fetchSmartLabelPage(qrUrl: string, deps: FetchDeps = {}): Promise<{ url: string; html: string }> {
  const first = allowedSmartLabelUrl(qrUrl);
  if (!first) throw new AppError(400, "VALIDATION_ERROR", "qrUrl is not a SmartLabel URL");
  const { url, result } = await guardedFetch(first, smartLabelHost, "text/html", (res) => readCapped(res), deps, "SmartLabel");
  return { url: url.toString(), html: result };
}

// ---------- Parsing ----------

// [key, label regex]. Values are stored in the unit the key names (g or mg).
const NUTRIENTS: [string, RegExp][] = [
  ["fat_g", /total fat/],
  ["sat_fat_g", /saturated fat/],
  ["trans_fat_g", /trans fat/],
  ["cholesterol_mg", /cholesterol/],
  ["sodium_mg", /sodium/],
  ["carbs_g", /total carbohydrates?/],
  ["fiber_g", /dietary fiber/],
  ["sugar_g", /total sugars?/],
  ["protein_g", /protein/],
];
const AMOUNT = /(\d+(?:\.\d+)?)\s*(mg|g)\b/;

function toUnit(value: number, unit: string, key: string): number {
  const wantMg = key.endsWith("_mg");
  if (wantMg && unit === "g") return value * 1000;
  if (!wantMg && unit === "mg") return value / 1000;
  return value;
}

const BLOCKS = new Set(["p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "div", "dt", "dd", "section", "td", "th"]);
const SKIP = new Set(["script", "style", "noscript", "template"]);
type DomNode = { type: string; name?: string; data?: string; children?: DomNode[] };

/**
 * Parses the label page into lines of visible text, one per block element. Iterative walk: cheerio's recursive
 * .text() overflows the stack on a few thousand nested elements (a 25 KB page).
 */
function pageLines($: cheerio.CheerioAPI): string[] {
  const parts: string[] = [];
  const stack: (DomNode | "\n")[] = [$("body")[0] as unknown as DomNode];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === "\n") parts.push("\n");
    else if (node.type === "text") parts.push(node.data ?? "");
    else if (node.name === "br") parts.push("\n");
    else if (node.children && !SKIP.has(node.name ?? "")) {
      if (BLOCKS.has(node.name ?? "")) stack.push("\n");
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
  }
  return parts.join("").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * Every allergen statement on the page ("Contains: Milk, Wheat."), including one at the end of the ingredients
 * paragraph. "Contains 2% or less of ..." / "contains less than ..." are ingredient sub-lists, not statements.
 */
function containsStatements(lines: string[]): string | null {
  const parts: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bcontains\b(?!\s*\d|\s+less\b)\s*:?\s*([^.]*)/gi)) {
      parts.push(m[1].trim() || lines[i + 1] || "");
    }
  });
  return parts.join(", ") || null;
}

/** Text after "Label:" on the first matching line; if the line is only the label, the next line. */
function afterLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${label.source}\\s*:?\\s*(.*)$`, "i"));
    if (m) return (m[m.length - 1] || lines[i + 1] || "").trim() || null;
  }
  return null;
}

const digits = (s: unknown) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 14 ? d : null;
};

/** Reads schema.org Product JSON-LD if the page has it (Label Insight pages often do). */
function jsonLdProduct($: cheerio.CheerioAPI): Record<string, any> | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const nodes = [data, ...(Array.isArray(data) ? data : []), ...(data?.["@graph"] ?? [])];
      const p = nodes.find((n) => n && typeof n === "object" && [n["@type"]].flat().includes("Product"));
      if (p) return p;
    } catch {
      // malformed JSON-LD: fall through to text parsing
    }
  }
  return null;
}

// cheerio/parse5 tree building and selector matching cost O(depth) per element, so a deeply nested page is quadratic
// (20k nested <div>s = seconds of blocked event loop, M3-19). Real label pages nest a few dozen levels.
const MAX_DEPTH = 128;
// Tags that never open a level, or that the parser closes implicitly when a sibling opens (<p><p>, <li><li>).
const FLAT = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
  "p", "li", "dt", "dd", "option", "optgroup", "tr", "td", "th", "thead", "tbody", "tfoot", "rb", "rt", "rp",
]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript"]);

/**
 * True if elements nest deeper than MAX_DEPTH: one pass, no regex backtracking. A close tag pops back to its open tag, and a stray
 * one is ignored, like the HTML parser.
 */
export function tooDeep(page: string): boolean {
  const html = page.toLowerCase();
  const open: string[] = [];
  let i = 0;
  for (;;) {
    if (open.length > MAX_DEPTH) return true;
    i = html.indexOf("<", i);
    if (i < 0) return false;
    if (html.startsWith("<!--", i)) {
      i = html.indexOf("-->", i + 4);
      if (i < 0) return false;
      continue;
    }
    const end = html.indexOf(">", i + 1);
    if (end < 0) return false;
    const m = /^<(\/?)([a-z][^\s/>]*)/.exec(html.slice(i, Math.min(end + 1, i + 64)));
    i = end + 1;
    if (!m) continue;
    const name = m[2];
    if (FLAT.has(name)) continue;
    if (m[1]) {
      const at = open.lastIndexOf(name);
      if (at >= 0) open.length = at;
    } else if (RAW_TEXT.has(name)) {
      i = html.indexOf(`</${name}`, i); // jump over script/style bodies
      if (i < 0) return false;
    } else if (html[end - 1] !== "/") open.push(name);
  }
}

export interface SmartLabelParse {
  /** Null when the page doesn't look like a product label (no name, or neither calories nor ingredients). */
  product: ProductData | null;
  /** Any GTIN found, so the caller can fall back to Open Food Facts if parsing failed. */
  gtin: string | null;
}

/**
 * Generic SmartLabel parser: JSON-LD first, then label-text heuristics over the visible page text.
 * ponytail: one heuristic parser instead of one per template; split per template once real fixtures show the need.
 */
export function parseSmartLabel(html: string): SmartLabelParse {
  if (tooDeep(html)) return { product: null, gtin: null };
  const $ = cheerio.load(html);
  const ld = jsonLdProduct($);
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  const lines = pageLines($);
  const text = lines.join("\n");

  const gtin =
    digits(ld?.gtin ?? ld?.gtin13 ?? ld?.gtin12 ?? ld?.gtin14 ?? ld?.gtin8) ??
    digits(text.match(/\b(?:UPC|GTIN|EAN)(?:\s*code)?\s*[:#]?\s*([\d -]{8,20})/i)?.[1]);

  const name = (typeof ld?.name === "string" && ld.name.trim()) || h1 || ogTitle || null;
  const brandLd = typeof ld?.brand === "string" ? ld.brand : ld?.brand?.name;
  const brand = (brandLd && String(brandLd).trim()) || afterLabel(lines, /brand:/);

  // JSON-LD is page-controlled: accept only the expected types, and non-negative numbers.
  const ldServing = ld?.nutrition?.servingSize;
  const servingSize = (typeof ldServing === "string" ? ldServing.trim() : null) || afterLabel(lines, /serving size/);
  const ldCal = ld?.nutrition?.calories;
  const calText = (typeof ldCal === "string" || typeof ldCal === "number" ? ldCal : null) ??
    text.match(/\bcalories\b\s*:?\s*(\d+(?:\.\d+)?)/i)?.[1];
  const calNum = calText != null ? parseFloat(String(calText)) : NaN;
  const caloriesPerServing = Number.isFinite(calNum) && calNum >= 0 ? calNum : null;

  const nutrition: Record<string, number> = {};
  for (const [key, label] of NUTRIENTS) {
    const line = lines.find((l) => label.test(l.toLowerCase()) && AMOUNT.test(l));
    const m = line?.toLowerCase().split(label)[1]?.match(AMOUNT);
    if (m) nutrition[key] = toUnit(parseFloat(m[1]), m[2], key);
  }
  const added = text.match(/(\d+(?:\.\d+)?)\s*g\s+added sugars?/i) ?? text.match(/added sugars?\s*(\d+(?:\.\d+)?)\s*g/i);
  if (added) nutrition.added_sugar_g = parseFloat(added[1]);

  const ingredients = afterLabel(lines, /ingredients/);
  const contains = containsStatements(lines);
  const mayContainText = afterLabel(lines, /(?:may contain|manufactured in a facility (?:that|which) (?:also )?processes)/);

  if (!name || (caloriesPerServing == null && !ingredients)) return { product: null, gtin };

  return {
    gtin,
    product: {
      source: "smartlabel",
      name,
      brand: brand || null,
      gtin,
      servingSize: servingSize || null,
      caloriesPerServing,
      nutrition,
      ingredients,
      allergens: mapAllergens(contains),
      mayContain: mapAllergens(mayContainText),
      healthScore: null,
      imageUrl: safeImageUrl(typeof ld?.image === "string" ? ld.image : ogImage),
      categoriesTags: [],
    },
  };
}
