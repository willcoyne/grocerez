import { isIP } from "node:net";
import type { Allergen } from "../../contracts/ai.js";
export type { Allergen };
import { AppError } from "../../lib/errors.js";

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

export const USER_AGENT = "GrocerEZ/0.1"; // ponytail: plan wants "(+contact email)"; add once the team picks an address
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One cache key per barcode: UPC-A (12), EAN-13 and GTIN-14 with a leading 0 all become 13 digits (OFF reports US UPC-A
 * codes as EAN-13). GTIN-8 stays 8; a GTIN-14 with a packaging indicator digit stays 14.
 */
export function normGtin(gtin: string): string {
  if (gtin.length === 8) return gtin;
  const g = gtin.padStart(14, "0");
  return g.startsWith("0") ? g.slice(1) : g;
}

// Postgres rejects NUL in text and jsonb; strip all C0 controls except tab/newline/CR (plus DEL) from upstream data.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function stripControl<T>(v: T): T {
  if (typeof v === "string") return v.replace(CONTROL, "") as T;
  if (Array.isArray(v)) return v.map(stripControl) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(CONTROL, ""), stripControl(x)])) as T;
  }
  return v;
}

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
