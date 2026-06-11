# Reports Persona Banner — Live Persona Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reports page's hardcoded "Alice" persona with the real signed-in user's name and a summary + signal chips derived from the live `persona:get` document.

**Architecture:** Add one pure helper (`lib/persona.ts` `parsePersona`) that turns the freeform persona markdown into a `{ summary, signals, isEmpty }` view-model, then wire `ReportsPage` to `useMe()` + the existing `usePersona()` hook and thread the derived values into the header, banner, and "Persona signals" panel, with an unset-state CTA linking to Settings. No backend changes; suggested-report cards and the catalog stay hardcoded (no recommendation backend).

**Tech Stack:** TypeScript, React, `@tanstack/react-query`, `react-router-dom`, Vitest. Spec: `docs/superpowers/specs/2026-06-11-reports-persona-banner-design.md`.

**Pre-flight:** Work on a feature branch (e.g. `git checkout -b feat/reports-persona`). Run commands from `brain2-web/`.

---

### Task 1: `parsePersona` helper

**Files:**
- Create: `brain2-web/src/lib/persona.ts`
- Test: `brain2-web/src/lib/persona.test.ts`

The persona is freeform markdown. `persona:set` stores prose; `persona:append` adds dated `- [YYYY-MM-DD] note` bullets. Derive the lead summary line and bullet "signals" defensively.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/persona.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePersona } from './persona';

