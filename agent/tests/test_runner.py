"""Runner + HTTP entrypoint tests. The Strands Agent is replaced by a scripted fake; no network."""
import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import main as main_mod
from app import runner as runner_mod
from app import tools as tools_mod
from app.config import get_settings
from app.pricing import PriceCache
from tests.conftest import API, EVENTS, G, GROUP_ID, RUN_ID, SECRET, FakePriceAgent, safety_ok

MEAL = {"title": "Rice bowl", "day": "Mon", "minutes": 20, "servings": 2, "ingredients": ["Rice", "Lemons"],
        "missing": ["Lemons"], "steps": ["Cook rice.", "Add lemon."]}
MEAL2 = {**MEAL, "title": "Egg rice", "ingredients": ["Rice", "Eggs"], "missing": []}


class FakeAgent:
    """Stands in for strands.Agent: `script(tools_by_name)` plays the model's tool calls."""

    script = None

    def __init__(self, model=None, tools=None, system_prompt=None, callback_handler=None, hooks=None):
        self.tools = {t.tool_name: t for t in tools}
        self.cancelled = False

    def cancel(self):
        self.cancelled = True

    async def invoke_async(self, prompt):
        await type(self).script(self.tools)
        return object()


@pytest.fixture
def play(monkeypatch):
    monkeypatch.setattr(runner_mod, "Agent", FakeAgent)

    def set_script(fn):
        FakeAgent.script = staticmethod(fn)

    return set_script


def events(route):
    return [json.loads(c.request.content) for c in route.calls]


def terminals(route):
    return [e for e in events(route) if e["type"] in ("proposed", "failed")]


async def go(ctx, settings, **kw):
    kw.setdefault("price_agent_factory", lambda: FakePriceAgent(['{"prices":[[300,400]]}']))
    kw.setdefault("price_cache", PriceCache())
    await runner_mod.run(ctx, settings, model=object(), retry_delay_s=0, **kw)


@pytest.fixture
def server():
    """Fake server: events accepted, safety endpoint passes everything."""
    with respx.mock:
        route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
        respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
        yield route


# ─── run() ───────────────────────────────────────────────────────────────────


async def test_exception_posts_single_user_safe_failed(ctx, settings, play, server):
    async def boom(tools):
        raise RuntimeError("secret internal detail sk-123")

    play(boom)
    await go(ctx, settings)
    t = terminals(server)
    assert len(t) == 1 and t[0]["type"] == "failed"
    assert "sk-123" not in json.dumps(t[0]) and "internal" not in t[0]["payload"]["message"]


