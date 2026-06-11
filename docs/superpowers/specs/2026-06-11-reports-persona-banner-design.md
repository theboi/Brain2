# Reports Persona Banner — Live Persona Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope owner:** Web console (`brain2-web`)

## Problem

The Reports page (`brain2-web/src/pages/Reports/index.tsx`) presents a fabricated,
hardcoded persona:

```ts
const REPORT_PERSONA = {
  name: 'Alice',
  role: 'Operations & Finance Lead',
  basis: 'Tuned to your role, the sources you own, and what you open most',
  signals: ['Owns 12 finance sources', 'Opens Q2 docs daily', 'Board meeting in 6 days'],
};
```

It is shown in three places:
- the page header — **"Suggested for {name}"** (`SectionLabel`),
- the persona banner line — **"Tuned for {name} · {role} — {basis}"** with a
  decorative `PersonaCrest`,
- the sidebar **"Persona signals"** `Panel` — `signals` rendered as chips.

Meanwhile a **real** per-user persona backend already exists and is live in
Settings → Profile:
- `persona:get` → `{ content, updated_at }` — a **freeform markdown document**
  (there is no structured `role` / `signals` field).
- consumed by `usePersona()` in `brain2-web/src/hooks/usePersona.ts`.
- the real user's name/role live in `useMe()` (`display_name`, `role`).

## Goal

Make the persona banner **honest and live**: real user name, and persona content
derived from the actual `persona:get` document — without inventing structured
fields the backend doesn't have.

## Non-goals

- **Suggested report cards** (`SUGGESTED_REPORTS`), the **catalog**
  (`REPORT_CATALOG`), and per-report `match` / `why` copy stay hardcoded. There is
  no recommendation backend; personalizing the actual suggestions is out of scope.
- No backend changes. (`persona:get` already returns what we need.)
- No changes to report generation / scheduling flow.

## Design

### Decision: "name + persona excerpt"

Use the real name everywhere, derive the banner "basis" and the signal chips from
the persona markdown, and gracefully handle the unset case.

### Persona parsing helper (pure, unit-tested)

Add `parsePersona(content: string)` (in `usePersona.ts` or a small `lib/persona.ts`):

- **`summary`** — the first non-empty line that is *not* a bullet, with any leading
  markdown heading markers (`#`) stripped and whitespace trimmed; truncated to a
  reasonable length (~120 chars). This becomes the banner "basis".
- **`signals`** — lines that begin with `-` or `*` (markdown bullets), stripped of
  the marker and any leading `[YYYY-MM-DD]` date stamp that `persona:append`
  writes; the first 4 are used as chips.
- **`isEmpty`** — true when `content` is empty/whitespace.

This matches how the persona is actually authored: `persona:set` stores free prose
and `persona:append` adds dated `- [date] note` bullets — so bullets are the
natural "signals" and the lead line is the natural summary.

### Component changes (`pages/Reports/index.tsx`)

- Import and call `useMe()` and `usePersona()` in `ReportsPage`; thread the derived
  values to the header, banner, and sidebar panel (props, not a second hook call
  deep in the tree).
- **Name** — `displayName = useMe().display_name ?? 'you'`; first token used where a
  first name reads better ("Suggested for {first}"). Replaces `REPORT_PERSONA.name`.
- **Banner line** — drop the fabricated `role`. Render
  "Tuned for **{name}** — {summary}". When persona `isEmpty`, render an invitation
  instead: "Set up your persona to tailor these suggestions" with a link to
  `/settings` (Profile section), keeping `PersonaCrest`.
- **"Persona signals" panel** — render `signals` chips from the parsed persona.
  When there are no signals (or persona is empty), replace the chip row with a
  muted CTA: "No persona notes yet — add some in Settings → Profile" linking to
  `/settings`.
- **`PersonaCrest`** — unchanged (decorative); optionally `pulse` while
  `usePersona()` is loading.
- Delete the `REPORT_PERSONA` constant.

### States

- **Loading** — while `usePersona()` / `useMe()` resolve, show the crest in a quiet
  state and neutral placeholder text; do not flash "Alice".
- **Unset persona** — invitation copy + Settings link (above).
- **Populated** — real name + summary + up to 4 signal chips.

## Risk / edge notes

- Persona content is user-authored markdown of arbitrary shape; the parser must be
  defensive (no assumption of headings or bullets) and always degrade to the unset
  affordance rather than throwing.
- `display_name` may be null (users who never set one) → fall back to "you" /
  email-free generic copy; never render `null`.

## Testing

- Unit-test `parsePersona`: prose-only (summary, no signals), bullets-only,
  mixed, dated `persona:append` bullets (date stamp stripped), empty/whitespace.
- Manual: Reports page with (a) a populated persona, (b) a bullet-only persona,
  (c) no persona set — confirm name, basis, signals, and the empty-state CTA each
  render correctly and the Settings link navigates to Profile.

## Files touched

- Edit: `pages/Reports/index.tsx`
- New (small): `parsePersona` helper in `hooks/usePersona.ts` or `lib/persona.ts` + test
- No backend changes.
