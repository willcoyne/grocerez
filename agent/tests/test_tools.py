import json

import httpx
import pytest
import respx

from app.pricing import normalize
from app.tools import build_tools, days_until
from tests.conftest import API, GROUP_ID, TOKEN

G = f"{API}/groups/{GROUP_ID}"


class FakeResult:
    def __init__(self, text):
        self._t = text

    def __str__(self):
        return self._t

    class metrics:  # noqa: N801
        @staticmethod
        def get_summary():
            return {"accumulated_usage": {"inputTokens": 10, "outputTokens": 5}}


class FakePriceAgent:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def invoke_async(self, prompt):
        self.calls += 1
        return FakeResult(self.replies.pop(0))


def tools_by_name(ctx, client, sink, state, settings, **kw):
    return {t.tool_name: t for t in build_tools(ctx, client, sink, state, settings, **kw)}


def household(today="2026-10-11"):
    return {"today": today, "timeZone": "America/Chicago", "zipCode": "64105",
            "members": [{"displayName": "Carson", "allergens": ["peanuts"], "diets": []},
                        {"displayName": "Maya", "allergens": ["milk"], "diets": ["vegetarian"]}]}


@respx.mock
async def test_get_household_path_auth_and_label(ctx, client, sink, state, settings):
    route = respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household()))
    t = tools_by_name(ctx, client, sink, state, settings)
    out = json.loads(await t["get_household"]())
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out["members"][0] == {"name": "Carson", "allergens": ["peanuts"]}
    assert out["members"][1] == {"name": "Maya", "allergens": ["milk"], "diets": ["vegetarian"]}
    assert state.done_labels["get_household"] == "Checking allergies: Carson (peanuts), Maya (milk)"
    assert state.done_details["get_household"] == "2 people"


def cabinet_rows():
    def row(name, exp, status="in_stock"):
        return {"item": {"name": name}, "status": status, "expiresAt": exp}

    return [row("Rice", None), row("Chicken Breast", "2026-10-14"), row("Spinach", "2026-10-13"),
            row("Old Milk", "2026-10-09"), row("Salt", "2027-01-01")]


@respx.mock
async def test_get_cabinet_sorted_with_days_and_label(ctx, client, sink, state, settings):
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household("2026-10-11")))
    route = respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=cabinet_rows()))
    t = tools_by_name(ctx, client, sink, state, settings)
    out = json.loads(await t["get_cabinet"]())
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out["expiring_days"] == ["Old Milk (expired)", "Spinach (2d)", "Chicken Breast (3d)"]
    assert out["in_stock"] == ["Salt", "Rice"]
    label = state.done_labels["get_cabinet"]
    assert label.startswith("5 items · using up: old milk (expired), spinach (2 days), chicken breast (3 days)")


@respx.mock
async def test_get_cabinet_caps_at_40(ctx, client, sink, state, settings):
    rows = [{"item": {"name": f"Item{i}"}, "status": "in_stock", "expiresAt": "2026-11-01"} for i in range(60)]
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household()))
    respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=rows))
    t = tools_by_name(ctx, client, sink, state, settings)
    out = json.loads(await t["get_cabinet"]())
    assert len(out["in_stock"]) + len(out["expiring_days"]) == 40


def test_days_until_uses_household_today_not_utc():
    # Household "today" already rolled over in its time zone while UTC is still the previous day.
    assert days_until("2026-10-12", "2026-10-11") == 1
    assert days_until("2026-10-12", "2026-10-12") == 0
    assert days_until("2026-10-12", "2026-10-13") == -1
    assert days_until(None, "2026-10-11") is None
    assert days_until("garbage", "2026-10-11") is None


@respx.mock
async def test_shopping_list_unchecked_only(ctx, client, sink, state, settings):
    rows = [{"item": {"name": "Milk"}, "checked": False}, {"item": {"name": "Eggs"}, "checked": True}]
    respx.get(f"{G}/shopping-list").mock(return_value=httpx.Response(200, json=rows))
    t = tools_by_name(ctx, client, sink, state, settings)
    assert json.loads(await t["get_shopping_list"]()) == ["Milk"]
    assert state.done_labels["get_shopping_list"] == "1 already on the list"


