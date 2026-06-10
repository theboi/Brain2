"""run_op task handler: dispatch a scheduled op under the creator's context."""
from __future__ import annotations

import json

from brain2.context import RequestContext
from brain2.operations import dispatch


def make_run_op_handler(store, operations):
    def handler(task):
        payload = json.loads(task["payload"])
        user = store.get_user(payload["tenant_id"], payload["user_id"])
        if user is None:
            raise RuntimeError(f"scheduled op user {payload['user_id']!r} no longer exists")
        op_params = payload.get("op_params") or {}
        ctx = RequestContext(
            tenant_id=payload["tenant_id"],
            user_id=payload["user_id"],
            tenant_role=user.role,
            project_id=op_params.get("project_id"),
        )
        dispatch(store, operations, ctx, payload["op_name"], op_params)
    return handler
