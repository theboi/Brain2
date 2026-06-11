# User Persona System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Non-Claude executors: ignore this line; the `- [ ]` task structure is standard.)

**Goal:** A private, per-user persona document, prepended to every LLM request made on the user's behalf, that the LLM can update over time via a memory tool. Each user can access only their own persona.

**Architecture:** A single markdown doc per user in a new `user_personas` table. Three strictly-scoped ops (`persona:get`, `persona:set`, `persona:append`) that always derive the user from `ctx.user_id` and never accept a target-user param. A pure `persona_preamble()` helper is prepended to the system prompt at user-scoped request sites (`run_turn` now, report generation). `persona:append` is a registered op, so adding it to an agent's `tool_allowlist` makes it callable through the existing chat tool loop — the memory mechanism.

**Tech Stack:** Python 3 + pytest (`LocalStore(":memory:")`); React 18 + @tanstack/react-query (frontend, verified via `tsc`). Reference design: `docs/superpowers/specs/2026-06-08-user-persona-design.md`.

**Confirmed against code:** `run_turn(store, operations, secrets, ctx, ...)` builds the system string via `_build_prompt(history, agent_row["system_prompt"], tools)` (`brain2/chat.py:117`). `_allowed_tools(store, ctx, operations, allowlist)` resolves an agent's `tool_allowlist` against the op registry, so any registered op in the allowlist becomes a callable tool. Persona ops use `action="use_agents"` (lowest tenant role, `member`), matching chat/agent access.

---

### Task 1: `user_personas` table (migration)

**Files:**
- Create: `brain2/store/migrations/sqlite/0027_user_personas.sql`
- Test: `tests/test_migration_0027_user_personas.py`

> Assumes `0024`–`0026` (history, reports, scheduling) have landed. Renumber to the next free slot otherwise: `ls brain2/store/migrations/sqlite/ | sort | tail -2`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0027_user_personas.py`:

```python
import sqlite3
from brain2.store.local import LocalStore


def test_user_personas_columns_and_pk():
    s = LocalStore(":memory:"); s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(user_personas)").fetchall()}
    assert {"tenant_id", "user_id", "content", "updated_at"} <= cols


def test_user_personas_pk_is_tenant_and_user():
    s = LocalStore(":memory:"); s.migrate()
    s._conn.execute(
        "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
        "VALUES ('t1','u1','hi','2026-06-08T00:00:00Z')")
    try:
        s._conn.execute(
            "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
            "VALUES ('t1','u1','dup','2026-06-08T00:01:00Z')")
        assert False, "expected PK conflict"
    except sqlite3.IntegrityError:
        pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migration_0027_user_personas.py -v`
Expected: FAIL — `no such table: user_personas`.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0027_user_personas.sql`:

```sql
-- 0027_user_personas: per-user private persona doc (CLAUDE.md-style memory).
--
-- One markdown doc per user, prepended to every LLM request made on their
-- behalf. Strictly user-scoped: the only access path is (tenant_id, user_id);
-- there is intentionally no owner index and no "list all personas" structure.

CREATE TABLE user_personas (
    tenant_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_migration_0027_user_personas.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0027_user_personas.sql tests/test_migration_0027_user_personas.py
git commit -m "feat(store): add user_personas table (0027)"
```

---

### Task 2: Persona ops — get / set / append (strictly user-scoped)

**Files:**
- Create: `brain2/persona_ops.py`
- Modify: `brain2/app_context.py` (register after `register_schedule_ops` / `register_access_ops`)
- Test: `tests/test_persona_ops.py`

The privacy invariant — ops use `ctx.user_id` only, never a target-user param — is asserted directly.

- [ ] **Step 1: Write the failing test**

Create `tests/test_persona_ops.py`:

