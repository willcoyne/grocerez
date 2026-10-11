import type { Item } from "@contracts/items";
import type { Preference } from "@contracts/preferences";
import { fireEvent, screen } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import { MyPreferences } from "@/components/MyPreferences";
import { apiRoutes, renderWithProviders, testGroup } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
const apiMock = api as jest.Mock;

const cheerios: Item = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Cheerios",
  normalizedName: "cheerios",
  category: "pantry",
  defaultAllergens: [],
  shelfLifeDays: 180,
};

describe("My preferences", () => {
  const pref: Preference = {
    id: "66666666-6666-4666-8666-666666666666",
    groupId: testGroup.id,
    userId: "u",
    itemId: cheerios.id,
    item: cheerios,
    user: { id: "u", displayName: "Carson" },
    quantityText: "2 boxes",
    recurrence: "staple",
    note: null,
    createdAt: "",
    updatedAt: "",
  };

  it("shows the On the list chip and rolls back a failed delete", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${testGroup.id}/preferences`]: () => [pref],
        [`GET /groups/${testGroup.id}/cabinet`]: () => [],
        [`GET /groups/${testGroup.id}/shopping-list`]: () => [{ itemId: cheerios.id }],
        [`DELETE /groups/${testGroup.id}/preferences/${pref.id}`]: () => {
          throw new ApiError(500, "INTERNAL", "boom");
        },
      }),
    );
    const { queryClient } = await renderWithProviders(<MyPreferences groupId={testGroup.id} />);
    await screen.findByText(/^Cheerios/);
    await screen.findByText("On the list");
    await fireEvent.press(screen.getByLabelText("Remove Cheerios"));
    await screen.findByText("boom");
    expect(queryClient.getQueryData<Preference[]>(keys.preferences(testGroup.id, "me"))).toHaveLength(1);
  });
});
