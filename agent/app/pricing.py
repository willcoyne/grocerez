"""Price sub-agent: a second Strands Agent with NO tools, run in the background (off the critical path).

PriceService.start(names) is called when the draft's safety check passes; propose_plan later awaits it for a
bounded time. Estimates come from model knowledge (no web search on Akamai) and are always labeled "AI estimate".
Cache: in-process, keyed by (normalized name, zip), 24 h TTL, at most 2000 entries (oldest evicted first).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

from pydantic import ValidationError
from strands import Agent

from .config import Settings
from .models import build_model
from .schemas import PricePairs, RunContext, RunState
from .server_client import EventSink

log = logging.getLogger("agent.pricing")

PRICER_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "pricer.md"
CACHE_TTL_S = 24 * 3600
CACHE_MAX = 2000
MAX_ITEMS = 30
STEP_ID = "estimate_prices"


def normalize(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


class PriceCache:
    """TTL + size-capped cache of (normalized name, zip) -> (lowCents, highCents)."""

    def __init__(
        self,
        ttl_s: float = CACHE_TTL_S,
        clock: Callable[[], float] = time.monotonic,
        max_entries: int = CACHE_MAX,
    ) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._max = max_entries
        self._data: OrderedDict[tuple[str, str], tuple[float, tuple[int, int]]] = OrderedDict()

    def __len__(self) -> int:
        return len(self._data)

    def get(self, name: str, zip_code: str) -> tuple[int, int] | None:
        key = (normalize(name), zip_code)
        hit = self._data.get(key)
        if hit is None:
            return None
        if self._clock() - hit[0] > self._ttl:
            del self._data[key]
            return None
        return hit[1]

    def set(self, name: str, zip_code: str, value: tuple[int, int]) -> None:
        key = (normalize(name), zip_code)
        self._data.pop(key, None)
        self._data[key] = (self._clock(), value)
        while len(self._data) > self._max:
            self._data.popitem(last=False)  # oldest first

    def clear(self) -> None:
        self._data.clear()


# Shared across runs on purpose (re-runs during a demo); it holds prices only, never run data.
DEFAULT_CACHE = PriceCache()


def extract_json(text: str) -> Any:
    """Parse the first {...} block of model text (tolerates code fences and stray prose)."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start : end + 1])


_PAIR = re.compile(r"\[\s*(\d+)\s*,\s*(\d+)\s*\]")


def parse_pairs(text: str) -> list[tuple[int, int]]:
    """[[low, high], ...] from the price agent. Qwen sometimes drops a closing bracket, so fall back to the pairs."""
    try:
        return PricePairs.model_validate(extract_json(text)).prices
    except (ValueError, ValidationError):
        pairs = [(int(a), int(b)) for a, b in _PAIR.findall(text)]
        return PricePairs.model_validate({"prices": pairs}).prices


def default_agent_factory(settings: Settings) -> Callable[[], Agent]:
    def make() -> Agent:
        return Agent(
            model=build_model(settings.price_provider, settings),
            system_prompt=PRICER_PROMPT_PATH.read_text(encoding="utf-8"),
            tools=None,  # no tools; an empty list makes vLLM reject the request (400)
            callback_handler=None,
        )

    return make


def _dollars(cents: int) -> str:
    return f"${(cents + 50) // 100}"