```python
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.persona_ops import register_persona_ops


def _ctx(user_id):
    return RequestContext(tenant_id="t1", user_id=user_id, tenant_role="member",
                          project_id=None)


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "ua", "editor")
    store.grant_access("t1", "p1", "user", "ub", "editor")
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    return reg


def test_set_then_get_roundtrips(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "Owns finance sources."})
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert out["content"] == "Owns finance sources."
    assert out["updated_at"]


def test_get_empty_when_unset(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert out["content"] == ""


def test_append_preserves_prior_content(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "Base line."})
    dispatch(store, reg, _ctx("ua"), "persona:append", {"note": "Prefers concise output."})
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert "Base line." in out["content"]
    assert "Prefers concise output." in out["content"]


def test_user_cannot_read_another_users_persona(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "SECRET about A"})
    # B reads — must see B's own (empty) doc, never A's
    out = dispatch(store, reg, _ctx("ub"), "persona:get", {})
    assert out["content"] == ""
    assert "SECRET" not in out["content"]


def test_ops_ignore_any_target_user_param(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "A content"})
    # B passes user_id of A — must be ignored; B sees its own empty doc
    out = dispatch(store, reg, _ctx("ub"), "persona:get", {"user_id": "ua"})
    assert out["content"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_persona_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.persona_ops'`.

- [ ] **Step 3: Implement `brain2/persona_ops.py`**

```python
"""Per-user persona ops. STRICTLY user-scoped: every handler derives the user
from ctx.user_id and never reads a target-user param. There is no path — for any
role — to access another user's persona through these ops.
"""
from __future__ import annotations

from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def _get_content(store, tenant_id, user_id) -> tuple[str, str | None]:
    row = store._conn.execute(
        "SELECT content, updated_at FROM user_personas WHERE tenant_id=? AND user_id=?",
        (tenant_id, user_id)).fetchone()
    if row is None:
        return "", None
    return (row["content"] or ""), row["updated_at"]


def _upsert(store, tenant_id, user_id, content) -> str:
    now = _now()
    store._conn.execute(
        "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
        "VALUES (?,?,?,?) "
        "ON CONFLICT(tenant_id, user_id) DO UPDATE SET content=excluded.content, "
        "updated_at=excluded.updated_at",
        (tenant_id, user_id, content, now))
    store._conn.commit()
    return now


def make_get(store):
    def handler(ctx, params):
        content, updated_at = _get_content(store, ctx.tenant_id, ctx.user_id)
        return {"content": content, "updated_at": updated_at}
    return handler


def make_set(store):
    def handler(ctx, params):
        now = _upsert(store, ctx.tenant_id, ctx.user_id, params.get("content", ""))
        return {"updated_at": now}
    return handler


def make_append(store):
    def handler(ctx, params):
        note = (params.get("note") or "").strip()
        existing, _ = _get_content(store, ctx.tenant_id, ctx.user_id)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        bullet = f"- [{stamp}] {note}"
        new_content = (existing.rstrip() + "\n" + bullet).strip() if existing.strip() else bullet
        now = _upsert(store, ctx.tenant_id, ctx.user_id, new_content)
        return {"updated_at": now, "appended": bullet}
    return handler


def persona_preamble(store, tenant_id, user_id) -> str:
    """System-prompt block for a user's persona, or '' when empty/missing."""
    content, _ = _get_content(store, tenant_id, user_id)
    if not content.strip():
        return ""
    return f"## About the user\n{content.strip()}\n"


def register_persona_ops(ops, store):
    ops.register("persona:get", action="use_agents", handler=make_get(store),
                 summary="Get the calling user's persona doc", params=[])
    ops.register("persona:set", action="use_agents", handler=make_set(store),
                 summary="Replace the calling user's persona doc",
                 params=[{"name": "content", "type": "str", "required": True}])
    ops.register("persona:append", action="use_agents", handler=make_append(store),
                 summary="Append a memory note to the calling user's persona (agent memory tool)",
                 params=[{"name": "note", "type": "str", "required": True}])
```

- [ ] **Step 4: Register in app_context**

In `brain2/app_context.py`, after `register_access_ops(ops, store)` (and after `register_schedule_ops` if the scheduling plan landed), add:

```python
    from brain2.persona_ops import register_persona_ops
    register_persona_ops(ops, store)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_persona_ops.py -v`
Expected: PASS (5 tests, including the two scoping/privacy assertions).

- [ ] **Step 6: Commit**

