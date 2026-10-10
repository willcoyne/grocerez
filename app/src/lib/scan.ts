import type { ScanBody } from "@contracts/products";

import { ApiError } from "@/api/client";

export const NOT_SMARTLABEL = "That QR code isn't a SmartLabel. Try the barcode.";
export const BAD_BARCODE = "Couldn't read that barcode, try again.";
export const NOT_FOUND = "We couldn't find this product.";

/** Camera result → request body. QR with a URL → {qrUrl}; barcode digits → {gtin}; anything else → an error message. */
export function scanRequestFor(type: string, data: string): { body: ScanBody } | { error: string } {
  const value = data.trim();
  if (/qr/i.test(type)) {
    return /^https?:\/\//i.test(value) ? { body: { qrUrl: value } } : { error: NOT_SMARTLABEL };
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return { error: BAD_BARCODE };
  return { body: { gtin: digits } };
}

/** Server errors from POST /products/scan → what the scanner says. */
export function scanErrorMessage(e: unknown, body: ScanBody): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === "PRODUCT_NOT_FOUND" || e.status === 404) return NOT_FOUND;
  if (e.code === "HOST_NOT_ALLOWED") return NOT_SMARTLABEL;
  if (e.status === 400 && body.gtin) return BAD_BARCODE; // e.g. bad check digit
  return null;
}
