"""Recipe crawler: robots.txt, sitemaps, rate limiting, dedupe, resume, batching. respx-mocked, no real sleeping."""
import gzip
import importlib.util
import json
from pathlib import Path

import httpx
import respx

from app.config import Settings
from app.indexer import (
    Batcher,
    Crawler,
    HostLimiter,
    Poster,
    StateFile,
    looks_like_recipe_url,
    parse_robots,
    parse_sitemap,
)
from app.schemas import IndexedRecipe, RecipeIngestBody

D = "recipes-test.com"
SECRET_METHOD = "Preheat the oven to 425 degrees and sear the chicken in a cast-iron skillet until deeply golden."


class FakeClock:
    """Deterministic time: sleeping advances the clock and is recorded, nothing really waits."""

    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def time(self):
        return self.now

    async def sleep(self, s):
        import asyncio

        self.sleeps.append(round(s, 3))
        self.now += s
        await asyncio.sleep(0)  # yield to the other hosts, like a real sleep would


def settings_for(*domains):
    return Settings(_env_file=None, agent_shared_secret="s" * 40, recipe_domains=list(domains) or [D])


def fast(clock=None):
    clock = clock or FakeClock()
    return HostLimiter(clock=clock.time, sleep=clock.sleep), clock


def page(n, title=None, lines=None, steps=2):
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "name": "Recipes Test"},
        {"@type": "Recipe", "name": title or f"Recipe number {n}", "image": "https://cdn.test/i.jpg",
         "totalTime": "PT30M", "recipeYield": "4 servings",
         "recipeIngredient": lines or ["1 lb chicken breast", "2 cloves garlic, minced", "1 tsp salt"],
         "recipeInstructions": [{"@type": "HowToStep", "text": SECRET_METHOD}] * steps}]}
    return f'<html><head><script type="application/ld+json">{json.dumps(ld)}</script></head><body>x</body></html>'


def urlset(urls):
    return "<?xml version='1.0'?><urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>"


def slug(n, d=D):
    return f"https://{d}/chicken-recipe-{n:03d}/"


def html(body):
    return httpx.Response(200, html=body, headers={"content-type": "text/html"})


def mock_site(n=10, robots="User-agent: *\nAllow: /\n"):
    respx.get(f"https://{D}/robots.txt").mock(
        return_value=httpx.Response(200, text=robots, headers={"content-type": "text/plain"}))
    respx.get(f"https://{D}/sitemap.xml").mock(
        return_value=httpx.Response(200, text=urlset([slug(i) for i in range(n)]),
                                    headers={"content-type": "application/xml"}))
    for i in range(n):
        respx.get(slug(i)).mock(return_value=html(page(i)))


async def crawl(domain=D, per_domain=5, state=None, **kw):
    limiter, clock = fast()
    c = Crawler(settings_for(domain), per_domain=per_domain, state=state, limiter=limiter, **kw)
    out = []

    async def emit(r):
        out.append(r)

    stats = await c.crawl_domain(domain, emit)
    return stats, out, clock, c


# ─── robots.txt ──────────────────────────────────────────────────────────────


@respx.mock
async def test_robots_disallowing_everything_skips_the_domain_without_fetching_pages():
    mock_site(robots="User-agent: *\nDisallow: /\n")
    sitemap = respx.get(f"https://{D}/sitemap.xml")
    stats, out, _, _ = await crawl()
    assert out == [] and "robots.txt disallows recipe paths" in stats.note and stats.tried == 0
    assert not sitemap.called


@respx.mock
async def test_robots_disallow_rules_filter_individual_urls():
    mock_site(robots="User-agent: *\nDisallow: /chicken-recipe-00\n")  # blocks 000-009
    respx.get(f"https://{D}/sitemap.xml").mock(
        return_value=httpx.Response(200, text=urlset([slug(i) for i in list(range(5)) + list(range(10, 14))])))
    for i in range(10, 14):
        respx.get(slug(i)).mock(return_value=html(page(i)))
    stats, out, _, _ = await crawl(per_domain=10)
    assert sorted(r.url for r in out) == [slug(i) for i in range(10, 14)]
    assert stats.tried == 4


@respx.mock
async def test_robots_403_skips_but_404_means_allowed():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(403))
    stats, _, _, _ = await crawl()
    assert "robots.txt http 403" in stats.note
    respx.reset()
    mock_site(n=3)
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    stats, out, _, _ = await crawl()
    assert stats.parsed == 3


