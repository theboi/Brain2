"""Model ops for saved LLM configurations.

A model is a saved configuration: provider + model + system prompt + tool
allowlist + endpoint. Credentials live in the secrets table, referenced by
secret_key.
"""
from __future__ import annotations

import ipaddress
import json
import os
import uuid
from urllib.parse import urlparse

from brain2.errors import Conflict, NotFound

_RUNTIME_PROVIDERS = {"anthropic", "ollama", "openrouter"}
_CREATABLE_PROVIDERS = _RUNTIME_PROVIDERS | {"stub"}
_KEYED_PROVIDERS = {"anthropic", "openrouter"}
_METADATA_HOSTS = {
    "instance-data",
    "instance-data.ec2.internal",
    "metadata.aws.internal",
    "metadata.azure.internal",
    "metadata.google.internal",
    "metadata.goog",
}
_METADATA_IPS = {
    ipaddress.ip_address("100.100.100.200"),
    ipaddress.ip_address("fd00:ec2::254"),
}


def _max_concurrency(value) -> int:
    if isinstance(value, bool) or isinstance(value, float):
        raise Conflict("max_concurrency must be a positive integer")
    if isinstance(value, int):
        result = value
    elif isinstance(value, str) and value.strip().isdigit():
        result = int(value.strip())
    else:
        raise Conflict("max_concurrency must be a positive integer")
    if result < 1:
        raise Conflict("max_concurrency must be a positive integer")
    return result


def _local_endpoint(provider: str, value):
    if provider != "ollama":
        return value
    endpoint = str(value or "").strip().rstrip("/")
    if not endpoint:
        raise Conflict("ollama_base_url is required for ollama")
    if not endpoint.startswith(("http://", "https://")) or "\\" in endpoint:
        raise Conflict(
            "ollama_base_url must be a valid http or https URL"
        )
    parsed = urlparse(endpoint)
    try:
        parsed.port
    except ValueError as exc:
        raise Conflict(
            "ollama_base_url must be a valid http or https URL"
        ) from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or "?" in endpoint
        or "#" in endpoint
    ):
        raise Conflict("ollama_base_url must be a valid http or https URL")
    host = parsed.hostname.lower().rstrip(".")
    if host in _METADATA_HOSTS:
        raise Conflict("ollama_base_url must not target a cloud metadata host")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_loopback and (
        address in _METADATA_IPS
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    ):
        raise Conflict(
            "ollama_base_url must not target link-local, multicast, "
            "unspecified, reserved, or cloud metadata addresses"
        )
    configured_hosts = os.environ.get("BRAIN2_OLLAMA_ALLOWED_HOSTS", "")
    allowed_hosts = {
        item.strip().lower().rstrip(".")
        for item in configured_hosts.split(",")
        if item.strip()
    }
    if allowed_hosts and host not in allowed_hosts:
        raise Conflict(
            "ollama_base_url host is not permitted by "
            "BRAIN2_OLLAMA_ALLOWED_HOSTS"
        )
    return endpoint


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    d = {k: row[k] for k in row.keys()}
    try:
        d["tool_allowlist"] = json.loads(d.get("tool_allowlist") or "[]")
    except Exception:
        d["tool_allowlist"] = []
    d["has_api_key"] = bool(d.get("secret_key"))
    d.pop("secret_key", None)
    return d


def make_models_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND status != 'disabled' "
            "ORDER BY updated_at DESC",
            (ctx.tenant_id,),
        ).fetchall()
        return {"models": [_row_to_dict(r) for r in rows]}

    return handler


def make_models_create(store, secrets, allowed_providers=None):
    providers = set(
        _CREATABLE_PROVIDERS
        if allowed_providers is None
        else allowed_providers
    )

    def handler(ctx, params):
        provider = str(params.get("provider") or "").strip().lower()
        if provider not in providers:
            raise Conflict(
                f"provider must be one of {sorted(providers)}"
            )
        name = str(params.get("name") or "").strip()
        provider_model = str(params.get("model") or "").strip()
        api_key = str(params.get("api_key") or "").strip()
        if not name:
            raise Conflict("name is required")
        if not provider_model:
            raise Conflict("model is required")
        if provider in _KEYED_PROVIDERS and not api_key:
            raise Conflict(f"api_key is required for {provider}")
        if provider not in _KEYED_PROVIDERS and api_key:
            raise Conflict(f"api_key is not supported for {provider}")
        ollama_base_url = _local_endpoint(
            provider, params.get("ollama_base_url")
        )
        max_concurrency = _max_concurrency(
            params.get("max_concurrency", 1)
        )
        model_id = str(uuid.uuid4())
        secret_key = None
        tool_allowlist = json.dumps(params.get("tool_allowlist") or [])
        now = _now()
        with store.transaction() as cx:
            if api_key:
                secret_key = f"model:{model_id}:api_key"
                secrets.store(
                    ctx.tenant_id,
                    secret_key,
                    api_key.encode(),
                    accessed_by=ctx.user_id,
                )
            cx.execute(
                "INSERT INTO models(model_id, tenant_id, name, provider, model, "
                "system_prompt, tool_allowlist, fallback_model, secret_key, "
                "ollama_base_url, param_count, max_concurrency, status, created_by, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    model_id,
                    ctx.tenant_id,
                    name,
                    provider,
                    provider_model,
                    params.get("system_prompt", ""),
                    tool_allowlist,
                    params.get("fallback_model"),
                    secret_key,
                    ollama_base_url,
                    params.get("param_count"),
                    max_concurrency,
                    "ready",
                    ctx.user_id,
                    now,
                    now,
                ),
            )
            row = cx.execute(
                "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
                (ctx.tenant_id, model_id),
            ).fetchone()
        return _row_to_dict(row)

    return handler


