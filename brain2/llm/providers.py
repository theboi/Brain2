"""LLM provider protocol and HTTP provider implementations.

All providers use httpx directly — no vendor SDK imports.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Protocol

import httpx

from brain2.errors import LLMError

_DEFAULT_MAX_TOKENS = 1024
_TIMEOUT_S = 60.0
_ERROR_TEXT_LIMIT = 500


def _safe_error_text(response: httpx.Response, api_key: str) -> str:
    """Return bounded provider error context without echoing a credential."""
    text = ""
    try:
        data = response.json()
        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict):
            text = str(error.get("message") or error.get("code") or "")
        elif error:
            text = str(error)
    except Exception:
        text = response.text or ""
    if api_key:
        text = text.replace(api_key, "[redacted]")
    return " ".join(text.split())[:_ERROR_TEXT_LIMIT]


class ServiceClass(enum.IntEnum):
    INTERACTIVE = 0   # lower number = higher priority
    BATCH = 1


@dataclass
class CompletionRequest:
    prompt: str
    model: str
    service_class: ServiceClass = ServiceClass.INTERACTIVE
    system: str = ""
    max_tokens: int = _DEFAULT_MAX_TOKENS


@dataclass
class CompletionResponse:
    text: str
    input_tokens: int
    output_tokens: int
    model: str = ""


class Provider(Protocol):
    def complete(self, request: CompletionRequest) -> CompletionResponse: ...


class AnthropicProvider:
    _BASE = "https://api.anthropic.com/v1/messages"
    _VERSION = "2023-06-01"

    def __init__(self, api_key: str, model: str = "claude-3-haiku-20240307",
                 client: httpx.Client | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._client = client or httpx.Client(timeout=_TIMEOUT_S)

    def complete(self, request: CompletionRequest) -> CompletionResponse:
        messages = [{"role": "user", "content": request.prompt}]
        body: dict = {
            "model": request.model or self._model,
            "max_tokens": request.max_tokens,
            "messages": messages,
        }
        if request.system:
            body["system"] = request.system
        try:
            resp = self._client.post(
                self._BASE,
                json=body,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": self._VERSION,
                    "content-type": "application/json",
                },
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"Anthropic {exc.response.status_code}: {exc}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Anthropic network error: {exc}") from exc
        data = resp.json()
        return CompletionResponse(
            text=data["content"][0]["text"],
            input_tokens=data["usage"]["input_tokens"],
            output_tokens=data["usage"]["output_tokens"],
            model=data.get("model", request.model),
        )


class OpenRouterProvider:
    _BASE = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, api_key: str, model: str, client: httpx.Client | None = None,
                 app_url: str | None = None, app_title: str = "Brain2") -> None:
        self._api_key = api_key
        self._model = model
        self._client = client or httpx.Client(timeout=_TIMEOUT_S)
        self._app_url = app_url
        self._app_title = app_title

    def complete(self, request: CompletionRequest) -> CompletionResponse:
        model = request.model or self._model
        messages = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.append({"role": "user", "content": request.prompt})
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._app_url:
            headers["HTTP-Referer"] = self._app_url
        if self._app_title:
            headers["X-OpenRouter-Title"] = self._app_title
        try:
            response = self._client.post(
                self._BASE,
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": request.max_tokens,
                    "stream": False,
                },
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = _safe_error_text(exc.response, self._api_key)
            suffix = f": {detail}" if detail else ""
            raise LLMError(
                f"OpenRouter {exc.response.status_code}{suffix}"
            ) from exc
        except httpx.HTTPError as exc:
            message = str(exc).replace(self._api_key, "[redacted]")
            raise LLMError(f"OpenRouter network error: {message[:_ERROR_TEXT_LIMIT]}") from exc

        try:
            data = response.json()
            if isinstance(data, dict) and data.get("error"):
                detail = _safe_error_text(response, self._api_key)
                raise LLMError(f"OpenRouter error: {detail or 'request failed'}")
            choice = data["choices"][0]
            text = choice["message"]["content"]
            usage = data.get("usage") or {}
            if not isinstance(text, str):
                raise TypeError("message content is not text")
            return CompletionResponse(
                text=text,
                input_tokens=int(usage.get("prompt_tokens") or 0),
                output_tokens=int(usage.get("completion_tokens") or 0),
                model=data.get("model") or model,
            )
        except LLMError:
            raise
        except Exception as exc:
            message = str(exc).replace(self._api_key, "[redacted]")
            raise LLMError(
                f"OpenRouter malformed response: {message[:_ERROR_TEXT_LIMIT]}"
            ) from exc


class GeminiProvider:
    _BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str = "gemini-1.5-flash",
                 client: httpx.Client | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._client = client or httpx.Client(timeout=_TIMEOUT_S)

    def complete(self, request: CompletionRequest) -> CompletionResponse:
        model = request.model or self._model
        url = f"{self._BASE}/{model}:generateContent?key={self._api_key}"
        parts = [{"text": request.prompt}]
        body: dict = {"contents": [{"parts": parts}]}
        if request.system:
            body["systemInstruction"] = {"parts": [{"text": request.system}]}
        body["generationConfig"] = {"maxOutputTokens": request.max_tokens}
        try:
            resp = self._client.post(url, json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"Gemini {exc.response.status_code}: {exc}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Gemini network error: {exc}") from exc
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        usage = data.get("usageMetadata", {})
        return CompletionResponse(
            text=text,
            input_tokens=usage.get("promptTokenCount", 0),
            output_tokens=usage.get("candidatesTokenCount", 0),
            model=model,
        )


class OllamaProvider:
    def __init__(self, base_url: str = "http://localhost:11434",
                 model: str = "llama3",
                 client: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._client = client or httpx.Client(timeout=_TIMEOUT_S)

    def complete(self, request: CompletionRequest) -> CompletionResponse:
        url = f"{self._base_url}/api/chat"
        messages = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.append({"role": "user", "content": request.prompt})
        body = {
            "model": request.model or self._model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": request.max_tokens},
        }
        try:
            resp = self._client.post(url, json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"Ollama {exc.response.status_code}: {exc}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Ollama network error: {exc}") from exc
        data = resp.json()
        return CompletionResponse(
            text=data["message"]["content"],
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            model=request.model or self._model,
        )
