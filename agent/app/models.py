"""Provider switch: AGENT_PROVIDER / PRICE_PROVIDER -> Strands model objects."""
from __future__ import annotations

from typing import Any

from .config import Settings


def model_id_for(provider: str, settings: Settings) -> str:
    return {
        "akamai": settings.akamai_model,
        "anthropic": settings.anthropic_model,
        "bedrock": settings.bedrock_model,
    }[provider]


def _akamai_model_cls() -> Any:
    """OpenAIModel that omits `tools` when empty: vLLM answers 400 to `"tools": []` (tool-less price agent)."""
    from strands.models.openai import OpenAIModel

    class AkamaiOpenAIModel(OpenAIModel):
        def format_request(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            request = super().format_request(*args, **kwargs)
            if not request.get("tools"):
                request.pop("tools", None)
            return request

    return AkamaiOpenAIModel


def build_model(provider: str, settings: Settings) -> Any:
    """Return a Strands Model. Imports are lazy so unused providers need no credentials."""
    params = {"temperature": settings.temperature, "max_tokens": settings.max_tokens}
    if provider == "akamai":
        from strands.models.openai import OpenAIModel

        if not settings.akamai_enable_thinking:
            # Qwen3 on vLLM: skip the (slow) reasoning phase; tool calling does not need it.
            params["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}

        return _akamai_model_cls()(
            client_args={"base_url": settings.akamai_inference_url, "api_key": settings.akamai_inference_key},
            model_id=settings.akamai_model,
            params=params,
        )
    if provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        return AnthropicModel(
            client_args={"api_key": settings.anthropic_api_key},
            model_id=settings.anthropic_model,
            **params,
        )
    if provider == "bedrock":
        from strands.models.bedrock import BedrockModel

        return BedrockModel(
            model_id=settings.bedrock_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
        )
    raise ValueError(f"unknown provider: {provider}")