def make_models_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"]),
        ).fetchone()
        if row is None:
            raise NotFound(f"model {params['model_id']!r} not found")
        return _row_to_dict(row)

    return handler


def make_models_update(store, secrets=None):
    def handler(ctx, params):
        with store.transaction() as cx:
            row = cx.execute(
                "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
                (ctx.tenant_id, params["model_id"]),
            ).fetchone()
            if row is None:
                raise NotFound(f"model {params['model_id']!r} not found")
            values = dict(params)
            for field in ("name", "model"):
                if field in values:
                    values[field] = str(values[field] or "").strip()
                    if not values[field]:
                        raise Conflict(f"{field} is required")
            if row["provider"] == "ollama":
                values["ollama_base_url"] = _local_endpoint(
                    row["provider"],
                    values.get("ollama_base_url", row["ollama_base_url"]),
                )
            if "max_concurrency" in values:
                values["max_concurrency"] = _max_concurrency(
                    values["max_concurrency"]
                )
            api_key = None
            if "api_key" in values:
                api_key = str(values["api_key"] or "").strip()
                if not api_key:
                    raise Conflict("api_key must not be blank")
                if row["provider"] not in _KEYED_PROVIDERS:
                    raise Conflict(
                        f"api_key is not supported for {row['provider']}"
                    )
                if secrets is None:
                    raise Conflict("api_key updates require secret storage")
            if (
                row["provider"] in _KEYED_PROVIDERS
                and not row["secret_key"]
                and api_key is None
            ):
                raise Conflict(f"api_key is required for {row['provider']}")

            fields = {
                "name",
                "model",
                "system_prompt",
                "fallback_model",
                "ollama_base_url",
                "param_count",
                "max_concurrency",
            }
            sets, args = [], []
            for k in fields:
                if k in params:
                    sets.append(f"{k}=?")
                    args.append(values[k])
            if "tool_allowlist" in params:
                sets.append("tool_allowlist=?")
                args.append(json.dumps(values["tool_allowlist"]))
            if not sets and api_key is None:
                return _row_to_dict(row)
            if api_key is not None:
                secret_key = (
                    row["secret_key"] or f"model:{row['model_id']}:api_key"
                )
                if row["secret_key"]:
                    secrets.rotate(
                        ctx.tenant_id, secret_key, api_key.encode(),
                        accessed_by=ctx.user_id,
                    )
                else:
                    secrets.store(
                        ctx.tenant_id, secret_key, api_key.encode(),
                        accessed_by=ctx.user_id,
                    )
                    sets.append("secret_key=?")
                    args.append(secret_key)
            sets.append("updated_at=?")
            args.append(_now())
            args += [ctx.tenant_id, params["model_id"]]
            cx.execute(
                f"UPDATE models SET {', '.join(sets)} "
                "WHERE tenant_id=? AND model_id=?",
                tuple(args),
            )
            new_row = cx.execute(
                "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
                (ctx.tenant_id, params["model_id"]),
            ).fetchone()
        return _row_to_dict(new_row)

    return handler


def make_models_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            row = cx.execute(
                "SELECT model_id FROM models WHERE tenant_id=? AND model_id=?",
                (ctx.tenant_id, params["model_id"]),
            ).fetchone()
            if row is None:
                raise NotFound(f"model {params['model_id']!r} not found")
            _guard_model_reference(store, ctx.tenant_id, params["model_id"])
            cx.execute(
                "UPDATE models SET status='disabled', updated_at=? "
                "WHERE tenant_id=? AND model_id=?",
                (_now(), ctx.tenant_id, params["model_id"]),
            )
        return {"model_id": params["model_id"], "deleted": True}

    return handler