@respx.mock
async def test_get_wants_uses_userid_all(ctx, client, sink, state, settings):
    rows = [{"item": {"name": "Milk"}, "user": {"displayName": "Maya"}},
            {"item": {"name": "Milk"}, "user": {"displayName": "Sam"}}]
    route = respx.get(f"{G}/preferences").mock(return_value=httpx.Response(200, json=rows))
    t = tools_by_name(ctx, client, sink, state, settings)
    out = json.loads(await t["get_wants"]())
    assert route.calls.last.request.url.params["userId"] == "all"
    assert out == ["Milk (Maya, Sam)"]


@respx.mock
async def test_non_2xx_becomes_readable_string_never_raises(ctx, client, sink, state, settings):
    route = respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(503))
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(404))
    t = tools_by_name(ctx, client, sink, state, settings)
    assert await t["get_cabinet"]() == "error: cabinet unavailable (503)"
    assert route.call_count == 2  # one retry on 5xx
    assert "get_cabinet" in state.failed_tools
    assert (await t["get_household"]()).startswith("error: household request failed (404)")


@respx.mock
async def test_timeout_is_retried_then_readable(ctx, client, sink, state, settings):
    route = respx.get(f"{G}/shopping-list").mock(side_effect=httpx.ConnectTimeout("slow"))
    t = tools_by_name(ctx, client, sink, state, settings)
    assert await t["get_shopping_list"]() == "error: shopping list unavailable (timeout)"
    assert route.call_count == 2


@respx.mock
async def test_check_meal_safety_posts_and_labels(ctx, client, sink, state, settings):
    resp = {"meals": [
        {"title": "A", "passes": True, "problems": [], "unknown": []},
        {"title": "B", "passes": False, "unknown": [],
         "problems": [{"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]},
    ]}
    route = respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=resp))
    t = tools_by_name(ctx, client, sink, state, settings)
    out = json.loads(await t["check_meal_safety"]([{"title": "A", "ingredients": ["Rice"]},
                                                   {"title": "B", "ingredients": ["Peanut Butter"]}]))
    sent = json.loads(route.calls.last.request.content)
    assert sent["meals"][0] == {"title": "A", "ingredients": ["Rice"]}
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out["results"][1]["passes"] is False and "FAILED" in out["instruction"]
    assert state.done_labels["check_meal_safety"] == "Safety check: 1/2 pass · 1 failed: Peanut Butter, fixing…"


async def test_check_meal_safety_invalid_input_returns_error(ctx, client, sink, state, settings):
    t = tools_by_name(ctx, client, sink, state, settings)
    out = await t["check_meal_safety"]([{"title": "A", "ingredients": []}])
    assert out.startswith("error: invalid meals")


async def test_estimate_prices_skips_without_zip(client, sink, state, settings):
    from app.schemas import RunContext

    nozip = RunContext(run_id="r", group_id=GROUP_ID, api_base=API, run_token=TOKEN, zip_code=None)
    t = tools_by_name(nozip, client, sink, state, settings, price_agent_factory=lambda: FakePriceAgent([]))
    out = json.loads(await t["estimate_prices"](["Lemons"]))
    assert out["estimate"] is None
    assert state.done_labels["estimate_prices"] == "No ZIP set, skipping prices"


async def test_estimate_prices_validates_caches_and_labels(ctx, client, sink, state, settings, cache):
    agent = FakePriceAgent(['```json\n{"prices":[[300,450],[250,400]]}\n```'])
    t = tools_by_name(ctx, client, sink, state, settings, price_agent_factory=lambda: agent, price_cache=cache)
    out = json.loads(await t["estimate_prices"](["Lemons", "Salsa"]))
    assert out["totalLowCents"] == 550 and out["totalHighCents"] == 850 and out["estimate"] is True
    assert state.done_labels["estimate_prices"] == "$6–$9 (AI estimate)"
    assert state.priced[normalize("Lemons")] == (300, 450)
    # second call is served from the (name, zip) cache: no new model call
    await t["estimate_prices"](["lemons "])
    assert agent.calls == 1


async def test_estimate_prices_retries_once_then_unavailable(ctx, client, sink, state, settings, cache):
    agent = FakePriceAgent(["not json", '{"prices":[[1,2],[3,4]]}'])  # second reply has the wrong count
    t = tools_by_name(ctx, client, sink, state, settings, price_agent_factory=lambda: agent, price_cache=cache)
    out = json.loads(await t["estimate_prices"](["Lemons"]))
    assert out["estimate"] is None
    assert agent.calls == 2
    assert "estimate_prices" in state.failed_tools