class PriceService:
    """Per-run background pricing. Only the FINAL missing names are priced; partial results are never summed."""

    def __init__(
        self,
        ctx: RunContext,
        state: RunState,
        settings: Settings,
        sink: EventSink,
        *,
        agent_factory: Callable[[], Any] | None = None,
        cache: PriceCache | None = None,
    ) -> None:
        self._ctx = ctx
        self._state = state
        self._sink = sink
        self._cache = cache if cache is not None else DEFAULT_CACHE
        self._make_agent = agent_factory or default_agent_factory(settings)
        self._task: asyncio.Task[dict[str, tuple[int, int]]] | None = None
        self._key: tuple[str, ...] = ()
        self._skipped_announced = False

    @property
    def zip_code(self) -> str:
        return (self._ctx.zip_code or (self._state.household or {}).get("zipCode") or "").strip()

    @staticmethod
    def _key_for(names: list[str]) -> tuple[str, ...]:
        return tuple(sorted({normalize(n) for n in names if n.strip()}))

    def start(self, names: list[str]) -> None:
        """Begin (or keep) pricing exactly these names. A different set cancels the previous task."""
        key = self._key_for(names)[:MAX_ITEMS]
        if not key:
            return
        if not self.zip_code:
            if not self._skipped_announced:
                self._skipped_announced = True
                asyncio.ensure_future(self._sink.step(STEP_ID, "No ZIP set, skipping prices", "done"))
            return
        if self._task is not None and key == self._key and not self._task.done():
            return
        if self._task is not None and key == self._key and self._task.done() and not self._task.cancelled():
            return  # already have this exact result
        self.cancel()
        self._key = key
        self._task = asyncio.create_task(self._run(list(key)))

    def cancel(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()

    async def _ask(self, items: list[str], zip_code: str) -> list[tuple[int, int]] | None:
        prompt = json.dumps({"zip": zip_code, "items": items})
        for attempt in range(2):  # retry once on invalid output
            try:
                result = await self._make_agent().invoke_async(prompt)
                try:
                    usage = result.metrics.get_summary().get("accumulated_usage", {})
                    self._state.extra_tokens_in += int(usage.get("inputTokens", 0))
                    self._state.extra_tokens_out += int(usage.get("outputTokens", 0))
                except Exception:  # metrics are best-effort
                    pass
                pairs = parse_pairs(str(result))
                if len(pairs) != len(items):
                    raise ValueError("price count does not match item count")
                return [(min(p), max(p)) for p in pairs]
            except (ValueError, ValidationError) as e:
                log.warning("price agent invalid output (attempt %d): %s", attempt + 1, type(e).__name__)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("price agent failed (attempt %d)", attempt + 1)
        return None

    async def _run(self, names: list[str]) -> dict[str, tuple[int, int]]:
        zip_code = self.zip_code
        found: dict[str, tuple[int, int]] = {}
        todo: list[str] = []
        for n in names:
            hit = self._cache.get(n, zip_code)
            if hit:
                found[normalize(n)] = hit
            else:
                todo.append(n)
        if todo:
            await self._sink.step(STEP_ID, f"Pricing {len(names)} missing items…", "running")
            pairs = await self._ask(todo, zip_code)
            for name, pair in zip(todo, pairs or []):
                found[normalize(name)] = pair
                self._cache.set(name, zip_code, pair)
        if len(found) == len(names):
            low = sum(v[0] for v in found.values())
            high = sum(v[1] for v in found.values())
            await self._sink.step(STEP_ID, f"{_dollars(low)}–{_dollars(high)} (AI estimate)", "done")
        else:
            await self._sink.step(STEP_ID, "Price estimate unavailable", "done")
        return found

    async def estimate_for(self, names: list[str], timeout: float = 8.0) -> tuple[int, int] | None:
        """(lowCents, highCents) for exactly `names`, or None (no ZIP, too slow, or any name unpriced)."""
        key = self._key_for(names)
        if not key or not self.zip_code:
            return None
        if self._task is None or key != self._key:
            self.start(names)
        task = self._task
        if task is None:
            return None
        try:
            found = await asyncio.wait_for(asyncio.shield(task), timeout)
        except asyncio.TimeoutError:
            self.cancel()
            await self._sink.step(STEP_ID, "Skipped prices (taking too long)", "done")
            return None
        except asyncio.CancelledError:
            if task.cancelled():  # the pricing task was superseded; our own run is not being cancelled
                return None
            raise
        except Exception:
            return None
        if any(k not in found for k in key):
            return None  # never sum a partial set
        return sum(found[k][0] for k in key), sum(found[k][1] for k in key)
