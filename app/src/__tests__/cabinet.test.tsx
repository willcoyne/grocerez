import type { CabinetItem } from "@contracts/cabinet";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api } from "@/api/client";
import CabinetScreen from "@/app/(tabs)/cabinet";
import { confirm } from "@/lib/confirm";
import { apiRoutes, renderWithProviders, testGroup } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
const apiMock = api as jest.Mock;

const g = testGroup.id;
const oreos: CabinetItem = {
  id: "77777777-7777-4777-8777-777777777777",
  groupId: g,
  itemId: "88888888-8888-4888-8888-888888888888",
  item: { id: "88888888-8888-4888-8888-888888888888", name: "Oreos", category: "snacks" },
  product: null,
  status: "in_stock",
  quantityText: null,
  location: "pantry",
  purchasedAt: null,
  expiresAt: "2099-01-01",
  expirationSource: "estimated",
  photoUrl: null,
  addedBy: null,
  createdAt: "",
  updatedAt: "",
};

describe("Cabinet", () => {
  it("ran out removes the row; when nobody wants it, offers to add it to the list anyway", async () => {
    let cabinet = [oreos];
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/cabinet`]: () => cabinet,
        [`GET /groups/${g}/alerts`]: () => ({ expiring: [], recalls: [] }),
        [`POST /groups/${g}/cabinet/${oreos.id}/ran-out`]: () => {
          cabinet = [];
          return { requeued: false };
        },
        [`POST /groups/${g}/shopping-list`]: () => ({}),
      }),
    );
    await renderWithProviders(<CabinetScreen />);
    await screen.findByText(/^Oreos/);
    expect(screen.getByLabelText("Exp Jan 1, estimated")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Actions for Oreos"));
    await fireEvent.press(screen.getByText("Ran out"));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list`, { method: "POST", body: { itemId: oreos.itemId } }),
    );
    await screen.findByText("Your cabinet is empty");
  });

  it("running low keeps the item and shows the Low · on list chip", async () => {
    let row = oreos;
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/cabinet`]: () => [row],
        [`GET /groups/${g}/alerts`]: () => ({ expiring: [], recalls: [] }),
        [`PATCH /groups/${g}/cabinet/${oreos.id}`]: () => (row = { ...oreos, status: "running_low" }),
      }),
    );
    await renderWithProviders(<CabinetScreen />);
    await fireEvent.press(await screen.findByLabelText("Actions for Oreos"));
    await fireEvent.press(screen.getByText("Running low"));
    await screen.findByText("Low · on list");
  });
});