def test_parse_robots_reads_delay_and_sitemaps_and_rejects_huge_delays():
    r = parse_robots("User-agent: *\nCrawl-delay: 4\nSitemap: https://a.test/s.xml\nSitemap: http://a.test/insecure.xml\n",
                     "https://a.test")
    assert r.delay == 4 and r.sitemaps == ["https://a.test/s.xml"] and not r.skip_reason
    assert "too long" in parse_robots("User-agent: *\nCrawl-delay: 120\n", "https://a.test").skip_reason


# ─── rate limit ──────────────────────────────────────────────────────────────


async def test_limiter_spaces_requests_per_host_but_not_across_hosts():
    limiter, clock = fast()
    for _ in range(3):
        await limiter.wait("a.test")
    assert clock.sleeps == [1.0, 1.0] and clock.now == 2.0  # 3 requests -> 1 s between each
    clock.sleeps.clear()
    await limiter.wait("b.test")  # another host is not delayed by a.test's schedule
    assert clock.sleeps == []


async def test_limiter_honors_a_larger_crawl_delay_and_never_goes_below_one_per_second():
    limiter, clock = fast()
    limiter.set_delay("a.test", 5)
    await limiter.wait("a.test")
    await limiter.wait("a.test")
    assert clock.sleeps == [5.0]
    limiter.set_delay("fast.test", 0.1)
    assert limiter.delays["fast.test"] == 1.0


@respx.mock
async def test_crawl_delay_from_robots_is_applied_to_page_fetches():
    mock_site(n=4, robots="User-agent: *\nCrawl-delay: 3\n")
    stats, out, clock, _ = await crawl(per_domain=3)
    assert stats.parsed == 3
    assert len(clock.sleeps) >= 4 and min(clock.sleeps[1:]) >= 2.9  # after robots.txt, every request waits the crawl-delay


@respx.mock
async def test_all_hosts_run_concurrently_not_one_after_the_other():
    limiter, clock = fast()
    doms = ("a-test.com", "b-test.com")
    order = []

    def serve(body, d):
        def handler(request):
            order.append(d)
            return body
        return handler

    for d in doms:
        respx.get(f"https://{d}/robots.txt").mock(side_effect=serve(httpx.Response(404), d))
        respx.get(f"https://{d}/sitemap.xml").mock(
            side_effect=serve(httpx.Response(200, text=urlset([slug(i, d) for i in range(3)])), d))
        for i in range(3):
            respx.get(slug(i, d)).mock(side_effect=serve(html(page(i)), d))
    c = Crawler(settings_for(*doms), per_domain=3, limiter=limiter)

    async def emit(r):
        return None

    stats = await c.crawl(list(doms), emit)
    assert [s.parsed for s in stats] == [3, 3]
    assert set(order[:4]) == set(doms)  # interleaved: b did not wait for a to finish
    assert all(x == 1.0 for x in clock.sleeps)  # and nothing ever waited longer than the 1 s per-host gap


# ─── sitemaps, dedupe, caps ──────────────────────────────────────────────────


def test_parse_sitemap_handles_index_gzip_and_entities():
    assert parse_sitemap(b"<sitemapindex><sitemap><loc>https://a.test/p.xml</loc></sitemap></sitemapindex>") == (
        [], ["https://a.test/p.xml"])
    pages, kids = parse_sitemap(gzip.compress(urlset(["https://a.test/x?a=1&amp;b=2"]).encode()))
    assert pages == ["https://a.test/x?a=1&b=2"] and kids == []


def test_recipe_url_heuristics():
    yes = ["https://www.bbcgoodfood.com/recipes/lemon-chicken",
           "https://www.epicurious.com/recipes/food/views/lemon-chicken-1",
           "https://www.bonappetit.com/recipe/lemon-chicken", "https://www.onceuponachef.com/recipes/potato-soup.html",
           "https://minimalistbaker.com/easy-vegan-fried-rice/", "https://www.tasteofhome.com/recipes/black-bean-nachos/"]
    no = ["https://www.bbcgoodfood.com/recipes/collection/dairy-free", "https://www.bonappetit.com/story/best-pasta",
          "https://minimalistbaker.com/category/dinner/", "https://minimalistbaker.com/about/",
          "https://minimalistbaker.com/", "https://www.epicurious.com/tags/vegan", "https://x.test/img/photo.jpg",
          "https://www.delish.com/cooking/recipe-ideas/g1234/best-dairy-free-recipes/"]
    assert all(looks_like_recipe_url(u) for u in yes)
    assert not any(looks_like_recipe_url(u) for u in no)


