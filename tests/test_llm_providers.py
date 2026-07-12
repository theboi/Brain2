"""Tests for LLM provider implementations."""
import pytest
from unittest.mock import MagicMock, patch
from brain2.llm.providers import (
    CompletionRequest, CompletionResponse, ServiceClass,
    AnthropicProvider, GeminiProvider, OllamaProvider, OpenRouterProvider,
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
    req = CompletionRequest(prompt="hi", model="claude-3-haiku-20240307", system="rules",
                            service_class=ServiceClass.INTERACTIVE)
    resp = provider.complete(req)
    assert resp.text == "hello"
    assert resp.input_tokens == 10
    assert resp.output_tokens == 5
    url = client.post.call_args.args[0]
    kwargs = client.post.call_args.kwargs
    assert url == "https://api.anthropic.com/v1/messages"
    assert kwargs["headers"]["x-api-key"] == "sk-test"
    assert kwargs["headers"]["anthropic-version"] == "2023-06-01"
    assert kwargs["json"]["system"] == "rules"
    assert kwargs["json"]["messages"] == [{"role": "user", "content": "hi"}]


def test_openrouter_provider_maps_request_and_response():
    client = MagicMock()
    client.post.return_value = _mock_response({
        "choices": [{"message": {"content": "hello"}}],
        "usage": {"prompt_tokens": 7, "completion_tokens": 3},
        "model": "openai/gpt-5",
    })
    provider = OpenRouterProvider("router-key", "openai/gpt-5", client=client,
                                  app_url="https://brain2.example")
    response = provider.complete(CompletionRequest(prompt="hi", model="", system="rules", max_tokens=42))
    assert response == CompletionResponse("hello", 7, 3, "openai/gpt-5")
    url = client.post.call_args.args[0]
    kwargs = client.post.call_args.kwargs
    assert url == "https://openrouter.ai/api/v1/chat/completions"
    assert kwargs["json"] == {
        "model": "openai/gpt-5", "messages": [
            {"role": "system", "content": "rules"},
            {"role": "user", "content": "hi"},
        ], "max_tokens": 42, "stream": False,
    }
    assert kwargs["headers"]["Authorization"] == "Bearer router-key"
    assert kwargs["headers"]["HTTP-Referer"] == "https://brain2.example"
    assert kwargs["headers"]["X-OpenRouter-Title"] == "Brain2"


@pytest.mark.parametrize("status", [401, 429])
def test_openrouter_errors_are_sanitized(status):
    from brain2.errors import LLMError
    client = MagicMock()
    client.post.return_value = _mock_response(
        {"error": {"message": "bad router-key credential"}}, status=status)
    provider = OpenRouterProvider("router-key", "model", client=client)
    with pytest.raises(LLMError) as caught:
        provider.complete(CompletionRequest(prompt="hi", model=""))
    assert str(status) in str(caught.value)
    assert "router-key" not in str(caught.value)


def test_openrouter_rejects_malformed_success():
    from brain2.errors import LLMError
    client = MagicMock()
    client.post.return_value = _mock_response({"choices": []})
    with pytest.raises(LLMError, match="malformed response"):
        OpenRouterProvider("secret", "model", client=client).complete(
            CompletionRequest(prompt="hi", model=""))


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
