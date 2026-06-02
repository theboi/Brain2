"""Agent ops (Web Console Phase E).

Agents are saved configurations of a provider + model + system prompt + allowed
tools. CRUD lives here; the chat tool-use loop (Phase F) consumes them.
"""
from __future__ import annotations

import json
import uuid

from brain2.errors import Conflict, NotFound

_PROVIDERS = {"anthropic", "gemini", "ollama", "openai", "stub"}


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    d = {k: row[k] for k in row.keys()}
    try:
        d["tool_allowlist"] = json.loads(d.get("tool_allowlist") or "[]")
    except Exception:
        d["tool_allowlist"] = []
    # Never return secrets
    d.pop("secret_key", None)
    return d


def make_agents_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND status != 'disabled' "
            "ORDER BY updated_at DESC",
            (ctx.tenant_id,)).fetchall()
        return {"agents": [_row_to_dict(r) for r in rows]}
    return handler


def make_agents_create(store, secrets):
    def handler(ctx, params):
        provider = params["provider"]
        if provider not in _PROVIDERS:
            raise Conflict(f"provider must be one of {sorted(_PROVIDERS)}")
        agent_id = str(uuid.uuid4())
        secret_key = None
        if "api_key" in params and params["api_key"]:
            secret_key = f"agent:{agent_id}:api_key"
            secrets.store(ctx.tenant_id, secret_key, params["api_key"].encode(),
                          accessed_by=ctx.user_id)
        tool_allowlist = json.dumps(params.get("tool_allowlist") or [])
        now = _now()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO agents(agent_id, tenant_id, name, provider, model, "
                "system_prompt, tool_allowlist, fallback_model, secret_key, "
                "ollama_base_url, status, created_by, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (agent_id, ctx.tenant_id, params["name"], provider, params["model"],
                 params.get("system_prompt", ""), tool_allowlist,
                 params.get("fallback_model"), secret_key,
                 params.get("ollama_base_url"), "ready", ctx.user_id, now, now))
        row = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, agent_id)).fetchone()
        return _row_to_dict(row)
    return handler


def make_agents_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, params["agent_id"])).fetchone()
        if row is None:
            raise NotFound(f"agent {params['agent_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_agents_update(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, params["agent_id"])).fetchone()
        if row is None:
            raise NotFound(f"agent {params['agent_id']!r} not found")
        fields = {"name", "model", "system_prompt", "fallback_model",
                  "ollama_base_url"}
        sets, args = [], []
        for k in fields:
            if k in params:
                sets.append(f"{k}=?"); args.append(params[k])
        if "tool_allowlist" in params:
            sets.append("tool_allowlist=?"); args.append(json.dumps(params["tool_allowlist"]))
        if not sets:
            return _row_to_dict(row)
        sets.append("updated_at=?"); args.append(_now())
        args += [ctx.tenant_id, params["agent_id"]]
        with store.transaction() as cx:
            cx.execute(
                f"UPDATE agents SET {', '.join(sets)} WHERE tenant_id=? AND agent_id=?",
                tuple(args))
        new_row = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, params["agent_id"])).fetchone()
        return _row_to_dict(new_row)
    return handler


def make_agents_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE agents SET status='disabled', updated_at=? "
                "WHERE tenant_id=? AND agent_id=?",
                (_now(), ctx.tenant_id, params["agent_id"]))
        return {"agent_id": params["agent_id"], "deleted": True}
    return handler


def make_agents_set_status(store, target_status: str):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE agents SET status=?, updated_at=? "
                "WHERE tenant_id=? AND agent_id=?",
                (target_status, _now(), ctx.tenant_id, params["agent_id"]))
        return {"agent_id": params["agent_id"], "status": target_status}
    return handler


def make_agents_test(store, secrets):
    """Synchronous one-shot call through the relevant provider; returns text."""
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, params["agent_id"])).fetchone()
        if row is None:
            raise NotFound(f"agent {params['agent_id']!r} not found")
        prompt = params.get("prompt", "Reply with the single word: ok")
        from brain2.chat_providers import build_provider, complete_once
        try:
            provider = build_provider(ctx.tenant_id, row, secrets)
            resp = complete_once(provider, prompt, system=row["system_prompt"])
            return {"ok": True, "text": resp.text,
                    "input_tokens": resp.input_tokens,
                    "output_tokens": resp.output_tokens}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
    return handler


def register_agent_ops(ops, store, secrets):
    ops.register("agents:list", action="use_agents",
                 handler=make_agents_list(store),
                 summary="List agents in your tenant")
    ops.register("agents:create", action="manage_agents",
                 handler=make_agents_create(store, secrets),
                 summary="Create a new agent",
                 params=[{"name": "name", "type": "str", "required": True},
                         {"name": "provider", "type": "str", "required": True,
                          "choices": sorted(_PROVIDERS)},
                         {"name": "model", "type": "str", "required": True},
                         {"name": "system_prompt", "type": "str", "required": False},
                         {"name": "tool_allowlist", "type": "list", "required": False},
                         {"name": "fallback_model", "type": "str", "required": False},
                         {"name": "ollama_base_url", "type": "str", "required": False},
                         {"name": "api_key", "type": "str", "required": False}])
    ops.register("agents:get", action="use_agents",
                 handler=make_agents_get(store),
                 summary="Get an agent's configuration",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:update", action="manage_agents",
                 handler=make_agents_update(store),
                 summary="Update an agent's configuration",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:delete", action="manage_agents",
                 handler=make_agents_delete(store),
                 summary="Soft-delete an agent (status=disabled)",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:pause", action="manage_agents",
                 handler=make_agents_set_status(store, "paused"),
                 summary="Pause an agent",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:resume", action="manage_agents",
                 handler=make_agents_set_status(store, "ready"),
                 summary="Resume an agent",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:test", action="manage_agents",
                 handler=make_agents_test(store, secrets),
                 summary="Test an agent's provider connection",
                 params=[{"name": "agent_id", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": False}])
