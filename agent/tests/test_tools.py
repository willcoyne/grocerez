import json

import httpx
import respx

from app.pricing import PriceCache, normalize
from app.tools import build_tools, days_until, normalize_meal, safety_payload
from tests.conftest import API, G, GROUP_ID, TOKEN, safety_ok


def tools_by_name(ctx, client, sink, state, settings, pricer):
    return {t.tool_name: t for t in build_tools(ctx, client, sink, state, settings, pricer=pricer)}


def household(today="2026-10-11"):
    return {"today": today, "timeZone": "America/Chicago", "zipCode": "64105",
            "members": [{"displayName": "Carson", "allergens": ["peanuts"], "diets": []},
                        {"displayName": "Maya", "allergens": ["milk"], "diets": ["vegetarian"]}]}


MEAL_A = {"title": "Rice bowl", "day": "Mon", "minutes": 20, "servings": 2,
          "ingredients": ["Rice", "Lemons"], "missing": ["Lemons"], "steps": ["Cook rice.", "Add lemon."]}
MEAL_B = {"title": "Egg rice", "day": "Tue", "minutes": 15, "servings": 2,
          "ingredients": ["Rice", "Eggs", "Cilantro"], "missing": ["Cilantro"], "steps": ["Fry eggs."]}


# ─── reads ───────────────────────────────────────────────────────────────────


@respx.mock
async def test_get_household_path_auth_and_compact_output(ctx, client, sink, state, settings, make_pricer):
    route = respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household()))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["get_household"]())
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out["members"][0] == {"name": "Carson", "allergens": ["peanuts"]}
    assert out["members"][1] == {"name": "Maya", "allergens": ["milk"], "diets": ["vegetarian"]}
    assert "timeZone" not in out
    assert state.done_labels["get_household"] == "Checking allergies: Carson (peanuts), Maya (milk)"
    assert state.done_details["get_household"] == "2 people"


def cabinet_rows():
    def row(name, exp, status="in_stock"):
        return {"item": {"name": name}, "status": status, "expiresAt": exp}

    return [row("Rice", None), row("Chicken Breast", "2026-10-14"), row("Spinach", "2026-10-13"),
            row("Old Milk", "2026-10-09"), row("Salt", "2027-01-01"), row("Cheddar", "2026-10-12")]


@respx.mock
async def test_get_cabinet_compact_sorted_and_blocked_items_marked(ctx, client, sink, state, settings, make_pricer):
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household("2026-10-11")))
    respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=cabinet_rows()))

    def safety(request):
        meals = json.loads(request.content)["meals"]
        assert meals[0]["title"] == "Cabinet 1" and "Cheddar" in meals[0]["ingredients"]
        return httpx.Response(200, json={"meals": [
            {"title": "Cabinet 1", "passes": False, "unknown": [],
             "problems": [{"ingredient": "Cheddar", "reason": "contains milk", "members": ["Maya"]}]}]})

    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["get_cabinet"]())
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out["expiring_days"] == ["Old Milk (expired)", "Spinach (2d)", "Chicken Breast (3d)"]
    assert out["in_stock"] == ["Salt", "Rice"]
    assert out["blocked"] == ["Cheddar"]
    assert "cheddar" in state.cabinet_names


@respx.mock
async def test_get_cabinet_caps_at_40_and_survives_safety_outage(ctx, client, sink, state, settings, make_pricer):
    rows = [{"item": {"name": f"Item{i}"}, "status": "in_stock", "expiresAt": "2026-11-01"} for i in range(60)]
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=household()))
    respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=rows))
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(503))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["get_cabinet"]())
    assert len(out["in_stock"]) + len(out["expiring_days"]) == 40 and "blocked" not in out


def test_days_until_uses_household_today_not_utc():
    assert days_until("2026-10-12", "2026-10-11") == 1
    assert days_until("2026-10-12", "2026-10-12") == 0
    assert days_until("2026-10-12", "2026-10-13") == -1
    assert days_until(None, "2026-10-11") is None
    assert days_until("garbage", "2026-10-11") is None


@respx.mock
async def test_shopping_list_unchecked_only(ctx, client, sink, state, settings, make_pricer):
    rows = [{"item": {"name": "Milk"}, "checked": False}, {"item": {"name": "Eggs"}, "checked": True}]
    respx.get(f"{G}/shopping-list").mock(return_value=httpx.Response(200, json=rows))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert json.loads(await t["get_shopping_list"]()) == ["Milk"]
    assert state.done_labels["get_shopping_list"] == "1 already on the list"


