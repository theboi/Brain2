"""FastAPI surface under /api/v1 (canonical). Thin adapter over dispatch().

- Bearer token validated on every protected route; tenant_role enriched from Store.
- Idempotency-Key replays stored responses for mutating ops (P4 §9.7).
- Domain errors map to HTTP status; lists paginate by cursor (P5 §3).
"""
from __future__ import annotations

import dataclasses
import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from brain2.app_context import AppContext
from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import (AggregateOverUnboundedResult, Brain2Error, Conflict,
                           NotFound, PageTooLarge, PermissionDenied, QueryNotAllowed,
                           RateLimitExceeded, SSRFBlocked)
from brain2.operations import dispatch

logger = logging.getLogger(__name__)

_STATUS = {
    PermissionDenied: 403, NotFound: 404, Conflict: 409,
    QueryNotAllowed: 400, AggregateOverUnboundedResult: 400, SSRFBlocked: 400,
    PageTooLarge: 413, RateLimitExceeded: 429,
}


def create_app(actx: AppContext) -> FastAPI:
    app = FastAPI(title="Brain2", version="v1")

    def _auth(authorization: str | None = Header(default=None),
              idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
              ) -> RequestContext:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        raw = authorization.split(" ", 1)[1]
        try:
            ctx = actx.tokens.validate(raw)
        except Exception:
            raise HTTPException(status_code=401, detail="invalid token")
        user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
        return dataclasses.replace(ctx, tenant_role=user.role if user else "member",
                                   idempotency_key=idempotency_key)

    @app.exception_handler(Brain2Error)
    async def _domain_errors(request: Request, exc: Brain2Error):
        status = next((s for cls, s in _STATUS.items() if isinstance(exc, cls)), 400)
        return JSONResponse(status_code=status, content={"error": str(exc)})

    # --- auth ---
    @app.post("/api/v1/auth/tokens")
    def login(body: dict):
        tenant_id, email = body["tenant_id"], body["email"]
        uid = actx.store.get_user_id_by_email(tenant_id, email)
        if uid is None:
            raise HTTPException(status_code=401, detail="invalid credentials")
        try:
            actx.passwords.verify_password(tenant_id, uid, body["password"])
        except Exception:
            raise HTTPException(status_code=401, detail="invalid credentials")
        access, refresh = actx.tokens.issue(tenant_id, uid)
        return {"token": access, "refresh_token": refresh}

    @app.post("/api/v1/auth/tokens/refresh")
    def refresh(body: dict):
        access, new_refresh = actx.tokens.refresh(body["refresh_token"])
        return {"token": access, "refresh_token": new_refresh}

    @app.delete("/api/v1/auth/tokens")
    def logout(authorization: str = Header(...)):
        actx.tokens.revoke(authorization.split(" ", 1)[1])
        return {"revoked": True}

    @app.get("/api/v1/me")
    def me(ctx: RequestContext = Depends(_auth)):
        return {"user_id": ctx.user_id, "tenant_id": ctx.tenant_id,
                "role": ctx.tenant_role}

    @app.get("/api/v1/ops")
    def list_ops(project_id: str | None = None, ctx: RequestContext = Depends(_auth)):
        out = []
        for name in actx.operations.names():
            op = actx.operations.get(name)
            try:
                authorize(actx.store, ctx, op.action, project_id)
            except PermissionDenied:
                continue
            except Exception:
                continue       # project ops needing a project_id we weren't given
            out.append({"name": name, "action": op.action,
                        "summary": op.summary, "params": op.params})
        return {"ops": out}

    # --- generic operation dispatch (core + add-on ops) ---
    @app.post("/api/v1/ops/{name}")
    def run_op(name: str, params: dict, ctx: RequestContext = Depends(_auth)):
        if actx.operations.get(name) is None:
            raise HTTPException(status_code=404, detail=f"unknown operation {name!r}")
        if ctx.idempotency_key:
            prior = actx.store.recall_idempotent(ctx.tenant_id, ctx.idempotency_key)
            if prior is not None:
                return JSONResponse(status_code=prior[0], content=prior[1])
        result = dispatch(actx.store, actx.operations, ctx, name, params)
        body = result if isinstance(result, (dict, list)) else {"result": result}
        if ctx.idempotency_key:
            actx.store.remember_idempotent(ctx.tenant_id, ctx.idempotency_key, 200, body)
        return body

    # --- telegram server surface (service-key authenticated) ---
    def _service_auth(x_telegram_service_key: str | None = Header(default=None)):
        key = actx.config.telegram_service_key
        if key is None:
            raise HTTPException(status_code=503, detail="telegram integration not configured")
        if not x_telegram_service_key or not hmac.compare_digest(
                x_telegram_service_key.encode(), key):
            raise HTTPException(status_code=401, detail="invalid service key")

    def _resolve_tenant_id(body: dict) -> str:
        tid = body.get("tenant_id")
        if tid:
            return tid
        if actx.store.count_tenants() == 1:
            row = actx.store._conn.execute(
                "SELECT tenant_id FROM tenants WHERE deleted_at IS NULL LIMIT 1").fetchone()
            return row["tenant_id"]
        raise HTTPException(status_code=400, detail="specify workspace (tenant_id)")

    def _issue_for(tenant_id: str, user_id: str) -> dict:
        access, refresh = actx.tokens.issue(tenant_id, user_id)
        user = actx.store.get_user(tenant_id, user_id)
        return {"token": access, "refresh_token": refresh, "tenant_id": tenant_id,
                "user_id": user_id, "role": user.role if user else "member"}

    @app.get("/api/v1/telegram/status", dependencies=[Depends(_service_auth)])
    def tg_status():
        return {"bootstrapped": actx.store.count_tenants() > 0,
                "owner_id": actx.config.telegram_owner_id}

    @app.get("/api/v1/telegram/resolve/{telegram_id}", dependencies=[Depends(_service_auth)])
    def tg_resolve(telegram_id: int):
        found = actx.store.get_user_by_telegram(telegram_id)
        if found is None:
            return {"linked": False}
        tenant_id, user_id = found
        user = actx.store.get_user(tenant_id, user_id)
        return {"linked": True, "tenant_id": tenant_id, "user_id": user_id,
                "role": user.role if user else "member"}

    @app.post("/api/v1/telegram/bootstrap", dependencies=[Depends(_service_auth)])
    def tg_bootstrap(body: dict):
        if body["telegram_id"] != actx.config.telegram_owner_id:
            raise HTTPException(status_code=403, detail="not the configured owner")
        if actx.store.count_tenants() > 0:
            raise HTTPException(status_code=409, detail="already bootstrapped")
        from brain2.provisioning import provision_tenant
        tenant_id, user_id = provision_tenant(
            actx.store, actx.passwords, body["workspace_name"], body["email"],
            body["password"], body.get("display_name"),
            telegram_id=body["telegram_id"])
        return _issue_for(tenant_id, user_id)

    @app.post("/api/v1/telegram/link", dependencies=[Depends(_service_auth)])
    def tg_link(body: dict):
        tenant_id = _resolve_tenant_id(body)
        uid = actx.store.get_user_id_by_email(tenant_id, body["email"])
        if uid is None:
            raise HTTPException(status_code=401, detail="invalid credentials")
        try:
            actx.passwords.verify_password(tenant_id, uid, body["password"])
        except Exception:
            raise HTTPException(status_code=401, detail="invalid credentials")
        actx.store.link_telegram(tenant_id, uid, body["telegram_id"])
        return _issue_for(tenant_id, uid)

    @app.post("/api/v1/telegram/link-owner", dependencies=[Depends(_service_auth)])
    def tg_link_owner(body: dict):
        if body["telegram_id"] != actx.config.telegram_owner_id:
            raise HTTPException(status_code=403, detail="not the configured owner")
        tenant_id = _resolve_tenant_id(body)
        uid = actx.store.get_user_id_by_email(tenant_id, body["email"])
        if uid is None:
            raise HTTPException(status_code=404, detail="no such account")
        actx.store.link_telegram(tenant_id, uid, body["telegram_id"])
        return _issue_for(tenant_id, uid)

    return app


def main() -> None:  # `brain2-api`
    import uvicorn

    from brain2.app_context import build_app_context
    uvicorn.run(create_app(build_app_context()), host="0.0.0.0", port=8000)
