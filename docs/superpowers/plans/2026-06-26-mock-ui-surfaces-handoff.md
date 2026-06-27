# Mock UI Surfaces — Disable/Handoff Plan

**Date:** 2026-06-26
**Source:** Security Review Packet 9 (Low/Medium severity)
**Decision:** Disable / hide unimplemented controls immediately. Each unimplemented surface is a separate future project; this document is the handoff for the next planning session.

---

## Immediate Action: Disable / Hide These Surfaces

Apply these changes on the `data-ingestion-refinement` branch (or a dedicated `chore/disable-mock-surfaces` branch). Each item is a small, isolated change. Commit each separately.

### 1. Dashboard `WIKI_HEALTH` and `QUICK_ACTIONS` static constants

**File:** `brain2-web/src/components/dashboard/QuickActions.tsx`

The `available` flag already gates rendering. Set all quick-action items to `available: false` or remove the static entries entirely and render nothing when the list is empty.

```tsx
// Replace the static QUICK_ACTIONS list with an empty array until wired to live data:
const QUICK_ACTIONS: QuickAction[] = [];
// The component should render null or a placeholder when the list is empty.
```

**File:** `brain2-web/src/lib/mockData.ts` — remove or stub out `WIKI_HEALTH` if it is imported by the dashboard and displayed. Replace the import site with `null`/`undefined` and skip rendering when `undefined`.

---

### 2. Ingest Modal Hard-Coded Access Entries

**File:** `brain2-web/src/pages/Sources/IngestModal.tsx`

Remove any hard-coded `alice`, `bob`, `Everyone`, `Research` entries from the access picker. If the access picker is not yet wired to a live API, hide the entire access section with a `// TODO: wire to access API` comment and render nothing in its place.

---

### 3. Reports Suggestions Catalog With Wrong Workspace Names

**File:** `brain2-web/src/pages/Reports/reportSuggestions.ts`

This file contains a static catalog keyed by workspace names like `Finance` and `Operations` that do not match seeded names (`Finance & HR`, `Flight Operations`). Two options:

**Option A (simpler):** Return an empty suggestions list until wired to live data:
```ts
export function getReportSuggestions(_workspaceId: string): ReportSuggestion[] {
  return [];
}
```

**Option B (if suggestions are visible and important):** Key the catalog by workspace ID returned from the API rather than by name, and only show suggestions for workspaces the caller has access to.

**Decision for now:** Use Option A (empty list). File a follow-up ticket to wire suggestions to real workspace IDs from the API.

---

### 4. Settings → Integrations (Local State Only)

**File:** `brain2-web/src/pages/Settings/sections/IntegrationsSection.tsx`

This section uses local React state to simulate toggling integrations. Until a backend integrations API exists, replace the section body with a disabled/coming-soon state:

```tsx
export function IntegrationsSection() {
  return (
    <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '24px 0' }}>
      Integrations are not yet available.
    </div>
  );
}
```

---

### 5. Settings → Audit (Static Mock Events)

**File:** `brain2-web/src/pages/Settings/sections/AuditSection.tsx`

Replace the static mock event list with the live `activity:list` op (which is already implemented in the backend). Wire it to `useActivity()` from the stats hooks, or add a `useAuditEvents()` hook that calls `activity:list`. If wiring is out of scope for this branch, render the section as disabled:

```tsx
export function AuditSection() {
  return (
    <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '24px 0' }}>
      Audit log is not yet available.
    </div>
  );
}
```

**Preferred path:** Wire to live `activity:list` (the backend already returns real events). This removes the mock AND adds real functionality.

---

### 6. Graph Page Mock Data Module

**File:** `brain2-web/src/pages/Graph/mockData.ts`

Per the memory note ([mock_ported_ui_surfaces.md](../../../.claude/projects/-Users-ryanthe-Dev-Brain2/memory/mock_ported_ui_surfaces.md)), the Graph page has live graph hooks already. Confirm whether `mockData.ts` is still imported anywhere:

