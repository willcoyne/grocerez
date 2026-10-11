"""Tool-call smoke test: one Agent, one @tool, run against the configured provider (default Akamai).

Usage: cd agent && .venv/bin/python3 scripts/smoke_tool_call.py
Pass = the tool was invoked with valid args and the answer contains 5.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from strands import Agent, tool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models import build_model  # noqa: E402

CALLS: list[tuple[int, int]] = []


@tool
def add(a: int, b: int) -> int:
    """Add two integers and return the sum."""
    CALLS.append((a, b))
    return a + b


def main() -> int:
    settings = get_settings()
    model = build_model(settings.agent_provider, settings)
    agent = Agent(
        model=model,
        tools=[add],
        callback_handler=None,
        system_prompt="You are a calculator. Always use the provided tools for arithmetic.",
    )
    t0 = time.perf_counter()
    result = agent("what is 2+3, use the tool")
    ms = int((time.perf_counter() - t0) * 1000)
    usage = result.metrics.get_summary().get("accumulated_usage", {})
    print(f"provider={settings.agent_provider} calls={CALLS} ms={ms} usage={usage}")
    print(f"answer={str(result).strip()!r}")
    ok = (2, 3) in CALLS and "5" in str(result)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
