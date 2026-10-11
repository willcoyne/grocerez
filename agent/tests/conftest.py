"""Shared test fixtures. Unit tests never touch the network: HTTP goes through respx, models are fakes."""
from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.pricing import PriceCache, PriceService
from app.schemas import RunContext, RunState
from app.server_client import EventSink, ServerClient

RUN_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"
GROUP_ID = "11111111-1111-4111-8111-111111111111"
API = "http://server.test/api"
EVENTS = f"{API}/internal/agent-events"
G = f"{API}/groups/{GROUP_ID}"
TOKEN = "run-token-abc"
SECRET = "s" * 40


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
    """Replies with canned text. `delay` simulates a slow model."""

    def __init__(self, replies, delay=0.0):
        self.replies = list(replies)
        self.calls = 0
        self.delay = delay

    async def invoke_async(self, prompt):
        import asyncio

        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return FakeResult(self.replies.pop(0) if len(self.replies) > 1 else self.replies[0])


def safety_ok(request: httpx.Request) -> httpx.Response:
    """Fake safety endpoint: every meal passes; "za'atar" is reported as unknown."""
    meals = json.loads(request.content)["meals"]
    return httpx.Response(200, json={"meals": [
        {"title": m["title"], "passes": True, "problems": [],
         "unknown": [i for i in m["ingredients"] if i == "za'atar"]} for m in meals]})


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, agent_shared_secret=SECRET, akamai_inference_key="k")


@pytest.fixture
def ctx() -> RunContext:
    return RunContext(run_id=RUN_ID, group_id=GROUP_ID, api_base=API, run_token=TOKEN,
                      zip_code="64105", prompt="Plan 4 dinners", budget_cents=6000)


@pytest.fixture
def state() -> RunState:
    return RunState()


@pytest.fixture
def client(ctx, settings):
    return ServerClient(ctx, settings, retry_delay_s=0)


@pytest.fixture
def sink(client) -> EventSink:
    return EventSink(client, RUN_ID)


@pytest.fixture
def cache() -> PriceCache:
    return PriceCache()


@pytest.fixture
def make_pricer(ctx, state, settings, sink, cache):
    def make(replies=('{"prices":[[300,450]]}',), delay=0.0, zip_code="unset"):
        agent = FakePriceAgent(list(replies), delay)
        c = ctx if zip_code == "unset" else RunContext(run_id=RUN_ID, group_id=GROUP_ID, api_base=API,
                                                       run_token=TOKEN, zip_code=zip_code)
        svc = PriceService(c, state, settings, sink, agent_factory=lambda: agent, cache=cache)
        svc.agent = agent
        return svc

    return make
