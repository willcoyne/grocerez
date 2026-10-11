"""Index-first ideas (spec section 12.1): course parsing, --refresh, suggest_recipes/use_recipe, distance threshold."""
import asyncio
import importlib.util
import json
from dataclasses import replace
from pathlib import Path

import httpx
import respx

from app.config import Settings
from app.hooks import StepReporter
from app.indexer import Crawler, HostLimiter, StateFile
from app.recipes import RecipeService, parse_course, parse_recipe_html
from app.runner import load_planner_prompt
from app.schemas import IndexedRecipe, RecipeSearchBody
from app.tools import build_tools
from tests.conftest import EVENTS, G, FakePriceAgent, safety_ok
from tests.test_hooks import after

SEARCH = f"{G}/agent/recipes/search"
TAVILY = "https://api.tavily.com/search"
DATES = ("2026-10-12", "2026-10-13", "2026-10-14")


# ─── course parsing & contract ───────────────────────────────────────────────


def test_parse_course_handles_strings_lists_commas_case_and_dupes():
    assert parse_course("Main Course") == ["main course"]
    assert parse_course(["Dinner", "Main Course, Entree", "dinner"]) == ["dinner", "main course", "entree"]
    assert parse_course("Dinner,  Lunch ,") == ["dinner", "lunch"]
    assert parse_course(None) == [] and parse_course(7) == [] and parse_course([None, 3]) == []
    assert len(parse_course([f"c{i}" for i in range(20)])) == 8


def recipe_page(category, title="Lemon Chicken"):
    ld = {"@type": "Recipe", "name": title, "recipeIngredient": ["1 lb chicken", "2 lemons", "1 tsp salt"],
          "recipeInstructions": ["Cook.", "Serve."], "recipeCategory": category}
    return f'<script type="application/ld+json">{json.dumps(ld)}</script>'


def test_parser_reads_recipe_category_into_course():
    r = parse_recipe_html(recipe_page(["Main Course", "Dinner, Chicken"]), "https://www.bbcgoodfood.com/x")
    assert r.course == ["main course", "dinner", "chicken"]
    assert parse_recipe_html(recipe_page(None), "https://www.bbcgoodfood.com/x").course == []


def test_contract_mirrors_course_and_browse():
    base = {"url": "https://a.test/r", "site": "S", "title": "T", "imageUrl": None, "minutes": 5, "servings": 2,
            "ingredientLines": ["1 cup rice"], "ingredients": ["Rice"]}
    assert IndexedRecipe.model_validate(base).course == []  # default for older crawls
    assert IndexedRecipe.model_validate({**base, "course": ["main course"]}).course == ["main course"]
    assert not RecipeSearchBody(query="dinner").browse and RecipeSearchBody(query="dinner", browse=True).browse


D = "recipes-test.com"


def slug(n):
    return f"https://{D}/chicken-recipe-{n:03d}/"


@respx.mock
async def test_crawler_sends_course_and_refresh_refetches_done_urls():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    respx.get(f"https://{D}/sitemap.xml").mock(return_value=httpx.Response(200, text="<urlset>" + "".join(
        f"<url><loc>{slug(i)}</loc></url>" for i in range(3)) + "</urlset>"))
    routes = [respx.get(slug(i)).mock(return_value=httpx.Response(
        200, html=recipe_page("Main Course", f"Lemon Chicken {i}"), headers={"content-type": "text/html"}))
        for i in range(3)]
    sett = Settings(_env_file=None, recipe_domains=[D])

    async def run(state):
        async def fake_sleep(s):
            return None

        c = Crawler(sett, per_domain=5, state=state, limiter=HostLimiter(sleep=fake_sleep, clock=lambda: 0.0))
        got = []

        async def emit(r):
            got.append(r)

        await c.crawl_domain(D, emit)
        return got

    state = StateFile(None)
    first = await run(state)
    assert len(first) == 3 and all(r.course == ["main course"] for r in first)
    assert all(rt.call_count == 1 for rt in routes)
    assert await run(state) == [] and all(rt.call_count == 1 for rt in routes)  # resume: nothing is fetched again
    state.refresh = True  # --refresh: re-fetch and re-send everything, ignoring the skip
    third = await run(state)
    assert len(third) == 3 and all(rt.call_count == 2 for rt in routes)


