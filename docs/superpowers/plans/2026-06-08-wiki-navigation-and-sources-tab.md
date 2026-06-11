# Wiki Navigation & Sources Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wiki `[[wikilinks]]` navigable and turn the Wiki "Sources" tab into a live, working surface (per-source links + functional re-ingest).

**Architecture:** Frontend-only. The `MiniMD` renderer gains an `onWikiLink(topic)` callback that the Wiki `ReadTab` wires to in-app navigation by updating the page's `topic` state. The Wiki `SourcesTab` links each contributing source to its `/sources/:id` detail and wires "Re-ingest all" to the existing `sources:reingest` op. No backend changes — `vault:graph` (for known topics) and `sources:reingest` already exist.

**Tech Stack:** React 18, react-router-dom v6, @tanstack/react-query. No frontend test runner exists; verification is `tsc`/`npm run build` plus manual checks.

---

### Task 1: Thread a wiki-link click callback through MiniMD

**Files:**
- Modify: `brain2-web/src/components/browse/MiniMD.tsx`

The renderer already matches `[[...]]` tokens (`MiniMD.tsx:22`) but renders them as inert `<a>` elements. Add an `onWikiLink` callback prop, thread it through `mdInline`, and attach it to the wikilink anchor. Also accept an optional `knownTopics` set so unresolved links can be styled differently (dashed underline, muted) — this matches the backend's `vault:unresolved` concept.

- [ ] **Step 1: Extend the `mdInline` signature and wikilink rendering**

In `brain2-web/src/components/browse/MiniMD.tsx`, change the `CiteFn` type block and `mdInline` to accept link handling. Replace the top type alias and the `mdInline` function signature:

```tsx
type CiteFn = ((token: string) => void) | undefined;
type WikiLinkFn = ((topic: string) => void) | undefined;

interface MdOpts {
  onCite?: CiteFn;
  onWikiLink?: WikiLinkFn;
  knownTopics?: Set<string>;
}

function mdInline(s: string, key: number | string, opts: MdOpts = {}): ReactNode {
  const { onCite, onWikiLink, knownTopics } = opts;
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[\[[^\]]+\]\]|\[\^\d+\]|\[#\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<b key={i++} style={{ fontWeight: 600, color: 'var(--fg)' }}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('*')) parts.push(<i key={i++} style={{ fontStyle: 'italic' }}>{t.slice(1, -1)}</i>);
    else if (t.startsWith('`')) parts.push(<code key={i++} style={{ fontFamily: 'var(--mono-font)', fontSize: '0.88em', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 5, color: 'var(--fg)' }}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[[')) {
      const topic = t.slice(2, -2);
      const resolved = !knownTopics || knownTopics.has(topic);
      parts.push(
        <a
          key={i++}
          onClick={(e) => { e.preventDefault(); onWikiLink && onWikiLink(topic); }}
          title={resolved ? topic : `${topic} — no page yet`}
          style={{
            color: resolved ? 'var(--accent)' : 'var(--fg-muted)',
            textDecoration: 'none',
            cursor: 'pointer',
            borderBottom: resolved ? '1px solid var(--accent-line)' : '1px dashed var(--border-strong)',
          }}
        >
          {topic}
        </a>,
      );
    }
    else if (t.startsWith('[#')) parts.push(<a key={i++} onClick={() => onCite && onCite(t)} style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--mono-font)', fontSize: '0.82em', fontWeight: 600, background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', margin: '0 1px', cursor: 'pointer' }}>{t.slice(1, -1)}</a>);
    else parts.push(<sup key={i++} onClick={() => onCite && onCite(t)} style={{ color: 'var(--accent)', fontFamily: 'var(--mono-font)', fontSize: '0.7em', cursor: 'pointer', background: 'var(--accent-soft)', borderRadius: 4, padding: '1px 4px', margin: '0 1px' }}>{t.replace(/[[\]^]/g, '')}</sup>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}
