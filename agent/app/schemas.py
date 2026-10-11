"""Pydantic mirror of server/src/contracts/agent.ts (zod, FROZEN) plus per-run runtime types.

Keep field names, bounds and enums identical to the zod file. The parity test
(tests/test_schemas.py) validates server/test/fixtures/agent/demo-run.json against these models.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, Callable, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAYS: tuple[str, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

SEQ_MAX = 2_147_483_647  # int4, same cap as the zod contract


def contains_nul(obj: Any) -> bool:
    """True if any string anywhere in a JSON-like structure holds a NUL (Postgres text can't store it)."""
    if isinstance(obj, str):
        return "\x00" in obj
    if isinstance(obj, dict):
        return any(contains_nul(k) or contains_nul(v) for k, v in obj.items())
    if isinstance(obj, (list, tuple)):
        return any(contains_nul(v) for v in obj)
    return False


def strip_nul(obj: Any) -> Any:
    """Recursively drop NULs from every string (applied to model output before it is validated/sent)."""
    if isinstance(obj, str):
        return obj.replace("\x00", "")
    if isinstance(obj, dict):
        return {strip_nul(k): strip_nul(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_nul(v) for v in obj]
    return obj


class NoNul(BaseModel):
    """Mixin: reject NUL characters in any field, like zod's `text()` in the contract."""

    @model_validator(mode="before")
    @classmethod
    def _reject_nul(cls, data: Any) -> Any:
        if contains_nul(data):
            raise ValueError("must not contain NUL characters")
        return data


# zod: z.string().trim().min(1).max(n)
S120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
S500 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


# ─── Plan ────────────────────────────────────────────────────────────────────


CalendarDateStr = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class StepPreview(BaseModel):
    """Early peek at a meal (spec section 13) so the Week sheet can fill a day before the plan is proposed."""

    date: CalendarDateStr | None
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    site: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] | None


class AlreadyPlanned(BaseModel):
    date: CalendarDateStr
    title: str


class PlanSource(BaseModel):
    """The web recipe a meal comes from (cited; we show our own short steps and link out)."""

    url: str = Field(max_length=2000, pattern=r"^https://")
    site: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    imageUrl: str | None = Field(max_length=2000, pattern=r"^https://")


class PlanMeal(BaseModel):
    title: S120
    day: Weekday | None
    minutes: int = Field(ge=1, le=240)
    servings: int = Field(ge=1, le=20)
    ingredients: list[S120] = Field(min_length=1, max_length=25)
    uses: list[S120] = Field(max_length=15)
    missing: list[S120] = Field(max_length=15)
    steps: list[S500] = Field(min_length=1, max_length=6)
    source: PlanSource | None = None
    # Calendar date this dinner is planned for (spec section 13); null for plans made without a week calendar.
    date: CalendarDateStr | None = None
    # The source's ingredient lines with quantities, for display. Empty when there is no source.
    ingredientLines: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=40
    )


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
    preview: StepPreview | None = None


class AgentStep(AgentStepPayload):
    seq: int = Field(ge=0, le=SEQ_MAX)
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
    # Apply also checks the title and steps for allergen/diet keywords, so the agent sends them too.
    steps: list[S500] = Field(default_factory=list, max_length=6)
    # A sourced meal's raw ingredient lines: keyword-scanned only (never "unknown"), like apply does.
    ingredientLines: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=40
    )


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
    runToken: str = Field(repr=False)
    # Dates to plan, one dinner each (spec section 13); empty for older servers (then 3 meals, days assigned).
    dates: list[CalendarDateStr] = Field(default_factory=list, max_length=7)
    # Meals already planned on nearby dates, so the agent avoids repeats.
    alreadyPlanned: list[AlreadyPlanned] = Field(default_factory=list, max_length=31)

    @field_validator("apiBaseUrl")
    @classmethod
    def _http_url(cls, v: str) -> str:
        if not re.match(r"^https?://[^\s/]+", v):
            raise ValueError("apiBaseUrl must be an http(s) URL")
        return v


class StepEvent(NoNul):
    runId: UUID
    seq: int = Field(ge=0, le=SEQ_MAX)
    type: Literal["step"]
    payload: AgentStepPayload


class ProposedPayload(BaseModel):
    plan: AgentPlan
    meta: AgentRunMeta


