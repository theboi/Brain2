"""Tenant-level LLM provider credential ops."""
from __future__ import annotations

import httpx

from brain2.errors import Conflict


_PROVIDERS = ("anthropic", "gemini", "ollama", "openai")


def _secret_key(provider: str) -> str:
    return f"tenant:provider:{provider}:api_key"


def _probe_provider(provider: str, api_key: str, model: str | None = None) -> dict:
    timeout = 10.0
    with httpx.Client(timeout=timeout) as client:
        if provider == "anthropic":
            resp = client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
        elif provider == "gemini":
            resp = client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"key": api_key},
            )
        elif provider == "openai":
            resp = client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        elif provider == "ollama":
            resp = client.get(f"{(model or 'http://localhost:11434').rstrip('/')}/api/tags")
        else:
            raise ValueError(f"unsupported provider: {provider}")
        resp.raise_for_status()
        return {"ok": True, "status_code": resp.status_code}


def make_providers_list(store):
    def handler(ctx, params):
        keys = []
        rows = store._conn.execute(
            "SELECT key FROM secrets WHERE tenant_id=? AND key LIKE 'tenant:provider:%:api_key'",
            (ctx.tenant_id,),
        ).fetchall()
        for row in rows:
            parts = row["key"].split(":")
            if len(parts) >= 4:
                keys.append(parts[2])
        return {"providers": sorted(set(keys))}
    return handler


def make_providers_set_key(secrets):
    def handler(ctx, params):
        provider = params["provider"]
        if provider not in _PROVIDERS:
            raise Conflict(f"provider must be one of {_PROVIDERS}")
        secrets.store(ctx.tenant_id, _secret_key(provider), params["api_key"].encode(),
                      accessed_by=ctx.user_id)
        return {"provider": provider, "configured": True}
    return handler


def make_providers_delete_key(store):
    def handler(ctx, params):
        provider = params["provider"]
        if provider not in _PROVIDERS:
            raise Conflict(f"provider must be one of {_PROVIDERS}")
        store.delete_secret(ctx.tenant_id, _secret_key(provider))
        return {"provider": provider, "deleted": True}
    return handler


def make_providers_test(secrets):
    def handler(ctx, params):
        provider = params["provider"]
        if provider not in _PROVIDERS:
            raise Conflict(f"provider must be one of {_PROVIDERS}")
        try:
            if provider == "ollama":
                return _probe_provider("ollama", "", params.get("base_url"))
            api_key = secrets.retrieve(ctx.tenant_id, _secret_key(provider),
                                       accessed_by=ctx.user_id).decode()
            result = _probe_provider(provider, api_key, params.get("model"))
            result["provider"] = provider
            return result
        except Exception as exc:
            return {"ok": False, "provider": provider, "error": str(exc)}
    return handler


def register_provider_ops(ops, secrets):
    store = secrets._store
    ops.register("providers:list", action="manage_agents",
                 handler=make_providers_list(store),
                 summary="List tenant-level configured providers")
    ops.register("providers:set_key", action="manage_agents",
                 handler=make_providers_set_key(secrets),
                 summary="Store a tenant provider API key",
                 params=[{"name": "provider", "type": "str", "required": True,
                          "choices": list(_PROVIDERS)},
                         {"name": "api_key", "type": "str", "required": True}])
    ops.register("providers:delete_key", action="manage_agents",
                 handler=make_providers_delete_key(store),
                 summary="Delete a tenant provider API key",
                 params=[{"name": "provider", "type": "str", "required": True,
                          "choices": list(_PROVIDERS)}])
    ops.register("providers:test", action="manage_agents",
                 handler=make_providers_test(secrets),
                 summary="Test a tenant provider credential",
                 params=[{"name": "provider", "type": "str", "required": True,
                          "choices": list(_PROVIDERS)},
                         {"name": "model", "type": "str", "required": False},
                         {"name": "base_url", "type": "str", "required": False}])
