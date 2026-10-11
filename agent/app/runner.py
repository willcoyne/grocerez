"""run(ctx): build the planner agent, execute it under a wall clock, and guarantee exactly one terminal event."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Callable

import httpx
from strands import Agent

from .config import Settings, get_settings
from .hooks import Budget, StepReporter
from .models import build_model, model_id_for
from .schemas import RunContext, RunState
from .server_client import EventSink, ServerClient
from .tools import build_tools

log = logging.getLogger("agent.runner")

PLANNER_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "planner.md"

MSG_GENERIC = "Something went wrong while planning. Please try again."
MSG_TIMEOUT = "Planning took too long. Please try again."
MSG_BUDGET = "The planner needed too many steps. Please try a simpler request."
MSG_NO_PLAN = "The planner didn't finish a plan. Please try again."


def build_user_message(ctx: RunContext) -> str:
    """The user's prompt is data. Strip angle brackets so it can't close our wrapper tag."""
    safe = ctx.prompt.replace("<", " ").replace(">", " ").strip()[:500]
    budget = f"${ctx.budget_cents / 100:.0f}" if ctx.budget_cents else "none given"
    return f"<user_request>\n{safe}\n</user_request>\nBudget: {budget}.\nPrice ZIP available: {'yes' if ctx.zip_code else 'no'}."


def _usage(agent: Agent) -> Callable[[], tuple[int | None, int | None]]:
    def read() -> tuple[int | None, int | None]:
        try:
            u = agent.event_loop_metrics.accumulated_usage
            return int(u.get("inputTokens", 0)), int(u.get("outputTokens", 0))
        except Exception:
            return None, None

    return read


async def run(
    ctx: RunContext,
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    model: Any = None,
    price_agent_factory: Any = None,
    price_cache: Any = None,
    retry_delay_s: float = 0.2,
) -> None:
    """Never raises. Exactly one of proposed/failed is posted (unless the server closed the run)."""
    settings = settings or get_settings()
    state = RunState()
    client = ServerClient(ctx, settings, transport=transport, retry_delay_s=retry_delay_s)
    sink = EventSink(client, ctx.run_id)
    agent: Agent | None = None

    def meta() -> dict[str, Any]:
        tin, tout = state.usage() if state.usage else (None, None)
        return {"provider": settings.agent_provider, "model": model_id_for(settings.agent_provider, settings),
                "toolCalls": state.tool_calls,
                "tokensIn": None if tin is None else tin + state.extra_tokens_in,
                "tokensOut": None if tout is None else tout + state.extra_tokens_out, "ms": state.ms()}

    try:
        tools = build_tools(ctx, client, sink, state, settings,
                            price_agent_factory=price_agent_factory, price_cache=price_cache)
        agent = Agent(
            model=model if model is not None else build_model(settings.agent_provider, settings),
            tools=tools,
            system_prompt=PLANNER_PROMPT_PATH.read_text(encoding="utf-8"),
            callback_handler=None,
            hooks=[Budget(state, settings.agent_max_tool_calls), StepReporter(sink, state)],
        )
        state.cancel = agent.cancel
        state.usage = _usage(agent)
        sink.on_stop = agent.cancel
        await asyncio.wait_for(agent.invoke_async(build_user_message(ctx)), timeout=settings.agent_run_timeout_s)
        if not sink.terminal_sent and not sink.closed:
            await sink.failed(MSG_BUDGET if state.budget_exceeded else MSG_NO_PLAN, meta())
    except asyncio.TimeoutError:
        log.warning("run %s timed out after %ss", ctx.run_id, settings.agent_run_timeout_s)
        if agent is not None:
            agent.cancel()
        await sink.failed(MSG_TIMEOUT, meta())
    except Exception:
        log.exception("run %s crashed", ctx.run_id)  # details stay in logs, never in the event
        await sink.failed(MSG_GENERIC, meta())
    finally:
        try:
            await client.aclose()
        except Exception:
            log.exception("closing client failed")
        log.info("run %s finished: toolCalls=%d ms=%d terminal=%s", ctx.run_id, state.tool_calls, state.ms(),
                 sink.terminal_sent)