@respx.mock
async def test_get_wants_uses_userid_all(ctx, client, sink, state, settings, make_pricer):
    rows = [{"item": {"name": "Milk"}, "user": {"displayName": "Maya"}},
            {"item": {"name": "Milk"}, "user": {"displayName": "Sam"}}]
    route = respx.get(f"{G}/preferences").mock(return_value=httpx.Response(200, json=rows))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["get_wants"]())
    assert route.calls.last.request.url.params["userId"] == "all"
    assert out == ["Milk (Maya, Sam)"]


# ─── error handling ──────────────────────────────────────────────────────────


@respx.mock
async def test_non_2xx_becomes_readable_string_never_raises(ctx, client, sink, state, settings, make_pricer):
    route = respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(503))
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(404))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert await t["get_cabinet"]() == "error: cabinet unavailable (503)"
    assert route.call_count == 2  # one retry on 5xx
    assert "get_cabinet" in state.failed_tools
    assert (await t["get_household"]()).startswith("error: household request failed (404)")


@respx.mock
async def test_422_includes_server_message_truncated(ctx, client, sink, state, settings, make_pricer):
    msg = "titles must be unique " + "x" * 400
    respx.get(f"{G}/shopping-list").mock(return_value=httpx.Response(422, json={"error": {"message": msg}}))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = await t["get_shopping_list"]()
    assert out.startswith("error: shopping list request failed (422): titles must be unique")
    assert len(out) < 220


@respx.mock
async def test_401_is_fatal_and_notifies(ctx, client, sink, state, settings, make_pricer):
    calls = []
    client.on_fatal = calls.append
    respx.get(f"{G}/shopping-list").mock(return_value=httpx.Response(401))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert "not authorized" in await t["get_shopping_list"]()
    assert calls == [401] and client.fatal_status == 401


@respx.mock
async def test_timeout_is_retried_then_readable(ctx, client, sink, state, settings, make_pricer):
    route = respx.get(f"{G}/shopping-list").mock(side_effect=httpx.ConnectTimeout("slow"))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert await t["get_shopping_list"]() == "error: shopping list unavailable (timeout)"
    assert route.call_count == 2


@respx.mock
async def test_unexpected_exception_in_send_does_not_escape(ctx, client, sink, state, settings, make_pricer):
    respx.get(f"{G}/shopping-list").mock(side_effect=RuntimeError("boom"))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert (await t["get_shopping_list"]()).startswith("error: shopping list unavailable")


# ─── safety payload (mirrors apply) ──────────────────────────────────────────


def test_normalize_meal_enforces_missing_subset_and_derives_uses():
    m = normalize_meal({"title": " Bowl ", "ingredients": ["Rice", "rice", "Beans"], "missing": ["Lime", "beans"],
                        "steps": ["Cook."]})
    assert m["title"] == "Bowl"
    assert m["ingredients"] == ["Rice", "Beans", "Lime"]  # missing ⊆ ingredients, de-duplicated
    assert m["uses"] == ["Rice"]
    assert m["missing"] == ["Lime", "beans"]


def test_safety_payload_has_steps_union_ingredients_and_to_buy():
    a, b = normalize_meal(MEAL_A), normalize_meal(MEAL_B)
    payload = safety_payload([a, b])
    assert payload[0] == {"title": "Rice bowl", "steps": ["Cook rice.", "Add lemon."],
                          "ingredients": ["Rice", "Lemons"]}
    assert payload[-1] == {"title": "To buy", "ingredients": ["Lemons", "Cilantro"]}
    assert len(payload) == 3


@respx.mock
async def test_check_meal_safety_sends_steps_and_to_buy_and_returns_all_pass(
    ctx, client, sink, state, settings, make_pricer
):
    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["check_meal_safety"]([MEAL_A, MEAL_B]))
    sent = json.loads(route.calls.last.request.content)["meals"]
    assert [m["title"] for m in sent] == ["Rice bowl", "Egg rice", "To buy"]
    assert sent[0]["steps"] == ["Cook rice.", "Add lemon."]
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert out == {"all_pass": True}
    assert state.to_buy_ok and set(state.draft_meals) == {"Rice bowl", "Egg rice"}
    assert state.done_labels["check_meal_safety"] == "Safety check: 2/2 pass"