async def test_unsafe_plan_returns_error_and_posts_no_proposed(ctx, settings, play):
    with respx.mock:
        route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
        bad = {"meals": [
            {"title": "Rice bowl", "passes": False, "unknown": [],
             "problems": [{"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]},
            {"title": "To buy", "passes": True, "problems": [], "unknown": []}]}
        respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=bad))
        out = {}

        async def script(tools):
            out["r"] = await tools["propose_plan"]({"meals": [MEAL], "summary": "x"})

        play(script)
        await go(ctx, settings)
    assert out["r"].startswith("error: unsafe") and "Peanut Butter" in out["r"]
    assert not [e for e in events(route) if e["type"] == "proposed"]
    assert [e["type"] for e in terminals(route)] == ["failed"]


async def test_title_or_step_hits_found_by_safety_block_the_proposal(ctx, settings, play):
    """Apply also checks titles/steps/missing/missingItems; propose_plan must send them (mirror apply)."""
    seen = {}

    def safety(request):
        meals = json.loads(request.content)["meals"]
        seen["meals"] = meals
        # the server flags the *step text*, which only happens if we sent steps
        flagged = any("butter" in s.lower() for m in meals for s in m.get("steps", []))
        return httpx.Response(200, json={"meals": [
            {"title": m["title"], "passes": not (flagged and m["title"] == "Rice bowl"), "unknown": [],
             "problems": [{"ingredient": "butter", "reason": "contains milk", "members": ["Maya"]}]
             if flagged and m["title"] == "Rice bowl" else []} for m in meals]})

    with respx.mock:
        route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
        respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
        out = {}

        async def script(tools):
            out["r"] = await tools["propose_plan"]({"meals": [{**MEAL, "steps": ["Cook in butter."]}], "summary": "x"})

        play(script)
        await go(ctx, settings)
    assert [m["title"] for m in seen["meals"]] == ["Rice bowl", "To buy"]
    assert seen["meals"][0]["steps"] == ["Cook in butter."]
    assert out["r"].startswith("error: unsafe")
    assert not [e for e in events(route) if e["type"] == "proposed"]


async def test_happy_path_one_proposed_pricing_in_background(ctx, settings, play, server):
    out = {}

    async def script(tools):
        r = json.loads(await tools["check_meal_safety"]([MEAL]))
        assert r == {"all_pass": True}
        assert "estimate_prices" not in tools  # pricing is not a model-visible tool any more
        out["r"] = await tools["propose_plan"]({"summary": "One dinner."})

    play(script)
    await go(ctx, settings)
    assert out["r"] == "ok"
    t = terminals(server)
    assert len(t) == 1 and t[0]["type"] == "proposed"
    plan = t[0]["payload"]["plan"]
    assert plan["estimate"] == {"lowCents": 300, "highCents": 400, "label": "AI estimate"}
    assert plan["safety"] == {"checked": True, "perMeal": [{"title": "Rice bowl", "passes": True, "unknown": []}]}
    assert plan["missingItems"] == [{"name": "Lemons", "forMeals": ["Rice bowl"]}]
    assert plan["meals"][0]["uses"] == ["Rice"]  # derived: ingredients minus missing
    meta = t[0]["payload"]["meta"]
    assert meta["provider"] == "akamai" and meta["model"] == "hackathon-chat" and "ms" in meta
    seqs = [e["seq"] for e in events(server)]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    labels = [e["payload"]["label"] for e in events(server) if e["payload"].get("id") == "estimate_prices"]
    assert labels[0] == "Pricing 1 missing items…" and labels[-1] == "$3–$4 (AI estimate)"


async def test_slow_pricing_is_skipped_and_estimate_is_null(ctx, settings, play, server, monkeypatch):
    monkeypatch.setattr(tools_mod, "PRICE_WAIT_S", 0.05)

    async def script(tools):
        await tools["check_meal_safety"]([MEAL])
        await tools["propose_plan"]({"summary": "x"})

    play(script)
    await go(ctx, settings, price_agent_factory=lambda: FakePriceAgent(['{"prices":[[1,2]]}'], delay=5))
    plan = terminals(server)[0]["payload"]["plan"]
    assert plan["estimate"] is None
    assert any(e["payload"].get("label", "").startswith("Skipped prices") for e in events(server))


async def test_changed_missing_names_never_use_stale_price(ctx, settings, play, server):
    """Priced Lemons during the draft, but the final plan adds Basil (unpriced): omit instead of summing."""
    replies = ['{"prices":[[300,400]]}', '{"prices":[[1,1]]}']

    async def script(tools):
        await tools["check_meal_safety"]([MEAL])
        await tools["propose_plan"]({"summary": "x", "add_missing": ["Basil"]})

    play(script)
    agent = FakePriceAgent(replies)
    await go(ctx, settings, price_agent_factory=lambda: agent)
    plan = terminals(server)[0]["payload"]["plan"]
    assert [i["name"] for i in plan["missingItems"]] == ["Lemons", "Basil"]
    # restarted for the final set {Lemons, Basil}; the reply has one price for two names -> omitted, not 300+400
    assert plan["estimate"] is None


async def test_no_zip_skips_prices(ctx, settings, play, server):
    async def script(tools):
        await tools["check_meal_safety"]([MEAL])
        await tools["propose_plan"]({"summary": "x"})

    play(script)
    await go(replace(ctx, zip_code=None), settings)
    assert terminals(server)[0]["payload"]["plan"]["estimate"] is None
    assert any(e["payload"].get("label") == "No ZIP set, skipping prices" for e in events(server))


async def test_propose_step_is_done_before_terminal_proposed_event(ctx, settings, play, server):
    async def script(tools):
        await tools["propose_plan"]({"meals": [MEAL], "summary": "x"})

    play(script)
    await go(ctx, settings)
    ev = events(server)
    assert ev[-1]["type"] == "proposed"
    done = [e for e in ev if e["type"] == "step" and e["payload"]["id"] == "propose_plan"]
    assert done and done[-1]["payload"] == {"id": "propose_plan", "label": "Plan ready", "status": "done"}
    assert ev.index(done[-1]) < ev.index(ev[-1])


async def test_zero_missing_gets_delta_nudge_then_add_missing_appends_without_redraft(ctx, settings, play, server):
    out = []
    checks = []

    async def script(tools):
        await tools["check_meal_safety"]([{**MEAL, "missing": [], "ingredients": ["Rice"]}, MEAL2])
        out.append(await tools["propose_plan"]({"summary": "x"}))
        out.append(await tools["propose_plan"]({"summary": "x", "add_missing": ["Cilantro", "Lime"]}))

    play(script)
    await go(ctx, settings)
    assert out[0].startswith("error: no missing items") and "add_missing" in out[0]
    assert out[1] == "ok"
    plan = terminals(server)[0]["payload"]["plan"]
    assert plan["meals"][-1]["missing"] == ["Cilantro", "Lime"]  # appended to the last meal, no full redraft
    assert [i["name"] for i in plan["missingItems"]] == ["Cilantro", "Lime"]
    assert plan["missingItems"][0]["forMeals"] == ["Egg rice"]


async def test_more_than_three_meals_is_capped_with_note(ctx, settings, play, server):
    meals = [{**MEAL, "title": f"Meal {i}", "missing": [f"Item{i}"], "ingredients": ["Rice", f"Item{i}"]}
             for i in range(4)]

    async def script(tools):
        await tools["propose_plan"]({"meals": meals, "summary": "Four dinners."})

    play(script)
    await go(ctx, settings)
    plan = terminals(server)[0]["payload"]["plan"]
    assert [m["title"] for m in plan["meals"]] == ["Meal 0", "Meal 1", "Meal 2"]
    assert [i["name"] for i in plan["missingItems"]] == ["Item0", "Item1", "Item2"]
    assert plan["summary"].endswith("Capped at 3 meals.")


async def test_revise_then_propose_summary_only(ctx, settings, play, server):
    out = {}

    async def script(tools):
        await tools["check_meal_safety"]([MEAL, MEAL2])
        out["rev"] = json.loads(await tools["revise_meal"]("Egg rice", add=["Cilantro"], steps=["Fry."]))
        out["r"] = await tools["propose_plan"]({"summary": "Two dinners."})

    play(script)
    await go(ctx, settings)
    assert out["rev"]["passes"] is True and out["r"] == "ok"
    plan = terminals(server)[0]["payload"]["plan"]
    assert plan["meals"][1]["missing"] == ["Cilantro"] and plan["meals"][1]["steps"] == ["Fry."]


async def test_propose_without_a_checked_draft_says_run_check_first(ctx, settings, play, server):
    out = []

    async def script(tools):
        out.append(await tools["propose_plan"]({"summary": "x"}))

    play(script)
    await go(ctx, settings)
    assert "run check_meal_safety first" in out[0]


async def test_three_failed_proposals_allowed_while_early_then_single_failed(ctx, settings, play, server):
    out = []

    async def script(tools):
        for _ in range(3):
            out.append(await tools["propose_plan"]({"meals": [{"title": "x"}]}))

    play(script)
    await go(ctx, settings)
    assert all("call propose_plan again" in o for o in out[:2]) and "final failure" in out[2]
    assert [e["type"] for e in terminals(server)] == ["failed"]


async def test_only_two_failures_when_late(ctx, settings, play, server, monkeypatch):
    monkeypatch.setattr(tools_mod, "LATE_MS", 0)
    out = []

    async def script(tools):
        for _ in range(2):
            out.append(await tools["propose_plan"]({"meals": [{"title": "x"}]}))

    play(script)
    await go(ctx, settings)
    assert "final failure" in out[1]


async def test_no_propose_means_failed(ctx, settings, play, server):
    async def script(tools):
        return None

    play(script)
    await go(ctx, settings)
    assert [e["type"] for e in terminals(server)] == ["failed"]


async def test_wall_clock_timeout_posts_failed_and_cancels_pricing(ctx, settings, play, server):
    started = {}

    async def slow(tools):
        await tools["check_meal_safety"]([MEAL])
        await asyncio.sleep(5)

    play(slow)
    s = settings.model_copy(update={"agent_run_timeout_s": 0.1})
    await go(ctx, s, price_agent_factory=lambda: FakePriceAgent(['{"prices":[[1,2]]}'], delay=5))
    t = terminals(server)
    assert len(t) == 1 and "too long" in t[0]["payload"]["message"]
    await asyncio.sleep(0.05)  # let the cancelled pricing task unwind
    leftover = [x for x in asyncio.all_tasks() if x is not asyncio.current_task() and not x.done()]
    assert not leftover  # pricing task cancelled in finally; nothing left running


async def test_cancellation_posts_best_effort_failed_then_reraises(ctx, settings, play, server):
    async def hang(tools):
        await asyncio.sleep(30)

    play(hang)
    task = asyncio.create_task(runner_mod.run(ctx, settings, model=object(), retry_delay_s=0))
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    t = terminals(server)
    assert len(t) == 1 and "interrupted" in t[0]["payload"]["message"]


async def test_auth_failure_on_tool_call_stops_run_with_failed(ctx, settings, play):
    with respx.mock:
        route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
        respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(401))

        async def script(tools):
            await tools["get_household"]()

        play(script)
        await go(ctx, settings)
    t = terminals(route)
    assert len(t) == 1 and t[0]["type"] == "failed" and "access" in t[0]["payload"]["message"]