```bash
git add brain2/persona_ops.py brain2/app_context.py tests/test_persona_ops.py
git commit -m "feat(persona): user-scoped persona get/set/append ops + preamble helper"
```

---

### Task 3: `persona_preamble` helper test

**Files:**
- Test: `tests/test_persona_preamble.py`

(The helper is implemented in Task 2; this task pins its contract.)

- [ ] **Step 1: Write the test**

Create `tests/test_persona_preamble.py`:

```python
from brain2.store.local import LocalStore
from brain2.persona_ops import persona_preamble, make_set
from brain2.context import RequestContext


def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    return s


def test_preamble_empty_when_unset():
    s = _seed()
    assert persona_preamble(s, "t1", "u1") == ""


def test_preamble_formats_block_when_set():
    s = _seed()
    make_set(s)(RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                               project_id=None), {"content": "Ops & Finance lead."})
    block = persona_preamble(s, "t1", "u1")
    assert block.startswith("## About the user")
    assert "Ops & Finance lead." in block
```

- [ ] **Step 2: Run test**

Run: `python -m pytest tests/test_persona_preamble.py -v`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/test_persona_preamble.py
git commit -m "test(persona): pin persona_preamble formatting contract"
```

---

### Task 4: Inject persona into chat system prompt

**Files:**
- Modify: `brain2/chat.py` (`_build_prompt` gains a `preamble` arg; `run_turn` passes it)
- Test: `tests/test_chat_persona_injection.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_chat_persona_injection.py`:

```python
from brain2.chat import _build_prompt


def test_build_prompt_prepends_persona_preamble():
    history = [{"role": "user", "content": "hi"}]
    system, _ = _build_prompt(history, "You are a helpful assistant.", [],
                              preamble="## About the user\nLikes brevity.\n")
    assert system.startswith("## About the user")
    assert "Likes brevity." in system
    assert "You are a helpful assistant." in system


