"""FastAPI surface under /api/v1 (canonical). Thin adapter over dispatch().

- Bearer token validated on every protected route; tenant_role enriched from Store.
- Idempotency-Key replays stored responses for mutating ops (P4 §9.7).
- Domain errors map to HTTP status; lists paginate by cursor (P5 §3).
"""
from __future__ import annotations

import dataclasses
import json
import logging
import re as _re
import time
import uuid

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from brain2.app_context import AppContext
from brain2.auth.passwords import AccountLockedError, CredentialError
from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import (AggregateOverUnboundedResult, Brain2Error, Conflict,
                           NotFound, PageTooLarge, PermissionDenied, QueryNotAllowed,
                           RateLimitExceeded, SSRFBlocked)
from brain2.operations import dispatch
from brain2.ratelimit import SlidingWindowLimiter

logger = logging.getLogger(__name__)


def _parse_frontmatter_sources(text: str) -> set[str]:
    """Extract `sources:` ids from a YAML frontmatter block. Tolerant of
    list-form `- id` and inline `[a, b]` shapes."""
    m = _re.match(r"^---\n(.*?)\n---\n", text, flags=_re.DOTALL)
    if not m:
        return set()
    body = m.group(1)
    # Inline list: "sources: [a, b, c]"
    inline = _re.search(r"^sources:\s*\[([^\]]*)\]\s*$", body, flags=_re.MULTILINE)
    if inline:
        return {s.strip().strip('"').strip("'") for s in inline.group(1).split(",")
                if s.strip()}
    # Block list: "sources:\n  - a\n  - b"
    m2 = _re.search(r"^sources:\s*\n((?:\s+-\s+\S.*\n?)+)", body, flags=_re.MULTILINE)
    if not m2:
        return set()
    out = set()
    for ln in m2.group(1).splitlines():
        ln = ln.strip()
        if ln.startswith("- "):
            out.add(ln[2:].strip().strip('"').strip("'"))
    return out


_STATUS = {
    PermissionDenied: 403, NotFound: 404, Conflict: 409,
    QueryNotAllowed: 400, AggregateOverUnboundedResult: 400, SSRFBlocked: 400,
    PageTooLarge: 413, RateLimitExceeded: 429,
}


