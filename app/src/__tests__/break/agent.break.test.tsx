/**
 * Break tests for the Pantry Agent app feature (plan/challenges/01-pantry-agent §2, §7).
 * Every test here FAILS against the current code; each one documents a defect a user would hit.
 */
import type { AgentRun, AgentRunSummary, ApplyAgentRunResponse, AgentStep } from "@contracts/agent";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

import demoRunJson from "../../../../server/test/fixtures/agent/demo-run.json";
import { api, ApiError } from "@/api/client";
import AgentScreen from "@/app/agent";
import { ActiveGroupContextForTests } from "@/state/ActiveGroupContext";
import { apiRoutes, groupValue, renderWithProviders, testGroup, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
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

const demoRun = demoRunJson as AgentRun;
const g = testGroup.id;
const groupB = { ...testGroup, id: "33333333-3333-4333-8333-333333333333", name: "Other House" };
const runPath = `/groups/${g}/agent/runs/${demoRun.id}`;
const clone = (): AgentRun => JSON.parse(JSON.stringify(demoRun));
const summaryOf = (r: AgentRun): AgentRunSummary => {
  const { steps: _s, ...rest } = r;
  return rest;
};
const gets = (path: string) => apiMock.mock.calls.filter(([p, o]) => p === path && (o?.method ?? "GET") === "GET").length;

beforeEach(() => {
  mockParams = {};
  Object.values(mockRouter).forEach((f) => f.mockReset());
});
afterEach(() => jest.useRealTimers());

async function settle(qc: QueryClient) {
  await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0));
  // TanStack batches observer notifications on setTimeout(0): flush that inside act too.
  await act(() => new Promise<void>((r) => setTimeout(r, 0)));
}

/** Lets a test switch the active household while the agent screen stays mounted (the modal sits above the tabs). */
const switcher: { set: (id: string) => void } = { set: () => {} };
function GroupSwitcher({ children }: { children: ReactNode }) {
  const [id, setId] = useState(g);
  useEffect(() => {
    switcher.set = setId;
  }, []);
  const active = id === g ? testGroup : groupB;
  return (
    <ActiveGroupContextForTests.Provider value={groupValue({ activeGroupId: id, activeGroup: active, groups: [testGroup, groupB] })}>
      {children}
    </ActiveGroupContextForTests.Provider>
  );
}

/** Two taps that land in the same JS frame (before React re-renders the button as disabled). */
async function doubleTap(label: string) {
  const btn = screen.getByLabelText(label);
  await act(async () => {
    void fireEvent.press(btn);
    void fireEvent.press(btn);
  });
}

// ─── 1. Finished plan still shows a spinner ──────────────────────────────────

describe("finished plan with a step still `running`", () => {
  // Real runs end like this: propose_plan's "running" step is posted, the proposed event flips the run, and the
  // after-tool "done" step is then rejected with 409 (run no longer running). The stored step stays `running`.
  const stuckStep = (): AgentRun => {
    const r = clone();
    r.steps[r.steps.length - 1] = { ...r.steps[r.steps.length - 1], label: "Finishing the plan…", status: "running" };
    return r;
  };

  it("does not show an 'in progress' spinner next to a proposed plan", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => stuckStep(),
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(await screen.findByText("Add 6 items to the list")).toBeTruthy();
    expect(screen.queryByLabelText(/in progress$/)).toBeNull();
    await settle(queryClient);
  });

  it("the recorded-run replay of such a run ends without a spinner either", async () => {
    jest.useFakeTimers();
    mockParams = { replay: "1" };
    const run = stuckStep();
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/agent/runs`]: () => [summaryOf(run)],
        [`GET ${runPath}`]: () => run,
      }),
    );
    await renderWithProviders(<AgentScreen />);
    expect(await screen.findByText("Planning your week…")).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(30_000));
    expect(screen.getByText("Add 6 items to the list")).toBeTruthy();
    expect(screen.queryByLabelText(/in progress$/)).toBeNull();
  });
});

// ─── 2. Closing the sheet orphans the run ────────────────────────────────────

describe("closing the sheet mid-run ('You can close this; the agent keeps working')", () => {
  /** The fixture run, made "mine" (the signed-in test user) and "just now" so the test doesn't depend on the calendar. */
  const mine = (over: Partial<AgentRun> = {}): AgentRun => {
    const now = new Date().toISOString();
    return { ...clone(), userId: testUser.id, createdAt: now, updatedAt: now, ...over };
  };

  it("reopening 'Plan our week' resumes my in-flight/proposed run instead of a blank compose form", async () => {
    const proposed = mine();
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/agent/runs`]: () => [summaryOf(proposed)],
        [`GET ${runPath}`]: () => proposed,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    // The run the user was told would keep working finished while the sheet was closed: its plan must be reachable.
    expect(await screen.findByText("Add 6 items to the list", {}, { timeout: 1000 })).toBeTruthy();
    await settle(queryClient);
  });

  it("resumes my run that is still in progress (live steps, no compose form)", async () => {
    const running = mine({ status: "running", plan: null, meta: null, steps: clone().steps.slice(0, 2) });
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/agent/runs`]: () => [summaryOf(running)],
        [`GET ${runPath}`]: () => running,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    expect(await screen.findByText("Planning your week…")).toBeTruthy();
    expect(screen.queryByLabelText("Run the planning agent")).toBeNull();
    await settle(queryClient);
  });

  it.each([
    ["another member's run", { userId: "44444444-4444-4444-8444-444444444444" }],
    ["a stale proposed plan (2 h old)", { updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }],
  ])("does not hijack the sheet with %s", async (_name, over) => {
    const r = mine(over);
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/agent/runs`]: () => [summaryOf(r)], [`GET ${runPath}`]: () => r }));
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await settle(queryClient);
    expect(screen.getByLabelText("Run the planning agent")).toBeTruthy();
    expect(gets(runPath)).toBe(0);
  });
});

