"""MCP surface: same operations as REST, with agent identity (P5 §4).

An agent authenticates with its own credential and acts on behalf of a user via
an on-behalf-of RequestContext (agent_id set). Effective permission is the
INTERSECTION of agent and user scope — enforced here by authorizing as the user
(via dispatch) AND filtering the advertised tool list to ops the principal may
invoke. Results pass through a size cap before returning.
"""
from __future__ import annotations

import json

from brain2.app_context import AppContext
from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.operations import dispatch

TOOL_SCHEMA_VERSION = "1.0"
_MAX_RESULT_CHARS = 100_000


class MCPServer:
    def __init__(self, actx: AppContext):
        self._actx = actx
        self.tool_schema_version = TOOL_SCHEMA_VERSION

    def list_tools(self, ctx: RequestContext) -> list[dict]:
        """Advertise only operations the principal may actually invoke."""
        tools = []
        for name in self._actx.operations.names():
            op = self._actx.operations.get(name)
            if self._may_invoke(ctx, op.action):
                tools.append({"name": name, "action": op.action,
                              "schema_version": TOOL_SCHEMA_VERSION})
        return tools

    def call_tool(self, ctx: RequestContext, name: str, params: dict) -> object:
        # dispatch() enforces authorize() as the on-behalf-of user (intersection:
        # the agent only ever carries a user ctx, never ambient authority).
        result = dispatch(self._actx.store, self._actx.operations, ctx, name, params)
        return self._cap(result)

    def _may_invoke(self, ctx: RequestContext, action: str) -> bool:
        try:
            authorize(self._actx.store, ctx, action, ctx.project_id)
            return True
        except PermissionDenied:
            return False

    @staticmethod
    def _cap(result):
        text = json.dumps(result)
        if len(text) > _MAX_RESULT_CHARS:
            return {"truncated": True, "preview": text[:_MAX_RESULT_CHARS]}
        return result


def main() -> None:  # `brain2-mcp`
    from brain2.app_context import build_app_context
    # Wire to the MCP stdio transport here; the server object is transport-agnostic.
    MCPServer(build_app_context())
