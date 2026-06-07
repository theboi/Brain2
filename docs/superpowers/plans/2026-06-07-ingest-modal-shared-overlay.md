# Ingest Modal Fixes + Shared Modal Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Ingest sources" overlay work in production (real upload with progress, working dropdowns, empty default queue, live tenant vaults) and unify it into one component built on a new shared `Modal` shell that all overlays will adopt.

**Architecture:** Extract the existing `ModalShell` (in `HomeModals.tsx`) into a standalone, exported `Modal` primitive that portals to `document.body`. Make `Sources/IngestModal.tsx` the single canonical ingest overlay built on that shell, with portal-based dropdowns, a browse-fix, live vaults from `useProjects`, and the already-working xhr upload flow. Delete the duplicate mock IngestModal from `HomeModals.tsx`, refactor the other three Home modals onto the shared shell, and switch the Sources sidebar + page off mock project data. Add `workspace_id` to the backend `list_projects` op so vaults can be scoped to the active workspace.

**Tech Stack:** React 18 + TypeScript (Vite), @tanstack/react-query, FastAPI + pytest (backend).

**Reference spec:** `docs/superpowers/specs/2026-06-07-ingest-modal-shared-overlay-design.md`

**Decisions locked in (previously deferred):**
- Home page **imports the canonical `IngestModal`** from `@/pages/Sources/IngestModal` and drops the HomeModals copy entirely (no re-export indirection).
- The Ingest button stays **enabled whenever `rows.length > 0`** (current behavior). File uploads are skipped when there is no active `projectId`; URL ingests still attempt. Rows default their vault to the active workspace's first live vault (falling back to `'default'`).

**Testing note:** `brain2-web` has **no** test runner configured (no vitest, no test scripts). Do **not** add one — it is out of scope. Frontend tasks are verified with `npm run build` (runs `tsc -b` typecheck + `vite build`) plus the manual smoke checks listed in each task. The backend task uses pytest (TDD).

---

## Task 1: Backend — `list_projects` returns and filters by `workspace_id`

**Why:** `useProjects(workspaceId)` sends `workspace_id`, but `make_list_projects` ignores it and omits `workspace_id`/`vault_path` from each row, so the UI cannot scope vaults to the active workspace. The store already has `store.list_projects(tenant_id, workspace_id=...)`; the op handler just bypasses it with raw SQL.

**Files:**
- Modify: `brain2/project_ops.py:31-40` (`make_list_projects`)
- Test: `tests/test_project_ops.py` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/test_project_ops.py`:

```python
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from fastapi.testclient import TestClient


def _client(role="owner"):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", role)
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_list_projects_includes_workspace_id():
    c, tok, s = _client("owner")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    rows = c.post("/api/v1/ops/list_projects", json={}, headers=_h(tok)).json()["projects"]
    p1 = next(p for p in rows if p["project_id"] == "p1")
    assert p1["workspace_id"] == "ws_a"
    assert "vault_path" in p1