def test_cli_has_a_refresh_flag():
    path = Path(__file__).resolve().parents[1] / "scripts" / "build_recipe_index.py"
    spec = importlib.util.spec_from_file_location("brix", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.build_parser().parse_args(["--refresh"]).refresh is True
    assert mod.build_parser().parse_args([]).refresh is False


# ─── suggest_recipes / use_recipe ────────────────────────────────────────────


def hh():
    return {"today": "2026-10-11", "timeZone": "UTC", "zipCode": None,
            "members": [{"displayName": "Maya", "allergens": ["milk"], "diets": []}]}


def cabinet():
    def row(name, exp):
        return {"item": {"name": name}, "status": "in_stock", "expiresAt": exp}

    return [row("Rice", None), row("Chicken Breast", "2026-10-14"), row("Spinach", "2026-10-13"),
            row("Eggs", "2026-10-25"), row("Garlic", None), row("Salt", None), row("Tomatoes", "2026-10-12"),
            row("Beans", "2026-10-15"), row("Peppers", "2026-10-16"), row("Pasta", "2026-10-17"),
            row("Carrots", "2026-10-18"), row("Milk", "2026-10-11")]


def hit(n, title, lines, ingredients=None, distance=0.2, uses=None):
    return {"id": f"{n:08x}-4a5e-4f60-8a7b-9c0d1e2f3a4b",
            "url": f"https://www.seriouseats.com/{title.lower().replace(' ', '-')}",
            "site": "Serious Eats", "title": title, "imageUrl": "https://cdn.test/i.jpg", "minutes": 30, "servings": 4,
            "ingredientLines": lines, "ingredients": ingredients or [ln.split(" ", 2)[-1].title() for ln in lines],
            "course": ["main course"], "distance": distance, "uses": uses or []}


HITS = [
    hit(1, "Spinach Chicken Rice", ["1 lb chicken breast", "2 cups spinach", "1 cup rice", "1 lemon"],
        ["Chicken Breast", "Spinach", "Rice", "Lemon"], uses=["Spinach", "Chicken Breast"]),
    hit(2, "Tomato Garlic Beans", ["1 can beans", "3 tomatoes", "2 cloves garlic"], ["Beans", "Tomatoes", "Garlic"],
        uses=["Tomatoes"]),
    hit(3, "Fancy Saffron Stew", ["1 lb lamb", "saffron", "tahini", "sumac", "fennel", "leeks", "capers", "quinoa"],
        ["Lamb", "Saffron", "Tahini", "Sumac", "Fennel", "Leeks", "Capers", "Quinoa"]),
]


def tools_for(ctx, client, sink, state, settings, make_pricer, *, index=True, recipes=None):
    svc = recipes or RecipeService(
        settings, steps_agent_factory=lambda: FakePriceAgent(['{"steps":["Cook it.","Serve."]}']))
    return {t.tool_name: t for t in build_tools(ctx, client, sink, state, settings, pricer=make_pricer(),
                                                recipes=svc, recipe_index=index)}


def mock_world(hits=HITS):
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json=hh()))
    cab = respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=cabinet()))
    search = respx.post(SEARCH).mock(return_value=httpx.Response(200, json={"available": True, "recipes": hits}))
    safety = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    return cab, search, safety


@respx.mock
async def test_suggest_recipes_browses_with_expiring_items_and_returns_a_compact_list(
    ctx, client, sink, state, settings, make_pricer
):
    _, search, _ = mock_world()
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    out = json.loads(await t["suggest_recipes"]())
    body = json.loads(search.calls[0].request.content)
    assert body["browse"] is True and body["query"] == "dinner" and body["limit"] == 10
    # expiring items, soonest first, at most 6
    assert body["mustUse"] == ["Milk", "Tomatoes", "Spinach", "Chicken Breast", "Beans", "Peppers"]
    assert search.calls[0].request.headers["authorization"].startswith("Bearer ")
    assert [s["id"] for s in out] == ["00000001", "00000002", "00000003"]
    assert set(out[0]) == {"id", "title", "site", "minutes", "uses", "missingCount"}
    assert out[0]["uses"] == ["Spinach", "Chicken Breast"] and out[0]["missingCount"] == 1  # lemon
    assert out[2]["missingCount"] == 8
    assert state.done_labels["suggest_recipes"] == "3 dinners that fit"


@respx.mock
async def test_suggest_and_get_cabinet_share_one_cabinet_request(ctx, client, sink, state, settings, make_pricer):
    cab, _, _ = mock_world()
    t = tools_for(ctx, client, sink, state, settings, make_pricer)
    await asyncio.gather(t["get_household"](), t["get_cabinet"](), t["suggest_recipes"]())
    assert cab.call_count == 1  # same-turn tools do not read the cabinet twice


