"""FastAPI entrypoint: POST /runs (X-Agent-Secret, 202, background run) and GET /health."""
from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException

from .config import Settings, get_settings
from .runner import run
from .schemas import AgentRunRequest, RunContext

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("agent.main")

app = FastAPI(title="GrocerEZ Pantry Agent", docs_url=None, redoc_url=None, openapi_url=None)

# Service-level (not per-run) bookkeeping: which runIds are in flight, and a global concurrency cap.
_active: set[str] = set()
_sem: asyncio.Semaphore | None = None


def _semaphore(settings: Settings) -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(max(1, settings.max_concurrent_runs))
    return _sem


def require_secret(
    x_agent_secret: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Constant-time shared-secret check. Fails closed when no secret is configured."""
    expected = settings.agent_shared_secret.encode()
    given = (x_agent_secret or "").encode()
    if not expected or not hmac.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _guarded(ctx: RunContext, settings: Settings) -> None:
    try:
        async with _semaphore(settings):
            await run(ctx, settings)
    except Exception:
        log.exception("run %s crashed outside run()", ctx.run_id)
    finally:
        _active.discard(ctx.run_id)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/runs", status_code=202, dependencies=[Depends(require_secret)])
async def start_run(
    body: AgentRunRequest,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    run_id = str(body.runId)
    if run_id in _active:  # duplicate delivery: already running, don't start a second one
        return {"accepted": True}
    _active.add(run_id)
    ctx = RunContext(
        run_id=run_id,
        group_id=str(body.groupId),
        api_base=body.apiBaseUrl,
        run_token=body.runToken,
        zip_code=body.zipCode,
        prompt=body.prompt,
        budget_cents=body.budgetCents,
        dates=tuple(body.dates),
        already_planned=tuple((a.date, a.title) for a in body.alreadyPlanned),
    )
    background.add_task(_guarded, ctx, settings)
    return {"accepted": True}
