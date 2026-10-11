"""Cited web recipes: Tavily search, safe page fetching, schema.org Recipe JSON-LD parsing, ingredient cleaning.

SSRF hygiene: pages are fetched only over https, only from allowlisted recipe hosts (re-checked after every redirect,
at most 3 redirects), never from IP literals, with a 5 s timeout and a 2 MB cap. We never copy a site's method text;
only the title, image, time, yield and ingredient lines are used, and the meal links back to the source.
"""
from __future__ import annotations

import asyncio
import hashlib
import html as html_lib
import ipaddress
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterator
from urllib.parse import urljoin, urlparse

import httpx

from .config import Settings

log = logging.getLogger("agent.recipes")

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
FETCH_TIMEOUT_S = 5.0
FETCH_DEADLINE_S = 8.0
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")

SITE_NAMES = {
    "allrecipes.com": "Allrecipes", "seriouseats.com": "Serious Eats", "bbcgoodfood.com": "BBC Good Food",
    "simplyrecipes.com": "Simply Recipes", "budgetbytes.com": "Budget Bytes", "foodnetwork.com": "Food Network",
    "bonappetit.com": "Bon Appétit", "epicurious.com": "Epicurious", "eatingwell.com": "EatingWell",
    "delish.com": "Delish", "tasteofhome.com": "Taste of Home", "cookieandkate.com": "Cookie and Kate",
    "minimalistbaker.com": "Minimalist Baker", "loveandlemons.com": "Love & Lemons",
}


def step_key(idea: str) -> str:
    """Stable per-idea step id, so three parallel find_recipe calls get three separate progress rows."""
    return "find_recipe_" + hashlib.md5(idea.strip().lower().encode()).hexdigest()[:8]


# ─── host allowlist ──────────────────────────────────────────────────────────


def host_allowed(host: str | None, allowed: list[str]) -> bool:
    if not host:
        return False
    host = host.lower().rstrip(".")
    try:
        ipaddress.ip_address(host.strip("[]"))
        return False  # IP literals are never fetched
    except ValueError:
        pass
    return any(host == d or host.endswith("." + d) for d in allowed)


def url_allowed(url: str, allowed: list[str]) -> bool:
    try:
        p = urlparse(url)
        return (p.scheme == "https" and p.username is None and p.password is None
                and p.port in (None, 443) and host_allowed(p.hostname, allowed))
    except ValueError:
        return False


# ─── ingredient line cleaning ────────────────────────────────────────────────

_FR = "½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞"
_NUM = rf"[\d{_FR}][\d\s/.{_FR}\-–]*"
_QTY_RE = re.compile(rf"^\s*(?:(?:about|approx\.?|approximately|around|roughly)\s+)?{_NUM}(?:\s*(?:to|or)\s*{_NUM})?")
_UNITS = (r"cups?|c|tablespoons?|tbsps?|tbs|tbl|teaspoons?|tsps?|ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|"
          r"milliliters?|ml|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal|pinch(?:es)?|dash(?:es)?|cloves?|"
          r"cans?|tins?|packages?|pkgs?|packets?|sticks?|slices?|bunch(?:es)?|heads?|sprigs?|pieces?|stalks?|ribs?|"
          r"jars?|bottles?|bags?|boxes?|handfuls?|knobs?|sheets?|fillets?|cubes?|drops?")
_UNIT_RE = re.compile(rf"^\s*(?:(?:heaping|heaped|scant|level|generous|rounded)\s+)?(?:{_UNITS})\b\.?(?:\s+of\b)?\s*", re.I)
_TAILS = re.compile(
    r"\b(?:to taste|for (?:serving|garnish|garnishing|drizzling|brushing|dusting|frying|greasing|topping)|as needed|"
    r"plus (?:more|extra)\b.*|such as\b.*|cut into\b.*|or more|divided|optional)\b", re.I)
