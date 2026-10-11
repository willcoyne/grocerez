import type { AgentRun, PlanMeal } from "@contracts/agent";
import type { MealPlanResponse, PlannedMeal } from "@contracts/mealPlan";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import demoRunJson from "../../../server/test/fixtures/agent/demo-run.json";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import { weekNoteLines, WEEK_FALLBACK } from "@/features/pantry/scene/exterior/list";
import { safetyStatus } from "@/components/AgentMealCard";
import { datesToPlan, weekPreviewLines } from "@/features/week/weekDates";
import { WeekSheet } from "@/features/week/WeekSheet";
import { confirm } from "@/lib/confirm";
import { handleSocketEvent } from "@/realtime/SocketProvider";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
const apiMock = api as jest.Mock;

const g = testGroup.id;
const demoRun = demoRunJson as AgentRun;
const meals = (): PlanMeal[] => JSON.parse(JSON.stringify(demoRun.plan!.meals));
const RUN_ID = demoRun.id;
const runPath = `/groups/${g}/agent/runs/${RUN_ID}`;

/** Mon Oct 12 … Sun Oct 18 2026. Lemon chicken (cited, needs Lemons) on Mon, stir fry (AI-created, needs Ginger) on Wed. */
function planned(id: string, date: string, meal: PlanMeal): PlannedMeal {
  return {
    id,
    groupId: g,
    date,
    slot: "dinner",
    safety: null,
    meal: { ...meal, date },
    agentRunId: null,
    warnings: [],
    createdBy: testUser.id,
    createdAt: "",
    updatedAt: "",
  };
}
const MON = planned("aaaaaaaa-0000-4000-8000-000000000001", "2026-10-12", meals()[0]);
const WED = planned("aaaaaaaa-0000-4000-8000-000000000003", "2026-10-14", meals()[2]);
const week = (list: PlannedMeal[], expiring: MealPlanResponse["expiring"] = []): MealPlanResponse => ({
  from: "2026-10-12",
  to: "2026-10-18",
  today: "2026-10-12",
  meals: list,
  expiring,
});

async function settle(qc: QueryClient) {
  await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0));
  await act(() => new Promise<void>((r) => setTimeout(r, 0)));
}

function render() {
  return renderWithProviders(<WeekSheet visible groupId={g} onClose={jest.fn()} />);
}

describe("saved-meal safety chip", () => {
  it("shows the stored problems and unknowns, not an assumed pass", () => {
    const bad = safetyStatus({ title: "x", passes: false, unknown: [], problems: [{ ingredient: "Peanuts", reason: "contains peanuts" }] });
    expect(bad).toMatchObject({ label: "Didn't pass the safety check", problems: ["Peanuts: contains peanuts"] });
    expect(safetyStatus({ title: "x", passes: true, unknown: ["Mystery sauce"] })).toMatchObject({
      label: "Safe for everyone",
      unknown: ["Mystery sauce"],
    });
  });
});

describe("Week note on the pantry door (preview)", () => {
  it("previews the next 3 days with a dash for empty ones; the 3D note falls back while loading", () => {
    const lines = weekPreviewLines(week([MON, WED]));
    expect(lines).toEqual(["Mon  Lemon garlic chicken with spinach rice", "Tue  —", "Wed  Chicken and pepper stir fry"]);
    expect(weekNoteLines(lines)).toEqual(["Mon Lemon ga..", "Tue —", "Wed Chicken.."]);
    expect(weekPreviewLines(undefined)).toEqual([]);
    expect(weekNoteLines([])).toEqual(WEEK_FALLBACK);
  });

  it("'Plan our week' targets the first 3 open days, or re-plans the first 3 when the week is full", () => {
    const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
    const someTaken = new Map([
      ["2026-10-12", 1],
      ["2026-10-14", 1],
    ]);
    expect(datesToPlan(dates, someTaken)).toEqual(["2026-10-13", "2026-10-15", "2026-10-16"]);
    const allTaken = new Map([
      ["2026-10-12", 1],
      ["2026-10-13", 1],
    ]);
    expect(datesToPlan(dates.slice(0, 2), allTaken)).toEqual(["2026-10-12", "2026-10-13"]);
  });
});

