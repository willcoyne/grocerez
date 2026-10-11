"""Shared test fixtures. Unit tests never touch the network: HTTP goes through respx, models are fakes."""
from __future__ import annotations

import pytest

from app.config import Settings
from app.pricing import PriceCache
from app.schemas import RunContext, RunState
from app.server_client import EventSink, ServerClient

RUN_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"
GROUP_ID = "11111111-1111-4111-8111-111111111111"
API = "http://server.test/api"
TOKEN = "run-token-abc"
SECRET = "s" * 40


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
