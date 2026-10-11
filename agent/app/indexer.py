"""Polite recipe crawler behind scripts/build_recipe_index.py (spec section 12).

For each allowlisted domain: read robots.txt (Disallow, Crawl-delay, Sitemap), walk its sitemaps for recipe URLs, fetch at
<= 1 request/s per host (all hosts concurrently), parse the schema.org Recipe JSON-LD with the same parser and cleaner
as find_recipe, and send IndexedRecipe batches to the server. Only ingredient lines and metadata are kept: the site's
method text is never stored or sent.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import json
import logging
import os
import random
import re
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from pydantic import ValidationError

from .config import Settings
from .recipes import _LISTING, RecipeService, canonical_url, parse_recipe_html, url_allowed
from .schemas import IndexedRecipe, RecipeIngestBody

log = logging.getLogger("agent.indexer")

MIN_INTERVAL_S = 1.0
MAX_CRAWL_DELAY_S = 30.0
SITEMAP_MAX_BYTES = 10 * 1024 * 1024
MAX_CHILD_SITEMAPS = 25
BATCH_SIZE = 50
BLOCK_PROBE = 6  # if the first N page fetches are all 403/429, stop hammering the domain

_SITEMAP_SKIP = re.compile(
    r"(?:page|categor|tag|author|attachment|product|video|image|news|user|comment|menu|tax|misc|term|contributor|bundle)",
    re.I)
_NOT_RECIPE = re.compile(
    r"/(?:about|contact|privacy|terms|search|login|register|shop|store|newsletter|subscribe|author|authors|page|"
    r"feed|wp-content|wp-json|cart|account|press|advertise|careers|sitemap)(?:/|$)|\.(?:jpe?g|png|gif|webp|pdf|xml|css|js)$",
    re.I)
# Hosts whose recipe pages live under a known path; every other host uses single-segment slugs from its sitemap.
_RECIPE_PATHS = {
    "bbcgoodfood.com": re.compile(r"^/recipes/[^/]+/?$"),
    "tasteofhome.com": re.compile(r"^/recipes/[^/]+/?$"),
    "epicurious.com": re.compile(r"^/recipes/food/views/[^/]+/?$"),
    "bonappetit.com": re.compile(r"^/recipe/[^/]+/?$"),
    "delish.com": re.compile(r"^/cooking/recipe-ideas/(?:recipes/)?a\d+/[^/]+/?$"),  # a<id> = recipe, g<id> = gallery
}
_RECIPES_SLUG = re.compile(r"^/recipes?/[^/]{6,}(?:\.html?)?/?$", re.I)  # /recipes/<slug>/ or /recipes/<slug>.html
_NOT_A_SLUG = re.compile(r"^/recipes/(?:collection|category|categories|inspiration|budget|healthy|seasonal)(?:/|$)", re.I)


def host_key(host: str) -> str:
    return host.lower().removeprefix("www.")


def looks_like_recipe_url(url: str) -> bool:
    """Per-site URL heuristic: known recipe paths where we know them, otherwise a single-segment slug."""
    try:
        p = urlparse(url)
    except ValueError:
        return False
    host, path = host_key(p.hostname or ""), p.path or "/"
    if _LISTING.search(path) or _NOT_RECIPE.search(path) or _NOT_A_SLUG.search(path):
        return False
    for d, rx in _RECIPE_PATHS.items():
        if host == d or host.endswith("." + d):
            return bool(rx.match(path))
    if _RECIPES_SLUG.match(path):
        return True
    segs = [s for s in path.split("/") if s]
    return len(segs) == 1 and len(segs[0]) >= 8 and "-" in segs[0]


# ─── rate limiting ───────────────────────────────────────────────────────────


class HostLimiter:
    """At most one request per `interval` seconds per host; different hosts never wait for each other."""

    def __init__(
        self,
        interval: float = MIN_INTERVAL_S,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._interval = interval
        self._clock = clock
        self._sleep = sleep
        self._next: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self.delays: dict[str, float] = {}

    def set_delay(self, host: str, seconds: float) -> None:
        self.delays[host] = max(self._interval, seconds)

    async def wait(self, host: str) -> None:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            gap = self.delays.get(host, self._interval)
            now = self._clock()
            ready = self._next.get(host, now)
            if ready > now:
                await self._sleep(ready - now)
            self._next[host] = max(now, ready) + gap


# ─── robots.txt & sitemaps ───────────────────────────────────────────────────


@dataclass
class Robots:
    parser: RobotFileParser | None
    delay: float = 0.0
    sitemaps: list[str] = field(default_factory=list)
    skip_reason: str = ""  # non-empty: do not crawl this domain

    def allows(self, url: str) -> bool:
        return True if self.parser is None else self.parser.can_fetch("*", url)


def parse_robots(text: str, base: str) -> Robots:
    rp = RobotFileParser()
    rp.parse(text.splitlines())
    delay = rp.crawl_delay("*")
    sitemaps = [s for s in (rp.site_maps() or []) if s.startswith("https://")]
    r = Robots(rp, float(delay or 0), sitemaps)
    if not (r.allows(f"{base}/recipes/probe-recipe-page") or r.allows(f"{base}/recipe/probe-recipe-page")
            or r.allows(f"{base}/probe-recipe-page")):
        r.skip_reason = "robots.txt disallows recipe paths"
    elif r.delay > MAX_CRAWL_DELAY_S:
        r.skip_reason = f"crawl-delay {r.delay:g}s is too long"
    return r


def parse_sitemap(data: bytes) -> tuple[list[str], list[str]]:
    """(page urls, child sitemap urls). Handles gzip and sitemap indexes; no XML parser needed for <loc> lists."""
    if data[:2] == b"\x1f\x8b":
        data = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data, SITEMAP_MAX_BYTES)
    text = data.decode("utf-8", errors="replace")
    locs = [html_lib.unescape(m.strip()) for m in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>", text, re.S)]
    if "<sitemapindex" in text[:2000].lower():
        return [], locs
    return locs, []


# ─── state & stats ───────────────────────────────────────────────────────────


@dataclass
class DomainStats:
    domain: str
    tried: int = 0
    parsed: int = 0
    no_jsonld: int = 0
    blocked: int = 0
    other: int = 0
    dupes: int = 0
    note: str = ""

    def line(self) -> str:
        rate = f"{100 * self.parsed // self.tried}%" if self.tried else "-"
        extra = f"  [{self.note}]" if self.note else ""
        return (f"{self.domain:26s} tried={self.tried:<4d} parsed={self.parsed:<4d} ({rate:>4s}) "
                f"no-JSON-LD={self.no_jsonld:<3d} blocked(403/429)={self.blocked:<3d} other={self.other:<3d}{extra}")


class StateFile:
    """agent/.index-state.json: {"done": {url: "ok"|"nojsonld"|"blocked"|"error"}} so --resume skips finished URLs."""

    def __init__(self, path: Path | None, resume: bool = True) -> None:
        self.path = path
        self.done: dict[str, str] = {}
        if path and resume and path.exists():
            try:
                self.done = json.loads(path.read_text()).get("done", {})
            except (ValueError, OSError):
                self.done = {}

    def skip(self, url: str) -> bool:
        return self.done.get(url) in ("ok", "nojsonld")

    def mark(self, url: str, status: str) -> None:
        self.done[url] = status

    def save(self) -> None:
        if self.path:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"done": self.done}))
            os.replace(tmp, self.path)


# ─── building an IndexedRecipe ───────────────────────────────────────────────


def to_indexed(parsed: Any) -> IndexedRecipe | None:
    """ParsedRecipe -> validated IndexedRecipe (lines + cleaned names + metadata only). None if it doesn't validate."""
    try:
        return IndexedRecipe.model_validate({
            "url": parsed.url, "site": parsed.site, "title": parsed.title, "imageUrl": parsed.image,
            "minutes": parsed.minutes_src, "servings": parsed.servings_src,
            "ingredientLines": parsed.lines, "ingredients": parsed.ingredients,
        })
    except ValidationError as e:
        log.info("recipe skipped (invalid for the index): %s %s", parsed.url, e.errors()[:1])
        return None