def test_list_projects_filters_by_workspace_id():
    c, tok, s = _client("owner")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    s.create_project("t1", "p2", "Vault Two", workspace_id="ws_b")
    rows = c.post("/api/v1/ops/list_projects",
                  json={"workspace_id": "ws_a"}, headers=_h(tok)).json()["projects"]
    ids = {p["project_id"] for p in rows}
    assert ids == {"p1"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_project_ops.py -v`
Expected: FAIL — `test_list_projects_includes_workspace_id` raises `KeyError: 'workspace_id'`; `test_list_projects_filters_by_workspace_id` fails because all projects are returned (filter ignored).

- [ ] **Step 3: Rewrite `make_list_projects` to use the store and return the new fields**

In `brain2/project_ops.py`, replace the `make_list_projects` function (lines 31-40):

```python
def make_list_projects(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params.get("workspace_id")
        projects = store.list_projects(ctx.tenant_id, workspace_id=workspace_id)
        out = [{"project_id": p.id, "name": p.name,
                "workspace_id": p.workspace_id, "vault_path": p.vault_path,
                "created_at": p.created_at.isoformat()
                if hasattr(p.created_at, "isoformat") else p.created_at}
               for p in projects]
        return {"projects": out}
    return handler
```

Then register the optional param. In `register_project_ops`, replace the `list_projects` registration (lines 80-82):

```python
    ops.register("list_projects", action="manage_projects",
                 handler=make_list_projects(store),
                 summary="List projects in your tenant",
                 params=[{"name": "workspace_id", "type": "str", "required": False}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_project_ops.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the broader op suite to confirm no regression**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_api_ops.py tests/test_workspace_ops.py tests/test_console_ops_phase_a.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add brain2/project_ops.py tests/test_project_ops.py
git commit -m "feat(api): list_projects returns and filters by workspace_id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared `Modal` shell component

**Why:** One overlay primitive for the whole app. It must portal to `document.body` so the backdrop's `backdrop-filter` never becomes a containing block (the root cause of the dropdown bug and a class of future bugs).

**Files:**
- Create: `brain2-web/src/components/ui/Modal.tsx`

This is extracted from the existing `ModalShell` in `HomeModals.tsx` (lines 27-82), generalized with: optional `icon`/`title`, a `header` escape hatch, and `closeOnBackdrop`.

- [ ] **Step 1: Create the component**

Create `brain2-web/src/components/ui/Modal.tsx`:

```tsx
/*
 * Brain2 Console — shared Modal shell. The single overlay primitive: fixed
 * backdrop, centered animated panel, Escape + backdrop-click to close, portalled
 * to document.body so the backdrop's blur never becomes a containing block for
 * the panel or for any position:fixed dropdowns rendered inside it.
 *
 * All app overlays should be built on this. Use `header` for a fully custom
 * header, or `icon`+`title` for the standard one.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  icon?: IconName;
  title?: ReactNode;
  width?: number;
  footer?: ReactNode;
  header?: ReactNode;            // overrides icon/title when provided
  closeOnBackdrop?: boolean;     // default true
}

export function Modal({
  onClose, children, icon, title, width = 760, footer, header,
  closeOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  return createPortal(
    <div
      className="b2-anim-fade"
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        className="b2-anim-slide"
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        {header ?? (
          (icon || title) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {icon && <Icon name={icon} size={18} color="var(--accent)" />}
              {title && <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{title}</span>}
              <span style={{ marginLeft: 'auto' }}>
                <button
                  onClick={onClose}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="x" size={15} />
                </button>
              </span>
            </div>
          )
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Verify it typechecks/builds**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds (the file is not yet imported anywhere; this just confirms it compiles).

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/components/ui/Modal.tsx
git commit -m "feat(web): shared Modal overlay shell (portalled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Canonical IngestModal — portal dropdowns, browse fix, live vaults, shared shell

**Why:** Fix the three reported bugs (browse closes modal, broken dropdown positions, seeded items) and make vaults live, in the one component both pages will use.

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

There are four edits. Apply them in order.

- [ ] **Step 1: Make `IngMenu` portal to `document.body`**

In `brain2-web/src/pages/Sources/IngestModal.tsx`, update the imports at the top of the file. Replace line 6-7:

```tsx
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
```

with:

```tsx
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useProjects } from '@/hooks/useWorkspaces';
```

Then in the `IngMenu` component, replace the returned popover markup (the `{open && ( ... )}` block, lines 72-79) so the popover renders through a portal:

```tsx
      {open && createPortal(
        <Fragment>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div className="b2-anim-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 306, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            {children(close)}
          </div>
        </Fragment>,
        document.body,
      )}
```

(The surrounding `<Fragment>...{open && ...}</Fragment>` wrapper and the trigger `<div ref={ref} ...>` stay as-is.)

- [ ] **Step 2: Drive the vault picker from live projects**

The `ProjectPicker` currently maps over the module-level `PROJECT_OPTS`. Change it to accept an options list. Replace the `ProjectPicker` function (lines 92-119) with:

```tsx
function ProjectPicker({ value, onPick, full, options, loading }: { value: string | null; onPick: (v: string) => void; full?: boolean; options: string[]; loading?: boolean }) {
  return (
    <IngMenu width={224} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={value || 'Choose vault'}>
        <Icon name="folder" size={13} color="var(--fg-muted)" />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{value || 'Vault'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>Vault · project</div>
          {loading && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>Loading…</div>}
          {!loading && options.length === 0 && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>No vaults yet</div>}
          {options.map((p) => (
            <button key={p} onClick={() => { onPick(p); close(); }} style={ingRowBtn()}>
              <Icon name="folder" size={13} color="var(--fg-muted)" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
              {value === p && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
          <button onClick={() => { onPick('new-vault'); close(); }} style={ingRowBtn()}>
            <Icon name="plus" size={13} color="var(--accent)" /><span style={{ color: 'var(--accent)', fontWeight: 600 }}>New vault…</span>
          </button>
        </div>
      )}
    </IngMenu>
  );
}
```

Delete the now-unused `PROJECT_OPTS` constant (line 16).

`ProjectPicker` now has required `options`/`loading` props, so update its three call sites:
- In `IngestQueueBar` (line 321): `<ProjectPicker value={null} onPick={(v) => onBulk({ project: v })} options={vaultOptions} loading={vaultsLoading} />`
- In `IngestRow` (line 346): `<ProjectPicker value={r.project} onPick={(v) => onChange({ project: v })} full options={vaultOptions} loading={vaultsLoading} />`

These two components must receive `vaultOptions`/`vaultsLoading`. Add them to each component's props. For `IngestQueueBar`, extend its signature (line 308-311) to include `vaultOptions: string[]; vaultsLoading?: boolean;` and accept them in the destructure. For `IngestRow`, extend its signature (line 333-335) to include `vaultOptions: string[]; vaultsLoading?: boolean;` and accept them. Pass them through from the parent where these are rendered (Step 4 wires the parent).

- [ ] **Step 3: Fix the browse-closes-modal bug**

The root issue is that the hidden file input lives outside the panel's stop-propagation subtree, and the synthetic click from the native picker bubbles to the backdrop. Building the modal on the shared `Modal` shell (Step 4) already places all children inside the stop-propagation panel. Additionally, harden the input itself so its events never bubble. In `onFileInputChange` (lines 434-438), keep logic but the input element (moved into the panel in Step 4) will read:

```tsx
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
          onClick={(e) => e.stopPropagation()}
          onChange={onFileInputChange} />
```

(The `onClick` stopPropagation is applied in Step 4 where the input is placed inside the panel.)

- [ ] **Step 4: Rebuild the `IngestModal` body on the shared `Modal` shell + wire live vaults**

Replace the entire `IngestModal` component (lines 371-582) with the version below. Key changes vs. the original: uses `<Modal>` instead of the hand-rolled backdrop; the hidden file input is inside the panel with `onClick` stopPropagation; it calls `useProjects(workspaceId)` and threads `vaultOptions`/`vaultsLoading` into the queue bar and rows; rows default their vault to the first live vault.

```tsx
export function IngestModal({ open, onClose, files = [] }: {
  open: boolean; onClose: () => void; files?: DroppedFile[];
}) {
  const { workspaceId, projectId } = useWorkspace();
  const { data: projects = [], isLoading: vaultsLoading } = useProjects(workspaceId);
  const qc = useQueryClient();
  const ingestUrl = useIngestUrl(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFiles = useRef<Map<string, File>>(new Map());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const vaultOptions = projects.map((p) => p.name);
  const defaultVault = vaultOptions[0] ?? 'default';

  const seedRows = (): Row[] => files.map((f, i) => norm(f, i, defaultVault));
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState('');
  const [access, setAccess] = useState<Record<string, Member[]>>({});
  const [showAccess, setShowAccess] = useState(true);

  useEffect(() => {
    if (open) {
      setRows(seedRows());
      setSel(new Set());
      setProgress({});
      setSubmitting(false);
      pendingFiles.current = new Map();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const addUrl = () => {
    const v = draft.trim();
    if (!v) return;
    let host = v;
    try { host = new URL(v.match(/^https?:\/\//) ? v : 'https://' + v).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    setRows((rs) => [...rs, { id: 'u' + Date.now(), kind: 'url', name: v, url: v, type: 'url', size: '—', project: defaultVault, suggestedTopic: host, topic: host, mode: 'wiki', collision: false }]);
    setDraft('');
  };

  const addFilesToQueue = (picked: File[]) => {
    const newRows: Row[] = picked.map((f, i) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? 'file';
      const typeMap: Record<string, string> = { pdf: 'pdf', md: 'md', txt: 'md', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', py: 'code', js: 'code', ts: 'code', mp3: 'audio', m4a: 'audio', wav: 'audio' };
      const type = typeMap[ext] ?? 'file';
      const sizeKb = f.size / 1024;
      const size = sizeKb < 1024 ? `${sizeKb.toFixed(0)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
      pendingFiles.current.set(f.name, f);
      return norm({ name: f.name, type, size, project: defaultVault, topic: '', mode: 'wiki' }, rows.length + i, defaultVault);
    });
    setRows((rs) => [...rs, ...newRows]);
  };

  const onBrowseClick = () => fileInputRef.current?.click();

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) addFilesToQueue(picked);
    e.target.value = '';
  };

  const onDropZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const picked = Array.from(e.dataTransfer.files);
    if (picked.length) addFilesToQueue(picked);
  };

  const onIngest = async () => {
    if (rows.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const urlRows = rows.filter((r) => r.kind === 'url');
      await Promise.allSettled(
        urlRows.map((r) => ingestUrl.mutateAsync({ url: r.url ?? r.name, topic: r.topic || undefined })),
      );
      if (projectId) {
        const fileRows = rows.filter((r) => r.kind === 'file');
        const uploads = Array.from(pendingFiles.current.entries()).map(([name, file]) => {
          const row = fileRows.find((r) => r.name === name);
          const handle = uploadFileWithProgress(projectId, file, {
            topic: row?.topic || undefined,
            onProgress: (frac) => setProgress((p) => ({ ...p, [name]: frac })),
          });
          return handle.promise
            .then(() => setProgress((p) => { const { [name]: _omit, ...rest } = p; return rest; }))
            .catch((err) => console.error('upload error', name, err));
        });
        await Promise.allSettled(uploads);
        qc.invalidateQueries({ queryKey: ['sources', projectId] });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const ids = rows.map((r) => r.id);
  const allSel = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(ids));
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...p } : r));
  const bulk = (p: Partial<Row>) => setRows((rs) => rs.map((r) => sel.has(r.id) ? { ...r, ...p } : r));
  const removeRow = (id: string) => { setRows((rs) => rs.filter((r) => r.id !== id)); setSel((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const removeSel = () => { setRows((rs) => rs.filter((r) => !sel.has(r.id))); setSel(new Set()); };

  const vaults = [...new Set(rows.map((r) => r.project))];
  const accessFor = (v: string) => access[v] || seedAccess();
  const setLevel = (v: string, id: string, level: string) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.map((m) => m.id === id ? { ...m, level } : m) }; });
  const addMember = (v: string, p: Person) => setAccess((a) => { const cur = a[v] || seedAccess(); if (cur.some((m) => m.id === p.id)) return a; return { ...a, [v]: [...cur, { ...p, level: 'read' }] }; });
  const rmMember = (v: string, id: string) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.filter((m) => m.id !== id) }; });
  const selCount = sel.size;
  const progressEntries = Object.entries(progress);

  return (
    <Modal
      onClose={onClose}
      width={880}
      icon="download"
      title="Ingest sources"
      footer={
        <Fragment>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'} → <b style={{ color: 'var(--fg)' }}>{vaults.length}</b> vault{vaults.length === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ingBtnGhost()}>Cancel</button>
            <button onClick={onIngest} disabled={submitting || rows.length === 0} style={{ ...ingBtnPrimary(), opacity: (rows.length && !submitting) ? 1 : 0.5, cursor: submitting ? 'wait' : 'pointer' }}><Icon name="download" size={14} color="#fff" /> {submitting ? 'Ingesting…' : `Ingest${rows.length ? ` ${rows.length}` : ''}`}</button>
          </span>
        </Fragment>
      }
    >
      {/* hidden file input — inside the panel; stop click bubbling to backdrop */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onChange={onFileInputChange} />

      {/* combined add area — files + URL */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropZoneDrop}
        style={{ borderRadius: 12, border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`, background: dragOver ? 'var(--accent-soft)' : 'var(--bg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color .1s, background .1s' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="download" size={19} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Drag files here, or <button onClick={onBrowseClick} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--ui-font)', cursor: 'pointer', padding: 0 }}>browse</button></div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>PDF · Markdown · text · images · code — or paste a link below</div>
          </div>
        </div>
        {progressEntries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {progressEntries.map(([name, frac]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <div style={{ width: 80, height: 4, borderRadius: 2, background: 'var(--border)' }}>
                  <div style={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: 2, background: 'var(--accent)', transition: 'width .15s' }} />
                </div>
                <span style={{ width: 30, textAlign: 'right' }}>{Math.round(frac * 100)}%</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Icon name="globe" size={15} color="var(--fg-muted)" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }} placeholder="https://…  paste a page or sitemap URL" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
          </div>
          <button onClick={addUrl} style={ingBtnGhost()}><Icon name="plus" size={14} /> Add link</button>
        </div>
      </div>

      {/* queue */}
      <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <IngestQueueBar total={rows.length} selCount={selCount} allSel={allSel} onToggleAll={toggleAll} onBulk={bulk} onClearSel={() => setSel(new Set())} onRemoveSel={removeSel} vaultOptions={vaultOptions} vaultsLoading={vaultsLoading} />
        <div>
          {rows.map((r) => <IngestRow key={r.id} r={r} selected={sel.has(r.id)} onToggle={() => toggle(r.id)} onChange={(p) => patch(r.id, p)} onRemove={() => removeRow(r.id)} vaultOptions={vaultOptions} vaultsLoading={vaultsLoading} />)}
          {!rows.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>Nothing queued — drop files or paste a link above.</div>}
        </div>
      </div>

      {/* access management */}
      {vaults.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
          <button onClick={() => setShowAccess((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
            <Icon name="shield" size={16} color="var(--accent)" />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Vault access</span>
            <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{vaults.length} vault{vaults.length > 1 ? 's' : ''}</span>
            <span style={{ marginLeft: 'auto', transform: showAccess ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .12s', display: 'flex' }}><Icon name="chevDown" size={15} color="var(--fg-muted)" /></span>
          </button>
          {showAccess && <VaultAccess vaults={vaults} accessFor={accessFor} onLevel={setLevel} onAdd={addMember} onRemove={rmMember} />}
        </div>
      )}
    </Modal>
  );
}
```

Note the escape-key handler and `if (!open) return null` change: `Modal` owns Escape now, so the old standalone `useEffect` keydown listener (original lines 402-407) is removed (it is not present in the replacement above). The early `if (!open) return null` is kept and placed **after** the hooks (as shown) so hook order stays stable.

- [ ] **Step 5: Update `IngestQueueBar` and `IngestRow` signatures to thread vault props**

Confirm both components now accept and forward `vaultOptions`/`vaultsLoading` to `ProjectPicker` (set up in Step 2). `IngestQueueBar` header (replace lines 308-311):

```tsx
function IngestQueueBar({ total, selCount, allSel, onToggleAll, onBulk, onClearSel, onRemoveSel, vaultOptions, vaultsLoading }: {
  total: number; selCount: number; allSel: boolean; onToggleAll: () => void;
  onBulk: (p: Partial<Row>) => void; onClearSel: () => void; onRemoveSel: () => void;
  vaultOptions: string[]; vaultsLoading?: boolean;
}) {
```

`IngestRow` header (replace lines 333-335):

```tsx
function IngestRow({ r, selected, onToggle, onChange, onRemove, vaultOptions, vaultsLoading }: {
  r: Row; selected: boolean; onToggle: () => void; onChange: (p: Partial<Row>) => void; onRemove: () => void;
  vaultOptions: string[]; vaultsLoading?: boolean;
}) {
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds with no TS errors. If TS flags an unused `useLayoutEffect`/`Fragment`, confirm they are still used (`IngMenu` uses both); they should remain imported.

- [ ] **Step 7: Manual smoke check (Sources page)**

Run the app (`npm run dev`), open the Sources page, click "Ingest sources":
- Modal opens with an **empty** queue ("Nothing queued…").
- Click **browse**, pick a file → file picker closes, modal **stays open**, row appears.
- Open the **Vault** dropdown on a row → menu appears correctly positioned directly under the trigger (not at a wrong offset), listing real vault names.
- Open **Topic** and **Mode** dropdowns → correctly positioned.
- Click **Ingest** → progress bar fills, modal closes after upload settles, new source appears in the list.

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "fix(web): ingest modal — portal dropdowns, browse fix, live vaults, shared shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Home page + HomeModals — drop duplicate, adopt shared shell

**Why:** Eliminate the mock IngestModal and route Home through the canonical component; refactor the remaining three Home modals onto the shared `Modal`.

**Files:**
- Modify: `brain2-web/src/components/home/HomeModals.tsx`
- Modify: `brain2-web/src/pages/Home/index.tsx`

- [ ] **Step 1: Remove the duplicate IngestModal and local `ModalShell` from HomeModals**

In `brain2-web/src/components/home/HomeModals.tsx`, delete the following, which only the removed IngestModal used:
- The local `ModalShell` component (lines 27-82) — replaced by the shared `Modal`.
- The entire `IngestModal` export and its helpers that are unused by the other three modals: `INGEST_TYPE_ICON`, `PROJECT_OPTS`, `INGEST_MODES`, `INGEST_TOPICS`, `ACCESS_LEVELS`, `PEOPLE_POOL`, `AccessMember`, `seedAccess`, `IngestItem`, `IngMenu`, `ingPill`, `ingRowBtn`, `IngCheck`, `ProjectPicker`, `TopicMenuBody`, `TopicPicker`, `ModePicker`, `IngestQueueRow`, `IngestQueueBar`, `LevelPicker`, `AddPeopleBody`, `AccessRow`, `VaultAccess`, `SEED_FILES`, and `export function IngestModal` (lines 105-756).

Keep: the shared button helpers `ghostBtn`, `primaryBtn`, `inputStyle`, `fieldLabel` (used by the other modals), and `ActivityModal`, `ManageAgentsModal`, `AddAgentModal`.

- [ ] **Step 2: Point the remaining modals at the shared `Modal`**

At the top of `HomeModals.tsx`, update imports. Replace lines 10-15:

```tsx
import { useState, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { IconName } from '@/components/ui/Icon';
import { AGENTS, ACTIVITY } from '@/lib/mockData';
```

with:

```tsx
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { IconName } from '@/components/ui/Icon';
import { AGENTS, ACTIVITY } from '@/lib/mockData';
import { Modal } from '@/components/ui/Modal';
```

(`useEffect`, `useLayoutEffect`, `useRef`, `useCallback`, `createPortal`, and `ReactNode` were only used by the deleted code. If the build reports any of them still referenced by `ActivityModal`/`ManageAgentsModal`/`AddAgentModal`, re-add only the ones actually used.)

Then in each of `ActivityModal`, `ManageAgentsModal`, `AddAgentModal`, replace the `<ModalShell ...>` wrapper with `<Modal ...>` — the props are identical (`icon`, `title`, `width`, `onClose`, `footer`, children). For example, `ActivityModal`'s return changes from `return (\n    <ModalShell` to `return (\n    <Modal`, and the closing `</ModalShell>` becomes `</Modal>`. Do the same for the other two.

- [ ] **Step 3: Route the Home page to the canonical IngestModal**

In `brain2-web/src/pages/Home/index.tsx`, line 25, change the import so `IngestModal` comes from the canonical module and the other three still come from HomeModals:

```tsx
import { ActivityModal, ManageAgentsModal, AddAgentModal } from '@/components/home/HomeModals';
import { IngestModal } from '@/pages/Sources/IngestModal';
```

Then update the render (line 179) — the canonical modal needs `open`:

```tsx
      {modal === 'ingest'   && <IngestModal open onClose={() => setModal(null)} />}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds. Fix any "declared but never used" errors by removing the leftover unused symbol.

- [ ] **Step 5: Manual smoke check (Home page)**

`npm run dev`, open Home, click the "Ingest source" entry point:
- Modal opens empty, dropdowns position correctly, browse keeps it open, vaults are live (same behavior as Sources).
- Open Activity, Manage agents, Add agent modals → each still renders correctly (header, body, footer, Escape closes).

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/components/home/HomeModals.tsx brain2-web/src/pages/Home/index.tsx
git commit -m "refactor(web): home modals adopt shared Modal; drop duplicate IngestModal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Sources page + lib — live vault chips, drop mock DROPPED

**Why:** The Sources sidebar project filter still reads mock counts from `SOURCE_TREE.projects`, and `SourcesPage` injects mock `DROPPED` files into the modal.

**Files:**
- Modify: `brain2-web/src/pages/Sources/index.tsx`
- Modify: `brain2-web/src/lib/sources.ts`

- [ ] **Step 1: Stop seeding the modal with mock files**

In `brain2-web/src/pages/Sources/index.tsx`, line 451, remove the `files` prop so the queue is empty by default:

```tsx
      <IngestModal open={modal} onClose={() => setModal(false)} />
```

Remove `DROPPED` from the import on lines 11-14:

```tsx
import {
  SOURCE_TREE, TYPE_ICON, STATUS_CHIP,
  type Source, type SourceFilter,
} from '@/lib/sources';
```

- [ ] **Step 2: Drive the project filter chip from live projects**

`sourceChipDefs` currently builds `projOpts` from `SOURCE_TREE.projects`. Make it take the live project names. Change the signature and `projOpts` (lines 63-65):

```tsx
function sourceChipDefs(f: SourceFilter, setF: (f: SourceFilter) => void, projectNames: string[] = []): ChipDef[] {
  const t = SOURCE_TREE;
  const projOpts = [{ value: 'all', label: 'All projects', icon: 'layers' as const }, ...projectNames.map((p) => ({ value: p, label: p, icon: 'folder' as const }))];
```

And update `proj` lookup (line 68) to use the live list:

```tsx
  const proj = projectNames.find((p) => p === f.project);
```

Then update the `project` chip def entry (line 72) so its label falls back correctly:

```tsx
    { key: 'project', icon: 'folder', label: proj ?? 'All projects', active: f.project !== 'all', title: 'Project', options: projOpts, value: f.project, onPick: (v) => setF({ ...f, project: v }) },
```

- [ ] **Step 3: Pass live project names into `sourceChipDefs` call sites**

`SourcesPage` already has `projects` from `useProjects(workspaceId)` (line 383). Compute the names once and pass to both `sourceChipDefs` calls. After line 383, add:

```tsx
  const projectNames = projects.map((p) => p.name);
```

Update the desktop sidebar usage: `SourcesSidebar` calls `sourceChipDefs(f, setF)` internally (line 84). Pass names down — add a `projectNames: string[]` prop to `SourcesSidebar` (signature line 79-81) and forward it: `const defs = sourceChipDefs(f, setF, projectNames).filter((d) => d.key !== 'project');`. Then in the page render (line 435) pass `projectNames={projectNames}` to `<SourcesSidebar .../>`.

Update the mobile chips (line 413): `const mobileChips = <FilterChips defs={sourceChipDefs(f, setF, projectNames)} />;`.

- [ ] **Step 4: Remove the now-unused `DROPPED` mock from lib**

In `brain2-web/src/lib/sources.ts`, delete the `DroppedFile` interface and the `DROPPED` constant (lines 72-80). Keep `SOURCE_TREE` (still used for tag/status metadata) and `SourceFilter`.

`IngestModal.tsx` imports `type { DroppedFile }`. Since `DROPPED` is gone but the `files?: DroppedFile[]` prop type remains useful, move the `DroppedFile` interface into `IngestModal.tsx` itself. At the top of `brain2-web/src/pages/Sources/IngestModal.tsx`, replace the import `import type { DroppedFile } from '@/lib/sources';` with a local definition near the other interfaces:

```tsx
export interface DroppedFile { name: string; type: string; size: string; project: string; topic: string; collision?: boolean; mode: 'wiki' | 'dynamic' | 'static'; }
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds; no references to `DROPPED` remain (`grep -rn "DROPPED" brain2-web/src` returns nothing).

- [ ] **Step 6: Manual smoke check**

`npm run dev`, Sources page: the **Project** filter chip lists the real tenant vaults (matching what the vault picker in the modal shows), and selecting one filters the source list. The ingest modal opens empty.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Sources/index.tsx brain2-web/src/lib/sources.ts brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): sources page uses live vault chips; drop mock DROPPED

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Backend tests pass:** `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_project_ops.py tests/test_workspace_ops.py tests/test_api_ops.py -q`
- [ ] **Frontend builds clean:** `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
- [ ] **No mock leftovers:** `grep -rn "PROJECT_OPTS\|DROPPED\|SEED_FILES" brain2-web/src` returns nothing.
- [ ] **Single IngestModal:** `grep -rln "export function IngestModal" brain2-web/src` lists only `src/pages/Sources/IngestModal.tsx`.
- [ ] **Manual end-to-end:** From both Home and Sources, ingest a real file (progress → close → appears in list) and a URL; confirm dropdowns position correctly and browse never closes the modal.