_WORDS = (
    "chopped|minced|diced|sliced|shredded|grated|crushed|fresh|freshly|finely|roughly|coarsely|thinly|thickly|lightly|"
    "large|small|medium|extra-large|jumbo|ripe|boneless|skinless|peeled|seeded|cored|trimmed|cooked|uncooked|raw|"
    "packed|softened|melted|chilled|cold|warm|hot|room temperature|unsalted|salted|low-sodium|reduced-sodium|"
    "organic|thawed|drained|rinsed|toasted|canned|frozen|lean|extra[- ]virgin|juiced|zested|halved|quartered|"
    "cubed|torn|beaten|sifted|heaping|scant"
)
_WORD_RE = re.compile(rf"\b(?:{_WORDS})\b", re.I)
_PAREN = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_SMALL = {"and", "or", "of", "with", "in", "for", "the", "a"}


def _title_case(s: str) -> str:
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        out.append(lw if (i > 0 and lw in _SMALL) else lw[:1].upper() + lw[1:])
    return " ".join(out)


def clean_ingredient(line: str) -> str | None:
    """'2 cups shredded mozzarella, divided' -> 'Mozzarella'. Deterministic; None for headers/empty lines."""
    s = html_lib.unescape(str(line)).replace(" ", " ").replace("\x00", "").strip()
    if not s or s.endswith(":") or re.match(r"^for the\b", s, re.I):
        return None
    s = _PAREN.sub(" ", s)
    s = re.sub(r"^(?:juice|zest)\s+of\s+", "", s, flags=re.I)
    for _ in range(2):  # "1 (14 oz) can tomatoes" -> quantity, then unit, then maybe another quantity
        s = _QTY_RE.sub("", s, count=1)
        s = _UNIT_RE.sub("", s, count=1)
    s = _TAILS.sub(" ", s)
    s = _WORD_RE.sub(" ", s)
    s = re.sub(r"[;*•]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^[\s,.\-–:]+", "", s)
    s = re.sub(r"^of\s+", "", s, flags=re.I)
    s = s.split(",")[0]
    s = re.split(r"\s+(?:or|/)\s+", s, maxsplit=1, flags=re.I)[0]  # "butter or margarine" -> first choice
    s = s.strip(" .-–:")
    if not re.search(r"[A-Za-z]", s) or len(s) > 120:
        return None
    return _title_case(s)


def _sing(name: str) -> str:
    s = " ".join(name.lower().split())
    if s.endswith("ies") and len(s) > 4:
        return s[:-3] + "y"
    if s.endswith(("ses", "xes", "oes")) and len(s) > 4:
        return s[:-2]
    if s.endswith("s") and not s.endswith("ss") and len(s) > 3:
        return s[:-1]
    return s


def have_item(name: str, owned: set[str]) -> bool:
    """True if a generic ingredient is already in `owned` (singular-normalized names): strict equality."""
    return _sing(name) in owned


def singular_set(names: Any) -> set[str]:
    return {_sing(n) for n in names}


# ─── JSON-LD parsing ─────────────────────────────────────────────────────────

_LD_RE = re.compile(r"<script[^>]+type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.I | re.S)
_OG_SITE = re.compile(r"<meta[^>]+property\s*=\s*[\"']og:site_name[\"'][^>]+content\s*=\s*[\"']([^\"']+)[\"']", re.I)
_OG_SITE2 = re.compile(r"<meta[^>]+content\s*=\s*[\"']([^\"']+)[\"'][^>]+property\s*=\s*[\"']og:site_name[\"']", re.I)


@dataclass
class ParsedRecipe:
    url: str
    site: str
    title: str
    image: str | None
    minutes: int
    servings: int
    lines: list[str]
    step_count: int
    ingredients: list[str] = field(default_factory=list)  # cleaned generic names (<= 25)


def _nodes(obj: Any) -> Iterator[dict[str, Any]]:
    if isinstance(obj, list):
        for x in obj:
            yield from _nodes(x)
    elif isinstance(obj, dict):
        yield obj
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in obj:
                yield from _nodes(obj[key])


def _is_type(node: dict[str, Any], want: str) -> bool:
    t = node.get("@type")
    types = t if isinstance(t, list) else [t]
    return any(isinstance(x, str) and x.lower().rsplit("/", 1)[-1] == want.lower() for x in types)


def parse_duration(value: Any) -> int | None:
    """ISO-8601 duration ('PT1H30M', 'P0DT45M', 'PT90M') -> minutes."""
    if not isinstance(value, str):
        return None
    m = re.fullmatch(r"\s*P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?\s*", value, re.I)
    if not m or not any(m.groups()):
        return None
    w, d, h, mi, _ = m.groups()
    return (int(w or 0) * 7 * 1440 + int(d or 0) * 1440 + int(h or 0) * 60 + int(mi or 0)) or None


def parse_yield(value: Any) -> int | None:
    if isinstance(value, list):
        for v in value:
            n = parse_yield(v)
            if n:
                return n
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value) or None
    if isinstance(value, str):
        m = re.search(r"\d+", value)
        return int(m.group()) if m else None
    return None


