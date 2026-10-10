import type { PricesResponse, Recipe } from "@contracts/ai";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import PricesScreen from "@/app/prices";
import RecipesScreen from "@/app/recipes";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
const apiMock = api as jest.Mock;
const g = testGroup.id;

const base = {
  [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
  [`GET /groups/${g}/shopping-list`]: () => [
    { itemId: "i-pb", item: { name: "Peanut Butter" }, allergenFlags: [{ userId: "u4", displayName: "User 4", allergen: "peanuts" }] },
  ],
  "GET /me/dietary": () => ({ diets: ["vegetarian"], allergens: [] }),
};

const recipe: Recipe = {
  title: "Spinach omelette",
  summary: "Quick eggs",
  minutes: 15,
  servings: 2,
  ingredients: ["2 eggs", "spinach", "parmesan"],
  usesCabinetItems: ["Eggs", "Spinach"],
  usesExpiring: ["Spinach"],
  missingItems: [
    { name: "parmesan", itemId: "11111111-0000-4000-8000-000000000001", itemName: "Parmesan", match: "exact" },
    { name: "chives", itemId: null, itemName: null, match: "none" },
  ],
  steps: ["Whisk", "Cook"],
  allergenWarnings: [],
};

describe("Recipes", () => {
  it("shows the household line, then adds missing items (creating unmatched names first)", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        ...base,
        [`POST /groups/${g}/recipes/suggest`]: () => [recipe],
        "POST /items": () => ({ id: "11111111-0000-4000-8000-000000000002" }),
        [`POST /groups/${g}/shopping-list`]: () => ({}),
      }),
    );
    await renderWithProviders(<RecipesScreen />);
    await screen.findByText("Safe for: Vegetarian · no peanuts");
    await fireEvent.press(screen.getByText("Find recipes"));
    await screen.findByText("Spinach omelette");
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/recipes/suggest`, { method: "POST", body: { mustUseExpiring: true, maxRecipes: 3 } });
    expect(screen.getByLabelText("Spinach, expiring soon")).toBeTruthy();
    await fireEvent.press(screen.getByText("Add missing to list"));
    await screen.findByText("2 items added to the list");
    expect(apiMock).toHaveBeenCalledWith("/items", { method: "POST", body: { name: "chives" } });
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list`, { method: "POST", body: { itemId: recipe.missingItems[0].itemId } });
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list`, { method: "POST", body: { itemId: "11111111-0000-4000-8000-000000000002" } });
  });

  it("AI_UNAVAILABLE → 'Recipe ideas are unavailable right now'", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        ...base,
        [`POST /groups/${g}/recipes/suggest`]: () => {
          throw new ApiError(503, "AI_UNAVAILABLE", "x");
        },
      }),
    );
    await renderWithProviders(<RecipesScreen />);
    await fireEvent.press(screen.getByText("Find recipes"));
    await screen.findByText("Recipe ideas are unavailable right now.");
  });
});

describe("Prices", () => {
  it("renders the total range and per-item rows labeled as AI estimates", async () => {
    const res: PricesResponse = {
      zipCode: "64105",
      items: [
        { itemId: "a", name: "Cheerios", lowCents: 350, highCents: 499, typicalCents: 399, unit: null, sources: [], estimate: true, cached: false, fetchedAt: new Date().toISOString() },
      ],
      missingItemIds: [],
      totalLowCents: 3400,
      totalHighCents: 4100,
    };
    apiMock.mockImplementation(apiRoutes({ ...base, [`POST /groups/${g}/shopping-list/prices`]: () => res }));
    await renderWithProviders(<PricesScreen />);
    await screen.findByText("$34–$41");
    expect(screen.getByText(/Cheerios · \$3\.50–\$4\.99/)).toBeTruthy();
    expect(screen.getByText("✨ AI estimate from web search")).toBeTruthy();
  });

  it("asks for a ZIP code first when the profile has none", async () => {
    apiMock.mockImplementation(apiRoutes({ ...base, "PATCH /me": (b) => ({ ...testUser, ...(b as object) }) }));
    await renderWithProviders(<PricesScreen />, { auth: { user: { ...testUser, zipCode: null } } });
    await fireEvent.changeText(screen.getByLabelText("ZIP code"), "64105");
    await fireEvent.press(screen.getByText("Save and estimate"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/me", { method: "PATCH", body: { zipCode: "64105" } }));
    expect(apiMock).not.toHaveBeenCalledWith(`/groups/${g}/shopping-list/prices`, expect.anything());
  });
});
