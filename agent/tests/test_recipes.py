"""Cited web recipes: line cleaner, JSON-LD parsing, SSRF-safe fetching, Tavily, and the find_recipe tool. No network."""
import json

import httpx
import pytest
import respx

from app.config import Settings
from app.recipes import (
    MAX_BYTES,
    RecipeService,
    clean_ingredient,
    host_allowed,
    parse_duration,
    parse_image,
    parse_recipe_html,
    parse_yield,
    pretty_host,
    step_key,
    url_allowed,
)
from app.schemas import PlanMeal, PlanSource
from app.tools import build_tools
from tests.conftest import G, safety_ok

TAVILY = "https://api.tavily.com/search"
ALLOWED = ["allrecipes.com", "seriouseats.com"]
SECRET_METHOD = "Preheat the oven to 425 degrees and sear the chicken in a cast-iron skillet until deeply golden."


# ─── ingredient line cleaner ─────────────────────────────────────────────────


@pytest.mark.parametrize("line,expected", [
    ("2 cups shredded mozzarella, divided", "Mozzarella"),
    ("1 1/2 lbs boneless, skinless chicken breasts", "Chicken Breasts"),
    ("1 (14.5 oz) can diced tomatoes", "Tomatoes"),
    ("3 cloves garlic, minced", "Garlic"),
    ("2 tablespoons extra-virgin olive oil", "Olive Oil"),
    ("½ cup fresh basil leaves, torn", "Basil Leaves"),
    ("1/2 cup (1 stick) unsalted butter, melted", "Butter"),
    ("3 large eggs", "Eggs"),
    ("1 lb ground beef (85/15)", "Ground Beef"),
    ("Juice of 1 lemon", "Lemon"),
    ("Salt, to taste", "Salt"),
    ("2 tbsp olive oil, plus more for drizzling", "Olive Oil"),
    ("1 (15-ounce) can black beans, drained and rinsed", "Black Beans"),
    ("8 ounces penne pasta", "Penne Pasta"),
    ("1¼ cups all-purpose flour", "All-purpose Flour"),
    ("2-3 tablespoons soy sauce", "Soy Sauce"),
    ("1 cup cooked rice", "Rice"),
    ("4 slices bacon, chopped", "Bacon"),
    ("1 bunch fresh cilantro, chopped", "Cilantro"),
    ("2 to 3 cups baby spinach", "Baby Spinach"),
    ("1 (8-ounce) package cream cheese, softened", "Cream Cheese"),
    ("Butter or margarine", "Butter"),
    ("1 teaspoon kosher salt", "Kosher Salt"),
    ("1 medium onion, diced", "Onion"),
    ("&frac12; cup milk", "Milk"),
])
def test_clean_ingredient_table(line, expected):
    assert clean_ingredient(line) == expected


@pytest.mark.parametrize("line", ["", "   ", "For the sauce:", "For the topping", "Marinade:", "1 cup", "()"])
def test_clean_ingredient_skips_headers_and_empties(line):
    assert clean_ingredient(line) is None


# ─── small parsers ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("value,minutes", [
    ("PT45M", 45), ("PT1H30M", 90), ("P0DT1H", 60), ("PT90M", 90), ("P1DT2H", 1560), ("PT0S", None),
    ("45 minutes", None), (None, None), (30, None),
])
def test_parse_duration(value, minutes):
    assert parse_duration(value) == minutes


def test_parse_yield_variants():
    assert parse_yield("4 servings") == 4
    assert parse_yield(["6", "6 servings"]) == 6
    assert parse_yield("Serves 4 to 6") == 4
    assert parse_yield(8) == 8
    assert parse_yield(None) is None


def test_parse_image_variants_and_https_only():
    assert parse_image("https://x.test/a.jpg") == "https://x.test/a.jpg"
    assert parse_image(["http://x.test/no.jpg", "https://x.test/b.jpg"]) == "https://x.test/b.jpg"
    assert parse_image({"@type": "ImageObject", "url": "https://x.test/c.jpg"}) == "https://x.test/c.jpg"
    assert parse_image([{"url": "https://x.test/d.jpg"}]) == "https://x.test/d.jpg"
    assert parse_image("http://x.test/e.jpg") is None and parse_image(None) is None


def test_pretty_host():
    assert pretty_host("www.seriouseats.com") == "Serious Eats"
    assert pretty_host("recipes.example-site.com") == "Recipes"


# ─── JSON-LD pages ───────────────────────────────────────────────────────────


def page(ld, head=""):
    return f'<html><head>{head}<script type="application/ld+json">{json.dumps(ld)}</script></head><body>x</body></html>'


