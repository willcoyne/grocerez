import type { Allergen } from "@contracts/dietary";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { FilterButton, FilterSheet, SearchPanel } from "../overlay";
import { EMPTY_FILTERS, type PantryFilters, type PantryItem } from "../types";

// Reanimated 4 needs the native worklets runtime; use its official Jest mocks.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
/* eslint-enable @typescript-eslint/no-require-imports */

function Harness({ myAllergens = [], onChange }: { myAllergens?: Allergen[]; onChange?: (f: PantryFilters) => void }) {
  const [filters, setFilters] = useState<PantryFilters>(EMPTY_FILTERS);
  return (
    <FilterSheet
      visible
      filters={filters}
      myAllergens={myAllergens}
      onClose={jest.fn()}
      onChange={(next) => {
        setFilters(next);
        onChange?.(next);
      }}
    />
  );
}

const selected = (testID: string) => screen.getByTestId(testID).props.accessibilityState;

function item(over: Partial<PantryItem>): PantryItem {
  return {
    id: "row-1",
    itemId: "item-1",
    name: "Lay's Classic Chips",
    brand: "Lay's",
    category: "snacks",
    location: "pantry",
    group: "snacks",
    allergens: [],
    status: "in_stock",
    expiresAt: null,
    caloriesPerServing: 160,
    healthScore: "d",
    imageUrl: null,
    ingredients: null,
    servingSize: null,
    ...over,
  };
}

describe("FilterSheet", () => {
  it("renders nothing when hidden", async () => {
    await render(
      <FilterSheet visible={false} filters={EMPTY_FILTERS} myAllergens={[]} onChange={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.queryByTestId("pantry-filter-sheet")).toBeNull();
  });

  it("toggles allergen, Nutri-Score, shelf and status filters on and off", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);

    await fireEvent.press(screen.getByTestId("pantry-filter-allergen-peanuts"));
    expect(selected("pantry-filter-allergen-peanuts")).toMatchObject({ selected: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ excludeAllergens: ["peanuts"] }));

    await fireEvent.press(screen.getByLabelText("Nutri-Score A"));
    await fireEvent.press(screen.getByLabelText("Nutri-Score B"));
    await fireEvent.press(screen.getByTestId("pantry-filter-group-fridge"));
    await fireEvent.press(screen.getByTestId("pantry-filter-cal-200"));
    await fireEvent.press(screen.getByTestId("pantry-filter-expiring"));
    await fireEvent.press(screen.getByTestId("pantry-filter-low"));
    expect(onChange).toHaveBeenLastCalledWith({
      excludeAllergens: ["peanuts"],
      safeForMe: false,
      healthScores: ["a", "b"],
      maxCalories: 200,
      groups: ["fridge"],
      expiringSoon: true,
      runningLow: true,
    });
    expect(selected("pantry-filter-cal-200")).toMatchObject({ checked: true });
    expect(selected("pantry-filter-low")).toMatchObject({ checked: true, disabled: false });

    // Second press turns it back off.
    await fireEvent.press(screen.getByTestId("pantry-filter-allergen-peanuts"));
    await fireEvent.press(screen.getByLabelText("Nutri-Score A"));
    expect(selected("pantry-filter-allergen-peanuts")).toMatchObject({ selected: false });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ excludeAllergens: [], healthScores: ["b"] }));
  });

  it("Reset clears everything back to EMPTY_FILTERS", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByTestId("pantry-filter-group-snacks"));
    await fireEvent.press(screen.getByTestId("pantry-filter-reset"));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTERS);
    expect(selected("pantry-filter-group-snacks")).toMatchObject({ selected: false });
  });

  it("marks my allergens and covers them with Safe for me", async () => {
    const onChange = jest.fn();
    await render(<Harness myAllergens={["milk"]} onChange={onChange} />);
    expect(screen.getByLabelText("Hide Milk, one of your allergies")).toBeTruthy();
    expect(selected("pantry-filter-allergen-milk")).toMatchObject({ selected: false });

    await fireEvent.press(screen.getByTestId("pantry-filter-safe"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ safeForMe: true }));
    expect(selected("pantry-filter-safe")).toMatchObject({ checked: true, disabled: false });
    expect(selected("pantry-filter-allergen-milk")).toMatchObject({ selected: true });

    // While covered, tapping the chip doesn't change excludeAllergens.
    onChange.mockClear();
    await fireEvent.press(screen.getByTestId("pantry-filter-allergen-milk"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables Safe for me when the user has no allergens", async () => {
    await render(<Harness />);
    expect(selected("pantry-filter-safe")).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText("Add your allergies on the Me note to use this")).toBeTruthy();
  });

  it("Done and the backdrop close the sheet", async () => {
    const onClose = jest.fn();
    await render(
      <FilterSheet visible filters={EMPTY_FILTERS} myAllergens={[]} onChange={jest.fn()} onClose={onClose} />,
    );
    await fireEvent.press(screen.getByTestId("pantry-filter-done"));
    await fireEvent.press(screen.getByTestId("pantry-filter-backdrop", { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("FilterButton", () => {
  it("shows a badge and count in the label only when filters are active", async () => {
    const { rerender } = await render(<FilterButton onPress={jest.fn()} activeCount={0} />);
    expect(screen.getByLabelText("Filters")).toBeTruthy();
    expect(screen.queryByTestId("pantry-filter-badge", { includeHiddenElements: true })).toBeNull();
    await rerender(<FilterButton onPress={jest.fn()} activeCount={3} />);
    expect(screen.getByLabelText("Filters, 3 active")).toBeTruthy();
    expect(screen.getByTestId("pantry-filter-badge", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("SearchPanel", () => {
  const items = [
    item({ id: "a", name: "Lay's Classic Chips", brand: "Lay's" }),
    item({ id: "b", name: "Whole Milk", brand: "Horizon", group: "fridge", allergens: ["milk"] }),
  ];

  it("shows a hint, live results with shelf + allergen chips, and a no-match state", async () => {
    const onSelect = jest.fn();
    await render(<SearchPanel visible items={items} onSelect={onSelect} onClose={jest.fn()} myAllergens={["milk"]} />);
    expect(screen.getByText("Type a name or brand to find it on your shelves.")).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("pantry-search-input"), "milk");
    expect(screen.getByText("Whole Milk")).toBeTruthy();
    expect(screen.getByText("Fridge")).toBeTruthy();
    expect(screen.getByText("Contains Milk")).toBeTruthy();
    expect(screen.queryByText("Lay's Classic Chips")).toBeNull();

    await fireEvent.press(screen.getByTestId("pantry-search-result-b"));
    expect(onSelect).toHaveBeenCalledWith(items[1]);

    await fireEvent.changeText(screen.getByTestId("pantry-search-input"), "zzz");
    expect(screen.getByTestId("pantry-search-empty")).toBeTruthy();
  });

  it("shows an empty-pantry state", async () => {
    await render(<SearchPanel visible items={[]} onSelect={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText(/Your pantry is empty/)).toBeTruthy();
  });
});
