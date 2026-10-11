/* eslint-disable react/no-unknown-property -- React Three Fiber props (position, geometry, material...) */
import type { Allergen } from "@contracts/dietary";
import type { PantryItem, ShelfGroup } from "../../types";
import { FoodItem } from "./FoodItem";

type Sample = [name: string, group: ShelfGroup, extra?: Partial<PantryItem>];

/** One of every kind/variant, plus glow / dimmed / highlighted / running-low examples. */
const SAMPLES: Sample[] = [
  ["Lay's Classic", "snacks"],
  ["Doritos Nacho", "snacks", { allergens: ["milk"] }],
  ["Oreos", "snacks"],
  ["Honey Nut Cheerios", "ingredients", { status: "running_low" }],
  ["Canned Tuna", "ingredients"],
  ["Peanut Butter", "ingredients", { allergens: ["peanuts"] }],
  ["Coca-Cola", "snacks"],
  ["Olive Oil", "ingredients"],
  ["Oat Milk", "fridge"],
  ["Eggs", "fridge", { allergens: ["eggs"] }],
  ["Cheddar Cheese", "fridge"],
  ["Chicken Breast", "fridge"],
  ["Salmon", "fridge"],
  ["Sourdough Bread", "ingredients"],
  ["Bagels", "ingredients"],
  ["Tortillas", "ingredients"],
  ["Croissants", "ingredients"],
  ["Apples", "produce"],
  ["Bananas", "produce"],
  ["Strawberries", "produce"],
  ["Watermelon", "produce"],
  ["Pineapple", "produce"],
  ["Carrots", "produce"],
  ["Tomatoes", "produce"],
  ["Cucumbers", "produce"],
  ["Broccoli", "produce"],
  ["Spinach", "produce"],
  ["Romaine Lettuce", "produce"],
  ["Ice Cream", "freezer"],
  ["Frozen Pizza", "freezer"],
  ["Paper Towels", "ingredients"],
  // flipped samples (back labels): full panel, no-label fallback, produce sticker
  [
    "Chocolate Chip Cookies",
    "snacks",
    {
      ingredients:
        "Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), semisweet chocolate chips (sugar, chocolate, cocoa butter, soy lecithin), sugar, butter (cream, salt), eggs, baking soda, salt, natural vanilla flavor.",
      servingSize: "3 cookies (34 g)",
      caloriesPerServing: 160,
      healthScore: "e",
      allergens: ["milk", "eggs", "wheat", "soy"],
    },
  ],
  ["Canned Black Beans", "ingredients", { caloriesPerServing: 110, healthScore: "a", allergens: [] }],
  ["Bananas", "produce", { caloriesPerServing: 105 }],
];

/** Gallery items shown flipped to their back label. */
export const GALLERY_FLIPPED = new Set(["Chocolate Chip Cookies", "Canned Black Beans"]);
/** Viewer allergens used by the gallery (milk + wheat show red on the cookie label). */
export const GALLERY_MY_ALLERGENS: Allergen[] = ["milk", "wheat"];

export const GALLERY_ITEMS: PantryItem[] = SAMPLES.map(([name, group, extra], i) => ({
  id: `gallery-${i}`,
  itemId: `gallery-item-${i}`,
  name,
  brand: null,
  category: null,
  location: null,
  group,
  allergens: [],
  status: "in_stock",
  expiresAt: null,
  caloriesPerServing: null,
  healthScore: null,
  imageUrl: null,
  ingredients: null,
  servingSize: null,
  ...extra,
}));

/**
 * Dev/review component: lays out every food kind in a grid (rows going down from `position`).
 * Items with allergens glow; "Oreos" is dimmed and "Bananas" highlighted to preview those states.
 * The last three samples are flipped to preview the back labels (panel, no-label fallback, produce sticker).
 */
export function FoodGallery({
  position = [0, 0, 0],
  columns = 5,
  spacing = 0.42,
  rowHeight = 0.55,
  onItemPress,
}: {
  position?: [number, number, number];
  columns?: number;
  spacing?: number;
  rowHeight?: number;
  onItemPress?: (item: PantryItem) => void;
}) {
  const offset = ((columns - 1) * spacing) / 2;
  return (
    <group position={position}>
      {GALLERY_ITEMS.map((item, i) => (
        <FoodItem
          key={item.id}
          item={item}
          position={[(i % columns) * spacing - offset, -Math.floor(i / columns) * rowHeight, 0]}
          glow={item.allergens.length > 0}
          dimmed={item.name === "Oreos"}
          highlighted={item.name === "Bananas"}
          flipped={GALLERY_FLIPPED.has(item.name) || i === GALLERY_ITEMS.length - 1}
          myAllergens={GALLERY_MY_ALLERGENS}
          onPress={() => onItemPress?.(item)}
        />
      ))}
    </group>
  );
}