GRAPH = {
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "WebSite", "name": "Serious Eats"},
        {"@type": "Organization", "name": "Serious Eats"},
        {
            "@type": ["Recipe"],
            "name": "Lemon Garlic Chicken &amp; Rice",
            "image": {"@type": "ImageObject", "url": "https://cdn.test/lemon.jpg"},
            "totalTime": "PT1H15M",
            "recipeYield": ["4", "4 servings"],
            "recipeIngredient": ["1 1/2 lbs boneless, skinless chicken breasts", "3 cloves garlic, minced",
                                 "2 lemons, juiced", "1 cup cooked rice", "Salt, to taste"],
            "recipeInstructions": [
                {"@type": "HowToSection", "name": "Cook", "itemListElement": [
                    {"@type": "HowToStep", "text": SECRET_METHOD},
                    {"@type": "HowToStep", "text": "Add the garlic."}]},
                {"@type": "HowToStep", "text": "Serve."},
            ],
        },
    ],
}


def test_parse_graph_page_with_howto_sections_and_image_object():
    r = parse_recipe_html(page(GRAPH), "https://www.seriouseats.com/lemon-chicken")
    assert r is not None
    assert r.title == "Lemon Garlic Chicken & Rice" and r.site == "Serious Eats"
    assert r.image == "https://cdn.test/lemon.jpg" and r.minutes == 75 and r.servings == 4
    assert r.ingredients == ["Chicken Breasts", "Garlic", "Lemons", "Rice", "Salt"]
    assert r.lines[0] == "1 1/2 lbs boneless, skinless chicken breasts" and len(r.lines) == 5
    assert r.step_count == 3


def test_parse_simple_page_with_prep_cook_times_og_site_and_string_instructions():
    ld = [{"@type": "Recipe", "name": "Egg Fried Rice", "image": ["https://cdn.test/e.jpg"],
           "prepTime": "PT10M", "cookTime": "PT15M", "recipeYield": "3 servings",
           "recipeIngredient": ["2 cups cooked rice", "3 large eggs", "1 tbsp soy sauce"],
           "recipeInstructions": "Cook the rice.\nScramble the eggs.\nCombine."}]
    head = '<meta property="og:site_name" content="Allrecipes">'
    r = parse_recipe_html(page(ld, head), "https://www.allrecipes.com/egg-rice")
    assert r.site == "Allrecipes" and r.minutes == 25 and r.servings == 3 and r.step_count == 3


def test_parse_defaults_when_time_and_yield_missing():
    ld = {"@type": "Recipe", "name": "Toast", "recipeIngredient": ["2 slices bread", "1 tbsp butter", "1 pinch salt"],
          "recipeInstructions": ["Toast the bread.", "Butter it."]}
    r = parse_recipe_html(page(ld), "https://www.delish.com/toast")
    assert (r.minutes, r.servings, r.image, r.site) == (30, 4, None, "Delish")


def test_page_without_json_ld_or_recipe_returns_none():
    assert parse_recipe_html("<html><body>no data</body></html>", "https://www.allrecipes.com/x") is None
    assert parse_recipe_html(page({"@type": "Article", "name": "Blog"}), "https://www.allrecipes.com/x") is None
    assert parse_recipe_html('<script type="application/ld+json">{not json</script>', "https://www.allrecipes.com/x") is None


# ─── allowlist / SSRF ────────────────────────────────────────────────────────


def test_host_and_url_allowlist_rules():
    assert host_allowed("www.seriouseats.com", ALLOWED) and host_allowed("seriouseats.com", ALLOWED)
    assert not host_allowed("evilseriouseats.com", ALLOWED)
    assert not host_allowed("seriouseats.com.evil.test", ALLOWED)
    assert not host_allowed("127.0.0.1", ALLOWED) and not host_allowed("[::1]", ALLOWED)
    assert url_allowed("https://www.allrecipes.com/r/1", ALLOWED)
    assert not url_allowed("http://www.allrecipes.com/r/1", ALLOWED)
    assert not url_allowed("https://user:pw@www.allrecipes.com/r/1", ALLOWED)
    assert not url_allowed("https://www.allrecipes.com:8443/r/1", ALLOWED)
    assert not url_allowed("https://169.254.169.254/latest", ALLOWED)
    assert not url_allowed("file:///etc/passwd", ALLOWED)


STEPS_JSON = '{"steps":["Sear the chicken in a hot pan until golden.","Stir in the garlic, then simmer with the rice."]}'


def mk_service(settings, steps=STEPS_JSON):
    """RecipeService whose step writer is a fake (unit tests never call a model)."""
    from tests.conftest import FakePriceAgent

    s = RecipeService(settings, steps_agent_factory=lambda: FakePriceAgent([steps]))
    s.steps_agent_calls = []
    return s


def svc(key="tvly-test") -> RecipeService:
    return RecipeService(Settings(_env_file=None, tavily_api_key=key, recipe_domains=ALLOWED))


@respx.mock
async def test_fetch_blocks_redirect_to_non_allowlisted_host():
    respx.get("https://www.allrecipes.com/r").mock(
        return_value=httpx.Response(302, headers={"location": "https://evil.test/steal"}))
    evil = respx.get("https://evil.test/steal").mock(return_value=httpx.Response(200, text="secrets"))
    assert await svc().fetch_html("https://www.allrecipes.com/r") is None
    assert not evil.called


