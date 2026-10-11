"""Runner + HTTP entrypoint tests. The Strands Agent is replaced by a scripted fake; no network."""
import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import main as main_mod
from app import runner as runner_mod
from app.config import get_settings
from tests.conftest import API, GROUP_ID, RUN_ID, SECRET

EVENTS = f"{API}/internal/agent-events"
G = f"{API}/groups/{GROUP_ID}"

MEAL = {"title": "Rice bowl", "day": "Mon", "minutes": 20, "servings": 2, "ingredients": ["Rice", "Lemons"],
        "uses": ["Rice"], "missing": ["Lemons"], "steps": ["Cook rice.", "Add lemon."]}
PLAN = {"meals": [MEAL], "missingItems": [{"name": "Lemons", "forMeals": ["Rice bowl"]}], "summary": "ok"}


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


def safety_ok(request):
    meals = json.loads(request.content)["meals"]
    return httpx.Response(200, json={"meals": [{"title": m["title"], "passes": True, "problems": [],
                                                "unknown": ["za'atar"]} for m in meals]})


async def go(ctx, settings, **kw):
    await runner_mod.run(ctx, settings, model=object(), retry_delay_s=0, **kw)


@respx.mock
async def test_exception_posts_single_user_safe_failed(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))

    async def boom(tools):
        raise RuntimeError("secret internal detail sk-123")

    play(boom)
    await go(ctx, settings)
    t = terminals(route)
    assert len(t) == 1 and t[0]["type"] == "failed"
    assert "sk-123" not in json.dumps(t[0]) and "internal" not in t[0]["payload"]["message"]


@respx.mock
async def test_unsafe_meal_returns_error_and_posts_no_proposed(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    bad = {"meals": [{"title": "Rice bowl", "passes": False, "unknown": [],
                      "problems": [{"ingredient": "Peanut Butter", "reason": "contains peanuts",
                                    "members": ["Carson"]}]}]}
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=bad))
    out = {}

    async def script(tools):
        out["r"] = await tools["propose_plan"](PLAN)

    play(script)
    await go(ctx, settings)
    assert out["r"].startswith("error: unsafe meals") and "Peanut Butter" in out["r"]
    assert not [e for e in events(route) if e["type"] == "proposed"]
    # the model never finished -> exactly one failed
    assert [e["type"] for e in terminals(route)] == ["failed"]


@respx.mock
async def test_happy_path_one_proposed_with_meta_and_estimate(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    out = {}

    class PA:
        async def invoke_async(self, p):
            class R:
                def __str__(s):
                    return '{"items":[{"name":"Lemons","lowCents":300,"highCents":400}]}'

            return R()

    async def script(tools):
        await tools["estimate_prices"](["Lemons"])
        out["r"] = await tools["propose_plan"](PLAN)

    play(script)
    await go(ctx, settings, price_agent_factory=lambda: PA(), price_cache=__import__("app.pricing").pricing.PriceCache())
    assert out["r"] == "ok"
    t = terminals(route)
    assert len(t) == 1 and t[0]["type"] == "proposed"
    plan = t[0]["payload"]["plan"]
    assert plan["estimate"] == {"lowCents": 300, "highCents": 400, "label": "AI estimate"}
    # perMeal comes from this call's safety response for the final meals
    assert plan["safety"] == {"checked": True, "perMeal": [{"title": "Rice bowl", "passes": True,
                                                            "unknown": ["za'atar"]}]}
    meta = t[0]["payload"]["meta"]
    assert meta["provider"] == "akamai" and meta["model"] == "hackathon-chat" and "ms" in meta
    seqs = [e["seq"] for e in events(route)]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)


@respx.mock
async def test_propose_fills_ingredients_and_missing_items_from_checked_draft(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)

    async def script(tools):
        await tools["check_meal_safety"]([{"title": "Rice bowl", "ingredients": ["Rice", "Lemons"]}])
        lean = {k: v for k, v in MEAL.items() if k != "ingredients"}
        await tools["propose_plan"]({"meals": [lean], "summary": "x"})

    play(script)
    await go(ctx, settings)
    plan = terminals(route)[0]["payload"]["plan"]
    assert plan["meals"][0]["ingredients"] == ["Rice", "Lemons"]
    assert plan["missingItems"] == [{"name": "Lemons", "forMeals": ["Rice bowl"]}]


@respx.mock
async def test_two_failed_proposals_end_run_with_single_failed(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    out = []

    async def script(tools):
        out.append(await tools["propose_plan"]({"meals": []}))
        out.append(await tools["propose_plan"]({"meals": []}))

    play(script)
    await go(ctx, settings)
    assert "call propose_plan again" in out[0] and "final failure" in out[1]
    assert [e["type"] for e in terminals(route)] == ["failed"]


@respx.mock
async def test_no_propose_means_failed(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))

    async def script(tools):
        return None

    play(script)
    await go(ctx, settings)
    assert [e["type"] for e in terminals(route)] == ["failed"]


@respx.mock
async def test_wall_clock_timeout_posts_failed(ctx, settings, play):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))

    async def slow(tools):
        await asyncio.sleep(5)

    play(slow)
    s = settings.model_copy(update={"agent_run_timeout_s": 0.05})
    await go(ctx, s)
    t = terminals(route)
    assert len(t) == 1 and "too long" in t[0]["payload"]["message"]


@respx.mock
async def test_no_zip_skips_prices_and_estimate_is_null(ctx, settings, play):
    from dataclasses import replace

    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)

    async def script(tools):
        await tools["estimate_prices"](["Lemons"])
        await tools["propose_plan"](PLAN)

    play(script)
    await go(replace(ctx, zip_code=None), settings)
    assert terminals(route)[0]["payload"]["plan"]["estimate"] is None


# ─── HTTP entrypoint ─────────────────────────────────────────────────────────

BODY = {"runId": RUN_ID, "groupId": GROUP_ID, "prompt": "Plan", "budgetCents": 6000, "zipCode": "64105",
        "apiBaseUrl": API, "runToken": "t"}


@pytest.fixture
def api(settings, monkeypatch):
    main_mod.app.dependency_overrides[get_settings] = lambda: settings
    fake = AsyncMock()
    monkeypatch.setattr(main_mod, "run", fake)
    yield TestClient(main_mod.app), fake
    main_mod.app.dependency_overrides.clear()


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


def test_runs_accepts_202_and_runs_in_background(api):
    c, fake = api
    r = c.post("/runs", json=BODY, headers={"X-Agent-Secret": SECRET})
    assert r.status_code == 202 and r.json() == {"accepted": True}
    fake.assert_awaited_once()
    ctx = fake.await_args.args[0]
    assert ctx.run_id == RUN_ID and ctx.run_token == "t" and ctx.budget_cents == 6000
