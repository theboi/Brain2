# Activity Rename — Free the "Audit" Name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Context.** The Settings "Audit log" section renders the lifecycle event-log
> feed (`audit:list` → `make_audit_list` in `brain2/stats_ops.py`, reading
> `event_type='audit'` rows from the event outbox). The new LLM auditor lives on
> the Wiki page (AuditDrawer). To remove the name collision, the Settings
> event-log section becomes **"Activity"**, leaving "Audit" to mean the LLM
> auditor. `activity:list` already exists (`view_activity`); this is a UI-level
> rename, not a data migration.

**Goal:** Rename the Settings "Audit log" section to "Activity" so the LLM-auditor feature owns the "Audit" name, with no change to the underlying event data.

**Architecture:** Rename the nav entry, the section component, and its copy. The section keeps reading the same lifecycle events (via `audit:list` or, preferably, `activity:list` which is the broader feed) — no backend op is removed.

**Tech Stack:** React + react-query, `brain2-web/src/pages/Settings/*`, vitest.

## Global Constraints

- Do not delete the `audit:list` backend op (other callers/tests may use it).
- Keep the section's data source working; if switching from `audit:list` to `activity:list`, preserve the existing row layout and timestamps.
- The route/nav id may stay `audit` internally to avoid breaking deep links, but the visible label becomes "Activity". (If deep links are not a concern, rename the id to `activity` and update `Settings/index.tsx` accordingly.)

---

### Task 1: Rename the Settings section to "Activity"

**Files:**
- Rename: `brain2-web/src/pages/Settings/sections/AuditSection.tsx` → `ActivitySection.tsx`
- Rename: `brain2-web/src/pages/Settings/sections/AuditSection.test.tsx` → `ActivitySection.test.tsx`
- Modify: `brain2-web/src/pages/Settings/index.tsx:16,52,107`
- Test: `ActivitySection.test.tsx`

**Interfaces:**
- Produces: `ActivitySection` component (exported), nav entry `{ id: 'activity'|'audit', icon: 'history', label: 'Activity', subtitle: 'A record of every change in this workspace.' }`.

- [ ] **Step 1: Update the test to assert the new name/heading**

```tsx
// ActivitySection.test.tsx
import { render, screen } from '@testing-library/react';
import { ActivitySection } from './ActivitySection';

it('renders the Activity section heading', () => {
  render(<ActivitySection />);
  expect(screen.getByText(/Activity/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Settings/sections/ActivitySection.test.tsx`
Expected: FAIL — module `./ActivitySection` not found.

- [ ] **Step 3: Rename + rewire**

```bash
cd brain2-web/src/pages/Settings/sections
git mv AuditSection.tsx ActivitySection.tsx
git mv AuditSection.test.tsx ActivitySection.test.tsx
```

In `ActivitySection.tsx`: rename the exported component `AuditSection` → `ActivitySection`; update any visible heading/label string from "Audit" to "Activity". In `Settings/index.tsx`:

```tsx
import { ActivitySection } from './sections/ActivitySection';
// nav:
{ id: 'audit', icon: 'history', label: 'Activity', subtitle: 'A record of every change in this workspace.' },
// render map:
audit: <ActivitySection />,
```

(Keeping `id: 'audit'` preserves existing deep links; only the label changes.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd brain2-web && npx vitest run src/pages/Settings/sections/ActivitySection.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Settings
git commit -m "feat(web): rename Settings 'Audit log' to 'Activity'"
```

---

## Self-Review

- **Spec coverage:** §4 naming split (old event-log Audit → Activity; LLM auditor owns "Audit") → Task 1. Covered.
- **Placeholder scan:** none.
- **Type consistency:** `ActivitySection` exported and imported consistently in `Settings/index.tsx`.
- **Dependency:** independent of Plans 1–3, 5, 6.
