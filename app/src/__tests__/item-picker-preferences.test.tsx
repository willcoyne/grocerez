import type { Item } from "@contracts/items";
import type { Preference } from "@contracts/preferences";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import { ItemPickerBody } from "@/components/ItemPicker";
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

describe("ItemPicker", () => {
  it('typing "cherios" offers Cheerios; Yes saves the alias and returns Cheerios', async () => {
    apiMock.mockImplementation(
      apiRoutes({
        "GET /items/search": () => ({ match: "suggested", results: [cheerios] }),
        "POST /items": () => cheerios,
      }),
    );
    const onPick = jest.fn();
    const onClose = jest.fn();
    await renderWithProviders(<ItemPickerBody onPick={onPick} onClose={onClose} />);
    await fireEvent.changeText(screen.getByLabelText("Search items"), "cherios");
    await screen.findByText(/Did you mean/);
    expect(apiMock).toHaveBeenCalledWith("/items/search", expect.objectContaining({ query: { q: "cherios" } }));
    await fireEvent.press(screen.getByLabelText("Yes, Cheerios"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(cheerios));
    expect(apiMock).toHaveBeenCalledWith("/items", { method: "POST", body: { name: "cherios", aliasOf: cheerios.id } });
    expect(onClose).toHaveBeenCalled();
  });

  it("no match → Create 'X' asks for a category", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        "GET /items/search": () => ({ match: "none", results: [] }),
        "POST /items": (body) => ({ ...cheerios, name: (body as { name: string }).name }),
      }),
    );
    const onPick = jest.fn();
    await renderWithProviders(<ItemPickerBody onPick={onPick} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText("Search items"), "dragonfruit");
    await fireEvent.press(await screen.findByText(/Create “dragonfruit”/));
    await fireEvent.press(screen.getByLabelText("Produce"));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith("/items", { method: "POST", body: { name: "dragonfruit", category: "produce" } });
  });
});

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

  it("shows In cabinet / On list tags and rolls back a failed delete", async () => {
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
    await screen.findByText("On list");
    await fireEvent.press(screen.getByLabelText("Delete Cheerios"));
    await screen.findByText("boom");
    expect(queryClient.getQueryData<Preference[]>(keys.preferences(testGroup.id, "me"))).toHaveLength(1);
  });
});
