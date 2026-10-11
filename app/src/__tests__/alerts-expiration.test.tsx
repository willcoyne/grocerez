import type { AlertsResponse } from "@contracts/alerts";
import type { CabinetItem } from "@contracts/cabinet";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api } from "@/api/client";
import { AlertsSection } from "@/components/AlertsSection";
import { expirationText } from "@/lib/format";
import { plannedReminders, reminderDate } from "@/notifications/expirations";
import { apiRoutes, renderWithProviders, testGroup } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-notifications", () => ({}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));
const apiMock = api as jest.Mock;
const g = testGroup.id;

function cab(id: string, name: string, expiresAt: string | null): CabinetItem {
  return {
    id,
    groupId: g,
    itemId: `i-${id}`,
    item: { id: `i-${id}`, name, category: "dairy" },
    product: null,
    allergens: [],
    status: "in_stock",
    quantityText: null,
    location: "fridge",
    purchasedAt: null,
    expiresAt,
    expirationSource: expiresAt ? "estimated" : null,
    photoUrl: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("expiration reminders", () => {
  it("fires at 9am the day before", () => {
    const d = reminderDate("2026-10-14");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 13, 9]);
  });

  it("keeps future reminders only, soonest first, at most 20", () => {
    const now = new Date(2026, 9, 10, 12);
    const items = [cab("past", "Old", "2026-10-10"), cab("none", "Salt", null)];
    for (let i = 0; i < 25; i++) items.push(cab(`f${i}`, `Food ${i}`, `2026-11-${String(i + 2).padStart(2, "0")}`));
    const plan = plannedReminders(items, now);
    expect(plan).toHaveLength(20);
    expect(plan[0].item.item.name).toBe("Food 0");
    expect(plan.some((p) => p.item.id === "past")).toBe(false);
  });

  it("labels estimated vs manual dates", () => {
    expect(expirationText({ expiresAt: "2026-10-14", expirationSource: "estimated" })).toBe("Expires Oct 14 (estimated)");
    expect(expirationText({ expiresAt: "2026-10-14", expirationSource: "manual" })).toBe("Expires Oct 14 (you set this)");
  });
});

describe("Alerts", () => {
  it("shows the seeded recall with 'may match' copy and dismisses it", async () => {
    const data: AlertsResponse = {
      expiring: [cab("m", "Milk", "2026-10-11")],
      recalls: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          score: 0.7,
          createdAt: "",
          label: "possible match, check your package",
          cabinetItem: { id: "c", itemId: "i", name: "Cheerios", brand: "General Mills" },
          recall: {
            id: "r",
            source: "openfda",
            externalId: "F-0001-2026",
            productDescription: "Honey Nut Cheerios 10.8 oz",
            reason: "Undeclared almonds",
            classification: "Class II",
            firm: "General Mills",
            distribution: null,
            reportDate: "2026-10-01",
            status: "Ongoing",
            url: null,
          },
        },
      ],
    };
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/alerts`]: () => data,
        [`POST /groups/${g}/alerts/recalls/${data.recalls[0].id}/dismiss`]: () => {
          data.recalls = [];
          return undefined;
        },
      }),
    );
    await renderWithProviders(<AlertsSection groupId={g} />);
    await screen.findByText("Alerts (2)");
    expect(screen.getByText(/match your General Mills Cheerios/)).toBeTruthy();
    expect(screen.getByText("Reason: Undeclared almonds")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Dismiss recall alert for Cheerios"));
    await waitFor(() => expect(screen.queryByText(/Possible recall/)).toBeNull());
    expect(screen.getByText("Alerts (1)")).toBeTruthy();
  });
});
