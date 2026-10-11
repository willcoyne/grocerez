import type { AgentRun, AgentRunSummary, ApplyAgentRunResponse } from "@contracts/agent";
import type { ShoppingListItem } from "@contracts/shoppingList";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import demoRunJson from "../../../server/test/fixtures/agent/demo-run.json";
import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import ListScreen from "@/app/(tabs)/index";
import GroupScreen from "@/app/(tabs)/group";
import AgentScreen, { DEFAULT_PROMPT, replayDelays } from "@/app/agent";
import { AgentMealCard } from "@/components/AgentMealCard";
import { handleSocketEvent } from "@/realtime/SocketProvider";
import { apiRoutes, renderWithProviders, testGroup } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));
jest.mock("@/notifications/expirations", () => ({ maybeAskNotificationPermission: jest.fn() }));
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));
const apiMock = api as jest.Mock;

/** The shared fixture (also validated by the server with zod and by the agent with pydantic). */
const demoRun = demoRunJson as AgentRun;
const g = testGroup.id;
const runPath = `/groups/${g}/agent/runs/${demoRun.id}`;
const clone = (): AgentRun => JSON.parse(JSON.stringify(demoRun));

beforeEach(() => {
  mockParams = {};
  Object.values(mockRouter).forEach((f) => f.mockReset());
});
afterEach(() => jest.useRealTimers());

/** Wait for trailing refetches (apply's onSettled, retries) so no update lands after the test ends. */
async function settle(qc: QueryClient) {
  await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0));
  // TanStack batches observer notifications on setTimeout(0): flush that inside act too.
  await act(() => new Promise<void>((r) => setTimeout(r, 0)));
}