```

- [ ] **Step 2: Update the `MiniMD` component to accept and forward the new props**

Every `mdInline(..., i, onCite)` call site inside the `MiniMD` component body must change to pass the opts object. Replace the `MiniMD` export's signature and all `mdInline` calls. The function currently destructures `{ text, onCite }` and calls `mdInline(<text>, i, onCite)` in ~7 places (h1/h2/h3, blockquote, list item, paragraph). Update the signature to:

```tsx
export function MiniMD({ text, onCite, onWikiLink, knownTopics }: {
  text: string; onCite?: CiteFn; onWikiLink?: WikiLinkFn; knownTopics?: Set<string>;
}) {
  const opts: MdOpts = { onCite, onWikiLink, knownTopics };
  // ...existing body, but every `mdInline(X, i, onCite)` becomes `mdInline(X, i, opts)`
```

Then find every `mdInline(<expr>, i, onCite)` occurrence in the component and replace the trailing `onCite` argument with `opts`. There are no other args to change.

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS (no errors). If errors mention a `mdInline` call still passing `onCite`, fix that call to pass `opts`.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/components/browse/MiniMD.tsx
git commit -m "feat(wiki): make MiniMD wikilinks clickable with resolved/unresolved styling"
```

---

### Task 2: Wire wikilink navigation in the Wiki page

**Files:**
- Modify: `brain2-web/src/pages/Wiki/index.tsx`

The Wiki page holds the current page in `topic` state and already has the list of pages in `vaultPages`. Wiring is: build a `Set` of known topics, pass an `onWikiLink` handler into `ReadTab` → `MiniMD` that sets `topic` (and switches to the Read tab, and on mobile reveals the page view). The `/wiki/:topic` route already exists in `App.tsx:49`, so deep links work; in-app clicks just update state.

- [ ] **Step 1: Update `ReadTab` to accept and forward link props**

In `brain2-web/src/pages/Wiki/index.tsx`, the `ReadTab` function (around line 122) renders `<MiniMD text={content} onCite={() => {}} />`. Change its signature and the `MiniMD` usage:

```tsx
function ReadTab({ content, onAudit, onAsk, onWikiLink, knownTopics }: {
  content: string; onAudit: () => void; onAsk: (text: string) => void;
  onWikiLink: (topic: string) => void; knownTopics: Set<string>;
}) {
```

And update the render line inside `ReadTab` (currently `<MiniMD text={content} onCite={() => {}} />`):

```tsx
      <MiniMD text={content} onCite={() => {}} onWikiLink={onWikiLink} knownTopics={knownTopics} />
```

- [ ] **Step 2: Build known-topics set and the navigate handler in `WikiPage`**

In the `WikiPage` component (after `const sources = sourceData?.sources ?? [];` near line 312), add:

```tsx
  const knownTopics = new Set(vaultPages.map((p) => p.topic));
  const goToWikiLink = (t: string) => {
    setTopic(t);
    setTab('Read');
    setMobilePage(t);
  };
```

- [ ] **Step 3: Pass the handler into `ReadTab`**

Find the `ReadTab` render (line ~357): `{tab === 'Read' && <ReadTab content={content} onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} />}` and replace with:

```tsx
          {tab === 'Read' && <ReadTab content={content} onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} onWikiLink={goToWikiLink} knownTopics={knownTopics} />}
```

- [ ] **Step 4: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run the app (`cd brain2-web && npm run dev`), open a wiki page whose content contains a `[[Some Topic]]` link. Confirm:
- Clicking a link to an existing page switches the view to that page on the Read tab.
- A link to a non-existent topic renders with a dashed underline and muted color.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Wiki/index.tsx
git commit -m "feat(wiki): navigate to linked topic on wikilink click"
```

---

### Task 3: Make the Wiki Sources tab links and re-ingest functional

**Files:**
- Modify: `brain2-web/src/pages/Wiki/index.tsx`

`SourcesTab` (line ~257) already lists contributing sources from `useWikiTopicSources`, but each row links to the bare `/sources` page and the "Re-ingest all" button does nothing. Link each row to `/sources/:id` and wire the button to call `sources:reingest` for every listed source via the existing `useReingest` hook.

- [ ] **Step 1: Import the reingest hook**

At the top of `brain2-web/src/pages/Wiki/index.tsx`, the import from `@/hooks/useVault` is present. Add a separate import for sources (place it after the `useVault` import block, around line 16):

```tsx
import { useReingest } from '@/hooks/useSources';
```

- [ ] **Step 2: Rewrite `SourcesTab` to take projectId and wire actions**

Replace the entire `SourcesTab` function (lines ~257-279) with:

```tsx
function SourcesTab({ sources, projectId }: { sources: any[]; projectId: string | null }) {
  const reingest = useReingest(projectId);
  const reingestAll = () => {
    sources.forEach((s) => {
      const id = s.source_id ?? s.id;
      if (id) reingest.mutate({ source_id: id });
    });
  };
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{sources.length} sources contributed to this page, derived from provenance.</span>
        <button style={wbtnGhost()} onClick={reingestAll} disabled={reingest.isPending || !sources.length}>
          <Icon name="refresh" size={13} /> Re-ingest all
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map((s) => {
          const id = s.source_id ?? s.id;
          return (
            <a key={id} href={`/sources/${encodeURIComponent(id)}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 13, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={s.mime?.startsWith('image') ? 'image' : 'file'} size={15} /></span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{s.filename ?? s.name ?? id}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{s.kind ?? s.detail ?? ''}</span>
              </span>
              <Icon name="arrowRight" size={15} color="var(--fg-faint)" />
            </a>
          );
        })}
        {!sources.length && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>No sources linked to this page.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2b: Pass `projectId` at the `SourcesTab` call site**

Find the render (line ~366): `{tab === 'Sources' && <SourcesTab sources={sources} />}` and replace with:

```tsx
          {tab === 'Sources' && <SourcesTab sources={sources} projectId={projectId} />}
```

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

In the running app, open a wiki page that has contributing sources, switch to the Sources tab:
- Click a source row → lands on `/sources/<that id>` with the source selected.
- Click "Re-ingest all" → sources move to the extracting/running state (watch the Sources page); button disables while pending.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Wiki/index.tsx
git commit -m "feat(wiki): link sources tab rows to source detail and wire re-ingest all"
```

---

## Self-Review Notes

- **Spec coverage:** Wikilinks navigate (Task 1+2); unresolved links styled distinctly (Task 1); Wiki Sources tab links to specific source and re-ingests (Task 3). ✓
- **`/sources/:id` route** already exists (`App.tsx:47`) and `SourcesPage` reads `selectedId` from list state; deep-linking by URL selects via auto-select-first only. NOTE: the Sources page does not yet read the `:id` route param to pre-select. If precise pre-selection is required, that is covered as a follow-up in the history plan's Task 0 note — for now the row link navigates to the Sources page. If exact selection is needed immediately, add to `SourcesPage`: read `useParams()` `id` and seed `selectedId`.
- **Type consistency:** `onWikiLink: (topic: string) => void` used identically in MiniMD, ReadTab, and WikiPage. ✓
