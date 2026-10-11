/**
 * Display model for a scanned `Product` (presentation mapping only: every number, allergen and source comes from the
 * server as-is). `Product.nutrition` is a loose record, so its known keys are read into typed fields here.
 */
import type { Allergen } from "@contracts/dietary";
import type { Product } from "@contracts/products";

export type LabelFacts = {
  /** "serving" when per-serving values are known, else "100g" (Product.nutrition.basis). */
  basis: "serving" | "100g";
  servingSize: string | null;
  calories: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  carbs_g: number | null;
  sugar_g: number | null;
  fiber_g: number | null;
  protein_g: number | null;
  sodium_mg: number | null;
};

export type LabelView = {
  name: string;
  brand: string | null;
  imageUrl: string | null;
  /** Nutri-Score letter, uppercase, or null. */
  healthScore: string | null;
  facts: LabelFacts | null;
  ingredients: string | null;
  allergens: Allergen[];
  mayContain: Allergen[];
  /** "From the SmartLabel" / "From Open Food Facts" / "Entered by hand". */
  sourceTitle: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const PRODUCT_SOURCE: Record<Product["source"], string> = {
  smartlabel: "From the SmartLabel",
  openfoodfacts: "From Open Food Facts",
  manual: "Entered by hand",
};

export function productLabelView(p: Product): LabelView {
  const n = p.nutrition ?? {};
  const facts: LabelFacts = {
    basis: n.basis === "100g" ? "100g" : "serving",
    servingSize: p.servingSize,
    // The server stores the label's calories on the same basis as the nutrients (per serving, else per 100 g).
    calories: p.caloriesPerServing,
    fat_g: num(n.fat_g),
    sat_fat_g: num(n.sat_fat_g),
    carbs_g: num(n.carbs_g),
    sugar_g: num(n.sugar_g),
    fiber_g: num(n.fiber_g),
    protein_g: num(n.protein_g),
    sodium_mg: num(n.sodium_mg),
  };
  return {
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    healthScore: p.healthScore ? p.healthScore.toUpperCase() : null,
    facts: hasFacts(facts) ? facts : null,
    ingredients: p.ingredients,
    allergens: p.allergens,
    mayContain: p.mayContain,
    sourceTitle: PRODUCT_SOURCE[p.source] ?? "Entered by hand",
  };
}

function hasFacts(f: LabelFacts): boolean {
  return (
    f.servingSize !== null ||
    [f.calories, f.fat_g, f.sat_fat_g, f.carbs_g, f.sugar_g, f.fiber_g, f.protein_g, f.sodium_mg].some((v) => v !== null)
  );
}

/** 12 → "12", 2.5 → "2.5", 0.333 → "0.3". */
export function fmtAmount(v: number): string {
  if (v >= 10) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}