def parse_image(value: Any) -> str | None:
    """image as a string, list, or ImageObject; https only."""
    if isinstance(value, str):
        return value if value.startswith("https://") and len(value) <= 2000 else None
    if isinstance(value, list):
        for v in value:
            u = parse_image(v)
            if u:
                return u
        return None
    if isinstance(value, dict):
        return parse_image(value.get("url") or value.get("contentUrl"))
    return None


def count_steps(value: Any) -> int:
    """Number of method steps (HowToStep / HowToSection / strings). The text itself is never kept."""
    if isinstance(value, str):
        parts = [p for p in re.split(r"\n+", value) if p.strip()]
        return len(parts) or (1 if value.strip() else 0)
    if isinstance(value, list):
        return sum(count_steps(v) for v in value)
    if isinstance(value, dict):
        if "itemListElement" in value:
            return count_steps(value["itemListElement"])
        return 1 if (value.get("text") or value.get("name")) else 0
    return 0


def _publisher_name(node: dict[str, Any], all_nodes: list[dict[str, Any]]) -> str | None:
    pub = node.get("publisher")
    if isinstance(pub, dict) and isinstance(pub.get("name"), str):
        return pub["name"]
    if isinstance(pub, str) and pub.strip() and not pub.startswith("http"):
        return pub
    for n in all_nodes:
        if any(_is_type(n, t) for t in ("Organization", "NewsMediaOrganization", "WebSite")) \
                and isinstance(n.get("name"), str):
            return n["name"]
    return None


def pretty_host(host: str) -> str:
    host = host.lower().removeprefix("www.")
    for d, name in SITE_NAMES.items():
        if host == d or host.endswith("." + d):
            return name
    return _title_case(host.split(".")[0].replace("-", " "))