@respx.mock
async def test_check_meal_safety_failure_output_and_label(ctx, client, sink, state, settings, make_pricer):
    resp = {"meals": [
        {"title": "Rice bowl", "passes": True, "problems": [], "unknown": []},
        {"title": "Egg rice", "passes": False, "unknown": [],
         "problems": [{"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]},
        {"title": "To buy", "passes": True, "problems": [], "unknown": []},
    ]}
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=resp))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["check_meal_safety"]([MEAL_A, MEAL_B]))
    assert out["all_pass"] is False and out["failed"][0]["title"] == "Egg rice"
    assert "revise_meal" in out["instruction"]
    assert state.done_labels["check_meal_safety"] == "Safety check: 1/2 pass · 1 failed: Peanut Butter, fixing…"


@respx.mock
async def test_check_meal_safety_error_clears_drafts(ctx, client, sink, state, settings, make_pricer):
    respx.post(f"{G}/agent/safety-check").mock(side_effect=[httpx.Response(200, json={"meals": []}),
                                                             httpx.Response(503), httpx.Response(503)])
    state.draft_meals = {"old": {}}
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = await t["check_meal_safety"]([MEAL_A])  # mismatched response -> error
    assert out.startswith("error:") and state.draft_meals == {} and not state.to_buy_ok


async def test_check_meal_safety_invalid_input_returns_error(ctx, client, sink, state, settings, make_pricer):
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = await t["check_meal_safety"]([{"title": "A", "ingredients": []}])
    assert out.startswith("error:")


UNVERIFIED = {"ingredient": "za'atar", "reason": "couldn't verify ingredients (allergy household)", "members": []}


@respx.mock
async def test_unverifiable_ingredient_failure_tells_model_to_replace_via_revise_meal(
    ctx, client, sink, state, settings, make_pricer
):
    bad = {"meals": [
        {"title": "Rice bowl", "passes": False, "unknown": [], "problems": [UNVERIFIED]},
        {"title": "Egg rice", "passes": True, "problems": [], "unknown": []},
        {"title": "To buy", "passes": True, "problems": [], "unknown": []}]}
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=bad))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["check_meal_safety"]([MEAL_A, MEAL_B]))
    assert out["all_pass"] is False
    ins = out["instruction"]
    assert "za'atar" in ins and "common grocery item" in ins and "drop them" in ins and "revise_meal" in ins
    assert "not a redraft" in ins


@respx.mock
async def test_revise_meal_also_returns_unverifiable_instruction(ctx, client, sink, state, settings, make_pricer):
    respx.post(f"{G}/agent/safety-check").mock(side_effect=[
        httpx.Response(200, json={"meals": [
            {"title": "Rice bowl", "passes": True, "problems": [], "unknown": []},
            {"title": "To buy", "passes": True, "problems": [], "unknown": []}]}),
        httpx.Response(200, json={"meals": [
            {"title": "Rice bowl", "passes": False, "unknown": [], "problems": [UNVERIFIED]},
            {"title": "To buy", "passes": True, "problems": [], "unknown": []}]}),
    ])
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    await t["check_meal_safety"]([MEAL_A])
    out = json.loads(await t["revise_meal"]("Rice bowl", add=["za'atar"]))
    assert out["passes"] is False and "za'atar" in out["instruction"] and "common grocery item" in out["instruction"]


