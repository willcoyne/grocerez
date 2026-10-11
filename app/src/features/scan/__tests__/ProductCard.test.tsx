import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "@/test-utils";

import { product } from "../__fixtures__/scan";
import type { AllergenAudience } from "../allergens";
import { productLabelView } from "../labelView";
import { ProductCard } from "../ProductCard";

const nobody: AllergenAudience = { household: new Map(), mine: [], meName: "Carson" };

describe("ProductCard", () => {
  it("renders a Nutrition Facts panel, Nutri-Score, collapsible ingredients and the source", async () => {
    await renderWithProviders(<ProductCard product={product} audience={nobody} />);
    expect(screen.getByText("Nutrition Facts")).toBeTruthy();
    expect(screen.getByTestId("product-card-facts-serving")).toHaveTextContent("1.5 cup (39 g)");
    expect(screen.getByTestId("product-card-facts-calories")).toHaveTextContent("140");
    expect(screen.getByLabelText("Sodium 190 milligrams")).toBeTruthy();
    expect(screen.getByLabelText("Saturated Fat 0.5 grams")).toBeTruthy();
    expect(screen.getByLabelText("Nutri-Score A")).toBeTruthy();
    expect(screen.getByTestId("product-card-source")).toHaveTextContent("From the SmartLabel");
    expect(screen.getByTestId("product-card-ingredients").props.numberOfLines).toBe(2);
    await fireEvent.press(screen.getByLabelText("Show ingredients"));
    expect(screen.getByTestId("product-card-ingredients").props.numberOfLines).toBeUndefined();
    expect(screen.queryByTestId("allergy-banner")).toBeNull();
  });

  it("another member's allergen gets a named (tinted) warning, mine come first as 'You'", async () => {
    const audience: AllergenAudience = {
      household: new Map([
        ["wheat", ["Sam"]],
        ["peanuts", ["Carson", "Alex"]],
      ]),
      mine: ["peanuts"],
      meName: "Carson",
    };
    await renderWithProviders(<ProductCard product={{ ...product, allergens: ["wheat", "peanuts"], mayContain: [] }} audience={audience} />);
    expect(screen.getByTestId("allergy-banner")).toHaveTextContent("Allergy warning: peanuts (You, Alex), wheat (Sam)");
    expect(screen.getByTestId("product-card-contains-peanuts")).toHaveTextContent("Peanuts · You, Alex");
    expect(screen.getByLabelText("Contains Wheat. Sam is allergic")).toBeTruthy();
  });

});

describe("labelView mapping", () => {
  it("a per-100 g product keeps its basis; a label with no numbers has no facts panel", () => {
    const v = productLabelView({ ...product, nutrition: { basis: "100g", fat_g: 7 }, source: "openfoodfacts" });
    expect(v.facts?.basis).toBe("100g");
    expect(v.facts?.fat_g).toBe(7);
    expect(v.facts?.protein_g).toBeNull();
    expect(v.sourceTitle).toBe("From Open Food Facts");
    const bare = productLabelView({ ...product, nutrition: null, caloriesPerServing: null, servingSize: null });
    expect(bare.facts).toBeNull();
  });
});