class ProposedEvent(NoNul):
    runId: UUID
    seq: int = Field(ge=0, le=SEQ_MAX)
    type: Literal["proposed"]
    payload: ProposedPayload


class FailedPayload(BaseModel):
    message: str = Field(max_length=500)
    meta: AgentRunMeta | None = None


class FailedEvent(NoNul):
    runId: UUID
    seq: int = Field(ge=0, le=SEQ_MAX)
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


class PricePairs(BaseModel):
    """Compact price-agent reply: [[lowCents, highCents], ...] in the same order as the input items."""

    prices: list[tuple[Annotated[int, Field(ge=0, le=10_000_000)], Annotated[int, Field(ge=0, le=10_000_000)]]]


# ─── Recipe index (spec §12) ─────────────────────────────────────────────────

HttpsUrl = Annotated[str, StringConstraints(max_length=2000, pattern=r"^https://")]


class IndexedRecipe(NoNul):
    """One crawled recipe, as POSTed to /api/internal/recipes. Lines and metadata only: never the site's method text."""

    url: HttpsUrl
    site: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    imageUrl: HttpsUrl | None
    minutes: int | None = Field(ge=1, le=1440)
    servings: int | None = Field(ge=1, le=50)
    ingredientLines: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = Field(
        min_length=1, max_length=40
    )
    ingredients: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]] = Field(
        min_length=1, max_length=40
    )
    # The page's schema.org recipeCategory, lower-cased ("main course", "dinner", "side dish"); [] when not stated.
    course: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]] = Field(
        default_factory=list, max_length=8
    )


class RecipeIngestBody(NoNul):
    recipes: list[IndexedRecipe] = Field(min_length=1, max_length=100)


class RecipeSearchBody(NoNul):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    mustUse: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]] = Field(
        default_factory=list, max_length=10
    )
    limit: int = Field(default=6, ge=1, le=10)
    # Browse mode: safe main courses that use the expiring items, ranked by kitchen fit (the query is just "dinner").
    browse: bool = False


class SearchedRecipe(IndexedRecipe):
    id: UUID
    distance: float
    uses: list[str]


class RecipeSearchResponse(BaseModel):
    recipes: list[SearchedRecipe]
    available: bool


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
    dates: tuple[str, ...] = ()  # one dinner per date; empty = the old behaviour (3 meals, days assigned)
    already_planned: tuple[tuple[str, str], ...] = ()  # (date, title)


@dataclass
class RunState:
    """Mutable state shared by one run's tools and hooks."""

    started: float = field(default_factory=time.perf_counter)
    household: dict[str, Any] | None = None
    done_labels: dict[str, str] = field(default_factory=dict)
    done_details: dict[str, str] = field(default_factory=dict)
    failed_tools: set[str] = field(default_factory=set)
    safety_by_title: dict[str, SafetyMealOut] = field(default_factory=dict)
    draft_meals: dict[str, dict[str, Any]] = field(default_factory=dict)  # normalized meals of the last check
    list_names: set[str] = field(default_factory=set)  # singular-normalized names already on the list
    used_urls: set[str] = field(default_factory=set)  # recipe pages already chosen this run
    suggested: dict[str, Any] = field(default_factory=dict)  # short id -> ParsedRecipe from suggest_recipes
    pending_finds: int = 0  # find_recipe calls in flight (pricing waits until they finish)
    to_buy_ok: bool = False  # the "To buy" pseudo-meal passed the last safety check
    cabinet_names: set[str] = field(default_factory=set)  # normalized cabinet item names
    expiry_days: dict[str, int] = field(default_factory=dict)  # normalized cabinet name -> days until expiry
    done_previews: dict[str, dict[str, Any]] = field(default_factory=dict)  # step key -> preview for its "done" event
    previewed: set[str] = field(default_factory=set)  # meal titles whose preview was already sent
    fatal_status: int | None = None  # 401/403 from the server: stop the run
    proposal_failures: int = 0
    missing_nudged: bool = False
    tool_s: float = 0.0  # summed tool wall time (parallel tools overlap, so this is an upper bound)
    tool_calls: int = 0
    budget_exceeded: bool = False
    extra_tokens_in: int = 0
    extra_tokens_out: int = 0
    cancel: Callable[[], None] | None = None
    usage: Callable[[], tuple[int | None, int | None]] | None = None

    def ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)