# ─── HTTP entrypoint ─────────────────────────────────────────────────────────

BODY = {"runId": RUN_ID, "groupId": GROUP_ID, "prompt": "Plan", "budgetCents": 6000, "zipCode": "64105",
        "apiBaseUrl": API, "runToken": "t"}


@pytest.fixture
def api(settings, monkeypatch):
    main_mod.app.dependency_overrides[get_settings] = lambda: settings
    main_mod._active.clear()
    main_mod._sem = None
    fake = AsyncMock()
    monkeypatch.setattr(main_mod, "run", fake)
    yield TestClient(main_mod.app), fake
    main_mod.app.dependency_overrides.clear()
    main_mod._active.clear()


def test_health(api):
    assert api[0].get("/health").json() == {"ok": True}


def test_runs_requires_secret(api):
    c, fake = api
    assert c.post("/runs", json=BODY).status_code == 401
    assert c.post("/runs", json=BODY, headers={"X-Agent-Secret": "wrong"}).status_code == 401
    fake.assert_not_called()


def test_runs_bad_body_422(api):
    c, _ = api
    assert c.post("/runs", json={"runId": "nope"}, headers={"X-Agent-Secret": SECRET}).status_code == 422


def test_runs_rejects_non_http_api_base_url(api):
    c, fake = api
    for bad in ("file:///etc/passwd", "ftp://x/y", "server:3000/api", ""):
        r = c.post("/runs", json={**BODY, "apiBaseUrl": bad}, headers={"X-Agent-Secret": SECRET})
        assert r.status_code == 422
    fake.assert_not_called()