// ─── 3. Double taps ──────────────────────────────────────────────────────────

describe("double taps in one frame", () => {
  it("Run starts exactly one agent run (rate-limited 10/hour/group)", async () => {
    let n = 0;
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => {
          n += 1;
          return { runId: demoRun.id };
        },
        [`GET ${runPath}`]: () => clone(),
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await doubleTap("Run the planning agent");
    await settle(queryClient);
    expect(n).toBe(1);
  });

  it("'Add 6 items' double-tap: the successful apply is reported, not the second tap's 409", async () => {
    let applied = false;
    const applyRes: ApplyAgentRunResponse = { added: 6, skipped: [], items: [] };
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => (applied ? { ...clone(), status: "applied" } : clone()),
        [`POST ${runPath}/apply`]: async () => {
          if (applied) throw new ApiError(409, "RUN_NOT_PROPOSED", "x");
          applied = true;
          return applyRes;
        },
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await screen.findByText("Add 6 items to the list");
    await doubleTap("Add 6 items to the list");
    await settle(queryClient);
    expect(screen.queryByText("This plan was already added.")).toBeNull();
    expect(screen.getByText("Added 6 items")).toBeTruthy();
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/");
  });
});

// ─── 4. Switching households mid-run ─────────────────────────────────────────

describe("switching the active group with the agent sheet open", () => {
  it("never asks group B for group A's run (no 404 'Couldn't load the plan')", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => clone(),
      }),
    );
    const { queryClient } = await renderWithProviders(
      <GroupSwitcher>
        <AgentScreen />
      </GroupSwitcher>,
    );
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await screen.findByText("Add 6 items to the list");

    await act(async () => switcher.set(groupB.id));
    await settle(queryClient);
    expect(gets(`/groups/${groupB.id}/agent/runs/${demoRun.id}`)).toBe(0);
    expect(screen.queryByText("Couldn't load the plan")).toBeNull();
  });

  it("a start that resolves after the switch does not attach A's run to B", async () => {
    let resolveStart: (v: { runId: string }) => void = () => {};
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => new Promise((r) => (resolveStart = r)),
        [`GET ${runPath}`]: () => clone(),
      }),
    );
    const { queryClient } = await renderWithProviders(
      <GroupSwitcher>
        <AgentScreen />
      </GroupSwitcher>,
    );
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await act(async () => switcher.set(groupB.id));
    await act(async () => resolveStart({ runId: demoRun.id }));
    await settle(queryClient);
    expect(gets(`/groups/${groupB.id}/agent/runs/${demoRun.id}`)).toBe(0);
    expect(screen.queryByText("Couldn't load the plan")).toBeNull();
  });
});

// ─── 5. Polling robustness ───────────────────────────────────────────────────

