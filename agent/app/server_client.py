"""httpx client bound to one RunContext, plus the EventSink that posts progress events.

Contract (agent/API.md):
- Tool calls: `Authorization: Bearer <runToken>`, 10 s timeout, one retry on 5xx/timeout.
- Events: `POST {apiBaseUrl}/internal/agent-events` with `X-Agent-Secret`; server answers 204.
- Nothing here raises into Strands: failures come back as ApiResult(ok=False, error="error: ...").
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from .config import Settings
from .schemas import RunContext

log = logging.getLogger("agent.server_client")


@dataclass
class ApiResult:
    ok: bool
    status: int
    data: Any = None
    error: str = ""


class ServerClient:
    def __init__(
        self,
        ctx: RunContext,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        retry_delay_s: float = 0.2,
    ) -> None:
        self._ctx = ctx
        self._secret = settings.agent_shared_secret
        self._base = ctx.api_base.rstrip("/")
        self._retry_delay = retry_delay_s
        self._http = httpx.AsyncClient(timeout=settings.http_timeout_s, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _send(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        json: Any = None,
        params: dict[str, str] | None = None,
    ) -> tuple[httpx.Response | None, str]:
        """One try plus one retry on timeout/transport error/5xx. Returns (last response, failure kind)."""
        kind = "unavailable"
        resp: httpx.Response | None = None
        for attempt in range(2):
            resp = None
            try:
                resp = await self._http.request(method, url, headers=headers, json=json, params=params)
            except httpx.TimeoutException:
                kind = "timeout"
            except httpx.HTTPError:
                kind = "network"
            if resp is not None:
                if resp.status_code < 500:
                    return resp, ""
                kind = str(resp.status_code)
            if attempt == 0:
                await asyncio.sleep(self._retry_delay)
        return resp, kind

    async def call(
        self,
        what: str,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, str] | None = None,
    ) -> ApiResult:
        """Authenticated tool call. `what` is a short noun for error text ("cabinet")."""
        url = f"{self._base}{path}"
        headers = {"Authorization": f"Bearer {self._ctx.run_token}"}
        resp, kind = await self._send(method, url, headers, json, params)
        if resp is None:
            return ApiResult(False, 0, error=f"error: {what} unavailable ({kind})")
        if resp.status_code >= 500:
            return ApiResult(False, resp.status_code, error=f"error: {what} unavailable ({resp.status_code})")
        if resp.status_code >= 400:
            return ApiResult(False, resp.status_code, error=f"error: {what} request failed ({resp.status_code})")
        try:
            data = resp.json() if resp.content else None
        except ValueError:
            return ApiResult(False, resp.status_code, error=f"error: {what} returned invalid data")
        return ApiResult(True, resp.status_code, data=data)

    async def get(self, what: str, path: str, params: dict[str, str] | None = None) -> ApiResult:
        return await self.call(what, "GET", path, params=params)

    async def post(self, what: str, path: str, body: Any) -> ApiResult:
        return await self.call(what, "POST", path, json=body)

    async def post_event(self, event: dict[str, Any]) -> int:
        """POST one AgentEvent. Returns the HTTP status, or 0 when the server was unreachable."""
        url = f"{self._base}/internal/agent-events"
        resp, _ = await self._send("POST", url, {"X-Agent-Secret": self._secret}, event)
        return resp.status_code if resp is not None else 0


class EventSink:
    """Posts step/proposed/failed events with a monotonically increasing seq.

    `proposed` and `failed` are terminal: exactly one is ever sent. A 409 from the server means the run
    is no longer `running`, so the sink closes itself and calls `on_stop` (cancels the agent).
    """

    def __init__(self, client: ServerClient, run_id: str, on_stop: Callable[[], None] | None = None) -> None:
        self._client = client
        self._run_id = run_id
        self._seq = 0
        self._lock = asyncio.Lock()
        self.terminal_sent = False
        self.closed = False
        self.on_stop = on_stop

    async def _post(self, type_: str, payload: dict[str, Any]) -> int:
        async with self._lock:
            if self.closed:
                return 409
            event = {"runId": self._run_id, "seq": self._seq, "type": type_, "payload": payload}
            self._seq += 1
            status = await self._client.post_event(event)
            if status == 409:
                self.closed = True
                if self.on_stop:
                    self.on_stop()
            elif status == 0 or status >= 400 and status != 422:
                log.warning("event %s for run %s failed: status=%s", type_, self._run_id, status)
            if type_ != "step" and (200 <= status < 300 or status == 422):
                # 422 on `proposed`: the server marked the run failed itself, so it is terminal too.
                self.terminal_sent = True
                self.closed = True
            return status

    async def step(self, step_id: str, label: str, status: str, detail: str | None = None) -> int:
        payload: dict[str, Any] = {"id": step_id[:64], "label": label[:200] or "...", "status": status}
        if detail:
            payload["detail"] = detail[:500]
        return await self._post("step", payload)

    async def proposed(self, plan: dict[str, Any], meta: dict[str, Any]) -> int:
        return await self._post("proposed", {"plan": plan, "meta": meta})

    async def failed(self, message: str, meta: dict[str, Any] | None = None) -> int:
        payload: dict[str, Any] = {"message": message[:500]}
        if meta:
            payload["meta"] = meta
        return await self._post("failed", payload)