def _clip_title(s: str, n: int) -> str:
    s = " ".join(html_lib.unescape(s).split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def parse_recipe_html(page: str, url: str) -> ParsedRecipe | None:
    """The first schema.org Recipe in the page's JSON-LD, or None."""
    all_nodes: list[dict[str, Any]] = []
    for raw in _LD_RE.findall(page):
        raw = re.sub(r"^<!--|-->$", "", raw.strip()).strip()
        try:
            all_nodes.extend(_nodes(json.loads(raw)))
        except ValueError:
            continue
    for node in all_nodes:
        if not _is_type(node, "Recipe"):
            continue
        raw_lines = node.get("recipeIngredient") or node.get("ingredients") or []
        lines = [html_lib.unescape(" ".join(str(x).split())) for x in raw_lines if isinstance(x, str) and x.strip()]
        name = node.get("name")
        if not lines or not isinstance(name, str) or not name.strip():
            continue
        host = urlparse(url).hostname or ""
        og = _OG_SITE.search(page) or _OG_SITE2.search(page)
        site = _publisher_name(node, all_nodes) or (og.group(1) if og else None) or pretty_host(host)
        total = parse_duration(node.get("totalTime"))
        if total is None:
            total = sum(p for p in (parse_duration(node.get("prepTime")), parse_duration(node.get("cookTime"))) if p) or None
        generic: list[str] = []
        for ln in lines:
            g = clean_ingredient(ln)
            if g and g.lower() not in {x.lower() for x in generic}:
                generic.append(g)
        if not generic:
            continue
        return ParsedRecipe(
            url=url,
            site=_clip_title(site, 80) or pretty_host(host),
            title=_clip_title(name, 200),
            image=parse_image(node.get("image")),
            minutes=max(1, min(240, total or 30)),
            servings=max(1, min(20, parse_yield(node.get("recipeYield")) or 4)),
            lines=[ln[:200] for ln in lines][:40],
            step_count=count_steps(node.get("recipeInstructions")),
            ingredients=generic[:25],
        )
    return None


# ─── fetching & search ───────────────────────────────────────────────────────


class RecipeService:
    """Tavily search + safe fetch for one run. `enabled` is False without TAVILY_API_KEY (the model writes the meal)."""

    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = settings.tavily_api_key
        self._search_url = settings.tavily_url
        self._allowed = [d.lower() for d in settings.recipe_domains]
        self._n = settings.recipe_candidates
        self._http = httpx.AsyncClient(timeout=FETCH_TIMEOUT_S, transport=transport, follow_redirects=False)

    @property
    def enabled(self) -> bool:
        return bool(self._key)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def search(self, query: str) -> list[str]:
        """Allowlisted result URLs, best first. Never raises."""
        try:
            resp = await self._http.post(
                self._search_url,
                headers={"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"},
                json={"query": query, "search_depth": "basic", "max_results": 8,
                      "include_domains": self._allowed, "include_answer": False, "include_images": False},
                timeout=8.0,
            )
            if resp.status_code != 200:
                log.warning("tavily search failed: status=%s", resp.status_code)
                return []
            results = resp.json().get("results") or []
        except Exception as e:
            log.warning("tavily search error: %s", type(e).__name__)
            return []
        urls: list[str] = []
        for r in results:
            u = r.get("url") if isinstance(r, dict) else None
            if isinstance(u, str) and url_allowed(u, self._allowed) and u not in urls:
                urls.append(u)
        return urls

    async def fetch_html(self, url: str) -> str | None:
        """GET with manual redirects (each hop re-checked against the allowlist), size cap and timeout."""

        async def go() -> str | None:
            current = url
            for _ in range(MAX_REDIRECTS + 1):
                if not url_allowed(current, self._allowed):
                    log.warning("blocked fetch of a non-allowlisted url")
                    return None
                async with self._http.stream("GET", current, headers={"User-Agent": UA, "Accept": "text/html"},
                                             timeout=FETCH_TIMEOUT_S) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            return None
                        current = urljoin(current, loc)
                        continue
                    if resp.status_code != 200:
                        return None
                    if "html" not in resp.headers.get("content-type", "html").lower():
                        return None
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes():
                        buf.extend(chunk)
                        if len(buf) > MAX_BYTES:
                            log.warning("page over the size cap")
                            return None
                    return buf.decode(resp.encoding or "utf-8", errors="replace")
            return None  # too many redirects

        try:
            return await asyncio.wait_for(go(), FETCH_DEADLINE_S)
        except Exception as e:
            log.warning("fetch failed: %s", type(e).__name__)
            return None

    async def load(self, url: str) -> ParsedRecipe | None:
        page = await self.fetch_html(url)
        if not page:
            return None
        try:
            return parse_recipe_html(page, url)
        except Exception:
            log.exception("recipe parse crashed")
            return None

    async def candidates(self, idea: str, must_use: list[str], avoid: list[str], skip: set[str]) -> list[ParsedRecipe]:
        """Up to N parsed recipes for an idea, fetched in parallel, in search order."""
        query = f"{idea} recipe" + (f" with {', '.join(must_use[:3])}" if must_use else "")
        urls = [u for u in await self.search(query[:300]) if u not in skip][: self._n]
        loaded = await asyncio.gather(*(self.load(u) for u in urls), return_exceptions=True)
        out = [r for r in loaded if isinstance(r, ParsedRecipe)]
        bad = {a.strip().lower() for a in avoid if a.strip()}
        if not bad:
            return out
        return [r for r in out if not any(b in g.lower() for g in r.ingredients for b in bad)]
