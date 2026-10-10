import { isIP } from "node:net";
import { AppError } from "../../lib/errors.js";

// Values match the `allergen` enum (database/02).
export const ALLERGENS = [
  "milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame", "gluten",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

// Shape of a scanned product, matching the `products` columns (database/08) that the scan service will upsert.
export interface ProductData {
  source: "smartlabel" | "openfoodfacts";
  name: string;
  brand: string | null;
  gtin: string | null;
  servingSize: string | null;
  caloriesPerServing: number | null;
  nutrition: Record<string, number>;
  ingredients: string | null;
  allergens: Allergen[];
  mayContain: Allergen[];
  healthScore: string | null;
  imageUrl: string | null; // copied to S3 by the service (backend/11), not stored as-is
  categoriesTags: string[]; // used to guess an item category when no catalog item matches
}

// Keyword table: whole words, optional plural "s". Order doesn't matter; results are de-duplicated.
const KEYWORDS: [RegExp, Allergen[]][] = [
  [/\b(milk|dairy|whey|casein(ate)?|butter|cream|cheese|lactose|yogh?urt)s?\b/, ["milk"]],
  [/\beggs?\b/, ["eggs"]],
  [/\b(fish|anchov(y|ies)|salmon|tuna|cod|pollock|tilapia)\b/, ["fish"]],
  [/\b(shellfish|shrimps?|crabs?|lobsters?|crustaceans?|prawns?|molluscs?|mollusks?|clams?|oysters?|scallops?)\b/, ["shellfish"]],
  [/\b(tree nuts?|nuts|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?)\b/, ["tree_nuts"]],
  [/\bpeanuts?\b/, ["peanuts"]],
  [/\bwheat\b/, ["wheat", "gluten"]],
  [/\b(gluten|barley|rye|spelt)\b/, ["gluten"]],
  [/\b(soy|soya|soybeans?)\b/, ["soy"]],
  [/\bsesame\b/, ["sesame"]],
];

export function mapAllergens(text: string | null | undefined): Allergen[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const out = new Set<Allergen>();
  for (const [re, allergens] of KEYWORDS) if (re.test(t)) allergens.forEach((a) => out.add(a));
  return ALLERGENS.filter((a) => out.has(a));
}

export const USER_AGENT = "GrocerEZ/0.1"; // ponytail: plan wants "(+contact email)"; add once the team picks an address
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Image URLs come from scraped/third-party data, and the service downloads them server-side (backend/11): keep only
// plain https URLs with a hostname (no IP literals, credentials or ports). The download must still go through the
// DNS/private-address guard and a host allowlist.
export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return null;
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".")) return null;
  return url.toString();
}

export const upstreamError = (message: string) => new AppError(502, "UPSTREAM_ERROR", message);

// Reads a response body as text, aborting once it exceeds `max` bytes.
export async function readCapped(res: Response, max = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) throw upstreamError("Response too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw upstreamError("Response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
