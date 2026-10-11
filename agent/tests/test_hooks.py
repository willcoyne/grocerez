from unittest.mock import MagicMock

import httpx
import respx
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookRegistry

from app.hooks import Budget, StepReporter
from app.schemas import RunState
from tests.conftest import API, RUN_ID

EVENTS = f"{API}/internal/agent-events"


def before(name, inp=None, agent=None):
    return BeforeToolCallEvent(agent=agent or MagicMock(), selected_tool=None,
                               tool_use={"name": name, "toolUseId": "t", "input": inp or {}}, invocation_state={})


def after(name, inp=None, exception=None):
    return AfterToolCallEvent(agent=MagicMock(), selected_tool=None,
                              tool_use={"name": name, "toolUseId": "t", "input": inp or {}},
                              invocation_state={}, result={"toolUseId": "t", "status": "success", "content": []},
                              exception=exception)


def sent(route):
    import json

    return [json.loads(c.request.content) for c in route.calls]


@respx.mock
async def test_step_reporter_running_then_done_with_increasing_seq(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    state.done_labels["get_cabinet"] = "14 items · using up: spinach (2 days)"
    await rep.before(before("get_cabinet"))
    await rep.after(after("get_cabinet"))
    ev = sent(route)
    assert [e["seq"] for e in ev] == [0, 1]
    assert [e["payload"]["status"] for e in ev] == ["running", "done"]
    assert ev[0]["payload"]["label"] == "Reading the cabinet…"
    assert ev[1]["payload"]["label"] == "14 items · using up: spinach (2 days)"
    assert ev[0]["payload"]["id"] == ev[1]["payload"]["id"] == "get_cabinet"
    assert ev[0]["runId"] == RUN_ID and ev[0]["type"] == "step"


@respx.mock
async def test_drafting_step_after_wants_and_closed_at_safety_check(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    await rep.before(before("get_wants"))
    await rep.after(after("get_wants"))
    await rep.before(before("check_meal_safety", {"meals": [{}, {}, {}, {}]}))
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
    drafting = [e["payload"] for e in sent(route) if e["payload"]["id"] == "drafting"]
    assert [d["status"] for d in drafting] == ["running", "done"]


@respx.mock
async def test_failed_tool_marks_step_failed(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    rep = StepReporter(sink, state)
    state.failed_tools.add("get_cabinet")
    state.done_labels["get_cabinet"] = "Couldn't read the cabinet"
    await rep.after(after("get_cabinet"))
    assert sent(route)[0]["payload"]["status"] == "failed"


@respx.mock
async def test_pricing_running_label_counts_items(sink, state):
    route = respx.post(EVENTS).mock(return_value=httpx.Response(204))
    await StepReporter(sink, state).before(before("estimate_prices", {"items": ["a", "b", "c"]}))
    assert sent(route)[0]["payload"]["label"] == "Pricing 3 missing items…"


@respx.mock
async def test_409_closes_sink_and_cancels_agent(client, state):
    from app.server_client import EventSink

    respx.post(EVENTS).mock(return_value=httpx.Response(409))
    stopped = MagicMock()
    s = EventSink(client, RUN_ID, on_stop=stopped)
    await s.step("get_cabinet", "x", "running")
    stopped.assert_called_once()
    assert await s.step("get_cabinet", "y", "done") == 409  # nothing more is sent


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