@respx.mock
async def test_sitemap_index_children_gzip_and_non_recipe_sitemaps():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    respx.get(f"https://{D}/sitemap.xml").mock(return_value=httpx.Response(
        200, text=f"<sitemapindex><sitemap><loc>https://{D}/post-sitemap.xml.gz</loc></sitemap>"
                  f"<sitemap><loc>https://{D}/category-sitemap.xml</loc></sitemap></sitemapindex>"))
    respx.get(f"https://{D}/post-sitemap.xml.gz").mock(return_value=httpx.Response(
        200, content=gzip.compress(urlset([slug(i) for i in range(3)]).encode()),
        headers={"content-type": "application/gzip"}))
    cat = respx.get(f"https://{D}/category-sitemap.xml").mock(return_value=httpx.Response(200, text=urlset([])))
    for i in range(3):
        respx.get(slug(i)).mock(return_value=html(page(i)))
    stats, out, _, _ = await crawl()
    assert stats.parsed == 3 and not cat.called  # category sitemaps are never fetched


@respx.mock
async def test_dedupe_by_url_variant_and_by_title_and_per_domain_cap():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    base = [slug(0), slug(0) + "comment-page-2", slug(0) + "?utm=1", slug(1), slug(2)]
    respx.get(f"https://{D}/sitemap.xml").mock(return_value=httpx.Response(200, text=urlset(base)))
    route0 = respx.get(slug(0)).mock(return_value=html(page(0, title="Same Title")))
    respx.get(slug(1)).mock(return_value=html(page(1, title="same  title!")))  # same title, another URL
    respx.get(slug(2)).mock(return_value=html(page(2, title="Different")))
    stats, out, _, _ = await crawl(per_domain=10)
    assert route0.call_count == 1  # three URL variants of one page -> one fetch
    assert len(out) == 2 and "Different" in {r.title for r in out} and stats.dupes == 1
    respx.reset()
    mock_site(n=20)
    stats, out, _, _ = await crawl(per_domain=4)
    assert stats.parsed == 4 and len(out) == 4  # --per-domain cap


@respx.mock
async def test_gives_up_on_a_domain_that_blocks_us():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    respx.get(f"https://{D}/sitemap.xml").mock(
        return_value=httpx.Response(200, text=urlset([slug(i) for i in range(12)])))
    for i in range(12):
        respx.get(slug(i)).mock(return_value=httpx.Response(403))
    stats, out, _, _ = await crawl(per_domain=10)
    assert out == [] and stats.blocked == 6 and stats.tried == 6 and "blocked" in stats.note  # stopped after 6 x 403


@respx.mock
async def test_counts_parsed_no_json_ld_blocked_and_other():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    respx.get(f"https://{D}/sitemap.xml").mock(
        return_value=httpx.Response(200, text=urlset([slug(i) for i in range(4)])))
    respx.get(slug(0)).mock(return_value=html("<html>no data</html>"))
    respx.get(slug(1)).mock(return_value=httpx.Response(429))
    respx.get(slug(2)).mock(return_value=html(page(2)))
    respx.get(slug(3)).mock(return_value=httpx.Response(500))
    stats, out, _, _ = await crawl(per_domain=10)
    assert (stats.tried, stats.parsed, stats.no_jsonld, stats.blocked, stats.other) == (4, 1, 1, 1, 1)


@respx.mock
async def test_bot_challenge_sitemap_is_reported_as_blocked():
    respx.get(f"https://{D}/robots.txt").mock(return_value=httpx.Response(404))
    respx.get(url__regex=rf"https://{D}/.*sitemap.*").mock(return_value=httpx.Response(
        200, html="<!DOCTYPE html><html><title>Client Challenge</title></html>",
        headers={"content-type": "text/html"}))
    stats, out, _, _ = await crawl()
    assert out == [] and "bot challenge" in stats.note


@respx.mock
async def test_indexed_recipe_has_lines_and_metadata_but_never_the_method_text():
    mock_site(n=2)
    _, out, _, _ = await crawl()
    r = out[0]
    assert isinstance(r, IndexedRecipe) and r.ingredientLines[0] == "1 lb chicken breast"
    assert r.ingredients == ["Chicken Breast", "Garlic", "Salt"] and r.minutes == 30 and r.servings == 4
    assert SECRET_METHOD not in r.model_dump_json() and "425" not in r.model_dump_json()
    assert set(r.model_dump()) == {"url", "site", "title", "imageUrl", "minutes", "servings", "ingredientLines",
                                   "ingredients"}