describe('parsePersona', () => {
  it('treats empty/whitespace content as unset', () => {
    expect(parsePersona('')).toEqual({ summary: '', signals: [], isEmpty: true });
    expect(parsePersona('   \n  ')).toEqual({ summary: '', signals: [], isEmpty: true });
  });

  it('uses the first non-bullet line as the summary, stripping heading marks', () => {
    const parsed = parsePersona('# Operations lead\nfocused on finance');
    expect(parsed.summary).toBe('Operations lead');
    expect(parsed.signals).toEqual([]);
    expect(parsed.isEmpty).toBe(false);
  });

  it('collects bullet lines as signals, stripping markers and append date stamps', () => {
    const content = [
      'Finance & ops lead.',
      '- [2026-06-08] Owns 12 finance sources',
      '* Opens Q2 docs daily',
    ].join('\n');
    const parsed = parsePersona(content);
    expect(parsed.summary).toBe('Finance & ops lead.');
    expect(parsed.signals).toEqual(['Owns 12 finance sources', 'Opens Q2 docs daily']);
  });

  it('caps signals at four', () => {
    const content = ['lead', '- a', '- b', '- c', '- d', '- e'].join('\n');
    expect(parsePersona(content).signals).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles a bullets-only document (no summary)', () => {
    const parsed = parsePersona('- only a note');
    expect(parsed.summary).toBe('');
    expect(parsed.signals).toEqual(['only a note']);
    expect(parsed.isEmpty).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/persona.test.ts`
Expected: FAIL — `Failed to resolve import "./persona"`.

- [ ] **Step 3: Implement**

Create `brain2-web/src/lib/persona.ts`:

```ts
/* Parse the freeform persona markdown into a small view-model for the Reports banner. */

export interface ParsedPersona {
  summary: string;
  signals: string[];
  isEmpty: boolean;
}

const BULLET = /^[-*]\s+/;
const APPEND_DATE = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

export function parsePersona(content: string): ParsedPersona {
  const text = (content ?? '').trim();
  if (!text) return { summary: '', signals: [], isEmpty: true };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const summaryLine = lines.find((l) => !BULLET.test(l)) ?? '';
  const summary = summaryLine.replace(/^#+\s*/, '').slice(0, 120);

  const signals = lines
    .filter((l) => BULLET.test(l))
    .map((l) => l.replace(BULLET, '').replace(APPEND_DATE, '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return { summary, signals, isEmpty: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/persona.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/persona.ts brain2-web/src/lib/persona.test.ts
git commit -m "feat(web): add parsePersona view-model helper"
```

---

### Task 2: Wire the Reports persona banner to live data

**Files:**
- Modify: `brain2-web/src/pages/Reports/index.tsx`

- [ ] **Step 1: Add imports**

At the top of `brain2-web/src/pages/Reports/index.tsx`, add to the import block:

```ts
import { Link } from 'react-router-dom';
import { useMe } from '@/hooks/me';
import { usePersona } from '@/hooks/usePersona';
import { parsePersona } from '@/lib/persona';
```

- [ ] **Step 2: Delete the hardcoded persona constant**

Remove the entire constant:

```ts
const REPORT_PERSONA = {
  name: 'Alice',
  role: 'Operations & Finance Lead',
  basis: 'Tuned to your role, the sources you own, and what you open most',
  signals: ['Owns 12 finance sources', 'Opens Q2 docs daily', 'Board meeting in 6 days'],
};
```

- [ ] **Step 3: Derive live persona values in ReportsPage**

In `export function ReportsPage()`, immediately after `const { projectId } = useWorkspace();`, add:

```tsx
  const me = useMe().data;
  const persona = usePersona();
  const parsed = parsePersona(persona.data?.content ?? '');
  const displayName = me?.display_name?.trim() || 'you';
  const firstName = displayName.split(/\s+/)[0];
```

- [ ] **Step 4: Update the "Suggested for ..." section label**

Replace:

```tsx
                Suggested for {REPORT_PERSONA.name}
```

with:

```tsx
                Suggested for {firstName}
```

- [ ] **Step 5: Replace the persona banner line**

Replace this block in the header:

```tsx
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
              <PersonaCrest size={26} />
              <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>
                Tuned for <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{REPORT_PERSONA.name}</b> · {REPORT_PERSONA.role} — {REPORT_PERSONA.basis}
              </span>
            </div>
```

with:

```tsx
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
              <PersonaCrest size={26} pulse={persona.isLoading} />
              {parsed.isEmpty ? (
                <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>
                  <Link to="/settings" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Set up your persona</Link> to tailor these suggestions.
                </span>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>
                  Tuned for <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{displayName}</b>{parsed.summary ? <> — {parsed.summary}</> : null}
                </span>
              )}
            </div>
```

- [ ] **Step 6: Replace the "Persona signals" panel body**

Replace:

```tsx
              <Panel title="Persona signals">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REPORT_PERSONA.signals.map((signal) => (
                    <span key={signal} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} /> {signal}
                    </span>
                  ))}
                </div>
              </Panel>
```

with:

```tsx
              <Panel title="Persona signals">
                {parsed.signals.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {parsed.signals.map((signal) => (
                      <span key={signal} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} /> {signal}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--fg-faint)', lineHeight: 1.5 }}>
                    No persona notes yet — add some in <Link to="/settings" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Settings → Profile</Link>.
                  </div>
                )}
              </Panel>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b`
Expected: no errors. (If TypeScript flags `PersonaCrest`'s `pulse` prop, confirm its signature is `{ size?: number; pulse?: boolean }` in the same file — it is — and that the prop is spelled `pulse`.)

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(web): wire Reports persona banner to live persona"
```

---

### Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the hardcoded persona is fully gone**

Run: `cd brain2-web && grep -rn "REPORT_PERSONA" src`
Expected: no matches.

- [ ] **Step 2: Full typecheck + tests + build**

Run: `cd brain2-web && npx tsc -b && npx vitest run && npm run build`
Expected: tsc clean; all Vitest suites pass (including `persona.test.ts`); production build succeeds.

- [ ] **Step 3: Manual verification**

Start the app and open Reports for three persona states:
- **Populated persona** (set one in Settings → Profile first): banner reads "Tuned for {your name} — {summary}", and the signals panel shows up to four chips.
- **Bullets-only persona**: banner shows the name with no summary suffix; chips render from the bullets (date stamps stripped).
- **No persona set**: banner shows "Set up your persona to tailor these suggestions" and the signals panel shows the "add some in Settings → Profile" CTA; both links navigate to Settings.
- In every case the header reads "Suggested for {first name}", never "Alice".

- [ ] **Step 4: (No commit)** — verification only; nothing to commit if all checks pass.

---

## Self-Review Notes

- **Spec coverage:** real name from `useMe` (Task 2 Steps 3-4), banner summary from parsed persona (Task 2 Step 5), signal chips from parsed bullets (Task 2 Step 6), unset-state CTAs to Settings (Task 2 Steps 5-6), loading pulse on the crest (Task 2 Step 5), `parsePersona` defensiveness incl. dated bullets and bullets-only (Task 1). Suggested cards/catalog untouched (non-goal). All covered.
- **Placeholder scan:** every step shows the exact code/command; no TBD/TODO.
- **Type consistency:** `ParsedPersona` defined in Task 1 and consumed in Task 2; `usePersona()` returns `{ content, updated_at }` per `hooks/usePersona.ts`, read as `persona.data?.content`; `useMe()` returns `display_name: string | null` per `lib/types.ts`, guarded with `?.trim() || 'you'`.
