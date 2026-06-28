# Auditor Core — Extract Headless Runner + Cited Semantics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **IMPORTANT — build on existing infra, do NOT create new tables.** The wiki
> auditor already exists: tables `wiki_audits` + `wiki_audit_suggestions`, ops in
> `brain2/wiki_audit_ops.py` (`create_audit_row`, `insert_suggestion`,
> `set_audit_status`, `make_accept_suggestion`, `make_dismiss_suggestion`,
> `make_list_audits`, `make_list_suggestions`), and an SSE runner inline in
> `brain2/api.py` (`/api/v1/wiki/{topic}/audit/stream`, lines ~377-458). The
> frontend `AuditDrawer.tsx` is already wired to the on-demand path. This plan
> makes that runner **reusable headlessly** and adds the **`cited`** notion the
> auto-correct loop (Plan 3) and UI gating need.

**Goal:** Extract the inline LLM audit logic from the SSE endpoint into a reusable `run_wiki_audit_once(...)` function, extract suggestion application into a headless `apply_suggestion(...)`, and add a `cited` derivation so callers can distinguish source-grounded suggestions (auto-applicable) from ungrounded ones.

**Architecture:** A new `brain2/wiki_audit_runner.py` holds the provider build + prompt + parse + `insert_suggestion` loop, returning the inserted suggestion ids and their parsed objects. The SSE endpoint is refactored to call it (no behavior change). `apply_suggestion(store, gateway, *, tenant_id, user_id, suggestion_id, edit=None)` is factored out of `make_accept_suggestion` so both the op and the auto-correct loop share one code path. `cited` = `len(sources_cited) > 0`.

**Tech Stack:** Python, `brain2/chat_providers.py` (`build_provider`, `complete_once`), `brain2/wiki_audit_ops.py`, `brain2/api.py`, pytest.

## Global Constraints

- Do NOT add new audit tables. Reuse `wiki_audits` / `wiki_audit_suggestions`.
- Suggestion shape (existing columns): `suggestion_id, audit_id, tenant_id, section, diff_text, proposed_content, rationale, sources_cited (json), status, decided_by, decided_at, created_at`.
- A suggestion is **cited** iff its `sources_cited` list is non-empty. There is no separate `cited` column; derive it.
- The auditor LLM is invoked via `build_provider(tenant_id, agent_row, secrets)` + `complete_once(provider, prompt, system=...)`, NOT the gateway. The agent_row is a `models` table row.
- Suggestions are parsed from lines matching `^SUGGESTION:\s+(\{.*\})\s*$` and the model ends with `DONE` (existing contract — keep it).
- `apply_suggestion` writes `proposed_content` as the full new page body and commits via `commit_batch` (existing `make_accept_suggestion` behavior).

---

### Task 1: Extract `run_wiki_audit_once` headless runner

**Files:**
- Create: `brain2/wiki_audit_runner.py`
- Modify: `brain2/api.py:377-458` (`wiki_audit_stream` — call the extracted runner)
- Test: `tests/test_wiki_audit_runner.py`