describe("Week sheet", () => {
  it("shows the range and counts, a section per day, planned rows with citation / AI-created, and empty days", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON, WED]) }));
    await render();
    expect(await screen.findByText("Oct 12–18")).toBeTruthy();
    expect(screen.getByTestId("week-summary").props.children).toBe("2 dinners planned · 2 to buy");
    for (const d of ["MON 12", "TUE 13", "WED 14", "THU 15", "FRI 16", "SAT 17", "SUN 18"]) expect(screen.getByText(d)).toBeTruthy();

    // Planned (cited): title, time, "Example Kitchen ↗" opens the recipe, "uses …".
    expect(screen.getByText("Lemon garlic chicken with spinach rice")).toBeTruthy();
    expect(screen.getByText("35 min · uses chicken breast, spinach, rice")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("week-cite-2026-10-12"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(MON.meal.source!.url);
    // Planned (no source): labelled AI-created.
    expect(screen.getByLabelText("AI-created recipe")).toBeTruthy();
    // Empty days offer "+ Plan a dinner"; the bottom button says Re-plan once days are planned.
    expect(screen.getByLabelText("Plan a dinner for Tuesday, October 13")).toBeTruthy();
    expect(screen.getAllByText("Plan a dinner")).toHaveLength(5);
    expect(screen.getByText("Re-plan")).toBeTruthy();
  });

  it("an empty week says 'Plan our week'; '+ Plan a dinner' starts a run for that one date", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([]),
        [`POST /groups/${g}/agent/runs`]: () => new Promise(() => {}),
      }),
    );
    await render();
    expect(await screen.findByText("Plan our week")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Plan a dinner for Thursday, October 15"));
    const start = apiMock.mock.calls.find(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST");
    expect(start?.[1].body).toMatchObject({ dates: ["2026-10-15"], budgetCents: 6000 });
    expect(start?.[1].body.replacePlannedMealId).toBeUndefined();
    // While it starts, that day shows "Finding a recipe…" and the steps area appears.
    expect(await screen.findByTestId("week-finding-2026-10-15")).toBeTruthy();
    expect(screen.getByTestId("week-agent-lines")).toBeTruthy();
  });
});

