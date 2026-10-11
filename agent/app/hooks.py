"""Strands hook providers: StepReporter (progress events) and Budget (tool-call cap).

Verified against strands-agents 1.59: BeforeToolCallEvent / AfterToolCallEvent from `strands.hooks`;
callbacks may be sync or async; `event.agent.cancel()` ends the invocation gracefully.
"""
from __future__ import annotations

import logging
from typing import Any

from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookProvider, HookRegistry

from .schemas import RunState
from .server_client import EventSink

log = logging.getLogger("agent.hooks")

RUNNING_LABELS = {
    "get_household": "Reading the household…",
    "get_cabinet": "Reading the cabinet…",
    "get_shopping_list": "Checking the list…",
    "get_wants": "Checking what everyone wants…",
    "check_meal_safety": "Safety check…",
    "estimate_prices": "Pricing missing items…",
    "propose_plan": "Finishing the plan…",
}
DONE_LABELS = {
    "get_household": "Read the household",
    "get_cabinet": "Read the cabinet",
    "get_shopping_list": "Checked the list",
    "get_wants": "Checked what everyone wants",
    "check_meal_safety": "Safety check done",
    "estimate_prices": "Priced the missing items",
    "propose_plan": "Plan ready",
}
DRAFT_ID = "drafting"


class Budget(HookProvider):
    """Cancels the run when more than `max_calls` tool calls are attempted."""

    def __init__(self, state: RunState, max_calls: int = 25) -> None:
        self._state = state
        self._max = max_calls

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before)

    def before(self, event: BeforeToolCallEvent) -> None:
        self._state.tool_calls += 1
        if self._state.tool_calls > self._max:
            self._state.budget_exceeded = True
            event.cancel_tool = "Tool call budget exceeded"
            log.warning("tool-call budget exceeded (%d)", self._state.tool_calls)
            event.agent.cancel()


class StepReporter(HookProvider):
    """Maps tool calls to human step events: running -> done, with a synthetic "drafting" step."""

    def __init__(self, sink: EventSink, state: RunState) -> None:
        self._sink = sink
        self._state = state
        self._drafting = False  # "Drafting…" is running

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before)
        registry.add_callback(AfterToolCallEvent, self.after)

    @staticmethod
    def _name(tool_use: Any) -> str:
        return str(tool_use.get("name", "")) if isinstance(tool_use, dict) else ""

    def _running_label(self, name: str, tool_use: Any) -> str:
        inp = tool_use.get("input") if isinstance(tool_use, dict) else None
        if isinstance(inp, dict) and name == "estimate_prices":
            items = inp.get("items")
            if isinstance(items, list) and items:
                return f"Pricing {len(items)} missing items…"
        return RUNNING_LABELS.get(name, f"Running {name}…")

    async def _finish_drafting(self, tool_use: Any) -> None:
        if not self._drafting:
            return
        self._drafting = False
        inp = tool_use.get("input") if isinstance(tool_use, dict) else None
        meals = inp.get("meals") if isinstance(inp, dict) else None
        n = len(meals) if isinstance(meals, list) else 0
        await self._sink.step(DRAFT_ID, f"Drafting {n} meals…" if n else "Drafted the meals", "done")

    async def before(self, event: BeforeToolCallEvent) -> None:
        if event.cancel_tool:
            return
        try:
            name = self._name(event.tool_use)
            if name not in RUNNING_LABELS:
                return
            if name == "check_meal_safety":
                await self._finish_drafting(event.tool_use)
            await self._sink.step(name, self._running_label(name, event.tool_use), "running")
        except Exception:  # progress is best-effort; never break the run
            log.exception("StepReporter.before failed")

    async def after(self, event: AfterToolCallEvent) -> None:
        if event.cancel_message:
            return
        try:
            name = self._name(event.tool_use)
            if name not in RUNNING_LABELS:
                return
            state = self._state
            failed = event.exception is not None or name in state.failed_tools
            label = state.done_labels.pop(name, None) or DONE_LABELS[name]
            detail = state.done_details.pop(name, None)
            if name == "propose_plan" and not self._sink.terminal_sent and label == DONE_LABELS[name]:
                # No label recorded means the proposal was not accepted.
                label = "Fixing the plan…"
            await self._sink.step(name, label, "failed" if failed else "done", detail)
            if name == "get_wants" and not self._drafting and not state.safety_by_title:
                self._drafting = True
                await self._sink.step(DRAFT_ID, "Drafting meals…", "running")
        except Exception:
            log.exception("StepReporter.after failed")
