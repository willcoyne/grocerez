import { fireEvent, screen } from "@testing-library/react-native";

import { applyTheme } from "@/features/theme/ThemeProvider";
import { renderWithProviders } from "@/test-utils";

import { MEALS, MealPrepSheet, WEEK_DAYS } from "../MealPrepSheet";
import { RecipesSheet } from "../RecipesSheet";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: jest.fn() }));

afterEach(() => applyTheme("cozy"));

describe("RecipesSheet", () => {
  it("shows the coming-soon collection and opens AI recipe ideas", async () => {
    await renderWithProviders(<RecipesSheet visible onClose={jest.fn()} />);
    expect(screen.getByText("Recipe collection — coming soon")).toBeTruthy();
    expect(screen.getByLabelText(/Recipe collection, coming soon/)).toBeTruthy();
    expect(screen.getAllByText("Soon").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText("Recipe ideas from my pantry"));
    expect(mockPush).toHaveBeenCalledWith("/recipes");
    // no meal-prep link without a handler
    expect(screen.queryByTestId("recipes-plan-meals")).toBeNull();
  });

  it("'Plan meals' calls onOpenMealPrep", async () => {
    const onOpenMealPrep = jest.fn();
    await renderWithProviders(<RecipesSheet visible onClose={jest.fn()} onOpenMealPrep={onOpenMealPrep} />);
    await fireEvent.press(screen.getByLabelText("Plan meals"));
    expect(onOpenMealPrep).toHaveBeenCalled();
  });

  it("keeps the same layout in another theme", async () => {
    applyTheme("pixel");
    await renderWithProviders(<RecipesSheet visible onClose={jest.fn()} onOpenMealPrep={jest.fn()} />);
    expect(screen.getByTestId("recipes-shelf-placeholder")).toBeTruthy();
    expect(screen.getByTestId("recipes-plan-meals")).toBeTruthy();
  });
});

describe("MealPrepSheet", () => {
  it("shows the coming-soon week grid (Mon–Sun × Breakfast/Lunch/Dinner)", async () => {
    const onClose = jest.fn();
    await renderWithProviders(<MealPrepSheet visible onClose={onClose} />);
    expect(screen.getByText("Meal prep calendar — coming soon")).toBeTruthy();
    expect(screen.getByLabelText(/Meal prep calendar, coming soon/)).toBeTruthy();
    for (const d of WEEK_DAYS) expect(screen.getByText(d)).toBeTruthy();
    for (const m of MEALS) expect(screen.getByText(m)).toBeTruthy();
    expect(screen.getAllByTestId(/^mealprep-cell-/)).toHaveLength(21);
    await fireEvent.press(screen.getByTestId("mealprep-sheet-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