describe("Recipe card (tap a day)", () => {
  function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
    return apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON, WED]), ...extra });
  }

  it("opens the paper card with the meal (photo, citation, safety) and Move day → PATCH {date}", async () => {
    apiMock.mockImplementation(routes({ [`PATCH /groups/${g}/meal-plan/${MON.id}`]: () => ({ ...MON, date: "2026-10-16" }) }));
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-12"));
    expect(screen.getByTestId("week-card")).toBeTruthy();
    expect(screen.getByTestId("agent-meal-photo")).toBeTruthy();
    expect(screen.getByText("Recipe from Example Kitchen ↗")).toBeTruthy();
    expect(screen.getByLabelText("Household safety check: Safe for everyone")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("week-card-move"));
    expect(screen.getByLabelText("Monday, October 12")).toBeDisabled(); // its own day
    await fireEvent.press(screen.getByLabelText("Friday, October 16"));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/meal-plan/${MON.id}`, { method: "PATCH", body: { date: "2026-10-16" } }),
    );
    expect(await screen.findByText("Moved Lemon garlic chicken with spinach rice to Fri")).toBeTruthy();
    expect(screen.queryByTestId("week-card")).toBeNull();
    await settle(queryClient);
  });

  it("Remove asks first, then DELETEs", async () => {
    apiMock.mockImplementation(routes({ [`DELETE /groups/${g}/meal-plan/${WED.id}`]: () => undefined }));
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-14"));
    await fireEvent.press(screen.getByTestId("week-card-remove"));
    expect(confirm).toHaveBeenCalledWith("Remove Chicken and pepper stir fry?", "Wednesday, October 14 goes back to empty.", "Remove", true);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/meal-plan/${WED.id}`, { method: "DELETE" }));
    expect(await screen.findByText("Removed Chicken and pepper stir fry")).toBeTruthy();
    await settle(queryClient);
  });

  it("Add missing to List posts add-missing and toasts added / skipped", async () => {
    apiMock.mockImplementation(
      routes({
        [`POST /groups/${g}/meal-plan/${MON.id}/add-missing`]: () => ({ added: 1, skipped: [{ name: "Olive Oil", reason: "in_cabinet" }] }),
      }),
    );
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-12"));
    await fireEvent.press(screen.getByTestId("week-card-add-missing"));
    expect(await screen.findByText("Added 1 item to the list · 1 skipped (already have)")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/meal-plan/${MON.id}/add-missing`, { method: "POST", body: {} });
    await settle(queryClient);
  });

  it("Swap starts a run for that date with replacePlannedMealId and closes the card", async () => {
    apiMock.mockImplementation(routes({ [`POST /groups/${g}/agent/runs`]: () => new Promise(() => {}) }));
    await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-14"));
    await fireEvent.press(screen.getByTestId("week-card-swap"));
    const start = apiMock.mock.calls.find(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST");
    expect(start?.[1].body).toMatchObject({ dates: ["2026-10-14"], replacePlannedMealId: WED.id });
    expect(start?.[1].body.prompt).toMatch(/^Find a different dinner for Wed\./);
    expect(screen.queryByTestId("week-card")).toBeNull();
    expect(await screen.findByTestId("week-finding-2026-10-14")).toBeTruthy();
  });
});

describe("Agent run on the Week sheet", () => {
  it("Plan our week: steps as lines, days fill from previews, then the proposal saves the week", async () => {
    const open = ["2026-10-13", "2026-10-15", "2026-10-16"];
    const base = { ...JSON.parse(JSON.stringify(demoRun)), userId: testUser.id } as AgentRun;
    let current: AgentRun = {
      ...base,
      status: "running",
      plan: null,
      meta: null,
      steps: [
        { ...base.steps[1], status: "done" },
        {
          seq: 4,
          id: "find_recipe",
          label: "Found Tuesday's dinner",
          status: "running",
          preview: { date: "2026-10-13", title: "Spinach quesadillas", site: "Example Kitchen" },
          at: base.steps[4].at,
        },
      ],
    };
    const proposedMeals = meals()
      .slice(0, 3)
      .map((m, i) => ({ ...m, date: open[i] }));
    const proposed: AgentRun = { ...base, status: "proposed", plan: { ...base.plan!, meals: proposedMeals } };
    let plan = week([MON, WED]);
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => plan,
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: RUN_ID }),
        [`GET ${runPath}`]: () => current,
        [`POST ${runPath}/apply`]: () => {
          plan = week([MON, WED, ...proposedMeals.map((m, i) => planned(`bbbbbbbb-0000-4000-8000-00000000000${i}`, open[i], m))]);
          return { added: 6, skipped: [], items: [], planned: 3 };
        },
      }),
    );
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByText("Re-plan"));
    const start = apiMock.mock.calls.find(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST");
    expect(start?.[1].body).toMatchObject({ dates: open });

    // Handwritten step lines, and Tuesday pencilled in from the step preview before anything is proposed.
    expect(await screen.findByLabelText("Found Tuesday's dinner, in progress")).toBeTruthy();
    expect(screen.getByLabelText("14 items · using up: spinach (2 days), chicken (3 days), done")).toBeTruthy();
    expect(screen.getByTestId("week-preview-2026-10-13")).toBeTruthy();
    expect(screen.getByText("Spinach quesadillas")).toBeTruthy();
    expect(screen.getByText("found on Example Kitchen…")).toBeTruthy();
    expect(screen.getByTestId("week-finding-2026-10-15")).toBeTruthy();
    expect(screen.getByTestId("week-plan")).toBeDisabled();

    // Proposed (socket signal → refetch): the meals sit in their days, not saved yet, with the confirm bar.
    current = proposed;
    await act(async () => handleSocketEvent(queryClient, "agent:changed", { groupId: g, by: "u", runId: RUN_ID }));
    expect(await screen.findByText("Add 6 items & save week")).toBeTruthy();
    expect(screen.getAllByText("· Proposed, not saved yet")).toHaveLength(3);
    expect(screen.queryByTestId("week-agent-lines")).toBeNull();

    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    await fireEvent.press(screen.getByText("Add 6 items & save week"));
    expect(await screen.findByText("Saved 3 dinners · added 6 items")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(`${runPath}/apply`, { method: "POST", body: {} });
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(expect.arrayContaining([keys.mealPlans(g), keys.shoppingList(g)]));
    // Rows become saved: no "proposed" marks, the counts include the new dinners.
    await waitFor(() => expect(screen.queryByText("· Proposed, not saved yet")).toBeNull());
    // To buy = each planned dinner's missing items: Mon 1 + Wed 1 + new Tue 1, Thu 2, Fri 1.
    expect(screen.getByTestId("week-summary").props.children).toBe("5 dinners planned · 6 to buy");
    await settle(queryClient);
  });

  it("a run stuck past the server timeout reads as failed, with Try again", async () => {
    const stuck: AgentRun = {
      ...(JSON.parse(JSON.stringify(demoRun)) as AgentRun),
      status: "running",
      plan: null,
      meta: null,
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([]),
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: RUN_ID }),
        [`GET ${runPath}`]: () => stuck,
      }),
    );
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByText("Plan our week"));
    expect(await screen.findByText("The agent took too long.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
    await settle(queryClient);
  });

  it("503 NOT_CONFIGURED says the planner isn't set up (no Try again)", async () => {
    const { ApiError } = jest.requireActual("@/api/client") as typeof import("@/api/client");
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([]),
        [`POST /groups/${g}/agent/runs`]: () => {
          throw new ApiError(503, "NOT_CONFIGURED", "x");
        },
      }),
    );
    await render();
    await fireEvent.press(await screen.findByText("Plan our week"));
    expect(await screen.findByText("The meal planner isn't set up on this server.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});

describe("Expiration-aware Week (spec §14)", () => {
  const item = (n: string, daysLeft: number, plannedOn: string | null, plannedMealId: string | null, i: number) => ({
    cabinetItemId: `cccccccc-0000-4000-8000-00000000000${i}`,
    name: n,
    expiresAt: "2026-10-14",
    daysLeft,
    plannedOn,
    plannedMealId,
  });
  const expiring = [item("Spinach", 2, MON.date, MON.id, 1), item("Milk", 1, null, null, 2), item("Yogurt", -1, null, null, 3)];

  it("Use soon lists planned, unplanned and expired rows; hidden when nothing expires", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON], expiring) }));
    const { queryClient } = await render();
    expect(await screen.findByText("USE SOON")).toBeTruthy();
    expect(screen.getByLabelText("Spinach, 2 days, planned Monday, October 12")).toBeTruthy();
    expect(screen.getByText("Spinach · 2 days")).toBeTruthy();
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Milk · tomorrow")).toBeTruthy();
    expect(screen.getByText("not planned")).toBeTruthy();
    expect(screen.getByLabelText("Yogurt, expired")).toBeTruthy();
    expect(screen.getByText("expired")).toBeTruthy();
    await settle(queryClient);
  });

  it("hides Use soon when nothing is expiring", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON]) }));
    const { queryClient } = await render();
    await screen.findByText("Oct 12–18");
    expect(screen.queryByText("USE SOON")).toBeNull();
    await settle(queryClient);
  });

  it("'Plan a dinner with these' starts a run for the earliest free date", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([MON], expiring),
        [`POST /groups/${g}/agent/runs`]: () => new Promise(() => {}),
      }),
    );
    await render();
    await fireEvent.press(await screen.findByTestId("week-use-soon-plan"));
    const start = apiMock.mock.calls.find(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST");
    expect(start?.[1].body).toMatchObject({ dates: ["2026-10-13"] });
  });

  it("no action when everything usable is planned", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON], [expiring[0], expiring[2]]) }));
    await render();
    await screen.findByText("USE SOON");
    expect(screen.queryByTestId("week-use-soon-plan")).toBeNull();
  });

  const LATE = { ...WED, warnings: [{ kind: "expires_before" as const, item: "Spinach", expiresAt: "2026-10-11" }] };

  it("warning line on the row and chip on the card", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/meal-plan`]: () => week([MON, LATE]) }));
    await render();
    expect(await screen.findByLabelText("Warning: Spinach expires Sun")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("week-open-2026-10-14"));
    expect(screen.getByTestId("week-card-warning")).toBeTruthy();
  });

  it("Move day past a used item's expiry confirms first; declining does not move", async () => {
    const mockConfirm = confirm as jest.Mock;
    mockConfirm.mockClear();
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/meal-plan`]: () => week([MON], [item("Spinach", 2, MON.date, MON.id, 1)]),
        [`PATCH /groups/${g}/meal-plan/${MON.id}`]: () => ({ ...MON, date: "2026-10-16" }),
      }),
    );
    const { queryClient } = await render();
    await fireEvent.press(await screen.findByTestId("week-open-2026-10-12"));
    await fireEvent.press(screen.getByTestId("week-card-move"));
    mockConfirm.mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByLabelText("Friday, October 16"));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith("Spinach expires Wed 14. Move anyway?", expect.any(String), "Move anyway"));
    expect(apiMock.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(false);
    // Moving before the deadline needs no confirm.
    mockConfirm.mockClear();
    await fireEvent.press(screen.getByLabelText("Tuesday, October 13"));
    await waitFor(() => expect(apiMock.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true));
    expect(mockConfirm).not.toHaveBeenCalled();
    await settle(queryClient);
  });
});