describe("Pantry Agent sheet", () => {
  it("fixture belongs to the test household", () => {
    expect(demoRun.groupId).toBe(g);
  });

  it("compose → running steps → proposed (via agent:changed) → apply → toast and back to the list", async () => {
    let current: AgentRun = { ...clone(), status: "running", plan: null, meta: null, steps: clone().steps.slice(0, 2) };
    current.steps[1] = { ...current.steps[1], status: "running" };
    const proposed = clone();
    proposed.plan!.safety.perMeal[1].unknown = ["za'atar"];
    const applyRes: ApplyAgentRunResponse = { added: 6, skipped: [], items: [] };
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => current,
        [`POST ${runPath}/apply`]: () => applyRes,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);

    // Compose: prompt pre-filled, $60 budget preselected.
    expect(screen.getByDisplayValue(DEFAULT_PROMPT)).toBeTruthy();
    expect(screen.getByLabelText("Budget $60")).toBeChecked();
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/agent/runs`, {
      method: "POST",
      body: { prompt: DEFAULT_PROMPT, budgetCents: 6000 },
    });

    // Running: done step has a check, the current one a spinner; both say their status in words.
    expect(await screen.findByLabelText("Checking allergies: Carson (peanuts), Maya (milk), 4 people, done")).toBeTruthy();
    expect(screen.getByLabelText("14 items · using up: spinach (2 days), chicken (3 days), in progress")).toBeTruthy();
    expect(screen.getByLabelText("Close; the agent keeps working")).toBeTruthy();

    // The server finishes; the socket signal makes the screen refetch.
    current = proposed;
    await act(async () => handleSocketEvent(queryClient, "agent:changed", { groupId: g, by: "u", runId: demoRun.id }));
    expect(await screen.findByText("Add 6 items to the list")).toBeTruthy();
    expect(screen.getByText("Lemon garlic chicken with spinach rice")).toBeTruthy();
    expect(screen.getByText("Mon · 35 min · serves 4")).toBeTruthy();
    expect(screen.getByText("uses: Chicken Breast, Spinach, Rice, Garlic, Olive Oil · missing: Lemons")).toBeTruthy();
    expect(screen.getByText("✨ $38–$46 to buy · AI estimate")).toBeTruthy();
    expect(screen.getAllByText("✓ Safe for everyone")).toHaveLength(3);
    expect(screen.getByText("✓ Safe for everyone · couldn't verify: za'atar")).toBeTruthy();

    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    await fireEvent.press(screen.getByText("Add 6 items to the list"));
    expect(await screen.findByText("Added 6 items")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(`${runPath}/apply`, { method: "POST", body: {} });
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/");
    // This phone's list and the run are refetched (other phones get it via shopping-list:changed).
    const invalidated = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidated).toEqual(expect.arrayContaining([keys.shoppingList(g), keys.agentRun(g, demoRun.id)]));
    await settle(queryClient);
  });

  it("503 NOT_CONFIGURED on start says the planner isn't set up (no retry, no navigation)", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => {
          throw new ApiError(503, "NOT_CONFIGURED", "Agent not configured");
        },
      }),
    );
    await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(await screen.findByText("The meal planner isn't set up on this server")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Close"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("AGENT_UNAVAILABLE on start shows the failed state with retry", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => {
          throw new ApiError(503, "AGENT_UNAVAILABLE", "x");
        },
      }),
    );
    await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(await screen.findByText("The planning agent is offline right now.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("a failed run shows its message, Try again starts a new run, and Close dismisses", async () => {
    const failed: AgentRun = { ...clone(), status: "failed", plan: null, error: "Took too long" };
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => failed,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(await screen.findByText("Took too long")).toBeTruthy();

    await fireEvent.press(screen.getByText("Try again"));
    await waitFor(() => expect(apiMock.mock.calls.filter(([p, o]) => p === `/groups/${g}/agent/runs` && o?.method === "POST")).toHaveLength(2));

    await fireEvent.press(await screen.findByText("Close"));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(screen.queryByText("Use quick recipes instead")).toBeNull();
    await settle(queryClient);
  });

  it("apply rejected by the server's safety re-check shows an error toast and stays put", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => clone(),
        [`POST ${runPath}/apply`]: () => {
          throw new ApiError(422, "PLAN_UNSAFE", "unsafe");
        },
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await fireEvent.press(await screen.findByText("Add 6 items to the list"));
    expect(await screen.findByText("The server's safety check rejected this plan. Try planning again.")).toBeTruthy();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    await settle(queryClient);
  });
});

describe("Recorded-run replay", () => {
  it("caps each gap at 3 s", () => {
    const steps = [{ at: "2026-10-11T18:00:00.400Z" }, { at: "2026-10-11T18:00:09.800Z" }, { at: "2026-10-11T18:00:10.700Z" }];
    expect(replayDelays(steps, "2026-10-11T18:00:00.000Z")).toEqual([400, 3000, 900]);
  });

  it("replays the last applied run's steps with the recorded gaps (capped at 3 s), then shows the plan with Add disabled", async () => {
    // Fake timers: the replay is driven by setTimeout, so the test controls the clock instead of racing it.
    jest.useFakeTimers();
    mockParams = { replay: "1" };
    // The fixture's real timestamps: gaps 400, 700, 500, 400, 7800→3000, 900, 4500→3000, 1700 = 10.6 s replayed (16.9 s recorded).
    const applied: AgentRun = { ...clone(), status: "applied", appliedAt: demoRun.updatedAt };
    const { steps: _steps, ...summary } = applied;
    const older: AgentRunSummary = { ...summary, id: "99999999-9999-4999-8999-999999999999", status: "failed" };
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/agent/runs`]: () => [summary, older],
        [`GET ${runPath}`]: () => applied,
      }),
    );
    await renderWithProviders(<AgentScreen />);
    const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

    // Running state first: the first step spins until its recorded time (400 ms). findBy advances at most ~50 ms here.
    expect(await screen.findByText("Planning your week…")).toBeTruthy();
    expect(screen.getByLabelText("Checking allergies: Carson (peanuts), Maya (milk), 4 people, in progress")).toBeTruthy();
    expect(screen.queryByLabelText("Already added")).toBeNull();

    await advance(450);
    expect(screen.getByLabelText("Checking allergies: Carson (peanuts), Maya (milk), 4 people, done")).toBeTruthy();
    expect(screen.getByLabelText("14 items · using up: spinach (2 days), chicken (3 days), in progress")).toBeTruthy();

    // Just before the capped total (10.6 s) the last step is still spinning…
    await advance(10_400 - 450);
    expect(screen.getByLabelText("Plan ready, in progress")).toBeTruthy();
    expect(screen.queryByLabelText("Already added")).toBeNull();

    // …and just after it the plan shows (uncapped it would take 16.9 s).
    await advance(300);
    expect(screen.getByLabelText("Already added")).toBeDisabled();
    expect(screen.getByLabelText("Plan ready, done")).toBeTruthy();
    expect(screen.getByText("✨ AI agent · recorded run")).toBeTruthy();
    expect(screen.getByText("Lemon garlic chicken with spinach rice")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/agent/runs`, { query: { limit: 5 } });
  });

  it("with no recorded run, offers to plan live", async () => {
    mockParams = { replay: "1" };
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/agent/runs`]: () => [] }));
    await renderWithProviders(<AgentScreen />);
    expect(await screen.findByText("No recorded runs yet")).toBeTruthy();
  });
});

describe("Group tab entry point", () => {
  it("'Plan our week' opens the agent; long-press opens the replay (dev build); the old recipes link is gone", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
      }),
    );
    await renderWithProviders(<GroupScreen />);
    const plan = await screen.findByText("✨ Plan our week");
    await fireEvent.press(plan);
    expect(mockRouter.push).toHaveBeenCalledWith("/agent");
    await fireEvent(screen.getByLabelText("✨ Plan our week"), "longPress");
    expect(mockRouter.push).toHaveBeenCalledWith("/agent?replay=1");
    expect(screen.queryByText(/What can we cook/)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalledWith("/recipes");
  });
});

