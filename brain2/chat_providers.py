"""Per-model provider construction + one-shot completion (Phases E/F).

Builds a brain2.llm.providers Provider from a models-table row, pulling the
API key from the SecretManager when needed. A 'stub' provider is included so
tests can exercise the full pipeline without hitting a network.
"""
from __future__ import annotations

from dataclasses import dataclass

from brain2.errors import LLMError
from brain2.llm.providers import (AnthropicProvider, CompletionRequest,
                                   CompletionResponse, GeminiProvider,
                                   OllamaProvider, OpenRouterProvider, ServiceClass)


@dataclass
class StubProvider:
    """Deterministic provider used in tests; echoes a tagged reply."""
    canned_text: str = "stub: ok"

    def complete(self, request: CompletionRequest) -> CompletionResponse:
        return CompletionResponse(text=self.canned_text,
                                   input_tokens=len(request.prompt.split()),
                                   output_tokens=len(self.canned_text.split()),
                                   model=request.model or "stub")


def build_provider(tenant_id: str, model_row, secrets, *,
                   accessed_by: str = "agent_runtime"):
    p = model_row["provider"]
    model = model_row["model"]
    if p == "stub":
        import os
        return StubProvider(canned_text=os.environ.get(
            "BRAIN2_STUB_TEXT", "stub: ok"))
    if p == "ollama":
        base = model_row["ollama_base_url"] or "http://localhost:11434"
        return OllamaProvider(base_url=base, model=model)
    if p == "anthropic":
        if not model_row["secret_key"]:
            raise LLMError("anthropic model missing api_key")
        api_key = secrets.retrieve(tenant_id, model_row["secret_key"],
                                   accessed_by=accessed_by).decode()
        return AnthropicProvider(api_key=api_key, model=model)
    if p == "openrouter":
        if not model_row["secret_key"]:
            raise LLMError("openrouter model missing api_key")
        api_key = secrets.retrieve(tenant_id, model_row["secret_key"],
                                   accessed_by=accessed_by).decode()
        return OpenRouterProvider(api_key=api_key, model=model)
    if p == "gemini":
        if not model_row["secret_key"]:
            raise LLMError("gemini model missing api_key")
        api_key = secrets.retrieve(tenant_id, model_row["secret_key"],
                                   accessed_by=accessed_by).decode()
        return GeminiProvider(api_key=api_key, model=model)
    raise LLMError(f"unsupported provider: {p}")


def complete_once(provider, prompt: str, *, system: str = "",
                  max_tokens: int = 512) -> CompletionResponse:
    req = CompletionRequest(prompt=prompt, model="", system=system,
                             max_tokens=max_tokens,
                             service_class=ServiceClass.INTERACTIVE)
    return provider.complete(req)