def create_app(actx: AppContext) -> FastAPI:
    app = FastAPI(title="Brain2", version="v1")
    _password_limiter = SlidingWindowLimiter()
    _stop_flags: dict[str, bool] = {}

    def _sse(payload: dict) -> str:
        return "data: " + json.dumps(payload) + "\n\n"

    def _stream_stored_assistant(message_row):
        from brain2.chat import _chunk
        for chunk in _chunk(message_row["content"] or ""):
            yield _sse({"type": "token", "text": chunk})
        yield _sse({
            "type": "done",
            "tokens_in": message_row["tokens_in"],
            "tokens_out": message_row["tokens_out"],
            "latency_ms": message_row["latency_ms"],
            "assistant_message_id": message_row["message_id"],
            "text": message_row["content"],
        })

    def _auth(authorization: str | None = Header(default=None),
              token: str | None = Query(default=None),
              idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
              ) -> RequestContext:
        raw: str | None = None
        if authorization and authorization.startswith("Bearer "):
            raw = authorization.split(" ", 1)[1]
        elif token:
            raw = token
        if not raw:
            raise HTTPException(status_code=401, detail="missing bearer token")
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
        user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
        return {"user_id": ctx.user_id, "tenant_id": ctx.tenant_id,
                "role": ctx.tenant_role,
                "display_name": user.display_name if user else None,
                "email": user.email if user else None}

    @app.patch("/api/v1/me")
    def patch_me(body: dict, ctx: RequestContext = Depends(_auth)):
        display_name = body.get("display_name")
        with actx.store.transaction() as cx:
            cx.execute(
                "UPDATE users SET display_name=? WHERE tenant_id=? AND user_id=?",
                (display_name, ctx.tenant_id, ctx.user_id),
            )
        user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
        return {"user_id": ctx.user_id, "display_name": user.display_name if user else None}

    @app.post("/api/v1/me/password")
    def change_password(body: dict, ctx: RequestContext = Depends(_auth)):
        key = f"me-password:{ctx.tenant_id}:{ctx.user_id}"
        if not _password_limiter.check(key, limit=5, window_s=300):
            raise HTTPException(status_code=429, detail="password change rate limit exceeded")
        try:
            actx.passwords.verify_password(ctx.tenant_id, ctx.user_id, body["current_password"])
        except CredentialError:
            raise HTTPException(status_code=401, detail="invalid current password")
        except AccountLockedError as exc:
            raise HTTPException(status_code=423, detail=str(exc))
        actx.passwords.set_password(ctx.tenant_id, ctx.user_id, body["new_password"])
        return {"changed": True}

    @app.get("/api/v1/workspace")
    def workspace_info(ctx: RequestContext = Depends(_auth)):
        authorize(actx.store, ctx, "view_stats")
        tenant = actx.store.get_tenant(ctx.tenant_id)
        member_count = actx.store._conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE tenant_id=?",
            (ctx.tenant_id,),
        ).fetchone()["n"]
        return {"tenant_id": ctx.tenant_id,
                "name": tenant.name if tenant else ctx.tenant_id,
                "member_count": member_count,
                "plan": None}

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

    # --- sources upload / raw / from_url / from_text (Phase D) ---
    def _project_authorize(ctx: RequestContext, project_id: str, action: str) -> None:
        authorize(actx.store, ctx, action, project_id)

    @app.post("/api/v1/sources/upload")
    async def upload_source(
        project_id: str = Form(...),
        topic: str | None = Form(default=None),
        file: UploadFile = File(...),
        ctx: RequestContext = Depends(_auth),
    ):
        if actx.blob_store is None:
            raise HTTPException(status_code=503, detail="blob store not configured")
        _project_authorize(ctx, project_id, "ingest")
        content = await file.read()
        blob_hash, blob_path = actx.blob_store.put(ctx.tenant_id, content)
        from brain2.source_ops import create_source_row, set_source_extracted, set_source_failed
        from brain2.knowledge.extract import extract_to_markdown
        from pathlib import Path
        source_id = create_source_row(
            actx.store, tenant_id=ctx.tenant_id, project_id=project_id, kind="file",
            filename=file.filename, mime=file.content_type,
            size_bytes=len(content), blob_hash=blob_hash, blob_path=blob_path,
            topic=topic, uploaded_by=ctx.user_id)
        try:
            md = extract_to_markdown(Path(blob_path), mime=file.content_type)
            set_source_extracted(actx.store, tenant_id=ctx.tenant_id,
                                  source_id=source_id, extracted_md=md)
            status = "extracted"
        except Exception as exc:
            set_source_failed(actx.store, tenant_id=ctx.tenant_id,
                               source_id=source_id, error=str(exc))
            status = "failed"
        return {"source_id": source_id, "blob_hash": blob_hash,
                "size_bytes": len(content), "status": status}

    @app.post("/api/v1/sources/from_url")
    def source_from_url(body: dict, ctx: RequestContext = Depends(_auth)):
        if actx.blob_store is None:
            raise HTTPException(status_code=503, detail="blob store not configured")
        project_id = body["project_id"]
        url = body["url"]
        _project_authorize(ctx, project_id, "ingest")
        # SSRF guard
        from brain2.knowledge.blobs import ssrf_check_url
        try:
            ssrf_check_url(url)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"url rejected: {exc}")
        from brain2.source_ops import create_source_row, set_source_extracted, set_source_failed
        from brain2.knowledge.extract import extract_url_to_markdown
        source_id = create_source_row(
            actx.store, tenant_id=ctx.tenant_id, project_id=project_id, kind="url",
            url=url, topic=body.get("topic"), uploaded_by=ctx.user_id)
        try:
            md = extract_url_to_markdown(url)
            set_source_extracted(actx.store, tenant_id=ctx.tenant_id,
                                  source_id=source_id, extracted_md=md)
            status = "extracted"
        except Exception as exc:
            set_source_failed(actx.store, tenant_id=ctx.tenant_id,
                               source_id=source_id, error=str(exc))
            status = "failed"
        return {"source_id": source_id, "url": url, "status": status}

    @app.post("/api/v1/sources/from_text")
    def source_from_text(body: dict, ctx: RequestContext = Depends(_auth)):
        if actx.blob_store is None:
            raise HTTPException(status_code=503, detail="blob store not configured")
        project_id = body["project_id"]
        content = body["content"]
        topic = body.get("topic")
        _project_authorize(ctx, project_id, "ingest")
        data = content.encode("utf-8")
        blob_hash, blob_path = actx.blob_store.put(ctx.tenant_id, data)
        from brain2.source_ops import create_source_row, set_source_extracted
        source_id = create_source_row(
            actx.store, tenant_id=ctx.tenant_id, project_id=project_id, kind="text",
            mime=body.get("mime", "text/markdown"), size_bytes=len(data),
            blob_hash=blob_hash, blob_path=blob_path, topic=topic,
            uploaded_by=ctx.user_id)
        set_source_extracted(actx.store, tenant_id=ctx.tenant_id,
                              source_id=source_id, extracted_md=content)
        return {"source_id": source_id, "status": "extracted"}

    # --- wiki audit kickoff + stream (Phase G) ---
    @app.post("/api/v1/wiki/{topic}/audit/stream")
    def wiki_audit_stream(topic: str, body: dict,
                           ctx: RequestContext = Depends(_auth)):
        from brain2.wiki_audit_ops import (create_audit_row, insert_suggestion,
                                            set_audit_status)
        from brain2.chat_providers import build_provider, complete_once
        from brain2.auth.authorize import authorize as _authz
        project_id = body["project_id"]
        _authz(actx.store, ctx, "read_wiki", project_id)

        from brain2.vault.parser import canonical_topic as _ct
        vault_page = actx.store.get_vault_page_by_topic(project_id, _ct(topic))
        proj = actx.store.get_project(ctx.tenant_id, project_id)
        page_content = ""
        if vault_page is not None and proj and proj.vault_path:
            from pathlib import Path as _Path
            try:
                page_content = (_Path(proj.vault_path) / vault_page.path).read_text(encoding="utf-8")
            except (FileNotFoundError, UnicodeDecodeError):
                page_content = vault_page.tldr or ""
        agent_row = actx.store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, body["agent_id"])).fetchone()
        if agent_row is None:
            raise HTTPException(status_code=404, detail="agent not found")

        audit_id = create_audit_row(
            actx.store, tenant_id=ctx.tenant_id, project_id=project_id,
            topic=topic, agent_id=body["agent_id"],
            instructions=body.get("instructions", ""),
            scope=body.get("scope", "page"),
            selection=body.get("selection"),
            citation_policy=body.get("citation_policy", "must_cite"),
            created_by=ctx.user_id)

        # System prompt: tell the model to emit JSON suggestions.
        system = ("You are a wiki auditor. Given a wiki page and instructions, "
                  "emit one or more suggestions. Each suggestion is a JSON object on "
                  "its own line of the form: "
                  "SUGGESTION: {\"section\": \"...\", \"proposed_content\": \"...\", "
                  "\"rationale\": \"...\", \"sources_cited\": [\"src1\"]}. "
                  "End with 'DONE'.")
        prompt = (f"Page topic: {topic}\nPage content:\n{page_content}\n\n"
                  f"Instructions: {body.get('instructions','')}\n")

        def _events():
            import json
            import re
            try:
                provider = build_provider(ctx.tenant_id, agent_row, actx.secrets)
                resp = complete_once(provider, prompt, system=system)
                text = resp.text
                pattern = re.compile(r"^SUGGESTION:\s+(\{.*\})\s*$", re.MULTILINE)
                count = 0
                for m in pattern.finditer(text):
                    try:
                        obj = json.loads(m.group(1))
                    except Exception:
                        continue
                    sid = insert_suggestion(
                        actx.store, tenant_id=ctx.tenant_id, audit_id=audit_id,
                        section=obj.get("section"),
                        proposed_content=obj.get("proposed_content", ""),
                        rationale=obj.get("rationale", ""),
                        sources_cited=obj.get("sources_cited", []))
                    count += 1
                    yield "data: " + json.dumps({
                        "type": "suggestion", "suggestion_id": sid,
                        "section": obj.get("section"),
                        "proposed_content": obj.get("proposed_content", ""),
                        "rationale": obj.get("rationale", ""),
                        "sources_cited": obj.get("sources_cited", [])}) + "\n\n"
                set_audit_status(actx.store, tenant_id=ctx.tenant_id,
                                  audit_id=audit_id, status="done")
                yield "data: " + json.dumps({"type": "done", "audit_id": audit_id,
                                              "suggestions_emitted": count}) + "\n\n"
            except Exception as exc:
                set_audit_status(actx.store, tenant_id=ctx.tenant_id,
                                  audit_id=audit_id, status="failed", error=str(exc))
                yield "data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n"

        return StreamingResponse(_events(), media_type="text/event-stream")

    @app.post("/api/v1/wiki/{topic}/audit")
    def wiki_audit_create(topic: str, project_id: str, body: dict,
                          ctx: RequestContext = Depends(_auth)):
        from brain2.wiki_audit_ops import create_audit_row
        authorize(actx.store, ctx, "ingest", project_id)
        if ctx.idempotency_key:
            prior = actx.store.recall_idempotent(ctx.tenant_id, ctx.idempotency_key)
            if prior is not None:
                return JSONResponse(status_code=prior[0], content=prior[1])
        audit_id = create_audit_row(
            actx.store, tenant_id=ctx.tenant_id, project_id=project_id,
            topic=topic, agent_id=body["agent_id"],
            instructions=body.get("instructions", ""),
            scope=body.get("scope", "page"),
            selection=body.get("selection"),
            citation_policy=body.get("citation_policy", "must_cite"),
            created_by=ctx.user_id)
        response = {"audit_id": audit_id, "stream_url": f"/api/v1/wiki/audits/{audit_id}/stream"}
        if ctx.idempotency_key:
            actx.store.remember_idempotent(ctx.tenant_id, ctx.idempotency_key, 200, response)
        return response

    @app.get("/api/v1/wiki/audits/{audit_id}/stream")
    def wiki_audit_stream_get(audit_id: str, ctx: RequestContext = Depends(_auth)):
        from brain2.chat_providers import build_provider, complete_once
        from brain2.wiki_audit_ops import insert_suggestion, set_audit_status
        row = actx.store._conn.execute(
            "SELECT * FROM wiki_audits WHERE tenant_id=? AND audit_id=?",
            (ctx.tenant_id, audit_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="audit not found")
        authorize(actx.store, ctx, "read_wiki", row["project_id"])

        if row["status"] == "done":
            def _replay():
                suggestions = actx.store._conn.execute(
                    "SELECT * FROM wiki_audit_suggestions WHERE tenant_id=? AND audit_id=? "
                    "ORDER BY created_at",
                    (ctx.tenant_id, audit_id)).fetchall()
                count = 0
                for suggestion in suggestions:
                    count += 1
                    yield _sse({
                        "type": "suggestion",
                        "suggestion_id": suggestion["suggestion_id"],
                        "section": suggestion["section"],
                        "proposed_content": suggestion["proposed_content"],
                        "rationale": suggestion["rationale"],
                        "sources_cited": json.loads(suggestion["sources_cited"] or "[]"),
                    })
                yield _sse({"type": "done", "audit_id": audit_id,
                            "suggestions_emitted": count})
            return StreamingResponse(_replay(), media_type="text/event-stream")

        from brain2.vault.parser import canonical_topic as _ct2
        _vault_page = actx.store.get_vault_page_by_topic(row["project_id"], _ct2(row["topic"]))
        _proj = actx.store.get_project(ctx.tenant_id, row["project_id"])
        _page_content = ""
        if _vault_page is not None and _proj and _proj.vault_path:
            from pathlib import Path as _Path2
            try:
                _page_content = (_Path2(_proj.vault_path) / _vault_page.path).read_text(encoding="utf-8")
            except (FileNotFoundError, UnicodeDecodeError):
                _page_content = _vault_page.tldr or ""
        agent_row = actx.store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, row["agent_id"])).fetchone()
        if agent_row is None:
            raise HTTPException(status_code=404, detail="agent not found")
        system = ("You are a wiki auditor. Given a wiki page and instructions, "
                  "emit one or more suggestions. Each suggestion is a JSON object on "
                  "its own line of the form: "
                  "SUGGESTION: {\"section\": \"...\", \"proposed_content\": \"...\", "
                  "\"rationale\": \"...\", \"sources_cited\": [\"src1\"]}. "
                  "End with 'DONE'.")
        prompt = (f"Page topic: {row['topic']}\nPage content:\n{_page_content}\n\n"
                  f"Instructions: {row['instructions']}\n")

        def _events():
            import re
            try:
                provider = build_provider(ctx.tenant_id, agent_row, actx.secrets)
                resp = complete_once(provider, prompt, system=system)
                pattern = re.compile(r"^SUGGESTION:\s+(\{.*\})\s*$", re.MULTILINE)
                count = 0
                for match in pattern.finditer(resp.text):
                    try:
                        obj = json.loads(match.group(1))
                    except Exception:
                        continue
                    sid = insert_suggestion(
                        actx.store, tenant_id=ctx.tenant_id, audit_id=audit_id,
                        section=obj.get("section"),
                        proposed_content=obj.get("proposed_content", ""),
                        rationale=obj.get("rationale", ""),
                        sources_cited=obj.get("sources_cited", []))
                    count += 1
                    yield _sse({
                        "type": "suggestion",
                        "suggestion_id": sid,
                        "section": obj.get("section"),
                        "proposed_content": obj.get("proposed_content", ""),
                        "rationale": obj.get("rationale", ""),
                        "sources_cited": obj.get("sources_cited", []),
                    })
                set_audit_status(actx.store, tenant_id=ctx.tenant_id,
                                 audit_id=audit_id, status="done")
                yield _sse({"type": "done", "audit_id": audit_id,
                            "suggestions_emitted": count})
            except Exception as exc:
                set_audit_status(actx.store, tenant_id=ctx.tenant_id,
                                 audit_id=audit_id, status="failed", error=str(exc))
                yield _sse({"type": "error", "message": str(exc)})

        return StreamingResponse(_events(), media_type="text/event-stream")

    # --- chat streaming (Phase F) ---
    @app.post("/api/v1/conversations/{cid}/messages/stream")
    def chat_post_and_stream(cid: str, body: dict,
                              ctx: RequestContext = Depends(_auth)):
        """Send a user message and stream the assistant's reply as SSE.

        Body: {"content": "...", "tools_override": [...optional...]}.
        Returns text/event-stream lines: data: <json>\\n\\n.
        """
        from brain2.chat import run_turn
        from brain2.auth.authorize import authorize as _authz
        _authz(actx.store, ctx, "use_agents")

        convo = actx.store._conn.execute(
            "SELECT * FROM conversations WHERE tenant_id=? AND conversation_id=? "
            "AND deleted=0", (ctx.tenant_id, cid)).fetchone()
        if convo is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        agent_row = actx.store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, convo["agent_id"])).fetchone()
        if agent_row is None:
            raise HTTPException(status_code=404, detail="agent not found")

        run_id = str(__import__("uuid").uuid4())
        _stop_flags[run_id] = False

        def _events():
            try:
                for ev, payload in run_turn(
                        actx.store, actx.operations, actx.secrets, ctx, cid,
                        agent_row, body["content"],
                        stop_check=lambda: _stop_flags.get(run_id, False)):
                    line = "data: " + __import__("json").dumps(
                        {"type": ev, **payload, "run_id": run_id}) + "\n\n"
                    yield line
            finally:
                _stop_flags.pop(run_id, None)

        return StreamingResponse(_events(), media_type="text/event-stream")

    @app.post("/api/v1/conversations/{cid}/messages")
    def chat_create_message(cid: str, body: dict, ctx: RequestContext = Depends(_auth)):
        from brain2.auth.authorize import authorize as _authz
        from brain2.chat_ops import insert_user_message
        _authz(actx.store, ctx, "use_agents")
        convo = actx.store._conn.execute(
            "SELECT * FROM conversations WHERE tenant_id=? AND conversation_id=? "
            "AND deleted=0", (ctx.tenant_id, cid)).fetchone()
        if convo is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        if ctx.idempotency_key:
            prior = actx.store.recall_idempotent(ctx.tenant_id, ctx.idempotency_key)
            if prior is not None:
                return JSONResponse(status_code=prior[0], content=prior[1])
        mid = insert_user_message(actx.store, conversation_id=cid, content=body["content"])
        response = {"message_id": mid,
                    "stream_url": f"/api/v1/conversations/{cid}/messages/{mid}/stream"}
        if ctx.idempotency_key:
            actx.store.remember_idempotent(ctx.tenant_id, ctx.idempotency_key, 200, response)
        return response

    @app.get("/api/v1/conversations/{cid}/messages/{mid}/stream")
    def chat_message_stream(cid: str, mid: str, ctx: RequestContext = Depends(_auth)):
        from brain2.auth.authorize import authorize as _authz
        from brain2.chat import run_turn
        _authz(actx.store, ctx, "use_agents")
        convo = actx.store._conn.execute(
            "SELECT * FROM conversations WHERE tenant_id=? AND conversation_id=? "
            "AND deleted=0", (ctx.tenant_id, cid)).fetchone()
        if convo is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        msg = actx.store._conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? AND message_id=? AND role='user'",
            (cid, mid)).fetchone()
        if msg is None:
            raise HTTPException(status_code=404, detail="message not found")
        agent_row = actx.store._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, convo["agent_id"])).fetchone()
        if agent_row is None:
            raise HTTPException(status_code=404, detail="agent not found")
        prior_assistant = actx.store._conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? AND parent_message_id=? "
            "AND role='assistant' ORDER BY created_at DESC LIMIT 1",
            (cid, mid)).fetchone()
        if prior_assistant is not None:
            return StreamingResponse(_stream_stored_assistant(prior_assistant),
                                     media_type="text/event-stream")

        _stop_flags[mid] = False

        def _events():
            try:
                for ev, payload in run_turn(
                        actx.store, actx.operations, actx.secrets, ctx, cid,
                        agent_row, msg["content"], user_message_id=mid,
                        persist_user_message=False,
                        stop_check=lambda: _stop_flags.get(mid, False)):
                    yield _sse({"type": ev, **payload})
            finally:
                _stop_flags.pop(mid, None)

        return StreamingResponse(_events(), media_type="text/event-stream")

    @app.post("/api/v1/conversations/{cid}/stream/{run_id}/stop")
    def chat_stop(cid: str, run_id: str, ctx: RequestContext = Depends(_auth)):
        from brain2.auth.authorize import authorize as _authz
        _authz(actx.store, ctx, "use_agents")
        _stop_flags[run_id] = True
        return {"stopped": True}

    @app.post("/api/v1/conversations/{cid}/messages/{mid}/stop")
    def chat_message_stop(cid: str, mid: str, ctx: RequestContext = Depends(_auth)):
        from brain2.auth.authorize import authorize as _authz
        _authz(actx.store, ctx, "use_agents")
        _stop_flags[mid] = True
        return {"stopped": True}

    # --- agents local runtime probes (Phase E) ---
    @app.get("/api/v1/agents/local/runtime")
    def agents_local_runtime(ctx: RequestContext = Depends(_auth)):
        info: dict = {"free_ram_bytes": None, "total_ram_bytes": None,
                      "ollama_ok": False, "ollama_base_url": "http://localhost:11434"}
        try:
            import psutil
            vm = psutil.virtual_memory()
            info["free_ram_bytes"] = int(vm.available)
            info["total_ram_bytes"] = int(vm.total)
        except Exception:
            pass
        import httpx
        try:
            with httpx.Client(timeout=2.0) as h:
                r = h.get(f"{info['ollama_base_url']}/api/tags")
                info["ollama_ok"] = r.status_code == 200
        except Exception:
            info["ollama_ok"] = False
        return info

    @app.get("/api/v1/agents/local/models")
    def agents_local_models(ctx: RequestContext = Depends(_auth)):
        base = "http://localhost:11434"
        import httpx
        try:
            with httpx.Client(timeout=4.0) as h:
                r = h.get(f"{base}/api/tags")
                r.raise_for_status()
                return {"models": r.json().get("models", []), "base_url": base}
        except Exception as exc:
            return {"models": [], "base_url": base, "error": str(exc)}

    @app.post("/api/v1/agents/local/pull")
    def agents_local_pull(body: dict, ctx: RequestContext = Depends(_auth)):
        # Fire-and-forget: hand off to Ollama; client polls /agents/local/models.
        # Authorization: only admins can pull (large download / disk).
        authorize(actx.store, ctx, "manage_agents")
        model = body["model"]
        base = body.get("base_url", "http://localhost:11434")
        import httpx
        try:
            with httpx.Client(timeout=5.0) as h:
                h.post(f"{base}/api/pull", json={"name": model, "stream": False})
            return {"started": True, "model": model}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"ollama pull failed: {exc}")

    @app.post("/api/v1/raw/upload")
    async def raw_upload(
        project_id: str = Form(...),
        type: str = Form(...),
        filename: str = Form(...),
        file: UploadFile = File(...),
        ctx: RequestContext = Depends(_auth),
    ):
        if type not in ("wiki", "static", "dynamic"):
            raise HTTPException(status_code=400, detail=f"unknown type {type!r}")
        authorize(actx.store, ctx, "ingest_vault", project_id)
        proj = actx.store.get_project(ctx.tenant_id, project_id)
        if proj is None or not proj.vault_path:
            raise HTTPException(status_code=404, detail="project has no vault")
        from pathlib import Path
        from brain2.vault.fs import write_bytes_atomic
        target = Path(proj.vault_path) / "raw" / type / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        body = await file.read()
        write_bytes_atomic(target, body)
        return {"path": str(target.relative_to(proj.vault_path)), "size": len(body)}

    @app.get("/api/v1/sources/{source_id}/raw")
    def source_raw(source_id: str, ctx: RequestContext = Depends(_auth)):
        row = actx.store._conn.execute(
            "SELECT project_id, blob_hash, mime, filename FROM sources "
            "WHERE tenant_id=? AND source_id=?",
            (ctx.tenant_id, source_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="source not found")
        _project_authorize(ctx, row["project_id"], "read_wiki")
        if actx.blob_store is None or not row["blob_hash"]:
            raise HTTPException(status_code=404, detail="blob not available")
        path = actx.blob_store.get_path(ctx.tenant_id, row["blob_hash"])
        if path is None:
            raise HTTPException(status_code=404, detail="blob not found on disk")

        def _iter():
            with open(path, "rb") as f:
                while chunk := f.read(64 * 1024):
                    yield chunk
        headers = {"Content-Disposition": f"attachment; filename=\"{row['filename'] or source_id}\""}
        return StreamingResponse(_iter(), media_type=row["mime"] or "application/octet-stream",
                                  headers=headers)

    @app.get("/api/v1/wiki/{topic}/sources")
    def wiki_topic_sources(topic: str, project_id: str,
                           ctx: RequestContext = Depends(_auth)):
        authorize(actx.store, ctx, "read_wiki", project_id)

        # 1) Topic-matched sources from the sources table.
        rows = actx.store._conn.execute(
            "SELECT * FROM sources WHERE tenant_id=? AND project_id=? AND topic=? "
            "AND status != 'deleted' ORDER BY created_at DESC",
            (ctx.tenant_id, project_id, topic)).fetchall()
        found = {r["source_id"]: dict(r) for r in rows}

        # 2) Frontmatter-declared source ids on the vault page.
        from brain2.vault.parser import canonical_topic as _canonical_topic
        page = actx.store.get_vault_page_by_topic(project_id, _canonical_topic(topic))
        if page is not None:
            proj = actx.store.get_project(ctx.tenant_id, project_id)
            if proj and proj.vault_path:
                from pathlib import Path
                abs_path = Path(proj.vault_path) / page.path
                try:
                    text = abs_path.read_text(encoding="utf-8")
                except (FileNotFoundError, UnicodeDecodeError):
                    text = ""
                extra_ids = _parse_frontmatter_sources(text)
                extra_ids -= set(found.keys())
                if extra_ids:
                    placeholders = ",".join("?" for _ in extra_ids)
                    args = (ctx.tenant_id, *sorted(extra_ids))
                    more = actx.store._conn.execute(
                        f"SELECT * FROM sources WHERE tenant_id=? AND source_id IN "
                        f"({placeholders}) ORDER BY created_at DESC", args
                    ).fetchall()
                    for r in more:
                        found[r["source_id"]] = dict(r)

        return {"topic": topic, "sources": list(found.values())}

    @app.get("/api/v1/sources/events")
    def source_events(project_id: str, ctx: RequestContext = Depends(_auth)):
        authorize(actx.store, ctx, "read_wiki", project_id)

        def _events():
            last_seen = ""
            last_heartbeat = time.monotonic()
            while True:
                rows = actx.store._conn.execute(
                    "SELECT source_id, filename, kind, status, extraction_error, updated_at "
                    "FROM sources WHERE tenant_id=? AND project_id=? AND updated_at > ? "
                    "ORDER BY updated_at, source_id",
                    (ctx.tenant_id, project_id, last_seen),
                ).fetchall()
                for row in rows:
                    event_type = "source_created" if row["status"] == "pending" else "source_status"
                    payload = {
                        "type": event_type,
                        "source_id": row["source_id"],
                        "filename": row["filename"],
                        "kind": row["kind"],
                        "status": row["status"],
                    }
                    if row["extraction_error"]:
                        payload["error"] = row["extraction_error"]
                    yield _sse(payload)
                    last_seen = max(last_seen, row["updated_at"])
                now = time.monotonic()
                if now - last_heartbeat >= 15:
                    yield _sse({"type": "heartbeat"})
                    last_heartbeat = now
                time.sleep(2)

        return StreamingResponse(_events(), media_type="text/event-stream")

    return app


def main() -> None:  # `brain2-api`
    import uvicorn

    from brain2.app_context import build_app_context
    uvicorn.run(create_app(build_app_context()), host="0.0.0.0", port=8000)
