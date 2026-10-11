import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentEvent, AgentRun } from "../src/contracts/agent.js";

// Contract parity (challenge 01): agent/tests/test_schemas.py validates the same fixture with pydantic.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent/demo-run.json", import.meta.url), "utf8"));

describe("agent contracts", () => {
  it("demo-run fixture is a valid AgentRun", () => {
    expect(AgentRun.parse(fixture).plan?.meals).toHaveLength(4);
  });

  it("missingItems cover every meal's missing list", () => {
    const run = AgentRun.parse(fixture);
    const names = new Set(run.plan!.missingItems.map((m) => m.name));
    for (const meal of run.plan!.meals) for (const m of meal.missing) expect(names.has(m)).toBe(true);
  });

  it("a proposed event wraps the fixture plan", () => {
    const run = AgentRun.parse(fixture);
    const ev = AgentEvent.parse({ runId: run.id, seq: 8, type: "proposed", payload: { plan: run.plan, meta: run.meta } });
    expect(ev.type).toBe("proposed");
  });

  it("rejects a plan whose estimate isn't labeled", () => {
    const bad = structuredClone(fixture);
    bad.plan.estimate.label = "price";
    expect(AgentRun.safeParse(bad).success).toBe(false);
  });
});
