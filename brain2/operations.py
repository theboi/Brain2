"""One operation surface for REST + MCP (Core §10).

`dispatch()` authorizes then invokes — the single logic path. Add-on operations
live in `AddonRegistry`; core operations live here. Both are reachable through
`dispatch()` so REST and MCP behave identically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.store.base import Store

Handler = Callable[[RequestContext, dict], object]

ParamSpec = dict          # {"name": str, "type": str, "required": bool, "choices"?: list}


@dataclass
class Operation:
    action: str                  # authorize() action key (tenant or project scoped)
    handler: Handler
    summary: str = ""
    params: list[ParamSpec] = field(default_factory=list)


class OperationRegistry:
    def __init__(self) -> None:
        self._ops: dict[str, Operation] = {}

    def register(self, name: str, *, action: str, handler: Handler,
                 summary: str = "", params: list[ParamSpec] | None = None) -> None:
        self._ops[name] = Operation(action=action, handler=handler,
                                    summary=summary, params=params or [])

    def get(self, name: str) -> Operation | None:
        return self._ops.get(name)

    def names(self) -> list[str]:
        return list(self._ops)


def dispatch(store: Store, registry: OperationRegistry, ctx: RequestContext,
             name: str, params: dict) -> object:
    op = registry.get(name)
    if op is None:
        raise KeyError(f"unknown operation {name!r}")
    project_id = params.get("project_id") or ctx.project_id
    workspace_id = params.get("workspace_id")
    authorize(store, ctx, op.action, project_id, workspace_id=workspace_id)
    return op.handler(ctx, params)
