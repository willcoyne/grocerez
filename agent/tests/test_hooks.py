import asyncio
import json
from unittest.mock import MagicMock

import httpx
import respx
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookRegistry

from app.hooks import Budget, StepReporter
from app.schemas import RunState
from app.server_client import EventSink
from tests.conftest import EVENTS, RUN_ID


def before(name, inp=None, agent=None):
    return BeforeToolCallEvent(agent=agent or MagicMock(), selected_tool=None,
                               tool_use={"name": name, "toolUseId": "t", "input": inp or {}}, invocation_state={})


def after(name, inp=None, exception=None):
    return AfterToolCallEvent(agent=MagicMock(), selected_tool=None,
                              tool_use={"name": name, "toolUseId": "t", "input": inp or {}},
                              invocation_state={}, result={"toolUseId": "t", "status": "success", "content": []},
                              exception=exception)


def sent(route):
    return [json.loads(c.request.content) for c in route.calls]


# ─── StepReporter ────────────────────────────────────────────────────────────


@respx.mock
async def test_step_reporter_running_then_done_with_increasing_seq(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    state.done_labels["get_cabinet"] = "14 items · using up: spinach (2 days)"
    await rep.before(before("get_cabinet"))
    await rep.after(after("get_cabinet"))
    await sink.flush()
    ev = sent(route)
    assert [e["seq"] for e in ev] == [0, 1]
    assert [e["payload"]["status"] for e in ev] == ["running", "done"]
    assert ev[0]["payload"]["label"] == "Reading the cabinet…"
    assert ev[1]["payload"]["label"] == "14 items · using up: spinach (2 days)"
    assert ev[0]["payload"]["id"] == ev[1]["payload"]["id"] == "get_cabinet"
    assert ev[0]["runId"] == RUN_ID and ev[0]["type"] == "step"
    assert "detail" not in ev[0]["payload"]  # absent, never null (zod: optional)


@respx.mock
async def test_drafting_step_after_wants_and_closed_by_next_tool(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    await rep.before(before("get_wants"))
    await rep.after(after("get_wants"))
    await rep.before(before("check_meal_safety", {"meals": [{}, {}, {}, {}]}))
    await sink.flush()
    ev = sent(route)
    drafting = [e["payload"] for e in ev if e["payload"]["id"] == "drafting"]
    assert [d["status"] for d in drafting] == ["running", "done"]
    assert drafting[1]["label"] == "Drafting 4 meals…"
    assert [e["seq"] for e in ev] == list(range(len(ev)))


@respx.mock
async def test_drafting_closed_by_whatever_tool_starts_next(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    await rep.after(after("get_wants"))
    await rep.before(before("propose_plan", {"meals": [{}, {}]}))
    await sink.flush()
    drafting = [e["payload"] for e in sent(route) if e["payload"]["id"] == "drafting"]
    assert [d["status"] for d in drafting] == ["running", "done"]


@respx.mock
async def test_parallel_find_recipe_calls_get_separate_rows_with_found_labels(sink, state):
    from app.recipes import step_key

    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    a, b = {"idea": "lemon chicken"}, {"idea": "spinach pasta"}
    await rep.before(before("find_recipe", a))
    await rep.before(before("find_recipe", b))
    state.done_labels[step_key("lemon chicken")] = "Found: Lemon Garlic Chicken (Serious Eats)"
    state.done_labels[step_key("spinach pasta")] = "No safe recipe found, writing it myself"
    await rep.after(after("find_recipe", a))
    await rep.after(after("find_recipe", b))
    await sink.flush()
    steps = [e["payload"] for e in sent(route)]
    ids = {s["id"] for s in steps}
    assert ids == {step_key("lemon chicken"), step_key("spinach pasta")}
    assert steps[0]["label"] == "Finding a recipe: lemon chicken…"
    assert "Found: Lemon Garlic Chicken (Serious Eats)" in [s["label"] for s in steps]


@respx.mock
async def test_failed_tool_marks_step_failed(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    state.failed_tools.add("get_cabinet")
    state.done_labels["get_cabinet"] = "Couldn't read the cabinet"
    await rep.after(after("get_cabinet"))
    await sink.flush()
    assert sent(route)[0]["payload"]["status"] == "failed"


# ─── EventSink: never blocks the run ─────────────────────────────────────────


@respx.mock
async def test_step_enqueue_returns_immediately_even_if_server_is_slow(client):
    async def slow(request):
        await asyncio.sleep(0.3)
        return httpx.Response(204)

    respx.post(EVENTS).mock(side_effect=slow)
    s = EventSink(client, RUN_ID, step_timeout=2)
    t0 = asyncio.get_event_loop().time()
    for i in range(5):
        await s.step("x", f"label {i}", "running")
    assert asyncio.get_event_loop().time() - t0 < 0.1  # the agent was not delayed by 5 slow posts
    await s.flush(5)


@respx.mock
async def test_steps_use_short_timeout_and_no_retry_and_trip_breaker(client):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(503))
    s = EventSink(client, RUN_ID)
    for i in range(6):
        await s.step("x", f"l{i}", "running")
        await s.flush()
    assert route.call_count == 2  # no retry per step; breaker opened after 2 consecutive failures
    assert s.breaker_open
    await s.step("x", "dropped", "running")
    await s.flush()
    assert route.call_count == 2


@respx.mock
async def test_breaker_does_not_block_terminal_event(client):
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body["type"])
        return httpx.Response(503) if body["type"] == "step" else httpx.Response(204)

    respx.post(EVENTS).mock(side_effect=handler)
    s = EventSink(client, RUN_ID)
    for _ in range(3):
        await s.step("x", "l", "running")
        await s.flush()
    assert s.breaker_open
    assert await s.failed("nope") == 204
    assert calls[-1] == "failed" and s.terminal_sent


@respx.mock
async def test_terminal_flushes_pending_steps_first_then_sends_once(client):
    order = []

    def handler(request):
        body = json.loads(request.content)
        order.append((body["seq"], body["type"]))
        return httpx.Response(204)

    respx.post(EVENTS).mock(side_effect=handler)
    s = EventSink(client, RUN_ID)
    await s.step("propose_plan", "Plan ready", "done")
    await s.step("a", "b", "done")
    status = await s.failed("done")
    assert status == 204
    assert order == [(0, "step"), (1, "step"), (2, "failed")]
    assert await s.failed("again") == 409  # exactly one terminal event
    assert len(order) == 3


@respx.mock
async def test_terminal_uses_longer_timeout_with_one_retry(client):
    route = respx.post(EVENTS).mock(side_effect=[httpx.Response(503), httpx.Response(204)])
    s = EventSink(client, RUN_ID)
    assert await s.failed("x") == 204
    assert route.call_count == 2


@respx.mock
async def test_terminal_400_401_403_are_fatal_and_stop_the_run(client):
    for code in (400, 401, 403):
        route = respx.post(EVENTS).mock(return_value=httpx.Response(code))
        stopped = MagicMock()
        s = EventSink(client, RUN_ID, on_stop=stopped)
        assert await s.failed("x") == code
        stopped.assert_called_once()
        assert s.terminal_fatal and s.closed and not s.terminal_sent
        assert await s.failed("again") == 409
        assert route.call_count == 1  # no retry, no loop
        respx.reset()


@respx.mock
async def test_409_closes_sink_and_cancels_agent(client):
    respx.post(EVENTS).mock(return_value=httpx.Response(409))
    stopped = MagicMock()
    s = EventSink(client, RUN_ID, on_stop=stopped)
    await s.step("get_cabinet", "x", "running")
    await s.flush()
    stopped.assert_called_once()
    await s.step("get_cabinet", "y", "done")
    assert s._queue.empty()  # nothing more is queued once closed


@respx.mock
async def test_outgoing_events_are_validated_and_nul_stripped(client):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    s = EventSink(client, RUN_ID)
    await s.step("get\x00cab", "bad\x00label", "running")
    await s.step("x", "y" * 50, "weird-status")  # invalid enum: dropped locally, never sent
    await s.flush()
    ev = sent(route)
    assert len(ev) == 1 and ev[0]["payload"] == {"id": "getcab", "label": "badlabel", "status": "running"}


@respx.mock
async def test_seq_is_capped_by_contract(client):
    respx.post(EVENTS).mock(return_value=httpx.Response(204))
    s = EventSink(client, RUN_ID)
    s._seq = 2_147_483_648
    assert await s.failed("x") == 400  # fails local validation (seq > int4): fatal, not sent


# ─── Budget ──────────────────────────────────────────────────────────────────


def test_budget_cancels_at_26th_call():
    state = RunState()
    budget = Budget(state, max_calls=25)
    agent = MagicMock()
    for _ in range(25):
        ev = before("get_cabinet", agent=agent)
        budget.before(ev)
        assert not ev.cancel_tool
    agent.cancel.assert_not_called()
    ev = before("get_cabinet", agent=agent)
    budget.before(ev)
    assert ev.cancel_tool
    agent.cancel.assert_called_once()
    assert state.budget_exceeded and state.tool_calls == 26


def test_hooks_register_on_real_registry(sink, state):
    reg = HookRegistry()
    Budget(state).register_hooks(reg)
    StepReporter(sink, state).register_hooks(reg)
    assert reg.has_callbacks()
