import { QueryClient } from "@tanstack/react-query";

import { keys } from "@/api/keys";
import { handleSocketEvent } from "../SocketProvider";

describe("socket events → query invalidation", () => {
  function setup() {
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, "invalidateQueries");
    return { qc, invalidated: () => spy.mock.calls.map((c) => c[0]?.queryKey) };
  }

  it("shopping-list:changed invalidates only that group's list", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "shopping-list:changed", { groupId: "g1", by: "u1" });
    expect(invalidated()).toContainEqual(keys.shoppingList("g1"));
    expect(invalidated()).not.toContainEqual(keys.shoppingList("g2"));
  });

  it("cabinet:changed invalidates cabinet and alerts", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "cabinet:changed", { groupId: "g1" });
    expect(invalidated()).toEqual(expect.arrayContaining([keys.cabinet("g1"), keys.alerts("g1")]));
  });

  it("group:changed refreshes the group and the switcher", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "group:changed", { groupId: "g1" });
    expect(invalidated()).toEqual(expect.arrayContaining([keys.group("g1"), keys.groups]));
  });

  it("invites:changed refreshes my invites", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "invites:changed", { groupId: "g1" });
    expect(invalidated()).toEqual(expect.arrayContaining([keys.myInvites, keys.groupInvites("g1")]));
  });

  it("agent:changed refreshes that run and the recent-runs list, in that group only", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "agent:changed", { groupId: "g1", by: "u1", runId: "r1" });
    expect(invalidated()).toEqual(expect.arrayContaining([keys.agentRun("g1", "r1"), keys.agentRuns("g1")]));
    expect(invalidated()).not.toContainEqual(keys.agentRuns("g2"));
    expect(invalidated()).not.toContainEqual(keys.agentRun("g2", "r1"));
  });

  it("agent:changed without a runId still refreshes the recent-runs list", () => {
    const { qc, invalidated } = setup();
    handleSocketEvent(qc, "agent:changed", { groupId: "g1" });
    expect(invalidated()).toEqual([keys.agentRuns("g1")]);
  });
});