# ─── crawling ────────────────────────────────────────────────────────────────


class Crawler:
    def __init__(
        self,
        settings: Settings,
        *,
        per_domain: int = 300,
        max_total: int | None = None,
        state: StateFile | None = None,
        limiter: HostLimiter | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        seed: int = 0,
    ) -> None:
        self._settings = settings
        self.per_domain = per_domain
        self.max_total = max_total
        self.state = state or StateFile(None)
        self.limiter = limiter or HostLimiter()
        self._transport = transport
        self._seed = seed
        self._total = 0
        self._titles: set[tuple[str, str]] = set()
        self.challenged: set[str] = set()  # domains whose sitemaps came back as a bot-challenge page
        self.sitemap_errors: dict[str, str] = {}  # first sitemap fetch failure per domain, for the summary

    def _service(self, domain: str) -> RecipeService:
        s = self._settings.model_copy(update={"recipe_domains": [domain]})
        return RecipeService(s, transport=self._transport)

    async def _get(self, svc: RecipeService, url: str, **kw: Any) -> tuple[bytes | None, str, str]:
        host = host_key(urlparse(url).hostname or "")
        await self.limiter.wait(host)
        res = await svc.fetch_raw(url, **kw)
        if res[0] is None and res[1].startswith("fetch failed"):  # transient (timeout): one polite retry
            await self.limiter.wait(host)
            res = await svc.fetch_raw(url, **kw)
        return res

    async def robots(self, svc: RecipeService, domain: str) -> Robots:
        base = f"https://{domain}"
        body, reason, enc = await self._get(svc, f"{base}/robots.txt", html_only=False, accept="text/plain",
                                            max_bytes=512 * 1024)
        if body is None:
            if reason == "http 404":
                return Robots(None)  # no robots.txt: everything allowed
            if reason in ("http 401", "http 403"):
                return Robots(None, skip_reason=f"robots.txt {reason} (blocked)")
            return Robots(None, skip_reason=f"robots.txt unreachable ({reason})")
        return parse_robots(body.decode(enc, errors="replace"), base)

    async def sitemap_urls(
        self, svc: RecipeService, domain: str, robots: Robots, want: int,
        keep: Callable[[str], bool] = lambda u: True,
    ) -> tuple[list[str], int]:
        """Recipe-looking URLs from the site's sitemaps (stops once `want` pass `keep`) and how many URLs were seen.
        Recipe-named sitemaps are tried first; WordPress defaults are the fallback."""
        def rank(u: str) -> int:
            return 0 if re.search(r"recipe|post", urlparse(u).path, re.I) else 1

        queue = sorted([s for s in robots.sitemaps if url_allowed(s, [domain])], key=rank)
        queue += [f"https://{domain}/sitemap.xml", f"https://{domain}/sitemap_index.xml",
                  f"https://{domain}/wp-sitemap.xml", f"https://{domain}/post-sitemap.xml"]
        kept: list[str] = []
        seen_urls = 0
        seen: set[str] = set()
        children = 0
        while queue and len(kept) < want:
            sm = queue.pop(0)
            if sm in seen or not url_allowed(sm, [domain]) or not robots.allows(sm):
                continue
            seen.add(sm)
            body, reason, _ = await self._get(svc, sm, html_only=False, accept="application/xml",
                                              max_bytes=SITEMAP_MAX_BYTES)
            if body is None:
                log.info("%s: sitemap %s: %s", domain, sm, reason)
                self.sitemap_errors.setdefault(domain, reason)
                continue
            if body[:300].lstrip().lower().startswith((b"<!doctype html", b"<html")):
                log.info("%s: sitemap %s is an HTML page (bot challenge)", domain, sm)
                self.challenged.add(domain)
                continue
            try:
                pages, kids = parse_sitemap(body)
            except Exception:
                log.info("%s: sitemap %s unreadable", domain, sm)
                continue
            seen_urls += len(pages)
            kept.extend(u for u in pages if keep(u))
            fresh = [k for k in kids if k not in seen and not _SITEMAP_SKIP.search(urlparse(k).path)]
            for k in sorted(fresh, key=rank):
                if children < MAX_CHILD_SITEMAPS:
                    children += 1
                    queue.insert(0, k) if rank(k) == 0 else queue.append(k)
        return kept, seen_urls

    async def crawl_domain(self, domain: str, emit: Callable[[IndexedRecipe], Awaitable[None]]) -> DomainStats:
        stats = DomainStats(domain)
        svc = self._service(domain)
        try:
            robots = await self.robots(svc, domain)
            if robots.skip_reason:
                stats.note = f"skipped: {robots.skip_reason}"
                return stats
            if robots.delay:
                self.limiter.set_delay(host_key(domain), robots.delay)
            def keep(u: str) -> bool:
                cu = canonical_url(u)
                return bool(cu and url_allowed(cu, [domain]) and looks_like_recipe_url(cu) and robots.allows(cu))

            found, n_seen = await self.sitemap_urls(svc, domain, robots, want=self.per_domain * 10, keep=keep)
            cands = list(dict.fromkeys(c for c in (canonical_url(u) for u in found) if c))
            if not cands:
                err = self.sitemap_errors.get(domain)
                if err in ("http 403", "http 429"):
                    stats.blocked += 1
                stats.note = ("blocked: sitemaps are served behind a bot challenge" if domain in self.challenged
                              else f"sitemap fetch failed ({err})" if err and n_seen == 0
                              else f"no recipe URLs found in sitemaps ({n_seen} urls seen)")
                return stats
            random.Random(f"{self._seed}:{domain}").shuffle(cands)  # sample across the whole site, reproducibly
            budget = self.per_domain * 3
            for url in cands:
                if stats.parsed >= self.per_domain or stats.tried >= budget:
                    break
                if self.max_total is not None and self._total >= self.max_total:
                    stats.note = "stopped: --max-total reached"
                    break
                if self.state.skip(url):
                    continue
                stats.tried += 1
                recipe, reason = await self._load(svc, url)
                if recipe is None:
                    if reason in ("http 403", "http 429"):
                        stats.blocked += 1
                        self.state.mark(url, "blocked")
                    elif reason == "no JSON-LD recipe":
                        stats.no_jsonld += 1
                        self.state.mark(url, "nojsonld")
                    else:
                        stats.other += 1
                        self.state.mark(url, "error")
                    if stats.blocked >= BLOCK_PROBE and stats.parsed == 0 and stats.blocked == stats.tried:
                        stats.note = "blocked: every request got 403/429, domain dropped"
                        break
                    continue
                key = (domain, re.sub(r"\W+", " ", recipe.title.lower()).strip())
                self.state.mark(url, "ok")
                if key in self._titles:
                    stats.dupes += 1
                    continue
                self._titles.add(key)
                stats.parsed += 1
                self._total += 1
                await emit(recipe)
        finally:
            await svc.aclose()
        return stats

    async def _load(self, svc: RecipeService, url: str) -> tuple[IndexedRecipe | None, str]:
        body, reason, enc = await self._get(svc, url)
        if body is None:
            return None, reason
        try:
            parsed = parse_recipe_html(body.decode(enc, errors="replace"), url)
        except Exception:
            return None, "parse error"
        if parsed is None:
            return None, "no JSON-LD recipe"
        idx = to_indexed(parsed)
        return (idx, "") if idx else (None, "invalid for the index")

    async def crawl(self, domains: list[str], emit: Callable[[IndexedRecipe], Awaitable[None]]) -> list[DomainStats]:
        """All domains concurrently (the per-host limiter keeps each one to <= 1 req/s)."""
        return list(await asyncio.gather(*(self.crawl_domain(d, emit) for d in domains)))


