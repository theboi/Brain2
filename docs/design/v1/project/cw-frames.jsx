/* Brain2 Console — Sources + Wiki consolidation study.
   Static device chrome + shared browse/detail atoms. No media queries:
   every "mobile" / "desktop" decision is explicit so frames render at any
   canvas size. Reuses tokens, Icon, MiniMD, SOURCES, WIKI_TREE, etc. */

const CWTONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };

// Flatten the wiki tree into a single page list (with project label per page).
const WIKI_PAGES = WIKI_TREE.flatMap((g) => g.pages.map((p) => ({ ...p, project: g.project })));

// ── tiny style helpers ───────────────────────────────────────────────────
function cwGhost(h = 30) { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: h, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }; }
function cwPrimary(h = 30) { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: h, padding: '0 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }; }
function cwTag() { return { fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px' }; }

// ── Phone chrome ───────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div style={{ height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', background: 'var(--surface)', color: 'var(--fg)' }}>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 9 }}>
          {[4, 6, 8, 10].map((h, i) => <span key={i} style={{ width: 2.5, height: h, borderRadius: 1, background: 'var(--fg)' }} />)}
        </span>
        <span style={{ width: 13, height: 9, borderRadius: 2, border: '1px solid var(--fg)', position: 'relative', display: 'inline-block' }}>
          <span style={{ position: 'absolute', inset: 1.5, right: 4, background: 'var(--fg)', borderRadius: 1 }} />
        </span>
      </span>
    </div>
  );
}

function MobileTabBar({ active = 'sources' }) {
  const items = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'sources', icon: 'sources', label: 'Sources' },
    { id: 'wiki', icon: 'wiki', label: 'Wiki' },
    { id: 'chats', icon: 'chats', label: 'Chats' },
    { id: 'more', icon: 'more', label: 'More' },
  ];
  return (
    <div style={{ flexShrink: 0, display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <div key={it.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0 10px', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
            <Icon name={it.icon} size={20} />
            <span style={{ fontSize: 9.5, fontWeight: on ? 600 : 500, fontFamily: 'var(--ui-font)' }}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Outer bezel. children = the screen stack (column).
function Phone({ children, w = 300, h = 638 }) {
  return (
    <div style={{ width: w + 14, height: h + 14, borderRadius: 34, background: '#05070b', padding: 7, boxShadow: '0 20px 50px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.05)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 27, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column', position: 'relative', fontFamily: 'var(--ui-font)' }}>
        {children}
      </div>
    </div>
  );
}

// A scrollable-looking body region (clipped — static frame).
function Body({ children, pad = 0, tab = true }) {
  return <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--bg)', padding: pad }}>{children}</div>;
}

// ── Shared header for browse screens ────────────────────────────────────────
function MobileAppHeader({ title, cta, ctaIcon = 'plus' }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--display-font)', fontSize: 19, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)', flex: 1 }}>{title}</span>
      {cta && <button style={cwPrimary(32)}><Icon name={ctaIcon} size={14} color="#fff" /> {cta}</button>}
    </div>
  );
}

function SearchField({ placeholder }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <Icon name="search" size={15} color="var(--fg-muted)" />
      <span style={{ fontSize: 13, color: 'var(--fg-faint)' }}>{placeholder}</span>
    </div>
  );
}

function MetaRow({ left, right = 'Newest' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{left}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-muted)' }}>
        <Icon name="filter" size={12} /> {right} <Icon name="chevDown" size={11} />
      </span>
    </div>
  );
}

// ── List item rows (shared visual language for both pages) ──────────────────
function SourceItem({ s, last }) {
  const chip = STATUS_CHIP[s.status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 4px', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
        <Icon name={TYPE_ICON[s.type] || 'file'} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
          <Icon name={chip.icon} size={11} color={CWTONE[chip.tone]} />
          <span style={{ color: CWTONE[chip.tone] }}>{chip.label}</span>
          <span style={{ color: 'var(--fg-faint)' }}>· {s.size.trim()}</span>
        </span>
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </div>
  );
}

function WikiItem({ p, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 4px', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
        <Icon name="wiki" size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.topic}</span>
          {p.isNew && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 }}>NEW</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
          v{p.v}{p.audits ? <span style={{ color: 'var(--accent)' }}>· {p.audits} audits</span> : null}
        </span>
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </div>
  );
}