@respx.mock
async def test_plain_failure_has_no_unverifiable_hint(ctx, client, sink, state, settings, make_pricer):
    bad = {"meals": [{"title": "Rice bowl", "passes": False, "unknown": [], "problems": [
        {"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]},
        {"title": "To buy", "passes": True, "problems": [], "unknown": []}]}
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json=bad))
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    out = json.loads(await t["check_meal_safety"]([MEAL_A]))
    assert "UNVERIFIABLE" not in out["instruction"]


# ─── revise_meal ─────────────────────────────────────────────────────────────


@respx.mock
async def test_revise_meal_rechecks_only_that_meal(ctx, client, sink, state, settings, make_pricer):
    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    await t["check_meal_safety"]([MEAL_A, MEAL_B])
    state.cabinet_names = {"rice", "eggs"}
    route.calls.reset()
    out = json.loads(await t["revise_meal"]("Egg rice", remove=["cilantro"], add=["Scallions"],
                                            steps=["Fry eggs with scallions."], new_title="Scallion egg rice"))
    sent = json.loads(route.calls.last.request.content)["meals"]
    assert [m["title"] for m in sent] == ["Scallion egg rice", "To buy"]  # not "Rice bowl": only the patched meal
    assert sent[0]["steps"] == ["Fry eggs with scallions."]
    assert sent[1]["ingredients"] == ["Lemons", "Scallions"]
    assert out == {"passes": True, "title": "Scallion egg rice", "all_meals_pass": True}
    meal = state.draft_meals["Scallion egg rice"]
    assert "Cilantro" not in meal["ingredients"] and meal["missing"] == ["Scallions"]  # new, not in cabinet
    assert list(state.draft_meals) == ["Rice bowl", "Scallion egg rice"]  # order kept


@respx.mock
async def test_revise_meal_unknown_title_and_error_paths(ctx, client, sink, state, settings, make_pricer):
    respx.post(f"{G}/agent/safety-check").mock(side_effect=[httpx.Response(503), httpx.Response(503)])
    t = tools_by_name(ctx, client, sink, state, settings, make_pricer())
    assert "Run check_meal_safety first" in await t["revise_meal"]("Nope")
    state.draft_meals = {"Rice bowl": normalize_meal(MEAL_A)}
    out = await t["revise_meal"]("Rice bowl", remove=["Rice"])
    assert out.startswith("error:") and state.draft_meals == {}  # #7: re-check error clears the drafts


# ─── pricing service (off the critical path) ─────────────────────────────────


async def test_estimate_for_prices_exactly_final_names(make_pricer, state, cache):
    svc = make_pricer(['{"prices":[[300,450],[250,400]]}'])
    svc.start(["Lemons", "Salsa"])
    assert await svc.estimate_for(["salsa", "Lemons"], 2) == (550, 850)
    assert svc.agent.calls == 1
    assert cache.get("Lemons", "64105") == (300, 450)


async def test_estimate_for_changed_names_restarts_and_never_sums_stale(make_pricer):
    svc = make_pricer(['{"prices":[[300,450],[250,400]]}', '{"prices":[[100,200]]}'])
    svc.start(["Lemons", "Salsa"])
    await svc.estimate_for(["Lemons", "Salsa"], 2)
    # the final plan only needs Lemons: cached, so it is the sum of Lemons alone (Salsa is not included)
    assert await svc.estimate_for(["Lemons"], 2) == (300, 450)


async def test_estimate_for_partial_result_is_omitted(make_pricer, state):
    svc = make_pricer(['{"prices":[[1,2],[3,4]]}', '{"prices":[[1,2],[3,4]]}'])  # wrong count twice -> nothing priced
    assert await svc.estimate_for(["Lemons"], 2) is None


async def test_estimate_for_timeout_skips_and_posts_step(make_pricer, sink):
    svc = make_pricer(['{"prices":[[1,2]]}'], delay=5)
    svc.start(["Lemons"])
    assert await svc.estimate_for(["Lemons"], 0.05) is None
    assert sink._queue.qsize() >= 1 or sink._consumer is not None
    svc.cancel()


async def test_no_zip_skips_pricing(make_pricer):
    svc = make_pricer(zip_code=None)
    svc.start(["Lemons"])
    assert await svc.estimate_for(["Lemons"], 1) is None
    assert svc.agent.calls == 0


def test_parse_pairs_tolerates_a_dropped_closing_bracket():
    from app.pricing import parse_pairs

    assert parse_pairs('{"prices":[[150,250],[200,400],[150,300],[150,300]}\n') == [(150, 250), (200, 400), (150, 300), (150, 300)]
    assert parse_pairs('```json\n{"prices":[[1,2]]}\n```') == [(1, 2)]


def test_price_cache_evicts_oldest_beyond_cap():
    c = PriceCache(max_entries=3)
    for i in range(5):
        c.set(f"item{i}", "64105", (i, i))
    assert len(c) == 3 and c.get("item0", "64105") is None and c.get("item4", "64105") == (4, 4)
    assert normalize("  Fresh   Lemons ") == "fresh lemons"
