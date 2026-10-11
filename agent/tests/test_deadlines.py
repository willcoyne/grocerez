"""Deadline-first meal scheduling (spec section 14): EDF dates, hard deadlines, refusals, expired items. No network."""
import json
from dataclasses import replace

import httpx
import respx

from app.tools import assign_dates, meal_deadline
from tests.conftest import G
from tests.test_dates import DATES, meal
from tests.test_suggest import HITS, SEARCH, cabinet, hh, mock_world, tools_for

TODAY = "2026-10-11"
EXPIRY = {"spinach": 2, "milk": 0, "old kale": -3}  # normalized cabinet name -> days left


def dl(m):
    found = meal_deadline(m, EXPIRY, TODAY)
    return found[0] if found else None


# ─── pure scheduling ─────────────────────────────────────────────────────────


def test_meal_deadline_uses_soonest_unexpired_item_and_skips_expired():
    assert meal_deadline(meal("A", uses=["Baby Spinach", "Milk"]), EXPIRY, TODAY) == ("2026-10-11", "milk")
    assert meal_deadline(meal("B", uses=["Spinach"]), EXPIRY, TODAY) == ("2026-10-13", "spinach")
    assert meal_deadline(meal("C", uses=["Kale", "Old Kale"]), EXPIRY, TODAY) is None  # expired: not usable
    assert meal_deadline(meal("D", uses=["Rice"]), EXPIRY, TODAY) is None


def test_edf_orders_by_deadline_with_no_deadline_last():
    meals = [meal("Plain", uses=["Rice"]), meal("Milky", uses=["Milk"]), meal("Spin", uses=["Spinach"])]
    out, missing = assign_dates(meals, list(DATES[:3]), dl)
    assert [(m["title"], m["date"]) for m in out] == [("Milky", DATES[0]), ("Spin", DATES[1]), ("Plain", DATES[2])]
    assert missing == []


def test_a_meal_is_never_dated_after_its_deadline():
    # the model dated the spinach meal on Wed 14, past its 13th deadline; the other two hold Mon 12 and Tue 13
    meals = [meal("Plain", DATES[0]), meal("Spin", DATES[2], uses=["Spinach"]), meal("Other", DATES[1])]
    notes: list[str] = []
    out, _ = assign_dates(meals, list(DATES[:3]), dl, notes)
    by = {m["title"]: m["date"] for m in out}
    assert by["Spin"] <= "2026-10-13" and notes == []
    assert len(set(by.values())) == 3


def test_impossible_deadline_falls_back_to_earliest_free_date_with_a_note():
    # Milk expires on the 11th but the first requested date is the 12th
    notes: list[str] = []
    out, _ = assign_dates([meal("Milky", uses=["Milk"]), meal("Plain")], list(DATES[:2]), dl, notes)
    assert out[0]["title"] == "Milky" and out[0]["date"] == DATES[0]
    assert len(notes) == 1 and "Milky" in notes[0] and "2026-10-11" in notes[0]


# ─── use_recipe / find_recipe refuse late dates ──────────────────────────────


@respx.mock
async def test_use_recipe_refuses_a_date_after_the_deadline_and_claims_nothing(
    ctx, client, sink, state, settings, make_pricer
):
    mock_world()
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["get_household"]()
    await t["get_cabinet"]()
    await t["suggest_recipes"]()
    out = await t["use_recipe"]("00000001", date="2026-10-14")  # spinach expires 2026-10-13
    assert out == ("Spinach expires Tue 13 — pick a date on or before 2026-10-13 "
                   "(free: 2026-10-12, 2026-10-13)")
    assert state.draft_meals == {} and not state.used_urls
    ok = json.loads(await t["use_recipe"]("00000001", date="2026-10-13"))  # retry on the deadline
    assert ok["found"] is True and state.draft_meals["Spinach Chicken Rice"]["date"] == "2026-10-13"


@respx.mock
async def test_find_recipe_refuses_a_late_date(ctx, client, sink, state, settings, make_pricer):
    mock_world()
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["get_household"]()
    await t["get_cabinet"]()
    out = await t["find_recipe"]("spinach chicken", must_use=["Spinach"], date="2026-10-14")
    assert out.startswith("Spinach expires Tue 13") and "2026-10-13" in out and "(free: 2026-10-12" in out
    assert state.draft_meals == {}


# ─── expired items are not usable ────────────────────────────────────────────


@respx.mock
async def test_expired_items_are_excluded_from_must_use(ctx, client, sink, state, settings, make_pricer):
    rows = [r for r in cabinet() if r["item"]["name"] != "Milk"]
    rows.append({"item": {"name": "Old Kale"}, "status": "in_stock", "expiresAt": "2026-10-08"})
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=hh()))
    respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=rows))
    search = respx.post(SEARCH).mock(return_value=httpx.Response(200, json={"available": True, "recipes": HITS}))
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["suggest_recipes"]()
    must = json.loads(search.calls[0].request.content)["mustUse"]
    assert "Old Kale" not in must and must[0] == "Tomatoes"