**Interfaces:**
- Produces: `run_wiki_audit_once(store, secrets, *, tenant_id, project_id, topic, agent_row, instructions, page_content, citation_policy="must_cite") -> tuple[str, list[dict]]` — creates an audit row, runs the LLM, inserts each parsed suggestion, sets the audit status to `done` (or `failed`), and returns `(audit_id, suggestions)` where each suggestion dict is `{suggestion_id, section, proposed_content, rationale, sources_cited, cited}`.
- Produces: `derive_cited(sources_cited: list) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
class FakeProvider: ...
def test_run_wiki_audit_once_inserts_and_derives_cited(store, seeded_project, monkeypatch):
    import brain2.wiki_audit_runner as r
    monkeypatch.setattr(r, "build_provider", lambda *a, **k: object())
    monkeypatch.setattr(r, "complete_once", lambda *a, **k: type("R", (), {
        "text": 'SUGGESTION: {"section":"Origins","proposed_content":"X",'
                '"rationale":"why","sources_cited":["a.pdf"]}\n'
                'SUGGESTION: {"section":"Body","proposed_content":"Y",'
                '"rationale":"w","sources_cited":[]}\nDONE'})())
    agent_row = {"model_id": "m1"}
    audit_id, sugs = r.run_wiki_audit_once(
        store, secrets=None, tenant_id="T", project_id="p", topic="Cell theory",
        agent_row=agent_row, instructions="", page_content="# Cell theory")
    assert len(sugs) == 2
    assert sugs[0]["cited"] is True and sugs[1]["cited"] is False
    assert all(s["suggestion_id"] for s in sugs)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_wiki_audit_runner.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
"""Reusable headless wiki audit runner shared by the SSE endpoint and audit.run."""
from __future__ import annotations
import json
import re

from brain2.chat_providers import build_provider, complete_once
from brain2.wiki_audit_ops import create_audit_row, insert_suggestion, set_audit_status

_SUGGESTION_RE = re.compile(r"^SUGGESTION:\s+(\{.*\})\s*$", re.MULTILINE)

_SYSTEM = ("You are a wiki auditor. Given a wiki page and instructions, emit one "
           "or more suggestions. Each suggestion is a JSON object on its own line "
           "of the form: SUGGESTION: {\"section\": \"...\", \"proposed_content\": "
           "\"...\", \"rationale\": \"...\", \"sources_cited\": [\"src1\"]}. Only "
           "include a source in sources_cited if the supplied page/sources support "
           "the change. End with 'DONE'.")


def derive_cited(sources_cited) -> bool:
    return bool(sources_cited)


def run_wiki_audit_once(store, secrets, *, tenant_id, project_id, topic, agent_row,
                        instructions, page_content, citation_policy="must_cite",
                        created_by=None, scope="page"):
    audit_id = create_audit_row(
        store, tenant_id=tenant_id, project_id=project_id, topic=topic,
        agent_id=agent_row["agent_id"] if "agent_id" in agent_row else agent_row["model_id"],
        instructions=instructions or "", scope=scope, selection=None,
        citation_policy=citation_policy, created_by=created_by)
    prompt = (f"Page topic: {topic}\nPage content:\n{page_content}\n\n"
              f"Instructions: {instructions or ''}\n")
    suggestions: list[dict] = []
    try:
        provider = build_provider(tenant_id, agent_row, secrets)
        resp = complete_once(provider, prompt, system=_SYSTEM)
        for m in _SUGGESTION_RE.finditer(resp.text or ""):
            try:
                obj = json.loads(m.group(1))
            except Exception:
                continue
            sources_cited = obj.get("sources_cited", []) or []
            sid = insert_suggestion(
                store, tenant_id=tenant_id, audit_id=audit_id,
                section=obj.get("section"),
                proposed_content=obj.get("proposed_content", ""),
                rationale=obj.get("rationale", ""), sources_cited=sources_cited)
            suggestions.append({
                "suggestion_id": sid, "section": obj.get("section"),
                "proposed_content": obj.get("proposed_content", ""),
                "rationale": obj.get("rationale", ""), "sources_cited": sources_cited,
                "cited": derive_cited(sources_cited)})
        set_audit_status(store, tenant_id=tenant_id, audit_id=audit_id, status="done")
    except Exception as exc:
        set_audit_status(store, tenant_id=tenant_id, audit_id=audit_id,
                         status="failed", error=str(exc))
        raise
    return audit_id, suggestions
```

> The `agent_row` may be a sqlite Row or a dict; `create_audit_row` needs the
> agent id. Confirm the column name (`model_id`) at execution and pass it through.

