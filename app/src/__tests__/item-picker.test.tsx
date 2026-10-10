import type { Item } from "@contracts/items";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api } from "@/api/client";
import { ItemPickerBody } from "@/components/ItemPicker";
import { apiRoutes, renderWithProviders } from "@/test-utils";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: jest.fn(),
}));
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
        "GET /items/search": () => ({
          match: "suggested",
          results: [cheerios],
          related: [],
        }),
        "POST /items": () => cheerios,
      }),
    );
    const onPick = jest.fn();
    const onClose = jest.fn();
    await renderWithProviders(
      <ItemPickerBody onPick={onPick} onClose={onClose} />,
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search items"),
      "cherios",
    );
    await screen.findByText("Did you mean Cheerios?");
    expect(apiMock).toHaveBeenCalledWith(
      "/items/search",
      expect.objectContaining({ query: { q: "cherios" } }),
    );
    await fireEvent.press(screen.getByTestId("suggest-banner-yes"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(cheerios));
    expect(apiMock).toHaveBeenCalledWith("/items", {
      method: "POST",
      body: { name: "cherios", aliasOf: cheerios.id },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("no match → Create 'X' asks for a category", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        "GET /items/search": () => ({
          match: "none",
          results: [],
          related: [],
        }),
        "POST /items": (body) => ({
          ...cheerios,
          name: (body as { name: string }).name,
        }),
      }),
    );
    const onPick = jest.fn();
    await renderWithProviders(
      <ItemPickerBody onPick={onPick} onClose={jest.fn()} />,
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search items"),
      "dragonfruit",
    );
    await fireEvent.press(await screen.findByText('Create "dragonfruit"'));
    await fireEvent.press(screen.getByLabelText("Produce"));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith("/items", {
      method: "POST",
      body: { name: "dragonfruit", category: "produce" },
    });
  });
  it('semantically related items show under "Related items" and can be picked', async () => {
    const oreos: Item = {
      ...cheerios,
      id: "66666666-6666-4666-8666-666666666666",
      name: "Oreos",
      normalizedName: "oreo",
      category: "snacks",
    };
    const cookies: Item = {
      ...cheerios,
      id: "77777777-7777-4777-8777-777777777777",
      name: "Cookies",
      normalizedName: "cookie",
      category: "snacks",
    };
    apiMock.mockImplementation(
      apiRoutes({
        "GET /items/search": () => ({
          match: "exact",
          results: [oreos],
          related: [cookies],
        }),
      }),
    );
    const onPick = jest.fn();
    await renderWithProviders(
      <ItemPickerBody onPick={onPick} onClose={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByLabelText("Search items"), "oreo");
    await screen.findByText("Related items");
    await fireEvent.press(screen.getByLabelText("Add Cookies"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(cookies));
  });
});