def make_models_set_status(store, target_status: str):
    def handler(ctx, params):
        with store.transaction() as cx:
            row = cx.execute(
                "SELECT model_id FROM models WHERE tenant_id=? AND model_id=?",
                (ctx.tenant_id, params["model_id"]),
            ).fetchone()
            if row is None:
                raise NotFound(f"model {params['model_id']!r} not found")
            if target_status == "disabled":
                _guard_model_reference(store, ctx.tenant_id, params["model_id"])
            cx.execute(
                "UPDATE models SET status=?, updated_at=? "
                "WHERE tenant_id=? AND model_id=?",
                (target_status, _now(), ctx.tenant_id, params["model_id"]),
            )
        return {"model_id": params["model_id"], "status": target_status}

    return handler


def _guard_model_reference(store, tenant_id: str, model_id: str) -> None:
    referenced = store._conn.execute(
        "SELECT 1 FROM agents WHERE tenant_id=? AND model_id=? "
        "AND deleted_at IS NULL LIMIT 1",
        (tenant_id, model_id),
    ).fetchone()
    if referenced is not None:
        raise Conflict(
            "model is referenced by an agent; rebind or delete the agent first"
        )


def make_models_test(store, secrets):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"]),
        ).fetchone()
        if row is None:
            raise NotFound(f"model {params['model_id']!r} not found")
        prompt = params.get("prompt", "Reply with the single word: ok")
        from brain2.chat_providers import build_provider, complete_once

        try:
            provider = build_provider(ctx.tenant_id, row, secrets,
                                      accessed_by=ctx.user_id)
            resp = complete_once(provider, prompt, system=row["system_prompt"])
            return {
                "ok": True,
                "text": resp.text,
                "input_tokens": resp.input_tokens,
                "output_tokens": resp.output_tokens,
            }
        except Exception as exc:
            error = str(exc)
            if row["secret_key"]:
                try:
                    key = secrets.retrieve(ctx.tenant_id, row["secret_key"],
                                           accessed_by=ctx.user_id).decode()
                    error = error.replace(key, "[redacted]")
                except Exception:
                    pass
            return {"ok": False, "error": error[:500]}

    return handler


def register_model_ops(ops, store, secrets):
    ops.register(
        "models:list",
        action="use_agents",
        handler=make_models_list(store),
        summary="List model configs in your tenant",
    )
    ops.register(
        "models:create",
        action="manage_agents",
        handler=make_models_create(
            store, secrets, allowed_providers=_RUNTIME_PROVIDERS
        ),
        summary="Create a new model config",
        params=[
            {"name": "name", "type": "str", "required": True},
            {
                "name": "provider",
                "type": "str",
                "required": True,
                "choices": sorted(_RUNTIME_PROVIDERS),
            },
            {"name": "model", "type": "str", "required": True},
            {"name": "param_count", "type": "str", "required": False},
            {"name": "system_prompt", "type": "str", "required": False},
            {"name": "tool_allowlist", "type": "list", "required": False},
            {"name": "fallback_model", "type": "str", "required": False},
            {"name": "ollama_base_url", "type": "str", "required": False},
            {"name": "max_concurrency", "type": "int", "required": False},
            {"name": "api_key", "type": "str", "required": False},
        ],
    )
    ops.register(
        "models:get",
        action="use_agents",
        handler=make_models_get(store),
        summary="Get a model config",
        params=[{"name": "model_id", "type": "str", "required": True}],
    )
    ops.register(
        "models:update",
        action="manage_agents",
        handler=make_models_update(store, secrets),
        summary="Update a model config",
        params=[
            {"name": "model_id", "type": "str", "required": True},
            {"name": "name", "type": "str", "required": False},
            {"name": "model", "type": "str", "required": False},
            {"name": "param_count", "type": "str", "required": False},
            {"name": "system_prompt", "type": "str", "required": False},
            {"name": "tool_allowlist", "type": "list", "required": False},
            {"name": "fallback_model", "type": "str", "required": False},
            {"name": "ollama_base_url", "type": "str", "required": False},
            {"name": "max_concurrency", "type": "int", "required": False},
            {"name": "api_key", "type": "str", "required": False},
        ],
    )
    ops.register(
        "models:delete",
        action="manage_agents",
        handler=make_models_delete(store),
        summary="Soft-delete a model config",
        params=[{"name": "model_id", "type": "str", "required": True}],
    )
    ops.register(
        "models:pause",
        action="manage_agents",
        handler=make_models_set_status(store, "paused"),
        summary="Pause a model config",
        params=[{"name": "model_id", "type": "str", "required": True}],
    )
    ops.register(
        "models:resume",
        action="manage_agents",
        handler=make_models_set_status(store, "ready"),
        summary="Resume a model config",
        params=[{"name": "model_id", "type": "str", "required": True}],
    )
    ops.register(
        "models:test",
        action="manage_agents",
        handler=make_models_test(store, secrets),
        summary="Test a model config's provider connection",
        params=[
            {"name": "model_id", "type": "str", "required": True},
            {"name": "prompt", "type": "str", "required": False},
        ],
    )
