"""Tests for LLM provider implementations."""
import pytest
from unittest.mock import MagicMock, patch
from brain2.llm.providers import (
    CompletionRequest, CompletionResponse, ServiceClass,
    AnthropicProvider, GeminiProvider, OllamaProvider,
)


def _mock_response(json_body: dict, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = json_body
    resp.raise_for_status = MagicMock()
    if status >= 400:
        import httpx
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp)
    return resp


ANTHROPIC_OK = {
    "content": [{"text": "hello"}],
    "usage": {"input_tokens": 10, "output_tokens": 5},
    "model": "claude-3-haiku-20240307",
}

GEMINI_OK = {
    "candidates": [{"content": {"parts": [{"text": "hello"}]}}],
    "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
}

OLLAMA_OK = {
    "message": {"content": "hello"},
    "prompt_eval_count": 10,
    "eval_count": 5,
}


def test_anthropic_provider_complete():
    client = MagicMock()
    client.post.return_value = _mock_response(ANTHROPIC_OK)
    provider = AnthropicProvider(api_key="sk-test", client=client)
    req = CompletionRequest(prompt="hi", model="claude-3-haiku-20240307",
                            service_class=ServiceClass.INTERACTIVE)
    resp = provider.complete(req)
    assert resp.text == "hello"
    assert resp.input_tokens == 10
    assert resp.output_tokens == 5


def test_gemini_provider_complete():
    client = MagicMock()
    client.post.return_value = _mock_response(GEMINI_OK)
    provider = GeminiProvider(api_key="test-key", client=client)
    req = CompletionRequest(prompt="hi", model="gemini-1.5-flash",
                            service_class=ServiceClass.INTERACTIVE)
    resp = provider.complete(req)
    assert resp.text == "hello"
    assert resp.input_tokens == 10
    assert resp.output_tokens == 5


def test_ollama_provider_complete():
    client = MagicMock()
    client.post.return_value = _mock_response(OLLAMA_OK)
    provider = OllamaProvider(base_url="http://localhost:11434", client=client)
    req = CompletionRequest(prompt="hi", model="llama3",
                            service_class=ServiceClass.INTERACTIVE)
    resp = provider.complete(req)
    assert resp.text == "hello"
    assert resp.input_tokens == 10
    assert resp.output_tokens == 5


def test_provider_raises_llm_error_on_5xx():
    from brain2.errors import LLMError
    client = MagicMock()
    client.post.return_value = _mock_response({}, status=503)
    provider = AnthropicProvider(api_key="sk-test", client=client)
    req = CompletionRequest(prompt="hi", model="claude-3-haiku-20240307",
                            service_class=ServiceClass.INTERACTIVE)
    with pytest.raises(LLMError):
        provider.complete(req)
