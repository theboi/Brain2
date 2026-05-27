"""Thin httpx client for the Brain2 REST API. /telegram/* calls carry the service
key; ops/auth calls carry the user's bearer token. 4xx/5xx -> ApiError."""
from __future__ import annotations

import httpx

from brain2_telegram.errors import ApiError


class Brain2Client:
    def __init__(self, base_url: str, service_key: str, *,
                 transport: httpx.BaseTransport | None = None, timeout: float = 15.0):
        self._service_key = service_key
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=timeout)

    # --- helpers ---
    def _svc(self) -> dict:
        return {"X-Telegram-Service-Key": self._service_key}

    @staticmethod
    def _ok(r: httpx.Response) -> dict:
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("error") or r.json().get("detail") or ""
            except Exception:
                detail = r.text
            raise ApiError(r.status_code, detail)
        return r.json()

    # --- telegram identity (service key) ---
    def status(self) -> dict:
        return self._ok(self._http.get("/api/v1/telegram/status", headers=self._svc()))

    def resolve(self, telegram_id: int) -> dict:
        return self._ok(self._http.get(f"/api/v1/telegram/resolve/{telegram_id}",
                                       headers=self._svc()))

    def bootstrap(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/bootstrap",
                                        headers=self._svc(), json=body))

    def link(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/link",
                                        headers=self._svc(), json=body))

    def link_owner(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/link-owner",
                                        headers=self._svc(), json=body))

    # --- auth (bearer/refresh) ---
    def refresh(self, refresh_token: str) -> dict:
        return self._ok(self._http.post("/api/v1/auth/tokens/refresh",
                                        json={"refresh_token": refresh_token}))

    # --- operations (bearer) ---
    def list_ops(self, token: str, project_id: str | None = None) -> dict:
        params = {"project_id": project_id} if project_id else None
        return self._ok(self._http.get("/api/v1/ops", params=params,
                                       headers={"Authorization": f"Bearer {token}"}))

    def run_op(self, token: str, name: str, params: dict,
               idempotency_key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {token}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return self._ok(self._http.post(f"/api/v1/ops/{name}", json=params, headers=headers))
