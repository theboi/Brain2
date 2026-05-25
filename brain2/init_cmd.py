"""`brain2-init`: bootstrap a fresh deployment — tenant + owner user + password.

Prints an access token for immediate use (Security model "Initial Setup").
"""
from __future__ import annotations

import uuid


def init_tenant(actx, *, tenant_id: str, name: str, email: str, password: str,
                role: str = "owner") -> dict:
    """Create the tenant + owner user, set the password, issue a token."""
    actx.store.create_tenant(tenant_id, name)
    user_id = f"user-{uuid.uuid4().hex[:12]}"
    actx.store.create_user(tenant_id, user_id, email, role)
    actx.passwords.set_password(tenant_id, user_id, password)
    access, refresh = actx.tokens.issue(tenant_id, user_id)
    return {"tenant_id": tenant_id, "user_id": user_id, "email": email,
            "token": access, "refresh_token": refresh}


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - CLI glue
    import argparse

    from brain2.app_context import build_app_context

    p = argparse.ArgumentParser(prog="brain2-init")
    p.add_argument("--tenant-id", default="default")
    p.add_argument("--name", default="Default Tenant")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    args = p.parse_args(argv)

    actx = build_app_context()
    result = init_tenant(actx, tenant_id=args.tenant_id, name=args.name,
                         email=args.email, password=args.password)
    print(f"Created tenant {result['tenant_id']!r}, owner {result['email']}")
    print(f"Access token: {result['token']}")
    return 0
