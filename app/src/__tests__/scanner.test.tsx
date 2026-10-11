import type { Product } from "@contracts/products";

import { ApiError } from "@/api/client";
import { conflicts } from "@/components/ProductCard";
import { BAD_BARCODE, NOT_FOUND, NOT_SMARTLABEL, scanErrorMessage, scanRequestFor } from "@/lib/scan";

describe("scanner request mapping", () => {
  it("QR URL → qrUrl; plain QR → not a SmartLabel; barcode → gtin", () => {
    expect(scanRequestFor("qr", "https://smartlabel.generalmills.com/00016000275287")).toEqual({
      body: { qrUrl: "https://smartlabel.generalmills.com/00016000275287" },
    });
    expect(scanRequestFor("qr", "WIFI:S:home")).toEqual({ error: NOT_SMARTLABEL });
    expect(scanRequestFor("upc_a", "016000275287")).toEqual({ body: { gtin: "016000275287" } });
    expect(scanRequestFor("ean13", "123")).toEqual({ error: BAD_BARCODE });
  });

  it("server errors → scanner messages", () => {
    expect(scanErrorMessage(new ApiError(404, "PRODUCT_NOT_FOUND", ""), { gtin: "016000275287" })).toBe(NOT_FOUND);
    expect(scanErrorMessage(new ApiError(400, "VALIDATION_ERROR", "check digit"), { gtin: "016000275288" })).toBe(BAD_BARCODE);
    expect(scanErrorMessage(new ApiError(400, "HOST_NOT_ALLOWED", ""), { qrUrl: "https://x.test" })).toBe(NOT_SMARTLABEL);
  });

  it("highlights a household member's allergen with their name", () => {
    const product = { allergens: ["peanuts", "milk"], mayContain: ["soy"] } as unknown as Product;
    const household = new Map([
      ["peanuts", ["User 4"]],
      ["eggs", ["User 2"]],
    ] as const);
    expect(conflicts(product, household as never)).toEqual([{ allergen: "peanuts", names: ["User 4"] }]);
  });
});
