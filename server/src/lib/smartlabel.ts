import * as cheerio from "cheerio";
import type { Allergen } from "../contracts/dietary.js";
import { allergensInText } from "./allergens.js";
import { BlockedHostError, fetchAllowlisted } from "./http.js";

/**
 * SmartLabel hosts we will fetch (SSRF guard). Exact hosts, plus any subdomain of smartlabel.org.
 * Add brand hosts here only after checking their robots.txt / terms (see plan/backend/DECISIONS.md, 08).
 */
export const SMARTLABEL_HOSTS = new Set([
  "smartlabel.org",
  "www.smartlabel.org",
  "smartlabel.labelinsight.com",
  "smartlabel.generalmills.com",
]);

export function isSmartLabelHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return SMARTLABEL_HOSTS.has(h) || h.endsWith(".smartlabel.org");
}

/** Validates a scanned QR URL and returns its canonical https form (the cache key). Throws 400 HOST_NOT_ALLOWED. */
export function canonicalSmartLabelUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BlockedHostError("that link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedHostError(url.protocol);
  if (!isSmartLabelHost(url.hostname) || url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) {
    throw new BlockedHostError(url.hostname || "that link");
  }
  url.protocol = "https:";
  url.port = "";
  url.hash = "";
  return url.toString();
}

export type ParsedLabel = {
  template: string;
  gtin: string | null;
  name: string | null;
  brand: string | null;
  servingSize: string | null;
  calories: number | null;
  nutrition: Record<string, number> | null;
  ingredients: string | null;
  allergens: Allergen[];
  mayContain: Allergen[];
};

/** True if the parse found real label data (not just an identifier). */
export const hasLabelData = (p: ParsedLabel) =>
  !!p.name && (p.calories != null || p.ingredients != null || p.allergens.length > 0 || p.nutrition != null);

const clean = (s: string | undefined | null) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
const num = (s: string | undefined | null) => {
  const m = /-?\d+(\.\d+)?/.exec(s ?? "");
  return m ? Number(m[0]) : null;
};

/** GTIN from the URL path (…/00016000275287) or a hidden input (General Mills: #hdnGTINId). */
function findGtin($: cheerio.CheerioAPI, url: string): string | null {
  const fromInput = $("#hdnGTINId").attr("value") ?? $("[itemprop=gtin14],[itemprop=gtin13],[itemprop=gtin12],[itemprop=gtin]").attr("content");
  if (fromInput && /^\d{8,14}$/.test(fromInput.trim())) return fromInput.trim();
  const fromPath = /(?:^|\/)(\d{8,14})(?:[/?#]|$)/.exec(new URL(url).pathname);
  return fromPath ? fromPath[1] : null;
}

/** "Contains: …" and "May contain: …" lines anywhere in the page text. */
function allergenLines(text: string) {
  const contains = /contains\s*:?\s*([^.\n]{2,200})/i.exec(text)?.[1] ?? "";
  const may = /(?:may contain|manufactured in a facility (?:that|which) (?:also )?(?:processes|handles)|processed in a facility with)\s*:?\s*([^.\n]{2,200})/i.exec(text)?.[1] ?? "";
  return { contains: allergensInText(contains), may: allergensInText(may) };
}

/** Template 1: schema.org Product in JSON-LD (some brand SmartLabel pages). */
function parseJsonLd($: cheerio.CheerioAPI, url: string): ParsedLabel | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      continue;
    }
    const nodes = (Array.isArray(data) ? data : [data]).flatMap((d) =>
      d && typeof d === "object" && "@graph" in d ? (d as { "@graph": unknown[] })["@graph"] : [d],
    ) as Record<string, unknown>[];
    const product = nodes.find((n) => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product"))));
    if (!product) continue;
    const brandRaw = product.brand as { name?: string } | string | undefined;
    const n = (product.nutrition ?? {}) as Record<string, string>;
    const nutrition: Record<string, number> = {};
    const map: [string, string, number][] = [
      ["fatContent", "fat_g", 1], ["saturatedFatContent", "sat_fat_g", 1], ["sodiumContent", "sodium_mg", 1],
      ["carbohydrateContent", "carbs_g", 1], ["sugarContent", "sugar_g", 1], ["proteinContent", "protein_g", 1], ["fiberContent", "fiber_g", 1],
    ];
    for (const [k, out, f] of map) {
      const v = num(n[k]);
      if (v != null) nutrition[out] = v * f;
    }
    const text = $("body").text();
    const lines = allergenLines(text);
    const ingredients =
      clean(product.ingredients as string | undefined) ??
      clean($(".ingredients, #ingredients, [data-testid=ingredients]").first().text().replace(/^\s*ingredients\s*:?\s*/i, ""));
    return {
      template: "jsonld",
      gtin: (["gtin14", "gtin13", "gtin12", "gtin"].map((k) => product[k]).find((v) => typeof v === "string" && /^\d{8,14}$/.test(v)) as string) ?? findGtin($, url),
      name: clean(product.name as string),
      brand: clean(typeof brandRaw === "string" ? brandRaw : brandRaw?.name),
      servingSize: clean(n.servingSize),
      calories: num(n.calories),
      nutrition: Object.keys(nutrition).length ? nutrition : null,
      ingredients,
      allergens: lines.contains.length ? lines.contains : allergensInText(ingredients),
      mayContain: lines.may,
    };
  }
  return null;
}