@respx.mock
async def test_suggest_with_no_index_results_points_to_find_recipe(ctx, client, sink, state, settings, make_pricer):
    mock_world(hits=[])
    t = tools_for(ctx, client, sink, state, settings, make_pricer)
    out = json.loads(await t["suggest_recipes"]())
    assert out["suggestions"] == [] and "find_recipe" in out["note"]


@respx.mock
async def test_use_recipe_builds_the_meal_with_its_date_and_preview(ctx, client, sink, state, settings, make_pricer):
    _, search, safety = mock_world()
    events = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["get_cabinet"]()
    await t["suggest_recipes"]()
    searches = search.call_count
    out = json.loads(await t["use_recipe"]("00000001", date="2026-10-13"))
    assert search.call_count == searches  # no second search
    assert out == {"found": True, "title": "Spinach Chicken Rice", "site": "Serious Eats",
                   "uses": ["Chicken Breast", "Spinach", "Rice"], "missing": ["Lemon"]}
    meal = state.draft_meals["Spinach Chicken Rice"]
    assert meal["date"] == "2026-10-13" and meal["day"] == "Tue"
    assert meal["source"]["site"] == "Serious Eats" and meal["ingredientLines"][0] == "1 lb chicken breast"
    assert meal["steps"] == ["Cook it.", "Serve."]  # model-written from title + ingredients (the index has no steps)
    sent = [m for c in safety.calls for m in json.loads(c.request.content)["meals"]
            if m["title"] == "Spinach Chicken Rice"][0]  # the batched safety check ran, lines included
    assert sent["ingredientLines"][0] == "1 lb chicken breast" and sent["title"] == "Spinach Chicken Rice"
    await StepReporter(sink, state).after(after("use_recipe", {"id": "00000001", "date": "2026-10-13"}))
    await sink.flush()
    payloads = [json.loads(c.request.content)["payload"] for c in events.calls]
    done = [p for p in payloads if p["id"] == "use_00000001"][-1]
    assert done["label"] == "Found: Spinach Chicken Rice (Serious Eats)"
    assert done["preview"] == {"date": "2026-10-13", "title": "Spinach Chicken Rice", "site": "Serious Eats"}


@respx.mock
async def test_unsafe_pick_is_rejected_with_a_readable_message_and_nothing_is_stored(
    ctx, client, sink, state, settings, make_pricer
):
    mock_world()

    def safety(request):
        m = json.loads(request.content)["meals"][0]
        return httpx.Response(200, json={"meals": [{"title": m["title"], "unknown": [], "passes": False, "problems": [
            {"ingredient": "Parmesan", "reason": "contains milk", "members": ["Maya"]}]}]})

    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["suggest_recipes"]()
    out = await t["use_recipe"]("00000002", date="2026-10-12")
    assert out.startswith("error: 'Tomato Garlic Beans' is not safe for this household")
    assert "contains milk (Parmesan)" in out and "Pick a different id" in out
    assert state.draft_meals == {} and state.pending_finds == 0


@respx.mock
async def test_use_recipe_errors_for_unknown_and_already_used_ids(ctx, client, sink, state, settings, make_pricer):
    mock_world()
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    assert "unknown recipe id" in await t["use_recipe"]("deadbeef", date="2026-10-12")
    await t["suggest_recipes"]()
    assert json.loads(await t["use_recipe"]("00000001", date="2026-10-12"))["found"] is True
    assert "already used" in await t["use_recipe"]("00000001", date="2026-10-13")


@respx.mock
async def test_duplicate_date_claims_get_distinct_dates(ctx, client, sink, state, settings, make_pricer):
    mock_world()
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["suggest_recipes"]()
    await asyncio.gather(t["use_recipe"]("00000001", date="2026-10-13"),
                         t["use_recipe"]("00000002", date="2026-10-13"))
    got = sorted(m["date"] for m in state.draft_meals.values())
    assert got == ["2026-10-12", "2026-10-13"]


@respx.mock
async def test_use_recipe_when_safety_is_down_says_so_and_stores_nothing(
    ctx, client, sink, state, settings, make_pricer
):
    mock_world()
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(503))
    t = tools_for(replace(ctx, dates=DATES), client, sink, state, settings, make_pricer)
    await t["suggest_recipes"]()
    assert "safety check is unavailable" in await t["use_recipe"]("00000001", date="2026-10-12")
    assert state.draft_meals == {}


# ─── find_recipe distance threshold ──────────────────────────────────────────