```bash
grep -rn "from.*Graph/mockData\|import.*mockData" brain2-web/src/pages/Graph/
```

If it is still imported, replace mock data usages with the live hook data. If it is not imported, delete the file.

---

## Future Planning Handoffs

Each surface below needs its own planning session before implementation. This document is the handoff prompt for Codex to write that plan.

---

### Handoff A: Quick Actions (wired to live ops)

**Handoff prompt for next Codex session:**

> Read `brain2-web/src/components/dashboard/QuickActions.tsx` and `brain2-web/src/lib/mockData.ts`. Quick Actions currently shows a static list of actions with a TODO no-op runner. Design and implement a live Quick Actions surface that: (1) derives available actions from the user's accessible workspaces and ops permissions (e.g. "Ingest sources" if user has ingest, "Generate report" if user has use_agents); (2) actually dispatches the op when clicked (navigate to the relevant modal or page); (3) respects the user's role so members without `use_agents` don't see agent actions. Write a plan at `docs/superpowers/plans/YYYY-MM-DD-quick-actions-wiring.md`.

---

### Handoff B: Report Suggestions by Workspace

**Handoff prompt for next Codex session:**

> Read `brain2-web/src/pages/Reports/reportSuggestions.ts` and `brain2-web/src/pages/Reports/`. Report suggestions are currently a static catalog keyed by hard-coded workspace names. Design and implement a live suggestion system that: (1) calls `workspaces:overview` to get real workspace names and IDs; (2) filters suggestions to workspaces the user can access (based on `workspaces:overview` response); (3) maps workspace IDs to suggestion templates rather than names. Also add a backend test verifying that `reports:list` returns no inaccessible-workspace suggestions (this is an acceptance criterion from the security review). Write a plan at `docs/superpowers/plans/YYYY-MM-DD-report-suggestions-wiring.md`.

---

### Handoff C: Settings Integrations

**Handoff prompt for next Codex session:**

> Read `brain2-web/src/pages/Settings/sections/IntegrationsSection.tsx` and `brain2/`. The Integrations settings section currently uses local React state only. Design and implement a backend + frontend integrations system: (1) define what "integration" means in this product (API keys, webhooks, third-party connectors?); (2) design the data model and store methods; (3) implement backend CRUD ops; (4) wire the frontend to those ops. This is a substantial feature — write separate sub-plans for backend and frontend. Place plans at `docs/superpowers/plans/YYYY-MM-DD-integrations-*.md`.

---

### Handoff D: Settings Audit Log (Live)

**Handoff prompt for next Codex session:**

> Read `brain2-web/src/pages/Settings/sections/AuditSection.tsx`, `brain2/stats_ops.py` (`activity:list` op), and `brain2/audit_chain.py`. The Audit section uses static mock events. Wire it to the live `activity:list` op: (1) add a `useAuditEvents(limit)` hook; (2) display real events in the Audit section; (3) add pagination; (4) add filtering by event type if the backend supports it. The `activity:list` op scope was updated in Security Plan B to be project-scoped for non-owners — verify the Audit section only shows events the user is allowed to see. Write a plan at `docs/superpowers/plans/YYYY-MM-DD-audit-log-wiring.md`.

---

## Acceptance Criteria (Immediate Fixes)

After applying the immediate disable/hide changes above:

- [ ] Network tab shows no failed `list_users` calls when a workspace admin opens VaultDrawer (covered by Plan C Task 1)
- [ ] Dashboard Quick Actions renders an empty state or nothing — no no-op buttons
- [ ] Ingest Modal has no hard-coded `alice`/`bob`/`Everyone` entries
- [ ] Reports page suggestions return empty for any workspace
- [ ] Settings → Integrations shows "not yet available" copy
- [ ] Settings → Audit shows "not yet available" copy OR live events from `activity:list`
- [ ] `brain2-web/src/pages/Graph/mockData.ts` is either deleted or has no live imports
