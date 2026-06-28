def make_agents_local_runtime(_store):
    def handler(ctx, params):
        base_url = params.get("base_url", "http://localhost:11434")
        try:
            import httpx
            with httpx.Client(timeout=2.0) as client:
                resp = client.get(f"{base_url}/api/tags")
                resp.raise_for_status()
                models = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
            return {"available": True, "models": models, "base_url": base_url}
        except Exception:
            return {"available": False, "models": [], "base_url": base_url}
    return handler


def register_runtime_ops(ops, store) -> None:
    ops.register(
        "agents:local:runtime",
        action="view_stats",
        handler=make_agents_local_runtime(store),
        summary="Check local Ollama runtime availability",
        params=[{"name": "base_url", "type": "str", "required": False}],
    )