def test_build_prompt_no_preamble_unchanged():
    history = [{"role": "user", "content": "hi"}]
    system, _ = _build_prompt(history, "Base prompt.", [])
    assert system.startswith("Base prompt.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_persona_injection.py -v`
Expected: FAIL — `_build_prompt() got an unexpected keyword argument 'preamble'`.

- [ ] **Step 3: Update `_build_prompt` and `run_turn`**

In `brain2/chat.py`, change `_build_prompt` (line ~41) to accept `preamble`:

```python
def _build_prompt(history: list[dict], system_prompt: str,
                  tools: list[str], preamble: str = "") -> tuple[str, str]:
    tools_block = ""
    if tools:
        tools_block = ("\n\nYou may call tools by emitting a line of the form:\n"
                       "TOOL_CALL: <name> {json args}\n"
                       f"Available tools: {', '.join(tools)}\n"
                       "After emitting tool calls, stop — the system will reply with results.\n")
    base = (system_prompt or "You are a helpful assistant.")
    system = ((preamble + "\n") if preamble else "") + base + tools_block
    # transcript assembly unchanged below
```

> Keep the existing transcript-building lines (the `transcript`/`"\n".join(...)` return) exactly as they are; only the `system` assembly changes. Match the existing `tools_block` text already in the file rather than the illustrative copy above if it differs.

In `run_turn`, compute the preamble once before the turn loop and pass it into `_build_prompt`. After `tools = _allowed_tools(...)` (line ~105), add:

```python
    from brain2.persona_ops import persona_preamble
    persona = persona_preamble(store, ctx.tenant_id, ctx.user_id)
```

Then change the `_build_prompt` call (line ~117) to:

```python
        system, transcript = _build_prompt(history, agent_row["system_prompt"], tools, preamble=persona)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_chat_persona_injection.py -v`
Expected: PASS.

- [ ] **Step 5: Run the chat suite for regressions**

Run: `python -m pytest tests/ -k "chat" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/chat.py tests/test_chat_persona_injection.py
git commit -m "feat(persona): prepend persona to chat system prompt"
```

---

### Task 5: Expose `persona:append` as a memory tool & verify discovery

**Files:**
- Test: `tests/test_persona_tool_discovery.py`

`persona:append` is already a registered op (Task 2). This task verifies that when it's in an agent's `tool_allowlist`, `_allowed_tools` surfaces it — i.e. the model can call it. No new code if discovery already works; otherwise the gap is in `_allowed_tools` mapping.

- [ ] **Step 1: Write the test**

Create `tests/test_persona_tool_discovery.py`:

```python
from brain2.context import RequestContext
from brain2.operations import OperationRegistry
from brain2.persona_ops import register_persona_ops
from brain2.chat import _allowed_tools


def test_persona_append_is_offered_when_allowlisted(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")
    tools = _allowed_tools(store, ctx, reg, ["persona:append"])
    assert "persona:append" in tools
```

- [ ] **Step 2: Run the test**

Run: `python -m pytest tests/test_persona_tool_discovery.py -v`
Expected: PASS. If it FAILS, inspect `_allowed_tools` (`brain2/chat.py:57`) — it likely filters by the op's `action` against the user's grants. `persona:append` uses `use_agents` (member), which the seeded editor/member context satisfies, so it should pass. If `_allowed_tools` has an explicit allowlist of tool-eligible ops, add `persona:append` there.

- [ ] **Step 3: Commit**

```bash
git add tests/test_persona_tool_discovery.py
git commit -m "test(persona): persona:append is discoverable as an agent tool"
```

---

### Task 6: Inject persona into report generation

**Files:**
- Modify: `brain2/report_ops.py` (`reports:generate` prepends the preamble to the prompt)
- Test: `tests/test_report_persona_injection.py`

> Depends on the reports-backend plan (`brain2/report_ops.py`). If reports is not yet implemented, fold this into that plan as a follow-up step. The mechanism: prepend `persona_preamble(...)` to the prompt the report dispatches to the agent. One-shot runners do NOT get `persona:append` in any allowlist, so they never mutate the persona (intended).

- [ ] **Step 1: Write the failing test**

Create `tests/test_report_persona_injection.py`:

```python
import uuid
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.report_ops import register_report_ops
from brain2.persona_ops import register_persona_ops, make_set


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    aid = str(uuid.uuid4()); now = "2026-06-08T00:00:00Z"
    store._conn.execute(
        "INSERT INTO agents(agent_id, tenant_id, name, provider, model, status, "
        "created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "t1", "Researcher", "anthropic", "claude-opus-4-8", "ready", "u1", now, now))
    store._conn.commit()
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    register_report_ops(reg, store)
    return reg, aid


def test_report_prompt_includes_persona(store):
    reg, aid = _seed(store)
    make_set(store)(_ctx(), {"content": "Reports should be board-ready."})
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2", "format": "doc",
        "prompt": "Generate the Q2 report.", "agent_id": aid, "schedule": "now"})
    msg = store._conn.execute(
        "SELECT content FROM messages WHERE conversation_id=? AND role='user'",
        (out["conversation_id"],)).fetchone()
    assert "board-ready" in msg["content"]
    assert "Generate the Q2 report." in msg["content"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_report_persona_injection.py -v`
Expected: FAIL — persona text absent from the posted prompt.

- [ ] **Step 3: Prepend the preamble in `reports:generate`**

In `brain2/report_ops.py` `make_reports_generate`, before posting the message, prepend the persona. Where `prompt = params["prompt"]` is set, add:

```python
        from brain2.persona_ops import persona_preamble
        preamble = persona_preamble(store, ctx.tenant_id, ctx.user_id)
        prompt = params["prompt"]
        if preamble:
            prompt = preamble + "\n" + prompt
```

(Use this `prompt` in the `insert_user_message(... content=prompt)` call.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_report_persona_injection.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/report_ops.py tests/test_report_persona_injection.py
git commit -m "feat(persona): prepend persona to report generation prompt"
```

---

### Task 7: Frontend — persona editor in Settings → Profile

**Files:**
- Create: `brain2-web/src/hooks/usePersona.ts`
- Modify: `brain2-web/src/pages/Settings/sections/ProfileSection.tsx`

- [ ] **Step 1: Create the hooks**

Create `brain2-web/src/hooks/usePersona.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';

export function usePersona() {
  return useQuery({
    queryKey: ['persona'],
    queryFn: () => ops<{ content: string; updated_at: string | null }>('persona:get', {}),
  });
}

export function useSetPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => ops('persona:set', { content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persona'] }),
  });
}
```

- [ ] **Step 2: Add a Persona card to ProfileSection**

In `brain2-web/src/pages/Settings/sections/ProfileSection.tsx`, import the hooks and add a persona editor card alongside the existing profile/password cards. Add near the top imports:

```tsx
import { usePersona, useSetPersona } from '@/hooks/usePersona';
```

Inside the component, add state + handlers (mirroring the existing profile-form pattern):

```tsx
  const { data: persona } = usePersona();
  const setPersona = useSetPersona();
  const [personaText, setPersonaText] = useState('');
  const [personaSaved, setPersonaSaved] = useState(false);
  useEffect(() => { if (persona?.content != null) setPersonaText(persona.content); }, [persona?.content]);
  function handleSavePersona(e: React.FormEvent) {
    e.preventDefault();
    setPersonaSaved(false);
    setPersona.mutate(personaText, { onSuccess: () => setPersonaSaved(true) });
  }
```

Then render a card in the section's JSX (place it after the profile card, using the existing `SCard` wrapper and `Button`):

```tsx
      <SCard title="Persona" subtitle="A private note about you, prepended to your AI requests. Only you can see this.">
        <form onSubmit={handleSavePersona} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            value={personaText}
            onChange={(e) => { setPersonaText(e.target.value); setPersonaSaved(false); }}
            placeholder="e.g. Operations & Finance lead. Prefers concise, board-ready output. Currently focused on Q2 planning."
            spellCheck={false}
            style={{ width: '100%', minHeight: 200, resize: 'vertical', padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontFamily: 'var(--mono-font)', fontSize: 13, lineHeight: 1.6, color: 'var(--fg)', outline: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button variant="primary" type="submit" disabled={setPersona.isPending}>Save persona</Button>
            {personaSaved && <span style={{ fontSize: 12.5, color: 'var(--success)' }}>Saved.</span>}
          </div>
        </form>
      </SCard>
```

> Confirm `SCard`'s prop names (`title`/`subtitle`) against `brain2-web/src/components/settings/SettingsCard.tsx` and match the existing cards in this file. If `SCard` takes different props, mirror how the profile card is rendered just above.

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run the app → Settings → Profile. Type a persona, Save, reload — it persists. Confirm it's per-user (a different user's account shows an empty persona). Optionally start a chat and confirm the model behaves persona-aware.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/usePersona.ts brain2-web/src/pages/Settings/sections/ProfileSection.tsx
git commit -m "feat(persona): persona editor in Settings → Profile"
```

---

## Self-Review Notes

- **Spec coverage:** storage + scoping (Task 1-2), preamble helper (Task 2-3), chat injection (Task 4), memory tool discovery (Task 5), report injection (Task 6), editor (Task 7). ✓
- **Privacy invariant** is the headline requirement and is asserted by two dedicated tests (`test_user_cannot_read_another_users_persona`, `test_ops_ignore_any_target_user_param`) — ops bind `(ctx.tenant_id, ctx.user_id)` and never read a target-user param. ✓
- **Type/name consistency:** `persona_preamble(store, tenant_id, user_id) -> str` used identically in chat and reports. Ops `persona:get/set/append` with `content`/`note` params consistent across handlers, tests, and frontend hooks. `action="use_agents"` on all three. ✓
- **`_build_prompt` change is additive** (`preamble=""` default) so existing callers/tests are unaffected; the no-preamble test pins that. ✓
- **Dependencies:** Task 6 depends on the reports-backend plan's `report_ops.py`; flagged with a fold-in fallback. Migration `0027` assumes `0024`–`0026`; renumber note included.
- **Out of scope (per spec):** KV-cache chat persistence/reload and cache-invalidation — persona reads fresh per request, so it plugs into that future system without change.
