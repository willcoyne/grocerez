import type { PricesResponse } from "@contracts/ai";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api } from "@/api/client";
import PricesScreen from "@/app/prices";
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

// The old one-call "What can we cook?" recipes screen was retired (spec §11); the Pantry Agent tests cover meals.

describe("Prices", () => {
  it("renders the total, per-item prices, and which ones come from BLS regional data vs AI estimates", async () => {
    const res: PricesResponse = {
      zipCode: "64105",
      items: [
        { itemId: "a", name: "Cheerios", lowCents: 350, highCents: 499, typicalCents: 399, unit: null, sources: [], basis: "ai_estimate", estimate: true, cached: false, fetchedAt: new Date().toISOString() },
        { itemId: "b", name: "Milk", lowCents: 299, highCents: 459, typicalCents: 349, unit: "1 gal", sources: ["https://data.bls.gov/timeseries/APU0200709112"], basis: "regional_average", estimate: true, cached: false, fetchedAt: new Date().toISOString() },
      ],
      missingItemIds: [],
      totalLowCents: 649,
      totalHighCents: 958,
    };
    apiMock.mockImplementation(apiRoutes({ ...base, [`POST /groups/${g}/shopping-list/prices`]: () => res }));
    await renderWithProviders(<PricesScreen />);
    await screen.findByText("About $7.48");
    expect(screen.getByText(/Range \$6–\$10 · 2 items priced, 1 from BLS regional data/)).toBeTruthy();
    expect(screen.getByText(/Cheerios · ~\$3\.99/)).toBeTruthy();
    expect(screen.getByText("Usually $3.50–$4.99")).toBeTruthy();
    expect(screen.getByText("BLS regional average")).toBeTruthy();
    expect(screen.getByText("Source: BLS average price series APU0200709112")).toBeTruthy();
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