describe("polling while the run is in progress", () => {
  it("one failed poll (dropped network) keeps the live steps on screen instead of a full-screen error", async () => {
    jest.useFakeTimers();
    const running: AgentRun = { ...clone(), status: "running", plan: null, meta: null, steps: clone().steps.slice(0, 2) };
    let calls = 0;
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => {
          calls += 1;
          if (calls === 2) throw new ApiError(0, "NETWORK", "Network request failed");
          return running;
        },
      }),
    );
    await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    expect(await screen.findByText("Planning your week…")).toBeTruthy();
    for (let i = 0; i < 4 && calls < 2; i++) await act(async () => void jest.advanceTimersByTime(800));
    await act(async () => {});
    await act(async () => void jest.advanceTimersByTime(100));
    expect(calls).toBe(2);
    expect(screen.queryByText("Couldn't load the plan")).toBeNull();
    expect(screen.getByText("Planning your week…")).toBeTruthy();
  });

  it("a run still `running` long past the server's 120 s timeout stops polling and says so", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-11T18:10:00.000Z"));
    // Started 10 min ago (createdAt 18:00); the server lost its in-process timeout (restart within the 2-min boot-sweep window).
    const stuck: AgentRun = { ...clone(), status: "running", plan: null, meta: null, steps: clone().steps.slice(0, 3) };
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => stuck,
      }),
    );
    await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    const tick = async (ms: number) => {
      for (let t = 0; t < ms; t += 500) await act(async () => void jest.advanceTimersByTime(500));
    };
    await tick(5_000);
    const before = gets(runPath);
    await tick(30_000);
    expect(gets(runPath)).toBe(before);
    expect(screen.queryByText("Planning your week…")).toBeNull();
  });
});

// ─── 6. Plan shape edge cases ────────────────────────────────────────────────

describe("plan shape edge cases", () => {
  it("two meals with the same title each get their own card and their own safety line", async () => {
    const r = clone();
    r.plan!.meals = [r.plan!.meals[0], { ...r.plan!.meals[1], title: r.plan!.meals[0].title, day: "Fri" }];
    r.plan!.safety.perMeal = [
      { title: r.plan!.meals[0].title, passes: true, unknown: [] },
      { title: r.plan!.meals[0].title, passes: true, unknown: ["za'atar"] },
    ];
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => r,
      }),
    );
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await screen.findByText("2 dinners for this week");
    const dupKey = err.mock.calls.some((c) => String(c[0]).includes("same key"));
    err.mockRestore();
    expect(dupKey).toBe(false);
    // The second card's safety line comes from perMeal[1], not the first match by title.
    expect(screen.getByText("✓ Safe for everyone · couldn't verify: za'atar")).toBeTruthy();
    await settle(queryClient);
  });
});

// ─── 7. Replay ───────────────────────────────────────────────────────────────

describe("recorded-run replay", () => {
  it("is not restarted when a newer run lands in the recent-runs list mid-replay", async () => {
    jest.useFakeTimers();
    mockParams = { replay: "1" };
    const first = clone();
    const newer: AgentRun = { ...clone(), id: "77777777-7777-4777-8777-777777777777", createdAt: "2026-10-11T19:00:00.000Z" };
    let list: AgentRunSummary[] = [summaryOf(first)];
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/agent/runs`]: () => list,
        [`GET ${runPath}`]: () => first,
        [`GET /groups/${g}/agent/runs/${newer.id}`]: () => newer,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    expect(await screen.findByText("Planning your week…")).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(2_500));
    expect(screen.getByLabelText("3 already on the list, done")).toBeTruthy();

    // Another member's run finishes: agent:changed → the recent list refetches.
    list = [summaryOf(newer), summaryOf(first)];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["group", g, "agent-runs"], exact: true });
    });
    await act(async () => void jest.advanceTimersByTime(50));
    // The replay in progress must keep going, not jump back to "Loading the recorded run…" / step 1.
    expect(screen.getByLabelText("3 already on the list, done")).toBeTruthy();
  });
});

// ─── 8. Accessibility ────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("announces a step change to screen readers on iOS too (accessibilityLiveRegion is Android-only)", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    let current: AgentRun = { ...clone(), status: "running", plan: null, meta: null, steps: clone().steps.slice(0, 1) };
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${g}/agent/runs`]: () => ({ runId: demoRun.id }),
        [`GET ${runPath}`]: () => current,
      }),
    );
    const { queryClient } = await renderWithProviders(<AgentScreen />);
    await fireEvent.press(screen.getByLabelText("Run the planning agent"));
    await screen.findByLabelText("Checking allergies: Carson (peanuts), Maya (milk), 4 people, done");
    const steps: AgentStep[] = clone().steps.slice(0, 2);
    steps[1] = { ...steps[1], status: "running" };
    current = { ...current, steps };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["group", g, "agent-runs", demoRun.id] });
    });
    await screen.findByLabelText("14 items · using up: spinach (2 days), chicken (3 days), in progress");
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("14 items"));
    announce.mockRestore();
    current = { ...current, status: "failed", error: "x" };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["group", g, "agent-runs", demoRun.id] });
    });
    await settle(queryClient);
  });

  it("budget choices are exposed as radio buttons (one of four), not independent checkboxes", async () => {
    apiMock.mockImplementation(apiRoutes({}));
    await renderWithProviders(<AgentScreen />);
    expect(screen.getByLabelText("Budget $60").props.accessibilityRole).toBe("radio");
  });
});