@respx.mock
async def test_fetch_blocks_redirect_to_ip_literal_and_http_downgrade():
    respx.get("https://www.allrecipes.com/a").mock(
        return_value=httpx.Response(301, headers={"location": "https://169.254.169.254/"}))
    respx.get("https://www.allrecipes.com/b").mock(
        return_value=httpx.Response(301, headers={"location": "http://www.allrecipes.com/ok"}))
    s = svc()
    assert await s.fetch_html("https://www.allrecipes.com/a") is None
    assert await s.fetch_html("https://www.allrecipes.com/b") is None


@respx.mock
async def test_fetch_follows_allowlisted_redirects_up_to_three():
    respx.get("https://www.allrecipes.com/a").mock(return_value=httpx.Response(301, headers={"location": "/b"}))
    respx.get("https://www.allrecipes.com/b").mock(return_value=httpx.Response(302, headers={"location": "/c"}))
    respx.get("https://www.allrecipes.com/c").mock(return_value=httpx.Response(200, html="<html>ok</html>"))
    assert await svc().fetch_html("https://www.allrecipes.com/a") == "<html>ok</html>"
    for i in range(5):  # a chain longer than 3 redirects is refused
        respx.get(f"https://www.allrecipes.com/h{i}").mock(
            return_value=httpx.Response(302, headers={"location": f"/h{i + 1}"}))
    assert await svc().fetch_html("https://www.allrecipes.com/h0") is None


@respx.mock
async def test_fetch_rejects_oversize_non_200_and_non_html():
    respx.get("https://www.allrecipes.com/big").mock(
        return_value=httpx.Response(200, content=b"x" * (MAX_BYTES + 1), headers={"content-type": "text/html"}))
    respx.get("https://www.allrecipes.com/404").mock(return_value=httpx.Response(404))
    respx.get("https://www.allrecipes.com/pdf").mock(
        return_value=httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"}))
    s = svc()
    assert await s.fetch_html("https://www.allrecipes.com/big") is None
    assert await s.fetch_html("https://www.allrecipes.com/404") is None
    assert await s.fetch_html("https://www.allrecipes.com/pdf") is None


@respx.mock
async def test_fetch_never_requests_a_non_allowlisted_start_url():
    route = respx.get("https://evil.test/x").mock(return_value=httpx.Response(200, text="x"))
    assert await svc().fetch_html("https://evil.test/x") is None and not route.called


@respx.mock
async def test_tavily_request_shape_and_result_filtering():
    route = respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": [
        {"url": "https://www.seriouseats.com/a", "title": "A", "score": 0.9},
        {"url": "https://evil.test/b", "title": "B", "score": 0.8},
        {"url": "http://www.allrecipes.com/insecure", "title": "C", "score": 0.7},
        {"url": "https://www.allrecipes.com/d", "title": "D", "score": 0.6},
        {"url": "https://www.seriouseats.com/a", "title": "dup", "score": 0.5}]}))
    urls = await svc().search("lemon chicken recipe")
    assert urls == ["https://www.seriouseats.com/a", "https://www.allrecipes.com/d"]
    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer tvly-test"
    body = json.loads(req.content)
    assert body["include_domains"] == ALLOWED and body["query"] == "lemon chicken recipe"


@respx.mock
async def test_tavily_errors_return_empty_list():
    respx.post(TAVILY).mock(return_value=httpx.Response(401))
    assert await svc().search("x") == []
    respx.post(TAVILY).mock(side_effect=httpx.ConnectTimeout("slow"))
    assert await svc().search("x") == []


# ─── find_recipe tool ────────────────────────────────────────────────────────


def recipe_ld(name, lines, instr=SECRET_METHOD, site="Serious Eats"):
    lines = list(lines) + ["1 tsp salt", "2 tbsp water"][: max(0, 3 - len(lines))]  # real recipes have >= 3 lines
    return {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "name": site},
        {"@type": "Recipe", "name": name, "image": "https://cdn.test/i.jpg", "totalTime": "PT30M", "recipeYield": "4",
         "recipeIngredient": lines,
         "recipeInstructions": [{"@type": "HowToStep", "text": instr}, {"@type": "HowToStep", "text": "Serve."}]}]}


def mock_search(*urls):
    respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": [{"url": u} for u in urls]}))


def mock_page(url, ld):
    respx.get(url).mock(return_value=httpx.Response(200, html=page(ld), headers={"content-type": "text/html"}))


def find_tools(ctx, client, sink, state, settings, make_pricer, service):
    state.cabinet_names = {"chicken breast", "garlic", "rice", "spinach"}
    return {t.tool_name: t for t in build_tools(ctx, client, sink, state, settings, pricer=make_pricer(),
                                                recipes=service)}


@pytest.fixture
def tavily_settings():
    return Settings(_env_file=None, tavily_api_key="tvly-test", recipe_domains=ALLOWED, agent_shared_secret="s" * 40)