# ─── posting ─────────────────────────────────────────────────────────────────


class Poster:
    """Batches to {server}/api/internal/recipes with X-Agent-Secret. One retry on 5xx/timeout."""

    def __init__(self, server: str, secret: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 retry_delay: float = 1.0) -> None:
        self._url = server.rstrip("/") + "/api/internal/recipes"
        self._secret = secret
        self._http = httpx.AsyncClient(timeout=30.0, transport=transport)
        self._retry_delay = retry_delay
        self.upserted = 0
        self.embedded = 0
        self.failed_batches = 0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def post(self, batch: list[IndexedRecipe]) -> bool:
        body = RecipeIngestBody(recipes=batch).model_dump(mode="json")
        for attempt in range(2):
            try:
                r = await self._http.post(self._url, json=body, headers={"X-Agent-Secret": self._secret})
            except httpx.HTTPError:
                r = None
            if r is not None and r.status_code < 500:
                if r.status_code == 200:
                    data = r.json()
                    self.upserted += int(data.get("upserted", 0))
                    self.embedded += int(data.get("embedded", 0))
                    return True
                log.error("ingest rejected: HTTP %s %s", r.status_code, r.text[:200])
                break
            if attempt == 0:
                await asyncio.sleep(self._retry_delay)
        self.failed_batches += 1
        return False


class Batcher:
    """Collects recipes from all domains and flushes them in batches (and once more at the end)."""

    def __init__(self, poster: Poster | None, state: StateFile, size: int = BATCH_SIZE) -> None:
        self._poster = poster
        self._state = state
        self._size = size
        self._buf: list[IndexedRecipe] = []
        self.count = 0
        self.batches = 0

    async def add(self, recipe: IndexedRecipe) -> None:
        self._buf.append(recipe)
        self.count += 1
        if len(self._buf) >= self._size:
            await self.flush()

    async def flush(self) -> None:
        if not self._buf:
            return
        batch, self._buf = self._buf, []
        self.batches += 1
        if self._poster is not None:
            await self._poster.post(batch)
        self._state.save()
