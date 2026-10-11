"""httpx client bound to one RunContext, plus the EventSink that delivers progress events.

Contract (agent/API.md):
- Tool calls: `Authorization: Bearer <runToken>`, 10 s timeout, one retry on 5xx/timeout.
- Events: `POST {apiBaseUrl}/internal/agent-events` with `X-Agent-Secret`; server answers 204.
- Nothing here raises into Strands: failures come back as ApiResult(ok=False, error="error: ...").

EventSink never lets progress block the run: step events go through one ordered queue with a short
timeout, no retry and a circuit breaker; terminal events (proposed/failed) flush pending steps for a
bounded time and then post with a longer timeout and one retry.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable

import httpx
from pydantic import TypeAdapter, ValidationError

from .config import Settings
from .schemas import AgentEvent, RunContext, strip_nul

log = logging.getLogger("agent.server_client")

_EVENT = TypeAdapter(AgentEvent)
FATAL_STATUSES = (400, 401, 403)


@dataclass
class ApiResult:
    ok: bool
    status: int
    data: Any = None
    error: str = ""


def _detail(resp: httpx.Response) -> str:
    """Short server message (<= 150 chars) from a JSON error body, or ''."""
    try:
        body = resp.json()
    except ValueError:
        return ""
    msg = None
    if isinstance(body, dict):
        err = body.get("error")
        msg = err.get("message") if isinstance(err, dict) else (err if isinstance(err, str) else body.get("message"))
    return " ".join(str(msg).split())[:150] if msg else ""


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
        self.fatal_status: int | None = None  # set on 401/403 from a tool call
        self.on_fatal: Callable[[int], None] | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _send(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        json: Any = None,
        params: dict[str, str] | None = None,
        *,
        timeout: float | None = None,
        retries: int = 1,
    ) -> tuple[httpx.Response | None, str]:
        """`retries` extra tries on timeout/transport error/5xx. Never raises. Returns (last response, failure kind)."""
        kind = "unavailable"
        resp: httpx.Response | None = None
        kwargs: dict[str, Any] = {} if timeout is None else {"timeout": timeout}
        for attempt in range(retries + 1):
            resp = None
            try:
                resp = await self._http.request(method, url, headers=headers, json=json, params=params, **kwargs)
            except httpx.TimeoutException:
                kind = "timeout"
            except httpx.HTTPError:
                kind = "network"
            except Exception:  # e.g. invalid URL; never leak into Strands
                log.exception("unexpected HTTP failure")
                kind = "error"
            if resp is not None:
                if resp.status_code < 500:
                    return resp, ""
                kind = str(resp.status_code)
            if attempt < retries:
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
        code = resp.status_code
        if code >= 500:
            return ApiResult(False, code, error=f"error: {what} unavailable ({code})")
        if code in (401, 403):  # the run token is bad or expired: nothing more can work
            self.fatal_status = code
            if self.on_fatal:
                self.on_fatal(code)
            return ApiResult(False, code, error=f"error: not authorized ({code}); stop")
        if code >= 400:
            msg = _detail(resp) if code in (400, 422) else ""
            return ApiResult(False, code, error=f"error: {what} request failed ({code})" + (f": {msg}" if msg else ""))
        try:
            data = resp.json() if resp.content else None
        except ValueError:
            return ApiResult(False, code, error=f"error: {what} returned invalid data")
        return ApiResult(True, code, data=data)

    async def get(self, what: str, path: str, params: dict[str, str] | None = None) -> ApiResult:
        return await self.call(what, "GET", path, params=params)

    async def post(self, what: str, path: str, body: Any) -> ApiResult:
        return await self.call(what, "POST", path, json=body)

    async def post_event(self, body: dict[str, Any], *, timeout: float, retries: int) -> int:
        """POST one already-validated AgentEvent. Returns the HTTP status, or 0 when unreachable."""
        url = f"{self._base}/internal/agent-events"
        resp, _ = await self._send("POST", url, {"X-Agent-Secret": self._secret}, body, timeout=timeout, retries=retries)
        return resp.status_code if resp is not None else 0


class EventSink:
    """Delivers step/proposed/failed events with a monotonically increasing seq.

    - `step()` only enqueues (never blocks the agent). One consumer posts steps in order, with a short
      timeout and no retry. Two consecutive failures trip a circuit breaker: later steps are dropped.
    - `proposed()` / `failed()` are terminal and exactly one is ever sent. They first give queued steps a
      bounded time to drain, then post with a longer timeout and one retry.
    - 409 means the run is no longer `running`: the sink closes and calls `on_stop`.
    - 400/401/403 on a terminal event are fatal (retrying cannot help): the sink closes and calls `on_stop`.
    """

    def __init__(
        self,
        client: ServerClient,
        run_id: str,
        on_stop: Callable[[], None] | None = None,
        *,
        step_timeout: float = 2.5,
        terminal_timeout: float = 5.0,
        flush_timeout: float = 3.0,
        breaker_threshold: int = 2,
    ) -> None:
        self._client = client
        self._run_id = run_id
        self._seq = 0
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._consumer: asyncio.Task[None] | None = None
        self._post_lock = asyncio.Lock()
        self._step_timeout = step_timeout
        self._terminal_timeout = terminal_timeout
        self._flush_timeout = flush_timeout
        self._threshold = breaker_threshold
        self._fails = 0
        self.breaker_open = False
        self.terminal_sent = False
        self.closed = False
        self.terminal_fatal = False
        self.on_stop = on_stop

    # ── steps ────────────────────────────────────────────────────────────────

    async def step(self, step_id: str, label: str, status: str, detail: str | None = None) -> None:
        if self.closed or self.breaker_open:
            return
        payload: dict[str, Any] = {"id": step_id[:64], "label": (label[:200] or "..."), "status": status}
        if detail:
            payload["detail"] = detail[:500]
        self._queue.put_nowait(payload)
        if self._consumer is None or self._consumer.done():
            self._consumer = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        while not self._queue.empty():
            payload = self._queue.get_nowait()
            if self.closed or self.breaker_open:
                continue
            status = await self._post("step", payload, timeout=self._step_timeout, retries=0)
            if status == 409:
                self._stop()
            elif status in FATAL_STATUSES:
                self.breaker_open = True
                log.warning("run %s: step rejected (%s); stopping progress events", self._run_id, status)
            elif status == 0 or status >= 500:
                self._fails += 1
                if self._fails >= self._threshold:
                    self.breaker_open = True
                    log.warning("run %s: progress events failing; circuit breaker open", self._run_id)
            else:
                self._fails = 0

    async def flush(self, timeout: float | None = None) -> None:
        """Wait (bounded) for queued steps to be delivered; drop what is left."""
        task = self._consumer
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), self._flush_timeout if timeout is None else timeout)
            except (asyncio.TimeoutError, Exception):
                pass
        while not self._queue.empty():
            self._queue.get_nowait()

    # ── terminal events ──────────────────────────────────────────────────────

    async def proposed(self, plan: dict[str, Any], meta: dict[str, Any]) -> int:
        return await self._terminal("proposed", {"plan": plan, "meta": meta})

    async def failed(self, message: str, meta: dict[str, Any] | None = None) -> int:
        payload: dict[str, Any] = {"message": message[:500]}
        if meta:
            payload["meta"] = meta
        return await self._terminal("failed", payload)

    async def _terminal(self, type_: str, payload: dict[str, Any]) -> int:
        if self.terminal_sent or self.closed:
            return 409
        await self.flush()
        if self.terminal_sent or self.closed:  # a 409 may have arrived while draining
            return 409
        status = await self._post(type_, payload, timeout=self._terminal_timeout, retries=1)
        if status == 409:
            self._stop()
        elif status in FATAL_STATUSES:
            self.terminal_fatal = True
            log.error("run %s: terminal %s rejected (%s); giving up", self._run_id, type_, status)
            self._stop()
        elif 200 <= status < 300 or status == 422:
            # 422 on `proposed`: the server marked the run failed itself, so it is terminal too.
            self.terminal_sent = True
            self.closed = True
        else:
            log.warning("run %s: terminal %s not delivered (status=%s)", self._run_id, type_, status)
        return status

    def _stop(self) -> None:
        self.closed = True
        if self.on_stop:
            self.on_stop()

    # ── one validated POST ───────────────────────────────────────────────────

    async def _post(self, type_: str, payload: dict[str, Any], *, timeout: float, retries: int) -> int:
        async with self._post_lock:
            event = strip_nul({"runId": self._run_id, "seq": self._seq, "type": type_, "payload": payload})
            try:
                body = _EVENT.validate_python(event).model_dump(mode="json", exclude_unset=True)
            except ValidationError as e:
                log.error("run %s: dropping invalid %s event: %s", self._run_id, type_, e.errors()[:3])
                return 400 if type_ != "step" else -1  # -1: dropped locally, not a server failure
            self._seq += 1
            try:
                return await self._client.post_event(body, timeout=timeout, retries=retries)
            except Exception:
                log.exception("run %s: event post crashed", self._run_id)
                return 0