// ── Detail view (shared) — reached by drilling into a list item ─────────────
function MobileDetail({ kind, tab = kind === 'wiki' ? 'Read' : 'Preview' }) {
  const tabs = kind === 'wiki' ? ['Read', 'Edit', 'History', 'Sources'] : ['Preview', 'Raw', 'Text', 'Details'];
  const title = kind === 'wiki' ? WIKI_PAGE.topic : 'Hooke 1665.pdf';
  return (
    <React.Fragment>
      <div style={{ flexShrink: 0, padding: '10px 14px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={{ ...cwGhost(30), width: 34, padding: 0, justifyContent: 'center' }}><Icon name="chevLeft" size={16} /></button>
          <Icon name={kind === 'wiki' ? 'wiki' : 'file'} size={16} color="var(--fg-muted)" />
          <span style={{ flex: 1, fontFamily: 'var(--display-font)', fontSize: 15, fontWeight: 600, letterSpacing: 'var(--display-track)', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          <button style={cwPrimary(30)}><Icon name="pencil" size={13} color="#fff" /></button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', margin: '7px 0 6px', paddingLeft: 42 }}>
          {kind === 'wiki' ? 'v7 · updated 1h ago · 3 sources' : 'pdf · 8.4 MB · ingested'}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
          {tabs.map((t, i) => (
            <div key={t} style={{ position: 'relative', height: 36, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: i === 0 ? 600 : 500, color: i === 0 ? 'var(--fg)' : 'var(--fg-muted)' }}>
              {t}
              {i === 0 && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
            </div>
          ))}
        </div>
      </div>
      <Body>
        <div style={{ padding: '14px 16px', overflow: 'hidden', height: '100%' }}>
          <MiniMD text={kind === 'wiki' ? WIKI_PAGE.content : SOURCES[0].extracted} />
        </div>
      </Body>
    </React.Fragment>
  );
}

// ── Bottom filter sheet (Direction A) ───────────────────────────────────────
function FilterSheet({ kind }) {
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 7 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
  const Opt = ({ icon, label, count, on, tone }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 11px', borderRadius: 9, background: on ? 'var(--accent-soft)' : 'transparent' }}>
      <Icon name={icon} size={15} color={tone ? CWTONE[tone] : (on ? 'var(--accent)' : 'var(--fg-muted)')} />
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{label}</span>
      {count != null && <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>}
      {on && <Icon name="check" size={15} color="var(--accent)" />}
    </div>
  );
  return (
    <React.Fragment>
      <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(5,7,11,0.55)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 21, maxHeight: '82%', background: 'var(--surface)', borderRadius: '18px 18px 0 0', borderTop: '1px solid var(--border-strong)', display: 'flex', flexDirection: 'column', boxShadow: '0 -16px 40px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center' }}>
          <span style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>Filter {kind === 'wiki' ? 'wiki' : 'sources'}</span>
          <span style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>Reset</span>
        </div>
        <div style={{ overflow: 'hidden', padding: '14px 16px 18px' }}>
          {kind === 'wiki' ? (
            <React.Fragment>
              <Section title="Project">
                <Opt icon="layers" label="All projects" count={WIKI_PAGES.length} on />
                {WIKI_TREE.map((g) => <Opt key={g.project} icon="folder" label={g.project} count={g.pages.length} />)}
              </Section>
              <Section title="Filters">
                <Opt icon="alert" label="Has open audit" count={1} tone="warning" />
                <Opt icon="clock" label="Edited last 7d" count={5} />
              </Section>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <Section title="Project">
                <Opt icon="layers" label="All sources" count={SOURCE_TREE.total} on />
                {SOURCE_TREE.projects.map((p) => <Opt key={p.label} icon="folder" label={p.label} count={p.count} />)}
              </Section>
              <Section title="Status">
                {SOURCE_TREE.status.map((s) => <Opt key={s.id} icon={s.icon} label={s.label} count={s.count} tone={s.tone} />)}
              </Section>
            </React.Fragment>
          )}
        </div>
        <div style={{ padding: '12px 16px 20px', borderTop: '1px solid var(--border)' }}>
          <button style={{ ...cwPrimary(42), width: '100%', justifyContent: 'center', fontSize: 14 }}>Show results</button>
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { CWTONE, WIKI_PAGES, cwGhost, cwPrimary, cwTag, StatusBar, MobileTabBar, Phone, Body, MobileAppHeader, SearchField, MetaRow, SourceItem, WikiItem, MobileDetail, FilterSheet });