def test_runs_accepts_202_runs_in_background_and_releases_the_run_id(api):
    c, fake = api
    r = c.post("/runs", json=BODY, headers={"X-Agent-Secret": SECRET})
    assert r.status_code == 202 and r.json() == {"accepted": True}
    fake.assert_awaited_once()
    ctx = fake.await_args.args[0]
    assert ctx.run_id == RUN_ID and ctx.run_token == "t" and ctx.budget_cents == 6000
    assert RUN_ID not in main_mod._active
    assert "runToken" not in repr(main_mod.AgentRunRequest.model_validate(BODY))  # secrets stay out of reprs


def test_duplicate_active_run_id_returns_202_without_second_start(api):
    c, fake = api
    main_mod._active.add(RUN_ID)  # a run with this id is already in flight
    r = c.post("/runs", json=BODY, headers={"X-Agent-Secret": SECRET})
    assert r.status_code == 202 and r.json() == {"accepted": True}
    fake.assert_not_called()


async def test_global_semaphore_caps_concurrent_runs(settings, monkeypatch):
    main_mod._sem = None
    s = settings.model_copy(update={"max_concurrent_runs": 2})
    live = {"now": 0, "max": 0}

    async def fake_run(ctx, settings_):
        live["now"] += 1
        live["max"] = max(live["max"], live["now"])
        await asyncio.sleep(0.05)
        live["now"] -= 1

    monkeypatch.setattr(main_mod, "run", fake_run)
    ctxs = [replace(main_mod.RunContext(run_id=str(i), group_id=GROUP_ID, api_base=API, run_token="t")) for i in range(6)]
    for c in ctxs:
        main_mod._active.add(c.run_id)
    await asyncio.gather(*(main_mod._guarded(c, s) for c in ctxs))
    assert live["max"] == 2 and not main_mod._active
    main_mod._sem = None
