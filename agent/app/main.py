"""FastAPI entrypoint: POST /runs (X-Agent-Secret, 202, background run) and GET /health."""
from __future__ import annotations

import hmac
import logging
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException

from .config import Settings, get_settings
from .runner import run
from .schemas import AgentRunRequest, RunContext

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="GrocerEZ Pantry Agent", docs_url=None, redoc_url=None, openapi_url=None)


def require_secret(
    x_agent_secret: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Constant-time shared-secret check. Fails closed when no secret is configured."""
    expected = settings.agent_shared_secret.encode()
    given = (x_agent_secret or "").encode()
    if not expected or not hmac.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/runs", status_code=202, dependencies=[Depends(require_secret)])
async def start_run(
    body: AgentRunRequest,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    ctx = RunContext(
        run_id=str(body.runId),
        group_id=str(body.groupId),
        api_base=body.apiBaseUrl,
        run_token=body.runToken,
        zip_code=body.zipCode,
        prompt=body.prompt,
        budget_cents=body.budgetCents,
    )
    background.add_task(run, ctx, settings)
    return {"accepted": True}
