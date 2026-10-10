import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import * as cheerio from "cheerio";
import { AppError } from "../../lib/errors.js";
import {
  FETCH_TIMEOUT_MS, USER_AGENT, mapAllergens, readCapped, safeImageUrl, upstreamError, type ProductData,
} from "./common.js";

// ---------- SSRF guard ----------

// Exact hosts, and suffixes that allow any subdomain. Add brand hosts here as they're found while testing.
const ALLOWED_HOSTS = ["smartlabel.org", "smartlabel.labelinsight.com"];
const ALLOWED_SUFFIXES = [".smartlabel.org"];
const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  // IPv4-mapped (::ffff:a.b.c.d) addresses are matched against the IPv4 rules by BlockList itself. The other forms
  // that embed an IPv4 (IPv4-compatible ::a.b.c.d, IPv4-translated ::ffff:0:a.b.c.d, NAT64, 6to4) are blocked whole.
  ["::", 96], ["::ffff:0:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all: refuse
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Parses and checks a URL against the allowlist. Returns null if it must not be fetched. */
export function allowedSmartLabelUrl(raw: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) return null;
  if (!ALLOWED_HOSTS.includes(host) && !ALLOWED_SUFFIXES.some((s) => host.endsWith(s))) return null;
  return url;
}

export type LookupFn = (host: string) => Promise<{ address: string }[]>;
export interface FetchDeps {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  timeoutMs?: number;
}

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true });

// ponytail: DNS is checked here and resolved again by fetch (rebinding window). Low risk since only allowlisted
// hostnames get this far; pin the IP with an undici dispatcher `connect.lookup` if that ever matters.
async function assertPublicHost(url: URL, lookup: LookupFn) {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(url.hostname);
  } catch {
    throw upstreamError("SmartLabel host did not resolve");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw upstreamError("SmartLabel host resolves to a private address");
  }
}

/**
 * Fetches a SmartLabel page. Redirects are followed by hand so every hop is re-checked against the allowlist and DNS
 * guard. 5 s timeout for the whole chain, 2 MB body cap.
 */
export async function fetchSmartLabelPage(qrUrl: string, deps: FetchDeps = {}): Promise<{ url: string; html: string }> {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);

  const first = allowedSmartLabelUrl(qrUrl);
  if (!first) throw new AppError(400, "VALIDATION_ERROR", "qrUrl is not a SmartLabel URL");
  let url: URL = first;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url, lookup);
      const res = await doFetch(url, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        const next = location ? allowedSmartLabelUrl(location, url) : null;
        if (!next) throw upstreamError("SmartLabel redirected to a disallowed URL");
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw upstreamError(`SmartLabel returned ${res.status}`);
      }
      return { url: url.toString(), html: await readCapped(res) };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw upstreamError(signal.aborted ? "SmartLabel request timed out" : "SmartLabel request failed");
  }
  throw upstreamError("Too many redirects");
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