def tavily_world():
    page_ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "name": "Allrecipes"},
        {"@type": "Recipe", "name": "Web Tomato Pasta", "image": "https://cdn.test/w.jpg", "totalTime": "PT20M",
         "recipeYield": "4", "recipeIngredient": ["1 lb pasta", "3 tomatoes", "2 cloves garlic"],
         "recipeInstructions": [{"@type": "HowToStep", "text": "Boil."}, {"@type": "HowToStep", "text": "Toss."}]}]}
    route = respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": [
        {"url": "https://www.allrecipes.com/tomato-pasta"}]}))
    respx.get("https://www.allrecipes.com/tomato-pasta").mock(return_value=httpx.Response(
        200, html=f'<script type="application/ld+json">{json.dumps(page_ld)}</script>',
        headers={"content-type": "text/html"}))
    return route


def tav_settings():
    return Settings(_env_file=None, tavily_api_key="tvly-test", recipe_domains=["allrecipes.com"],
                    agent_shared_secret="s" * 40)


def web_service(s):
    return RecipeService(s, steps_agent_factory=lambda: FakePriceAgent(['{"steps":["Cook."]}']))


@respx.mock
async def test_far_index_hit_tries_tavily_first(ctx, client, sink, state, make_pricer):
    s = tav_settings()
    mock_world(hits=[hit(9, "Gazpacho Soup", ["4 tomatoes", "1 cucumber"], distance=0.62)])
    tavily = tavily_world()
    t = tools_for(ctx, client, sink, state, s, make_pricer, recipes=web_service(s))
    out = json.loads(await t["find_recipe"]("tomato garlic pasta"))
    assert tavily.called and out["title"] == "Web Tomato Pasta"


@respx.mock
async def test_far_index_hit_is_still_used_when_the_web_finds_nothing_safe(ctx, client, sink, state, make_pricer):
    s = tav_settings()
    mock_world(hits=[hit(9, "Gazpacho Soup", ["4 tomatoes", "1 cucumber"], distance=0.62)])
    respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": []}))
    t = tools_for(ctx, client, sink, state, s, make_pricer, recipes=web_service(s))
    assert json.loads(await t["find_recipe"]("tomato garlic pasta"))["title"] == "Gazpacho Soup"


@respx.mock
async def test_close_index_hit_does_not_touch_tavily(ctx, client, sink, state, make_pricer):
    s = tav_settings()
    mock_world(hits=[hit(9, "Tomato Garlic Pasta", ["1 lb pasta", "3 tomatoes", "2 cloves garlic"], distance=0.30)])
    tavily = respx.post(TAVILY).mock(return_value=httpx.Response(500))
    t = tools_for(ctx, client, sink, state, s, make_pricer, recipes=web_service(s))
    assert json.loads(await t["find_recipe"]("tomato garlic pasta"))["title"] == "Tomato Garlic Pasta"
    assert not tavily.called


# ─── registration & prompt order ─────────────────────────────────────────────


def test_suggest_and_use_recipe_are_registered_only_with_the_index(ctx, client, sink, state, settings, make_pricer):
    with_index = tools_for(ctx, client, sink, state, settings, make_pricer, index=True)
    assert {"suggest_recipes", "use_recipe", "find_recipe"} <= set(with_index)
    names = list(with_index)
    assert names.index("suggest_recipes") < names.index("use_recipe") < names.index("check_meal_safety")
    s = tav_settings()
    only_web = tools_for(ctx, client, sink, state, s, make_pricer, index=False, recipes=web_service(s))
    assert "find_recipe" in only_web and "suggest_recipes" not in only_web and "use_recipe" not in only_web
    neither = tools_for(ctx, client, sink, state, settings, make_pricer, index=False)
    assert not ({"find_recipe", "suggest_recipes", "use_recipe"} & set(neither))


def test_prompt_variants_have_the_new_order_and_only_what_is_registered():
    p = load_planner_prompt(True, suggest=True)
    assert p.index("`suggest_recipes`") < p.index("`use_recipe(id") < p.index("`find_recipe(idea") < p.index("LAST resort")
    assert "AND `suggest_recipes` together" in p and "different main protein" in p
    assert "ONLY for a date where nothing suggested fits" in p and "<!--" not in p
    web = load_planner_prompt(True)
    assert "find_recipe(idea" in web and "suggest_recipes" not in web and "use_recipe" not in web
    own = load_planner_prompt(False)
    assert not any(w in own for w in ("find_recipe", "suggest_recipes", "use_recipe")) and "<!--" not in own
    for text in (p, web, own):
        assert "propose_plan" in text and "Then:" in text