Refactor `wiki_audit_stream` in `api.py` to reuse the runner. Replace the inline
`_events()` LLM block with a call to `run_wiki_audit_once(...)` and stream the
returned suggestions; keep the SSE event shapes (`suggestion`, `done`, `error`)
identical. (The streaming-from-DB variant at `/audits/{id}/stream` can remain or
also delegate; keep its event contract unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_wiki_audit_runner.py -v && pytest tests/ -k audit -v`
Expected: PASS (runner test + existing audit tests still green).

- [ ] **Step 5: Commit**

```bash
git add brain2/wiki_audit_runner.py brain2/api.py tests/test_wiki_audit_runner.py
git commit -m "refactor(audit): extract reusable headless wiki audit runner"
```

---

### Task 2: Extract headless `apply_suggestion`

**Files:**
- Modify: `brain2/wiki_audit_ops.py` (factor `apply_suggestion` out of `make_accept_suggestion`)
- Test: `tests/test_wiki_audit_apply.py`

**Interfaces:**
- Produces: `apply_suggestion(store, gateway, *, tenant_id, user_id, suggestion_id, edit=None) -> dict` — the full body of the current `make_accept_suggestion` handler, callable without a request `ctx`. Returns `{suggestion_id, status, commit_sha}`. `make_accept_suggestion` becomes a thin wrapper calling it with `ctx.tenant_id` / `ctx.user_id`.

- [ ] **Step 1: Write the failing test**

```python
def test_apply_suggestion_writes_revision(store, seeded_pending_suggestion):
    from brain2.wiki_audit_ops import apply_suggestion
    out = apply_suggestion(store, gateway=None, tenant_id="T", user_id="u1",
                           suggestion_id=seeded_pending_suggestion)
    assert out["status"] == "accepted"
    assert out["commit_sha"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_wiki_audit_apply.py -v`
Expected: FAIL — `apply_suggestion` not defined.

- [ ] **Step 3: Implement**

Move the body of the inner `handler` in `make_accept_suggestion` into a module-level
`apply_suggestion(store, gateway, *, tenant_id, user_id, suggestion_id, edit=None)`,
replacing `ctx.tenant_id`→`tenant_id`, `ctx.user_id`→`user_id`, and
`params.get("edit")`→`edit`, `"edit" in params`→`edit is not None`. Then:

```python
def make_accept_suggestion(store, gateway):
    def handler(ctx, params):
        return apply_suggestion(store, gateway, tenant_id=ctx.tenant_id,
                                user_id=ctx.user_id,
                                suggestion_id=params["suggestion_id"],
                                edit=params.get("edit"))
    return handler
```

Keep imports inside `apply_suggestion` as they are today.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_wiki_audit_apply.py -v && pytest tests/ -k audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/wiki_audit_ops.py tests/test_wiki_audit_apply.py
git commit -m "refactor(audit): headless apply_suggestion shared by op + loop"
```

---

### Task 3: `cited` exposed in `wiki:list_suggestions`

**Files:**
- Modify: `brain2/wiki_audit_ops.py` (`make_list_suggestions` — add derived `cited`)
- Test: `tests/test_wiki_audit_ops.py` (extend)

**Interfaces:**
- Consumes: `derive_cited` (Task 1).
- Produces: each suggestion dict returned by `wiki:list_suggestions` gains `cited: bool` so the AuditDrawer (Plan 5) can disable Accept when `!cited`.

- [ ] **Step 1: Write the failing test**

```python
def test_list_suggestions_includes_cited(store, seeded_audit_with_two_suggestions):
    from brain2.wiki_audit_ops import make_list_suggestions
    h = make_list_suggestions(store)
    out = h(_ctx("T"), {"audit_id": seeded_audit_with_two_suggestions, "project_id": "p"})
    cited = {s["section"]: s["cited"] for s in out["suggestions"]}
    assert cited["Origins"] is True   # had sources_cited
    assert cited["Body"] is False     # empty sources_cited
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_wiki_audit_ops.py::test_list_suggestions_includes_cited -v`
Expected: FAIL — no `cited` key.

- [ ] **Step 3: Implement**

In `make_list_suggestions`, after parsing `sources_cited`:

```python
            from brain2.wiki_audit_runner import derive_cited
            d["cited"] = derive_cited(d["sources_cited"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_wiki_audit_ops.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/wiki_audit_ops.py tests/test_wiki_audit_ops.py
git commit -m "feat(audit): expose derived cited flag on suggestions"
```

---

## Self-Review

- **Spec coverage:** reusable auditor (verdict/suggestions vs sources) → Task 1; suggestion application reuse for the loop → Task 2; `cited` gating used by loop (Plan 3) and UI (Plan 5) → Tasks 1,3. No new tables — reuses `wiki_audits`/`wiki_audit_suggestions`. Covered.
- **Placeholder scan:** none. Two flagged conformance checks (agent id column name; second SSE endpoint delegation) are runtime details, not unfinished steps.
- **Type consistency:** `run_wiki_audit_once(...) -> (audit_id, suggestions[{suggestion_id, section, proposed_content, rationale, sources_cited, cited}])` consumed by Plan 3; `apply_suggestion(store, gateway, *, tenant_id, user_id, suggestion_id, edit=None) -> {suggestion_id, status, commit_sha}` consumed by Plan 3 loop and the existing accept op; `derive_cited` shared by Tasks 1 and 3.
- **Dependency:** none for merge. Plan 3 consumes Tasks 1 and 2.
