"""Pydantic mirror of server/src/contracts/agent.ts (zod, FROZEN) plus per-run runtime types.

Keep field names, bounds and enums identical to the zod file. The parity test
(tests/test_schemas.py) validates server/test/fixtures/agent/demo-run.json against these models.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Annotated, Any, Callable, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator

Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAYS: tuple[str, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# zod: z.string().trim().min(1).max(n)
S120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
S500 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


# ─── Plan ────────────────────────────────────────────────────────────────────


class PlanMeal(BaseModel):
    title: S120
    day: Weekday | None
    minutes: int = Field(ge=1, le=240)
    servings: int = Field(ge=1, le=20)
    ingredients: list[S120] = Field(min_length=1, max_length=25)
    uses: list[S120] = Field(max_length=15)
    missing: list[S120] = Field(max_length=15)
    steps: list[S500] = Field(min_length=1, max_length=6)


class PlanMissingItem(BaseModel):
    name: S120
    forMeals: list[Annotated[str, StringConstraints(max_length=120)]] = Field(min_length=1, max_length=7)


class PlanEstimate(BaseModel):
    lowCents: int = Field(ge=0, le=10_000_000)
    highCents: int = Field(ge=0, le=10_000_000)
    label: Literal["AI estimate"]


class PerMealSafety(BaseModel):
    title: str
    passes: bool
    unknown: list[str]


class PlanSafety(BaseModel):
    checked: Literal[True]
    perMeal: list[PerMealSafety]


class AgentPlan(BaseModel):
    meals: list[PlanMeal] = Field(min_length=1, max_length=7)
    missingItems: list[PlanMissingItem] = Field(max_length=40)
    estimate: PlanEstimate | None
    safety: PlanSafety
    summary: str = Field(max_length=400)


class AgentRunMeta(BaseModel):
    provider: str = Field(max_length=40)
    model: str = Field(max_length=120)
    toolCalls: int = Field(ge=0)
    tokensIn: int | None = Field(ge=0)
    tokensOut: int | None = Field(ge=0)
    ms: int = Field(ge=0)


class PlanDraftMeal(PlanMeal):
    """Lenient meal accepted from the model: normalizes "Monday"/"monday" to "Mon"."""

    day: Weekday | None = None

    @field_validator("day", mode="before")
    @classmethod
    def _norm_day(cls, v: Any) -> Any:
        if isinstance(v, str):
            key = v.strip()[:3].title()
            return key if key in WEEKDAYS else None
        return v


class PlanDraft(BaseModel):
    """What the model passes to propose_plan. `estimate` and `safety` are filled in by the tool from
    verified results, never trusted from the model, so extra keys are ignored."""

    meals: list[PlanDraftMeal] = Field(min_length=1, max_length=7)
    missingItems: list[PlanMissingItem] = Field(default_factory=list, max_length=40)
    summary: str = Field(default="", max_length=400)


# ─── Runs ────────────────────────────────────────────────────────────────────

AgentRunStatus = Literal["running", "proposed", "applied", "failed"]
AgentStepStatus = Literal["running", "done", "failed"]


class AgentStepPayload(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)
    status: AgentStepStatus
    detail: str | None = Field(default=None, max_length=500)


class AgentStep(AgentStepPayload):
    seq: int = Field(ge=0)
    at: str


class AgentRun(BaseModel):
    id: UUID
    groupId: UUID
    userId: UUID
    prompt: str
    budgetCents: int | None
    status: AgentRunStatus
    steps: list[AgentStep]
    plan: AgentPlan | None
    error: str | None
    meta: AgentRunMeta | None
    createdAt: str
    updatedAt: str
    appliedAt: str | None


# ─── Tool endpoints ──────────────────────────────────────────────────────────


class HouseholdMember(BaseModel):
    displayName: str
    allergens: list[str]
    diets: list[str]


class AgentHousehold(BaseModel):
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    timeZone: str
    zipCode: str | None
    members: list[HouseholdMember]


class SafetyMealIn(BaseModel):
    title: S120
    ingredients: list[S120] = Field(min_length=1, max_length=25)


class SafetyCheckBody(BaseModel):
    meals: list[SafetyMealIn] = Field(min_length=1, max_length=7)


class SafetyProblem(BaseModel):
    ingredient: str
    reason: str
    members: list[str]


class SafetyMealOut(BaseModel):
    title: str
    passes: bool
    problems: list[SafetyProblem]
    unknown: list[str]


class SafetyCheckResponse(BaseModel):
    meals: list[SafetyMealOut]


# ─── Agent service <-> server wire format (agent/API.md) ─────────────────────


class AgentRunRequest(BaseModel):
    runId: UUID
    groupId: UUID
    prompt: str
    budgetCents: int | None
    zipCode: str | None
    apiBaseUrl: str
    runToken: str


class StepEvent(BaseModel):
    runId: UUID
    seq: int = Field(ge=0)
    type: Literal["step"]
    payload: AgentStepPayload


class ProposedPayload(BaseModel):
    plan: AgentPlan
    meta: AgentRunMeta


class ProposedEvent(BaseModel):
    runId: UUID
    seq: int = Field(ge=0)
    type: Literal["proposed"]
    payload: ProposedPayload


class FailedPayload(BaseModel):
    message: str = Field(max_length=500)
    meta: AgentRunMeta | None = None


class FailedEvent(BaseModel):
    runId: UUID
    seq: int = Field(ge=0)
    type: Literal["failed"]
    payload: FailedPayload


AgentEvent = Annotated[StepEvent | ProposedEvent | FailedEvent, Field(discriminator="type")]


class PriceItem(BaseModel):
    """One line returned by the price sub-agent."""

    name: S120
    lowCents: int = Field(ge=0, le=10_000_000)
    highCents: int = Field(ge=0, le=10_000_000)


class PriceResult(BaseModel):
    items: list[PriceItem]


# ─── Per-run runtime types (no module-level mutable state) ───────────────────


@dataclass(frozen=True)
class RunContext:
    run_id: str
    group_id: str
    api_base: str
    run_token: str = field(repr=False)
    zip_code: str | None = None
    prompt: str = ""
    budget_cents: int | None = None


@dataclass
class RunState:
    """Mutable state shared by one run's tools and hooks."""

    started: float = field(default_factory=time.perf_counter)
    household: dict[str, Any] | None = None
    done_labels: dict[str, str] = field(default_factory=dict)
    done_details: dict[str, str] = field(default_factory=dict)
    failed_tools: set[str] = field(default_factory=set)
    safety_by_title: dict[str, SafetyMealOut] = field(default_factory=dict)
    drafts: dict[str, list[str]] = field(default_factory=dict)  # title -> ingredients last safety-checked
    priced: dict[str, tuple[int, int]] = field(default_factory=dict)
    proposal_failures: int = 0
    tool_calls: int = 0
    budget_exceeded: bool = False
    extra_tokens_in: int = 0
    extra_tokens_out: int = 0
    cancel: Callable[[], None] | None = None
    usage: Callable[[], tuple[int | None, int | None]] | None = None

    def ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)