/**
 * Template 2: server-rendered label page with labelled sections (Label Insight style):
 * `.product-name`, `.brand-name`, a nutrition table of "label / value" rows, an "Ingredients" section and "Contains" / "May contain" text.
 */
function parseSections($: cheerio.CheerioAPI, url: string): ParsedLabel | null {
  const name = clean($(".product-name, [data-testid=product-name], h1.product-title").first().text());
  if (!name) return null;
  const brand = clean($(".brand-name, [data-testid=brand-name]").first().text());
  const nutrition: Record<string, number> = {};
  let calories: number | null = null;
  let servingSize: string | null = null;
  const keys: [RegExp, string][] = [
    [/^total fat/i, "fat_g"], [/^saturated fat/i, "sat_fat_g"], [/^sodium/i, "sodium_mg"], [/^total carbohydrate/i, "carbs_g"],
    [/^(total )?sugars/i, "sugar_g"], [/^protein/i, "protein_g"], [/^dietary fiber/i, "fiber_g"],
  ];
  $(".nutrition-table tr, .nutrition-facts tr, table.nutrition tr").each((_, tr) => {
    const cells = $(tr).find("th,td").toArray().map((c) => clean($(c).text()) ?? "");
    const [label, value] = [cells[0] ?? "", cells[1] ?? ""];
    if (/^calories/i.test(label)) calories = num(value);
    else if (/^serving size/i.test(label)) servingSize = value || null;
    else for (const [re, key] of keys) if (re.test(label) && num(value) != null) nutrition[key] = num(value)!;
  });
  const ingredients = clean($(".ingredients, #ingredients, [data-testid=ingredients]").first().text().replace(/^ingredients\s*:?\s*/i, ""));
  const lines = allergenLines($("body").text());
  return {
    template: "sections",
    gtin: findGtin($, url),
    name,
    brand,
    servingSize,
    calories,
    nutrition: Object.keys(nutrition).length ? nutrition : null,
    ingredients,
    allergens: lines.contains,
    mayContain: lines.may,
  };
}

/**
 * Parses a SmartLabel page. Tries each template parser; if none finds label data, returns at least the GTIN
 * (template "gtin-only", e.g. General Mills' JavaScript-rendered shell) so the caller can fall back to Open Food Facts.
 */
export function parseSmartLabel(html: string, url: string): ParsedLabel {
  const $ = cheerio.load(html);
  for (const parser of [parseJsonLd, parseSections]) {
    const parsed = parser($, url);
    if (parsed && hasLabelData(parsed)) return parsed;
  }
  return {
    template: "gtin-only", gtin: findGtin($, url), name: null, brand: null, servingSize: null, calories: null,
    nutrition: null, ingredients: null, allergens: [], mayContain: [],
  };
}

export const smartlabel = {
  /** Fetch with the host allowlist enforced on every redirect hop, 5 s timeout, our User-Agent. */
  async fetchPage(url: string) {
    return fetchAllowlisted(url, isSmartLabelHost, { timeoutMs: 5000 });
  },
};
