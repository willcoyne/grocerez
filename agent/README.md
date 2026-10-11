# GrocerEZ Pantry Agent (lane B)

Python 3.12 FastAPI + AWS Strands Agents SDK service. Wire format: `API.md`. Spec: `plan/challenges/01-pantry-agent/README.md`.

## Decision record (spec section 0, decided 2026-10-10: path A)

- Provider: Akamai hosted OpenAI-compatible inference, `https://ws.akamai-workshops.com/v1`, model `hackathon-chat`
  (`Qwen/Qwen3.8-27B-FP8` on vLLM, 32k context). `AGENT_PROVIDER=akamai`, `PRICE_PROVIDER=akamai`. Anthropic and Bedrock are fallbacks.
- Smoke test (`scripts/smoke_tool_call.py`, strands-agents 1.59.0, `OpenAIModel`): PASS. Tool called with `(2, 3)`, answer "2 + 3 = 5",
  about 4.5 to 6 s, 693 tokens in / 44 out.
- Qwen reasoning is switched off (`AKAMAI_ENABLE_THINKING=false`, sent as `chat_template_kwargs.enable_thinking=false`). vLLM also rejects an
  empty `tools: []`, which the repo's `AkamaiOpenAIModel` subclass strips (needed for the tool-less price agent).

## Run

```bash
cd agent
python3.12 -m venv .venv && source .venv/bin/activate     # once; agent/.venv is gitignored
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                                       # then fill in keys; agent/.env is gitignored, never commit it
uvicorn app.main:app --port 8000
pytest -q                                                  # unit tests, no network
python3 scripts/smoke_tool_call.py                         # live tool-call check against AGENT_PROVIDER
./scripts/e2e.sh                                           # manual end-to-end against a running server (needs curl, jq)
```

Docker: `docker build -t grocerez-agent agent/` and run with `--env-file agent/.env`. Do not publish port 8000; only the server reaches it.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PROVIDER` / `PRICE_PROVIDER` | `akamai` | `akamai`, `anthropic` or `bedrock` for the planner / price sub-agent |
| `AKAMAI_INFERENCE_URL`, `AKAMAI_INFERENCE_KEY`, `AKAMAI_MODEL` | see above | Akamai endpoint credentials |
| `AKAMAI_ENABLE_THINKING` | `false` | Qwen reasoning phase (slow) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | model `claude-sonnet-5-5` | Anthropic fallback |
| `AGENT_SHARED_SECRET` | none | Must equal the server's; checked on `POST /runs`, sent on `/internal/agent-events` |
| `AGENT_MAX_TOOL_CALLS` | `25` | Budget hook cap |
| `AGENT_RUN_TIMEOUT_S` | `95` | Wall-clock cap per run (terminal event lands by ~108 s; server gives up at 120 s) |

## Cited web recipes (Tavily)

The `find_recipe` tool searches the web for a real recipe per meal idea and cites it (`meal.source`, plus the source's
ingredient lines). To turn it on, put a key in `agent/.env` (never commit it):

```
TAVILY_API_KEY=tvly-...        # https://app.tavily.com
```

Without a key, or when Tavily fails or no safe recipe is found, the model writes the meal itself (`source: null`, shown as
AI-created). Pages are fetched only over https from an allowlist of recipe sites (`recipe_domains` in `app/config.py`, probed live: bbcgoodfood.com, bonappetit.com,
epicurious.com, delish.com, tasteofhome.com, minimalistbaker.com, skinnytaste.com, recipetineats.com, pinchofyum.com,
onceuponachef.com, natashaskitchen.com, jocooks.com, cafedelites.com, spendwithpennies.com, wellplated.com,
ambitiouskitchen.com; dropped: foodnetwork/budgetbytes/cookieandkate = 403 to our fetcher, allrecipes/seriouseats/
simplyrecipes/eatingwell = Tavily returns no results for them, loveandlemons = no JSON-LD), re-checked after every redirect (max 3),
never IP literals, 5 s timeout, 2 MB cap. Only the title, image, time, yield and ingredient lines are used; the method text is never copied.

Endpoints: `POST /runs` (header `X-Agent-Secret`, answers 202) and `GET /health`.
