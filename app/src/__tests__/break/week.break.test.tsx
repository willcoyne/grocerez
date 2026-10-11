import type { AgentRun, PlanMeal } from "@contracts/agent";
import type { MealPlanResponse, PlannedMeal } from "@contracts/mealPlan";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import demoRunJson from "../../../../server/test/fixtures/agent/demo-run.json";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import { WeekSheet } from "@/features/week/WeekSheet";
import { confirm } from "@/lib/confirm";
import { handleSocketEvent } from "@/realtime/SocketProvider";
import { apiRoutes, makeTestQueryClient, renderWithProviders, testGroup, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }), useFocusEffect: jest.fn() }));
const apiMock = api as jest.Mock;
const confirmMock = confirm as jest.Mock;

const g = testGroup.id;
const demoRun = demoRunJson as AgentRun;
const meals = (): PlanMeal[] => JSON.parse(JSON.stringify(demoRun.plan!.meals));
const planned = (id: string, date: string, meal: PlanMeal, warnings: PlannedMeal["warnings"] = []): PlannedMeal => ({
  id, groupId: g, date, slot: "dinner", meal: { ...meal, date }, agentRunId: null, safety: null, warnings, createdBy: testUser.id, createdAt: "", updatedAt: "",
});
const ID = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
const week = (list: PlannedMeal[], expiring: MealPlanResponse["expiring"] = []): MealPlanResponse => ({
  from: "2026-10-12", to: "2026-10-18", today: "2026-10-12", meals: list, expiring,
});
const item = (n: number, name: string, expiresAt: string, daysLeft: number, plannedOn: string | null = null, plannedMealId: string | null = null) => ({
  cabinetItemId: `cccccccc-0000-4000-8000-00000000000${n}`, name, expiresAt, daysLeft, plannedOn, plannedMealId,
});
const render = () => renderWithProviders(<WeekSheet visible groupId={g} onClose={jest.fn()} />);
const startCalls = () => apiMock.mock.calls.filter(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST");

afterEach(() => jest.clearAllMocks());

describe("BREAK week: stale Use soon / warnings after cabinet changes", () => {
  it("cabinet:changed socket event also refreshes the meal plan (expiring + warnings are computed from the cabinet)", () => {
    const qc = makeTestQueryClient();
    const spy = jest.spyOn(qc, "invalidateQueries");
    handleSocketEvent(qc, "cabinet:changed", { groupId: g, by: "u" });
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(keys.mealPlans(g));
  });
});

describe("BREAK week: Use soon", () => {
  it("'Plan a dinner with these' still works when every day is planned (it must not be a dead disabled button)", async () => {
    const full = DAYS.map((d, i) => planned(ID(i), d, meals()[i % 3]));
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week(full, [item(1, "Spinach", "2026-10-14", 2)]),
        [`POST /groups/${g}/agent/runs`]: () => new Promise(() => {}),
      }),
    );
    await render();
    const btn = await screen.findByTestId("week-use-soon-plan");
    expect(btn).not.toBeDisabled();
    await fireEvent.press(btn);
    expect(startCalls()).toHaveLength(1);
  });
});

describe("BREAK week: Move day", () => {
  it("moving onto a taken day swaps: the partner dinner that moves LATER past its own deadline is confirmed too", async () => {
    const A = planned(ID(1), "2026-10-12", meals()[0]); // Mon, uses Spinach which expires Tue
    const B = planned(ID(3), "2026-10-14", meals()[2]); // Wed
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([A, B], [item(1, "Spinach", "2026-10-13", 1, "2026-10-12", A.id)]),
        [`PATCH /groups/${g}/meal-plan/${B.id}`]: () => ({ ...B, date: "2026-10-12" }),
      }),
    );
    await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-14"));
    await fireEvent.press(screen.getByTestId("week-card-move"));
    await fireEvent.press(screen.getByLabelText("Monday, October 12")); // swap: A lands on Wed, after Spinach expires
    await act(async () => {});
    expect(confirmMock).toHaveBeenCalled();
    expect(JSON.stringify(confirmMock.mock.calls[0])).toMatch(/Spinach/);
  });

  it("with several used items expiring before the target day, the confirm names all of them", async () => {
    const warns = [
      { kind: "expires_before" as const, item: "Spinach", expiresAt: "2026-10-13" },
      { kind: "expires_before" as const, item: "Chicken", expiresAt: "2026-10-14" },
    ];
    const A = planned(ID(1), "2026-10-12", meals()[0], warns);
    apiMock.mockImplementation(
      apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([A]), [`PATCH /groups/${g}/meal-plan/${A.id}`]: () => A }),
    );
    await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-12"));
    await fireEvent.press(screen.getByTestId("week-card-move"));
    await fireEvent.press(screen.getByLabelText("Saturday, October 17"));
    await act(async () => {});
    const text = JSON.stringify(confirmMock.mock.calls[0]);
    expect(text).toMatch(/Spinach/);
    expect(text).toMatch(/Chicken expires/);
  });
});

describe("BREAK week: a proposal is on the sheet", () => {
  const proposedRun = (): AgentRun => {
    const base = JSON.parse(JSON.stringify(demoRun)) as AgentRun;
    const m = meals().slice(0, 2).map((x, i) => ({ ...x, date: ["2026-10-13", "2026-10-15"][i] }));
    return { ...base, userId: testUser.id, status: "proposed", updatedAt: new Date().toISOString(), plan: { ...base.plan!, meals: m } };
  };
  const { steps: _s, ...summary } = proposedRun();
  function routes(extra: Record<string, (b: unknown) => unknown> = {}) {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([]),
        [`GET /groups/${g}/agent/runs`]: () => [summary],
        [`GET /groups/${g}/agent/runs/${demoRun.id}`]: () => proposedRun(),
        ...extra,
      }),
    );
  }

  it("other empty days can't silently start a new run and throw the unsaved proposal away", async () => {
    routes({ [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }) });
    await render();
    await screen.findByTestId("week-save");
    await fireEvent.press(screen.getByTestId("week-plan-day-2026-10-16"));
    expect(startCalls()).toHaveLength(0);
  });

  it("Discard is disabled while the save is in flight (otherwise it reads as discarded but still saves)", async () => {
    routes({ [`POST /groups/${g}/agent/runs/${demoRun.id}/apply`]: () => new Promise(() => {}) });
    await render();
    await fireEvent.press(await screen.findByTestId("week-save"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/agent/runs/${demoRun.id}/apply`, expect.anything()));
    expect(screen.getByTestId("week-discard")).toBeDisabled();
  });
});