# ─── resume, max-total, batching ─────────────────────────────────────────────


@respx.mock
async def test_resume_skips_done_urls_and_max_total_stops_early(tmp_path):
    mock_site(n=6)
    state_path = tmp_path / "state.json"
    st = StateFile(state_path)
    stats, out, _, _ = await crawl(per_domain=3, state=st)
    st.save()
    assert stats.parsed == 3 and len(json.loads(state_path.read_text())["done"]) == 3
    st2 = StateFile(state_path, resume=True)
    stats2, out2, _, _ = await crawl(per_domain=3, state=st2)
    assert not ({r.url for r in out} & {r.url for r in out2}) and stats2.parsed == 3  # the other three URLs
    stats3, out3, _, _ = await crawl(per_domain=10, state=StateFile(state_path, resume=False), max_total=2)
    assert len(out3) == 2 and "max-total" in stats3.note


def indexed(n):
    return IndexedRecipe.model_validate({
        "url": f"https://{D}/r-{n}", "site": "S", "title": f"T{n}", "imageUrl": None, "minutes": None,
        "servings": None, "ingredientLines": ["1 cup rice"], "ingredients": ["Rice"]})


@respx.mock
async def test_batches_of_50_with_agent_secret_and_validated_payload():
    route = respx.post("http://server.test/api/internal/recipes").mock(
        return_value=httpx.Response(200, json={"upserted": 50, "embedded": 50}))
    poster = Poster("http://server.test", "the-secret")
    batcher = Batcher(poster, StateFile(None), size=50)
    for n in range(120):
        await batcher.add(indexed(n))
    await batcher.flush()
    sizes = [len(json.loads(c.request.content)["recipes"]) for c in route.calls]
    assert sizes == [50, 50, 20] and batcher.batches == 3
    assert all(c.request.headers["x-agent-secret"] == "the-secret" for c in route.calls)
    RecipeIngestBody.model_validate(json.loads(route.calls[0].request.content))
    assert poster.upserted == 150 and poster.failed_batches == 0
    await poster.aclose()


@respx.mock
async def test_poster_retries_once_on_5xx_and_counts_failures():
    route = respx.post("http://server.test/api/internal/recipes").mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json={"upserted": 1, "embedded": 0})])
    poster = Poster("http://server.test", "s", retry_delay=0)
    assert await poster.post([indexed(1)]) is True and route.call_count == 2
    respx.post("http://server.test/api/internal/recipes").mock(return_value=httpx.Response(401))
    assert await poster.post([indexed(2)]) is False and poster.failed_batches == 1
    await poster.aclose()


# ─── the CLI ─────────────────────────────────────────────────────────────────


def load_cli():
    path = Path(__file__).resolve().parents[1] / "scripts" / "build_recipe_index.py"
    spec = importlib.util.spec_from_file_location("build_recipe_index", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@respx.mock
async def test_cli_dry_run_sends_nothing_and_writes_no_state(tmp_path, capsys):
    cli = load_cli()
    mock_site(n=4)
    post = respx.post("http://server.test/api/internal/recipes").mock(return_value=httpx.Response(200, json={}))
    args = cli.build_parser().parse_args(
        ["--dry-run", "--per-domain", "3", "--domains", D, "--server", "http://server.test"])
    limiter, _ = fast()
    stats = await cli.run(args, settings=settings_for(), limiter=limiter, state_path=tmp_path / "s.json")
    assert stats[0].parsed == 3 and not post.called and not (tmp_path / "s.json").exists()
    out = capsys.readouterr().out
    assert "dry run" in out and D in out and "tried=" in out and "no-JSON-LD=" in out and "blocked(403/429)=" in out


@respx.mock
async def test_cli_real_run_posts_and_saves_state(tmp_path):
    cli = load_cli()
    mock_site(n=4)
    post = respx.post("http://server.test/api/internal/recipes").mock(
        return_value=httpx.Response(200, json={"upserted": 3, "embedded": 3}))
    args = cli.build_parser().parse_args(
        ["--per-domain", "3", "--domains", D, "--server", "http://server.test"])
    limiter, _ = fast()
    await cli.run(args, settings=settings_for(), limiter=limiter, state_path=tmp_path / "s.json")
    assert post.call_count == 1 and len(json.loads(post.calls[0].request.content)["recipes"]) == 3
    assert post.calls[0].request.headers["x-agent-secret"] == "s" * 40
    assert len(json.loads((tmp_path / "s.json").read_text())["done"]) == 3