@respx.mock
async def test_unsafe_first_candidate_second_wins_and_meal_is_stored(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    mock_search("https://www.seriouseats.com/peanut-chicken", "https://www.allrecipes.com/lemon-chicken")
    mock_page("https://www.seriouseats.com/peanut-chicken", recipe_ld("Peanut Chicken", [
        "1 lb chicken breast", "3 cloves garlic", "1/2 cup peanut butter", "1 cup rice"]))
    mock_page("https://www.allrecipes.com/lemon-chicken", recipe_ld("Lemon Garlic Chicken", [
        "1 lb boneless skinless chicken breast", "3 cloves garlic, minced", "2 lemons", "1 cup rice"], site="Allrecipes"))

    def safety(request):
        meals = json.loads(request.content)["meals"]
        return httpx.Response(200, json={"meals": [
            {"title": m["title"], "unknown": [], "passes": "Peanut" not in m["title"],
             "problems": [{"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]
             if "Peanut" in m["title"] else []} for m in meals]})

    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    out = json.loads(await t["find_recipe"]("lemon chicken", must_use=["Chicken Breast"]))
    assert out["found"] is True and out["title"] == "Lemon Garlic Chicken" and out["site"] == "Allrecipes"
    assert out["missing"] == ["Lemons"]  # chicken, garlic and rice are in the cabinet
    sent = json.loads(route.calls[0].request.content)["meals"]
    assert len(sent) == 2 and all("ingredientLines" in m for m in sent)  # one batched call, lines included
    meal = state.draft_meals["Lemon Garlic Chicken"]
    assert meal["source"] == {"url": "https://www.allrecipes.com/lemon-chicken", "site": "Allrecipes",
                              "title": "Lemon Garlic Chicken", "imageUrl": "https://cdn.test/i.jpg"}
    assert meal["ingredientLines"][1] == "3 cloves garlic, minced"
    assert state.done_labels[step_key("lemon chicken")] == "Found: Lemon Garlic Chicken (Allrecipes)"
    PlanMeal.model_validate({**meal})  # the stored meal fits the frozen contract


@respx.mock
async def test_instructions_are_never_copied_into_steps(ctx, client, sink, state, tavily_settings, make_pricer):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice"]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    await t["find_recipe"]("chicken rice")
    steps = state.draft_meals["Chicken Rice"]["steps"]
    assert 1 <= len(steps) <= 6 and all(len(s.split()) <= 15 for s in steps)
    assert not any("cast-iron" in s or "425" in s for s in steps)


@respx.mock
async def test_candidates_are_ranked_by_must_use_items(ctx, client, sink, state, tavily_settings, make_pricer):
    mock_search("https://www.seriouseats.com/first", "https://www.allrecipes.com/second")
    mock_page("https://www.seriouseats.com/first", recipe_ld("Plain Rice", ["1 cup rice", "1 tsp salt"]))
    mock_page("https://www.allrecipes.com/second", recipe_ld("Spinach Rice", ["1 cup rice", "2 cups baby spinach"],
                                                             site="Allrecipes"))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    out = json.loads(await t["find_recipe"]("rice dish", must_use=["Spinach"]))
    assert out["title"] == "Spinach Rice"


@respx.mock
async def test_all_candidates_unsafe_falls_back_to_model_written_meal(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Peanut Noodles", ["1 cup peanut butter"]))
    respx.post(f"{G}/agent/safety-check").mock(return_value=httpx.Response(200, json={"meals": [
        {"title": "Peanut Noodles", "passes": False, "unknown": [], "problems": [
            {"ingredient": "Peanut Butter", "reason": "contains peanuts", "members": ["Carson"]}]}]}))
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    out = json.loads(await t["find_recipe"]("peanut noodles"))
    assert out["found"] is False and "Write the meal yourself" in out["note"]
    assert state.draft_meals == {} and state.pending_finds == 0


@respx.mock
async def test_no_tavily_key_falls_back_without_any_network(ctx, client, sink, state, settings, make_pricer):
    from app.runner import load_planner_prompt

    route = respx.post(TAVILY).mock(return_value=httpx.Response(500))
    # No key: the tool is not even registered, so the model never wastes a turn on it.
    t = find_tools(ctx, client, sink, state, settings, make_pricer, RecipeService(settings))
    assert "find_recipe" not in t and {"check_meal_safety", "revise_meal", "propose_plan"} <= set(t)
    assert "find_recipe" not in find_tools(ctx, client, sink, state, settings, make_pricer, None)
    assert not route.called
    # ...and the prompt takes the draft-all-meals-in-one-turn path
    own = load_planner_prompt(False)
    assert "find_recipe" not in own and "ALL 3 meals as FULL meals" in own
    assert "<!--" not in own and "Then:" in own and "propose_plan" in own


def test_key_set_registers_find_recipe_and_uses_the_recipe_prompt(ctx, client, sink, state, tavily_settings, make_pricer):
    from app.runner import load_planner_prompt

    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    assert "find_recipe" in t
    rec = load_planner_prompt(True)
    assert "find_recipe(idea" in rec and "ALL 3 meals as FULL meals" not in rec and "<!--" not in rec
    assert "propose_plan" in rec and "Then:" in rec


@respx.mock
async def test_tavily_outage_and_page_without_json_ld_fall_back(ctx, client, sink, state, tavily_settings, make_pricer):
    respx.post(TAVILY).mock(return_value=httpx.Response(503))
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    assert json.loads(await t["find_recipe"]("a"))["found"] is False
    mock_search("https://www.seriouseats.com/nojsonld")
    respx.get("https://www.seriouseats.com/nojsonld").mock(return_value=httpx.Response(200, html="<html>none</html>"))
    assert json.loads(await t["find_recipe"]("b"))["found"] is False


@respx.mock
async def test_sourced_meals_survive_a_fallback_check_and_lines_are_sent(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice", "1 lime"]))
    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    await t["find_recipe"]("chicken rice")
    own = {"title": "My Own Bowl", "ingredients": ["Rice", "Eggs"], "missing": ["Eggs"], "steps": ["Fry."],
           "day": None, "minutes": 10, "servings": 2}
    assert json.loads(await t["check_meal_safety"]([own])) == {"all_pass": True}
    assert list(state.draft_meals) == ["Chicken Rice", "My Own Bowl"]  # the cited meal was kept
    sent = json.loads(route.calls.last.request.content)["meals"]
    assert sent[0]["ingredientLines"] == ["1 lb chicken breast", "1 cup rice", "1 lime"]
    assert state.draft_meals["My Own Bowl"].get("source") is None


@respx.mock
async def test_revise_drops_the_citation_when_ingredients_change(ctx, client, sink, state, tavily_settings, make_pricer):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice", "1 lime"]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    await t["find_recipe"]("chicken rice")
    await t["revise_meal"]("Chicken Rice", remove=["Lime"])
    meal = state.draft_meals["Chicken Rice"]
    assert meal["source"] is None and meal["ingredientLines"] == []


@respx.mock
async def test_propose_carries_source_and_ingredient_lines_end_to_end(ctx, tavily_settings, monkeypatch):
    from app import runner as runner_mod
    from tests.conftest import EVENTS

    class ScriptedAgent:
        def __init__(self, model=None, tools=None, **kw):
            self.tools = {t.tool_name: t for t in tools}

        def cancel(self):
            pass

        async def invoke_async(self, prompt):
            await self.tools["get_cabinet"]()  # seeds the cabinet names
            out = json.loads(await self.tools["find_recipe"]("chicken rice", must_use=["Chicken Breast"]))
            assert out["found"] is True
            assert await self.tools["propose_plan"]({"summary": "One dinner."}) == "ok"
            return object()

    monkeypatch.setattr(runner_mod, "Agent", ScriptedAgent)
    events = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    respx.get(f"{G}/agent/household").mock(return_value=httpx.Response(200, json={
        "today": "2026-10-11", "timeZone": "UTC", "zipCode": None, "members": []}))
    respx.get(f"{G}/cabinet").mock(return_value=httpx.Response(200, json=[
        {"item": {"name": "Chicken Breast"}, "status": "in_stock", "expiresAt": "2026-10-13"}]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice", "1 lime"]))

    from tests.conftest import FakePriceAgent

    await runner_mod.run(ctx, tavily_settings, model=object(), retry_delay_s=0,
                         recipe_steps_factory=lambda: FakePriceAgent([STEPS_JSON]))
    bodies = [json.loads(c.request.content) for c in events.calls]
    proposed = [b for b in bodies if b["type"] == "proposed"]
    assert len(proposed) == 1
    meal = proposed[0]["payload"]["plan"]["meals"][0]
    assert meal["source"]["site"] == "Serious Eats" and meal["source"]["url"].startswith("https://")
    assert meal["ingredientLines"] == ["1 lb chicken breast", "1 cup rice", "1 lime"]
    assert meal["missing"] == ["Rice", "Lime"]  # the cabinet only has the chicken
    found_steps = [b["payload"]["label"] for b in bodies if b["type"] == "step"]
    assert "Found: Chicken Rice (Serious Eats)" not in found_steps  # that label is emitted by the hook, not the tool


HOUSEHOLD = {"today": "2026-10-11", "timeZone": "UTC", "zipCode": None, "members": [
    {"displayName": "Maya", "allergens": ["milk"], "diets": []},
    {"displayName": "Sam", "allergens": [], "diets": ["vegetarian"]}]}


def test_default_allowlist_drops_sites_that_block_us():
    domains = Settings(_env_file=None).recipe_domains
    for dropped in ("foodnetwork.com", "budgetbytes.com", "cookieandkate.com", "allrecipes.com", "seriouseats.com",
                    "simplyrecipes.com", "eatingwell.com", "loveandlemons.com"):
        assert dropped not in domains
    assert "delish.com" in domains and "bbcgoodfood.com" in domains
    assert Settings(_env_file=None).recipe_candidates == 6


def test_cleaner_handles_cloves_and_pepper_noise():
    assert clean_ingredient("6 garlic cloves, minced") == "Garlic"
    assert clean_ingredient("Garlic Cloves") == "Garlic"
    assert clean_ingredient("1/2 tsp freshly ground black pepper") == "Black Pepper"
    assert clean_ingredient("Ground black pepper, to taste") == "Black Pepper"
    assert clean_ingredient("2 tbsp canola oil") == "Canola Oil"


@pytest.mark.parametrize("name,owned,expected", [
    ("Garlic Cloves", {"garlic"}, True),        # whole-word containment, either direction
    ("Garlic", {"garlic cloves"}, True),
    ("Chicken Breast", {"chicken"}, True),
    ("Olive Oil", {"olive oil"}, True),
    ("Rice Vinegar", {"rice"}, False),          # a different product that shares a word
    ("Garlic Powder", {"garlic"}, False),
    ("Chicken Broth", {"chicken breast"}, False),
    ("Lemons", {"lemon"}, True),
    ("Basil", {"rice", "eggs"}, False),
])
def test_have_item_matching(name, owned, expected):
    from app.recipes import have_item

    assert have_item(name, owned) is expected


def test_exclusion_terms_from_household():
    from app.recipes import exclusion_terms

    assert exclusion_terms(HOUSEHOLD) == ["dairy-free", "vegetarian"]
    assert exclusion_terms(None) == []
    assert exclusion_terms({"members": [{"allergens": ["peanuts", "tree_nuts"], "diets": ["gluten_free"]}]}) == [
        "peanut-free", "nut-free", "gluten-free"]


@respx.mock
async def test_pantry_basics_and_cooking_oil_are_not_missing_noise(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Garlic Chicken", [
        "1 lb chicken breast", "6 garlic cloves, minced", "1 tsp freshly ground black pepper", "1 tsp salt",
        "2 tbsp canola oil", "1 lime"]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    state.cabinet_names |= {"olive oil"}
    out = json.loads(await t["find_recipe"]("garlic chicken"))
    assert out["missing"] == ["Lime"]  # Garlic (cloves), Black Pepper, Salt, Canola Oil (cabinet has Olive Oil)

    state.cabinet_names -= {"olive oil"}  # without any oil in the cabinet, the oil is a real purchase
    state.draft_meals.clear()
    state.used_urls.clear()
    out = json.loads(await t["find_recipe"]("garlic chicken again"))
    assert out["missing"] == ["Canola Oil", "Lime"]


@respx.mock
async def test_query_carries_household_exclusions_and_asks_for_8_results_6_candidates(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    state_urls = [f"https://www.allrecipes.com/r{i}" for i in range(8)]
    route = respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": [{"url": u} for u in state_urls]}))
    fetched = []

    def page_for(request):
        fetched.append(str(request.url))
        return httpx.Response(200, html=page(recipe_ld(f"R{len(fetched)}", ["1 cup rice"])),
                              headers={"content-type": "text/html"})

    respx.get(url__startswith="https://www.allrecipes.com/r").mock(side_effect=page_for)
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    state.household = HOUSEHOLD
    await t["find_recipe"]("rice bowl", must_use=["Spinach"])
    body = json.loads(route.calls[0].request.content)
    assert body["max_results"] == 8
    assert "dairy-free" in body["query"] and "vegetarian" in body["query"] and "Spinach" in body["query"]
    assert len(fetched) == 6  # at most 6 candidates fetched in parallel


@respx.mock
async def test_one_simpler_retry_when_nothing_passes_and_rejections_are_logged(
    ctx, client, sink, state, tavily_settings, make_pricer, caplog
):
    import logging

    caplog.set_level(logging.INFO, logger="agent")
    searches = iter([
        ["https://www.allrecipes.com/blocked", "https://www.allrecipes.com/nold", "https://www.allrecipes.com/creamy"],
        ["https://www.allrecipes.com/easy"],
    ])
    route = respx.post(TAVILY).mock(side_effect=lambda r: httpx.Response(
        200, json={"results": [{"url": u} for u in next(searches)]}))
    respx.get("https://www.allrecipes.com/blocked").mock(return_value=httpx.Response(403))
    respx.get("https://www.allrecipes.com/nold").mock(return_value=httpx.Response(200, html="<html>nothing</html>"))
    mock_page("https://www.allrecipes.com/creamy", recipe_ld("Creamy Chicken", ["1 cup cream", "1 lb chicken breast"]))
    mock_page("https://www.allrecipes.com/easy", recipe_ld("Easy Chicken", ["1 lb chicken breast", "1 cup rice"]))

    def safety(request):
        meals = json.loads(request.content)["meals"]
        return httpx.Response(200, json={"meals": [
            {"title": m["title"], "unknown": [], "passes": "Creamy" not in m["title"],
             "problems": [{"ingredient": "Cream", "reason": "contains milk", "members": ["Maya"]}]
             if "Creamy" in m["title"] else []} for m in meals]})

    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    state.household = HOUSEHOLD
    out = json.loads(await t["find_recipe"]("chicken dinner", must_use=["Chicken Breast"]))
    assert out["found"] is True and out["title"] == "Easy Chicken"
    assert route.call_count == 2
    second = json.loads(route.calls[1].request.content)["query"]
    assert "easy" in second and "Chicken Breast" in second and "dairy-free" in second
    text = caplog.text
    assert "https://www.allrecipes.com/blocked: http 403" in text
    assert "https://www.allrecipes.com/nold: no JSON-LD recipe" in text
    assert "https://www.allrecipes.com/creamy: unsafe: contains milk (Cream)" in text


@respx.mock
async def test_find_recipe_result_is_minimal_and_steps_are_model_written_and_rechecked(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    from tests.conftest import FakePriceAgent

    prompts = []

    class Spy(FakePriceAgent):
        async def invoke_async(self, prompt):
            prompts.append(prompt)
            return await super().invoke_async(prompt)

    long_steps = '{"steps":["' + " ".join(["word"] * 40) + '","Serve it warm."]}'
    svc_ = RecipeService(tavily_settings, steps_agent_factory=lambda: Spy([long_steps]))
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice"]))
    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, svc_)
    out = json.loads(await t["find_recipe"]("chicken rice"))
    assert set(out) == {"found", "title", "site", "uses", "missing"}  # no lines, no steps, no minutes
    steps = state.draft_meals["Chicken Rice"]["steps"]
    assert len(steps) == 2 and len(steps[0].split()) == 15 and steps[1] == "Serve it warm."  # trimmed to 15 words
    sent = json.loads(prompts[0])
    assert sent["outline"] == ["Preheat the oven to 425 degrees and sear the chicken", "Serve."]  # first 10 words only
    assert SECRET_METHOD not in prompts[0]
    assert route.call_count == 2  # candidate batch, then a re-check of the final steps


@respx.mock
async def test_unsafe_or_failed_model_steps_fall_back_to_generic_steps(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice"]))

    def safety(request):
        m = json.loads(request.content)["meals"][0]
        bad = any("butter" in s for s in m["steps"])
        return httpx.Response(200, json={"meals": [{"title": m["title"], "unknown": [], "passes": not bad, "problems": [
            {"ingredient": "butter", "reason": "contains milk", "members": ["Maya"]}] if bad else []}]})

    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety)
    svc_ = mk_service(tavily_settings, steps='{"steps":["Melt butter in the pan."]}')
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, svc_)
    await t["find_recipe"]("chicken rice")
    assert state.draft_meals["Chicken Rice"]["steps"][1].startswith("Cook everything")
    state.draft_meals.clear()
    state.used_urls.clear()
    svc2 = mk_service(tavily_settings, steps="not json at all")
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, svc2)
    await t["find_recipe"]("chicken rice")
    assert state.draft_meals["Chicken Rice"]["steps"][1].startswith("Cook everything")


def test_assign_days_fills_every_meal_from_household_today():
    from app.tools import assign_days

    meals = [{"day": None}, {"day": None}, {"day": None}]
    assign_days(meals, "2026-10-11")  # a Sunday
    assert [m["day"] for m in meals] == ["Sun", "Mon", "Tue"]
    mixed = [{"day": "Mon"}, {"day": None}, {"day": None}]
    assign_days(mixed, "2026-10-11")
    assert [m["day"] for m in mixed] == ["Mon", "Sun", "Tue"]  # never duplicates, never leaves null
    bad = [{"day": None}]
    assign_days(bad, "garbage")
    assert bad[0]["day"] in ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


@respx.mock
async def test_propose_gives_all_meals_a_day_even_when_cited_meals_have_none(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    from app.runner import run as run_run  # noqa: F401  (imported to make sure the module loads)

    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Chicken Rice", ["1 lb chicken breast", "1 cup rice"]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    events = respx.post("http://server.test/api/internal/agent-events").mock(return_value=httpx.Response(204))
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    state.household = HOUSEHOLD
    await t["find_recipe"]("chicken rice")
    own = {"title": "Egg Bowl", "ingredients": ["Rice", "Eggs"], "missing": ["Eggs"], "steps": ["Fry."],
           "day": "Mon", "minutes": 10, "servings": 2}
    await t["check_meal_safety"]([own])
    assert await t["propose_plan"]({"summary": "x"}) == "ok"
    plan = [json.loads(c.request.content) for c in events.calls if json.loads(c.request.content)["type"] == "proposed"][0][
        "payload"]["plan"]
    assert [m["day"] for m in plan["meals"]] == ["Sun", "Mon"]  # model's Mon kept; the cited meal got the next free day


def test_roundup_and_listing_pages_are_not_recipes():
    """Live bug: Good Food collection pages ('84 gluten and dairy-free recipes') were parsed as meals."""
    base = {"@type": "Recipe", "recipeIngredient": ["1 cup rice", "2 eggs", "1 tsp salt"],
            "recipeInstructions": ["Cook.", "Serve."]}
    url = "https://www.bbcgoodfood.com/x"
    for title in ("84 gluten and dairy-free recipes", "Spinach recipes", "Dairy-free pasta recipes", "25 Easy Dinners"):
        assert parse_recipe_html(page({**base, "name": title}), url) is None
    assert parse_recipe_html(page({**base, "name": "Spinach Fried Rice"}), url) is not None
    # a list page whose carousel items are Recipes of other pages must not be read as this page's recipe
    carousel = {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "item": {**base, "name": "Other Rice"}}]}
    assert parse_recipe_html(page(carousel), url) is None


def test_string_ingredients_thin_recipes_and_step_less_pages_are_rejected():
    url = "https://www.bbcgoodfood.com/x"
    ok = {"@type": "Recipe", "name": "Rice", "recipeIngredient": ["1 cup rice", "2 eggs", "1 tsp salt"],
          "recipeInstructions": ["Cook.", "Serve."]}
    assert parse_recipe_html(page(ok), url) is not None
    assert parse_recipe_html(page({**ok, "recipeIngredient": "1 cup rice, 2 eggs"}), url) is None  # was iterated by char
    assert parse_recipe_html(page({**ok, "recipeIngredient": ["1 cup rice"]}), url) is None
    assert parse_recipe_html(page({**ok, "recipeInstructions": ["Cook."]}), url) is None


@pytest.mark.parametrize("line,expected", [
    ("1 large bunch green onions", "Green Onions"),
    ("6 garlic cloves, finely chopped (about 2 tbsp", "Garlic"),
    ("1 (10 ounce) bag prepared brown rice", "Brown Rice"),
    ("3 garlic cloves (or 1 tsp garlic powder)", "Garlic"),
])
def test_cleaner_regressions_from_live_pages(line, expected):
    assert clean_ingredient(line) == expected


@pytest.mark.parametrize("line,expected", [
    ("1 cup fresh or canned pineapple", "Pineapple"),
    ("2 large eggs + 1 Tablespoon water", "Eggs"),
    ("1/4 cup oil-packed sun-dried tomatoes", "Sun-dried Tomatoes"),
    ("2 green onions/scallions, sliced", "Green Onions"),
])
def test_cleaner_regressions_round_two(line, expected):
    assert clean_ingredient(line) == expected


def test_canonical_url_dedupes_comment_print_and_query_variants():
    from app.recipes import canonical_url

    base = "https://www.wellplated.com/spinach-quinoa-peppers"
    for variant in (base, base + "/", base + "/comment-page-2", base + "?load_all_comments=1", base + "/print",
                    base + "#comments"):
        assert canonical_url(variant).rstrip("/") == base
    assert canonical_url(None) is None


@respx.mock
async def test_search_dedupes_variants_and_skips_collection_pages():
    respx.post(TAVILY).mock(return_value=httpx.Response(200, json={"results": [
        {"url": "https://www.allrecipes.com/a"},
        {"url": "https://www.allrecipes.com/a/comment-page-2"},
        {"url": "https://www.allrecipes.com/a?load_all_comments=1"},
        {"url": "https://www.seriouseats.com/collection/vegan-dinners"},
        {"url": "https://www.seriouseats.com/best-pasta-gallery"},
        {"url": "https://www.seriouseats.com/b"}]}))
    assert await svc().search("x") == ["https://www.allrecipes.com/a", "https://www.seriouseats.com/b"]


@respx.mock
async def test_pantry_basics_use_suffix_match_not_substring(ctx, client, sink, state, tavily_settings, make_pricer):
    mock_search("https://www.seriouseats.com/a")
    mock_page("https://www.seriouseats.com/a", recipe_ld("Stir Fry", [
        "1 lb chicken breast", "1 tsp kosher salt", "nonstick cooking spray", "1 can water chestnuts", "1 lime"]))
    respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    out = json.loads(await t["find_recipe"]("stir fry"))
    assert out["missing"] == ["Water Chestnuts", "Lime"]  # Kosher Salt and Cooking Spray are on hand; chestnuts are not


@respx.mock
async def test_check_meal_safety_does_not_redraft_when_three_cited_meals_are_stored(
    ctx, client, sink, state, tavily_settings, make_pricer
):
    t = find_tools(ctx, client, sink, state, tavily_settings, make_pricer, mk_service(tavily_settings))
    for i in range(3):
        state.draft_meals[f"Cited {i}"] = {"title": f"Cited {i}", "source": {"url": "https://x"}, "ingredients": ["Rice"],
                                           "missing": [], "uses": ["Rice"], "steps": ["Cook."]}
    route = respx.post(f"{G}/agent/safety-check").mock(side_effect=safety_ok)
    out = json.loads(await t["check_meal_safety"]([{"title": "Mine", "ingredients": ["Eggs"], "steps": ["Fry."]}]))
    assert out["all_pass"] is True and "propose_plan" in out["note"]
    assert not route.called and "Mine" not in state.draft_meals


def test_plan_source_contract_requires_https():
    PlanSource.model_validate({"url": "https://a.test/r", "site": "A", "title": "T", "imageUrl": None})
    with pytest.raises(Exception):
        PlanSource.model_validate({"url": "http://a.test/r", "site": "A", "title": "T", "imageUrl": None})
    with pytest.raises(Exception):
        PlanSource.model_validate({"url": "https://a.test/r", "site": "A", "title": "T", "imageUrl": "http://i"})
