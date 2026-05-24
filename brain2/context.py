"""RequestContext: the explicit tenant/user envelope threaded through handlers.

Built at the API/MCP boundary from a validated token (P03). `tenant_id` and
`user_id` are mandatory and never defaulted inside business logic (P1 §1).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RequestContext:
    tenant_id: str
    user_id: str
    project_id: str | None = None
    tenant_role: str = "member"          # owner | admin | member
    request_id: str | None = None        # tracing correlation (Phase 3 §6)
    idempotency_key: str | None = None   # Phase 4 §9.7
    # MCP on-behalf-of (Phase 5 §4); None for direct human/API callers.
    agent_id: str | None = None

    def __post_init__(self) -> None:
        if not self.tenant_id:
            raise ValueError("tenant_id is required")
        if not self.user_id:
            raise ValueError("user_id is required")