describe("Shopping list ✨ note chip", () => {
  it("shows the agent's note on the row, marked as AI", async () => {
    const row: ShoppingListItem = {
      id: "a1",
      groupId: g,
      itemId: "item-1",
      item: { id: "item-1", name: "Lemons", category: "produce" },
      reason: "manual",
      wantedBy: [],
      quantityText: null,
      allergenFlags: [],
      checked: false,
      checkedBy: null,
      checkedAt: null,
      scannedProductId: null,
      addedBy: null,
      note: "✨ for Lemon garlic chicken with spinach rice",
      createdAt: "",
      updatedAt: "",
    };
    const plain: ShoppingListItem = { ...row, id: "a2", itemId: "item-2", item: { id: "item-2", name: "Oreos", category: "snacks" }, note: null };
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [row, plain],
        [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
      }),
    );
    await renderWithProviders(<ListScreen />);
    expect(await screen.findByText("✨ for Lemon garlic chicken with spinach rice")).toBeTruthy();
    expect(screen.getByLabelText("AI note: for Lemon garlic chicken with spinach rice")).toBeTruthy();
    expect(screen.getAllByLabelText(/^AI note:/)).toHaveLength(1);
  });
});

describe("Meal cards (cited web recipes, spec §11)", () => {
  const meals = clone().plan!.meals;
  const pass = (title: string) => ({ title, passes: true, unknown: [] });

  it("a sourced meal shows the photo, ingredient lines (5 then 'Show all'), our steps, and a citation that opens the page", async () => {
    const meal = meals[0];
    await renderWithProviders(<AgentMealCard meal={meal} safety={pass(meal.title)} />);
    expect(screen.getByTestId("agent-meal-photo")).toBeTruthy();
    expect(screen.getByLabelText(`Photo of ${meal.source!.title}`)).toBeTruthy();
    expect(screen.getByText("Mon · 35 min · serves 4")).toBeTruthy();
    expect(screen.queryByText("✨ AI-created recipe")).toBeNull();

    // Ingredient lines with quantities: 5 shown, the 6th behind "Show all 6".
    expect(screen.getByText("• 1.5 lb chicken breast")).toBeTruthy();
    expect(screen.getByText("• 1 lemon, juiced")).toBeTruthy();
    expect(screen.queryByText("• 2 tbsp olive oil")).toBeNull();
    await fireEvent.press(screen.getByText("Show all 6"));
    expect(screen.getByText("• 2 tbsp olive oil")).toBeTruthy();

    // Our own short steps, not the site's.
    expect(screen.getByText("1. Cook the rice.")).toBeTruthy();

    const link = screen.getByLabelText("Open the full recipe on Example Kitchen");
    expect(link.props.accessibilityRole).toBe("link");
    expect(screen.getByText("Recipe from Example Kitchen ↗")).toBeTruthy();
    await fireEvent.press(link);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(meal.source!.url);
  });

  it("a sourced meal without an image shows no photo, and the site's own title when it differs", async () => {
    const meal = meals[1];
    await renderWithProviders(<AgentMealCard meal={meal} safety={pass(meal.title)} />);
    expect(screen.queryByTestId("agent-meal-photo")).toBeNull();
    expect(screen.getByText("“Black Bean Spinach Quesadillas”")).toBeTruthy();
    expect(screen.getByText("Recipe from Example Kitchen ↗")).toBeTruthy();
    expect(screen.getByText("• 8 flour tortillas")).toBeTruthy();
  });

  it("five or fewer ingredient lines show without a 'Show all' button", async () => {
    const meal = { ...meals[1], ingredientLines: meals[1].ingredientLines.slice(0, 5) };
    await renderWithProviders(<AgentMealCard meal={meal} safety={pass(meal.title)} />);
    expect(screen.getByText("• 1/2 cup salsa")).toBeTruthy();
    expect(screen.queryByText(/Show all/)).toBeNull();
  });

  it("an unsourced meal is labeled AI-created and shows the generic ingredients, with no citation", async () => {
    const meal = meals[2];
    expect(meal.source).toBeNull();
    await renderWithProviders(<AgentMealCard meal={meal} safety={pass(meal.title)} />);
    expect(screen.getByText("✨ AI-created recipe")).toBeTruthy();
    expect(screen.getByLabelText("AI-created recipe, generated by AI")).toBeTruthy();
    expect(screen.getByText(`Ingredients: ${meal.ingredients.join(", ")}`)).toBeTruthy();
    expect(screen.queryByText(/^• /)).toBeNull();
    expect(screen.queryByText(/Recipe from/)).toBeNull();
    expect(screen.queryByTestId("agent-meal-photo")).toBeNull();
  });
});
