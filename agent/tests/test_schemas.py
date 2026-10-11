"""Contract parity: the shared fixture (also validated by zod on the server) must validate with pydantic."""
import copy
import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import AgentEvent, AgentPlan, AgentRun, AgentRunRequest, PlanDraft

FIXTURE = Path(__file__).resolve().parents[2] / "server" / "test" / "fixtures" / "agent" / "demo-run.json"


@pytest.fixture(scope="module")
def run_json() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_validates_as_agent_run(run_json):
    run = AgentRun.model_validate(run_json)
    assert run.status == "proposed"
    assert len(run.plan.meals) == 4
    assert [s.seq for s in run.steps] == sorted(s.seq for s in run.steps)


def test_fixture_plan_roundtrips_as_proposed_event(run_json):
    event = {"runId": run_json["id"], "seq": 9, "type": "proposed",
             "payload": {"plan": run_json["plan"], "meta": run_json["meta"]}}
    parsed = TypeAdapter(AgentEvent).validate_python(event)
    assert parsed.type == "proposed"
    assert AgentPlan.model_validate(parsed.payload.plan.model_dump()) == parsed.payload.plan


def test_step_and_failed_events_validate(run_json):
    step = {"runId": run_json["id"], "seq": 0, "type": "step",
            "payload": {"id": "get_cabinet", "label": "Reading the cabinet…", "status": "running"}}
    failed = {"runId": run_json["id"], "seq": 1, "type": "failed", "payload": {"message": "nope"}}
    ta = TypeAdapter(AgentEvent)
    assert ta.validate_python(step).type == "step"
    assert ta.validate_python(failed).type == "failed"


def test_bounds_match_zod(run_json):
    bad = copy.deepcopy(run_json["plan"])
    bad["meals"][0]["minutes"] = 241
    with pytest.raises(ValidationError):
        AgentPlan.model_validate(bad)
    bad = copy.deepcopy(run_json["plan"])
    bad["estimate"]["label"] = "exact price"
    with pytest.raises(ValidationError):
        AgentPlan.model_validate(bad)
    bad = copy.deepcopy(run_json["plan"])
    bad["safety"]["checked"] = False
    with pytest.raises(ValidationError):
        AgentPlan.model_validate(bad)
    bad = copy.deepcopy(run_json["plan"])
    bad["meals"][0]["day"] = "Monday"
    with pytest.raises(ValidationError):
        AgentPlan.model_validate(bad)


def test_plan_draft_normalizes_day_and_ignores_extras(run_json):
    draft = copy.deepcopy(run_json["plan"])
    draft["meals"][0]["day"] = "monday"
    draft["safety"] = {"checked": False}
    parsed = PlanDraft.model_validate(draft)
    assert parsed.meals[0].day == "Mon"


def test_run_request_validates():
    body = {"runId": "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", "groupId": "11111111-1111-4111-8111-111111111111",
            "prompt": "x", "budgetCents": None, "zipCode": None, "apiBaseUrl": "http://s/api", "runToken": "t"}
    assert AgentRunRequest.model_validate(body).zipCode is None
    del body["runToken"]
    with pytest.raises(ValidationError):
        AgentRunRequest.model_validate(body)
