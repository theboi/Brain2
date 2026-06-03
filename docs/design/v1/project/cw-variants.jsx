/* Brain2 Console — Sources + Wiki consolidation: three directions.
   Each direction renders the SAME shell; only the scope/filter region
   differs. Both pages drill list → detail with a back button. */

// ── Scope atoms ─────────────────────────────────────────────────────────────

// A · full-width breadcrumb summary that opens the filter sheet.
function ScopeButton({ segments }) {
  return (
    <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
      {segments.map((sg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Icon name="chevRight" size={12} color="var(--fg-faint)" />}
          <Icon name={sg.icon} size={14} color={sg.tone ? CWTONE[sg.tone] : 'var(--fg-muted)'} />
          <span style={{ fontSize: 13, fontWeight: 600, color: sg.tone ? CWTONE[sg.tone] : 'var(--fg)' }}>{sg.label}</span>
          {sg.count != null && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{sg.count}</span>}
        </React.Fragment>
      ))}
      <span style={{ flex: 1 }} />
      <Icon name="sliders" size={15} color="var(--fg-muted)" />
    </button>
  );
}

// B · horizontally scrollable filter chips, current selection always visible.
function ChipRail({ chips }) {
  return (
    <div className="b2-tabscroll" style={{ display: 'flex', gap: 8, overflowX: 'hidden', margin: '0 -16px', padding: '0 16px' }}>
      {chips.map((c, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 999, flexShrink: 0, whiteSpace: 'nowrap',
          border: `1px solid ${c.on ? 'transparent' : 'var(--border)'}`, background: c.on ? 'var(--accent)' : 'var(--surface)', color: c.on ? '#fff' : 'var(--fg-muted)', fontSize: 12.5, fontWeight: c.on ? 600 : 500 }}>
          {c.icon && <Icon name={c.icon} size={13} color={c.on ? '#fff' : (c.tone ? CWTONE[c.tone] : 'var(--fg-muted)')} />}
          {c.label}
          {c.count != null && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', opacity: 0.8 }}>{c.count}</span>}
        </span>
      ))}
    </div>
  );
}

// B · filter DROPDOWN chip — label shows the current selection; chevron signals it opens a menu.
const SOFT = { accent: 'var(--accent-soft)', warning: 'var(--warning-soft)', success: 'var(--success-soft)', destructive: 'var(--destructive-soft)', muted: 'var(--surface-2)' };
function FilterChip({ icon, label, on, tone, size = 'm' }) {
  const c = on ? (tone ? CWTONE[tone] : 'var(--accent)') : 'var(--fg-muted)';
  const bg = on ? (tone ? SOFT[tone] : 'var(--accent-soft)') : 'var(--surface)';
  const bd = on ? (tone ? CWTONE[tone] : 'var(--accent-line)') : 'var(--border)';
  const s = size === 's';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: s ? 5 : 6, height: s ? 27 : 33, padding: s ? '0 9px' : '0 11px', borderRadius: 9, flexShrink: 0, whiteSpace: 'nowrap', cursor: 'pointer',
      border: `1px solid ${bd}`, background: bg, color: c, fontSize: s ? 11.5 : 12.5, fontWeight: on ? 600 : 500, fontFamily: 'var(--ui-font)' }}>
      {icon && <Icon name={icon} size={s ? 12 : 13} color={c} />}
      {label}
      <Icon name="chevDown" size={s ? 11 : 12} color={c} />
    </span>
  );
}
function DropdownChipRow({ chips, size = 'm' }) {
  return <div className="b2-tabscroll" style={{ display: 'flex', gap: 8, overflowX: 'hidden', flexWrap: size === 's' ? 'wrap' : 'nowrap' }}>{chips.map((c, i) => <FilterChip key={i} {...c} size={size} />)}</div>;
}
// Open dropdown panel (shows that a chip is a selector).
function ChipMenu({ title, options, top, left, width = 168 }) {
  return (
    <React.Fragment>
      <div style={{ position: 'absolute', inset: 0, zIndex: 18, background: 'rgba(5,7,11,0.35)' }} />
      <div style={{ position: 'absolute', top, left, width, zIndex: 19, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.42)', padding: 6 }}>
        {title && <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>{title}</div>}
        {options.map((o, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 9px', borderRadius: 8, background: o.on ? 'var(--accent-soft)' : 'transparent' }}>
            <Icon name={o.icon || 'dot'} size={14} color={o.tone ? CWTONE[o.tone] : (o.on ? 'var(--accent)' : 'var(--fg-muted)')} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: o.on ? 600 : 500, color: o.on ? 'var(--fg)' : 'var(--fg-muted)' }}>{o.label}</span>
            {o.count != null && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{o.count}</span>}
            {o.on && <Icon name="check" size={14} color="var(--accent)" />}
          </div>
        ))}
      </div>
    </React.Fragment>
  );
}

// C · grouped collapsible section header.
function GroupHeader({ icon = 'folder', label, count, open = true, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px 7px' }}>
      <Icon name={open ? 'chevDown' : 'chevRight'} size={13} color="var(--fg-muted)" />
      <Icon name={icon} size={14} color="var(--fg-muted)" />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg)', letterSpacing: '0.01em' }}>{label}</span>
      {sub && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{sub}</span>}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>
    </div>
  );
}

// ── MOBILE SCREENS ───────────────────────────────────────────────────────────
function MobileScroll({ children }) {
  return <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}><div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div></div>;
}

function SourcesMobile({ dir, sheet, menu }) {
  const list = SOURCES.slice(0, 7);
  let scope;
  if (dir === 'A') scope = <ScopeButton segments={[{ icon: 'folder', label: 'default' }, { icon: 'alert', label: 'Failed', tone: 'warning', count: 7 }]} />;
  else if (dir === 'B') scope = <DropdownChipRow chips={[{ icon: 'folder', label: 'default', on: true }, { icon: 'tag', label: 'All tags' }, { icon: 'layers', label: 'All status' }]} />;
  const grouped = dir === 'C';
  return (
    <Phone>
      <StatusBar />
      <MobileAppHeader title="Sources" cta="Ingest" />
      <Body>
        <MobileScroll>
          {scope}
          <SearchField placeholder="Search sources…" />
          {!grouped && <MetaRow left={dir === 'A' ? '7 failed sources' : '1,284 sources'} />}
          {grouped ? (
            <div>
              {SOURCE_TREE.projects.slice(0, 2).map((p, gi) => (
                <div key={p.label}>
                  <GroupHeader label={p.label} count={p.count} sub={gi === 0 ? '1 failed' : null} />
                  <div style={{ paddingLeft: 2 }}>
                    {SOURCES.slice(gi * 2, gi * 2 + (gi === 0 ? 3 : 2)).map((s, i, a) => <SourceItem key={s.id} s={s} last={i === a.length - 1} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>{list.map((s, i) => <SourceItem key={s.id} s={s} last={i === list.length - 1} />)}</div>
          )}
        </MobileScroll>
      </Body>
      <MobileTabBar active="sources" />
      {sheet && <FilterSheet kind="sources" />}
      {menu === 'status' && <ChipMenu title="Status" top={144} left={120} options={[{ icon: 'layers', label: 'All status', on: true }, { icon: 'dot', label: 'pending', count: 3, tone: 'muted' }, { icon: 'loader', label: 'running', count: 1, tone: 'accent' }, { icon: 'check', label: 'done', count: 1273, tone: 'success' }, { icon: 'alert', label: 'failed', count: 7, tone: 'warning' }]} />}
    </Phone>
  );
}

function WikiMobile({ dir }) {
  let scope;
  if (dir === 'A') scope = <ScopeButton segments={[{ icon: 'layers', label: 'All projects', count: WIKI_PAGES.length }]} />;
  else if (dir === 'B') scope = <DropdownChipRow chips={[{ icon: 'layers', label: 'All projects', on: true }, { icon: 'sliders', label: 'Filters' }]} />;
  const grouped = dir === 'C';
  return (
    <Phone>
      <StatusBar />
      <MobileAppHeader title="Wiki" cta="New" />
      <Body>
        <MobileScroll>
          {scope}
          <SearchField placeholder="Search wiki…" />
          {!grouped && <MetaRow left={`${WIKI_PAGES.length} pages`} right="Recent" />}
          {grouped ? (
            <div>
              {WIKI_TREE.map((g) => (
                <div key={g.project}>
                  <GroupHeader label={g.project} count={g.pages.length} />
                  <div style={{ paddingLeft: 2 }}>{g.pages.map((p, i) => <WikiItem key={p.topic} p={p} last={i === g.pages.length - 1} />)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div>{WIKI_PAGES.map((p, i) => <WikiItem key={p.topic} p={p} last={i === WIKI_PAGES.length - 1} />)}</div>
          )}
        </MobileScroll>
      </Body>
      <MobileTabBar active="wiki" />
    </Phone>
  );
}

function DetailPhone({ kind }) {
  return (
    <Phone>
      <StatusBar />
      <MobileDetail kind={kind} />
      <MobileTabBar active={kind} />
    </Phone>
  );
}

// ── DESKTOP SHELL ─────────────────────────────────────────────────────────────
function DeskTopBar() {
  return (
    <div style={{ height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 9, height: 9, background: 'var(--surface)', borderRadius: 2, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 15, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Brain2</span>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12.5 }}>
        <span style={{ color: 'var(--fg-muted)' }}>workspace</span><span style={{ color: 'var(--fg)', fontWeight: 500 }}>default</span><Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </span>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 360, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-muted)', fontSize: 13 }}>
          <Icon name="search" size={15} /><span style={{ flex: 1 }}>Search…</span><kbd style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 5px' }}>⌘K</kbd>
        </div>
      </div>
      <span style={{ width: 27, height: 27, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>A</span>
    </div>
  );
}

function DeskRail({ active }) {
  const items = [['home', 'home'], ['sources', 'sources'], ['wiki', 'wiki'], ['chats', 'chats'], ['reports', 'file'], ['plugins', 'plug']];
  return (
    <div style={{ width: 60, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 4 }}>
      {items.map(([id, icon]) => {
        const on = id === active;
        return (
          <div key={id} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 9, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
            {on && <span style={{ position: 'absolute', left: -8, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
            <Icon name={icon} size={19} />
          </div>
        );
      })}
    </div>
  );
}

// Browse sidebar — its filter presentation mirrors the mobile direction.
function DeskSidebar({ kind, dir }) {
  const head = (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
      <button style={{ ...cwPrimary(36), width: '100%', justifyContent: 'center', fontSize: 13 }}><Icon name="plus" size={14} color="#fff" /> {kind === 'wiki' ? 'New page' : 'Ingest sources'}</button>
    </div>
  );
  const TreeRow = ({ icon, label, count, on, tone, indent = 0 }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 32, padding: `0 10px 0 ${10 + indent * 12}px`, borderRadius: 7, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>
      <Icon name={icon} size={14} color={tone ? CWTONE[tone] : (on ? 'var(--accent)' : 'var(--fg-muted)')} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count != null && <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>}
    </div>
  );
  const Group = ({ title, children }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
  const projects = kind === 'wiki' ? WIKI_TREE.map((g) => ({ label: g.project, count: g.pages.length })) : SOURCE_TREE.projects;
  return (
    <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      {head}
      <div style={{ flex: 1, overflow: 'hidden', padding: '12px 8px' }}>
        <Group title="Projects">
          <TreeRow icon="layers" label={kind === 'wiki' ? 'All pages' : 'All sources'} count={kind === 'wiki' ? WIKI_PAGES.length : SOURCE_TREE.total} on={dir !== 'C'} />
          {projects.map((p) => <TreeRow key={p.label} icon="folder" label={p.label} count={p.count} on={dir === 'C' && p.label === 'default'} />)}
        </Group>
        {kind === 'wiki' ? (
          <Group title="Filters">
            <TreeRow icon="alert" label="Has open audit" count={1} tone="warning" />
            <TreeRow icon="clock" label="Edited last 7d" count={5} />
          </Group>
        ) : (
          <React.Fragment>
            <Group title="Tags">
              {SOURCE_TREE.tags.slice(0, 3).map((t) => <TreeRow key={t.label} icon="tag" label={t.label} count={t.count} />)}
            </Group>
            <Group title="Status">
              {SOURCE_TREE.status.map((s) => <TreeRow key={s.id} icon={s.icon} label={s.label} count={s.count} tone={s.tone} />)}
            </Group>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function DeskListHeader({ kind, count }) {
  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Icon name="search" size={15} color="var(--fg-muted)" /><span style={{ fontSize: 13, color: 'var(--fg-faint)' }}>{kind === 'wiki' ? 'Search wiki…' : 'Search sources…'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{count}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-muted)' }}><Icon name="filter" size={12} /> Newest <Icon name="chevDown" size={11} /></span>
      </div>
    </div>
  );
}

function DesktopApp({ kind, dir }) {
  const sources = SOURCES.slice(0, 8);
  return (
    <DeskRailShell active={kind}>
      <DeskSidebar kind={kind} dir={dir} />
      {kind === 'sources' ? (
        <React.Fragment>
          {/* list pane */}
          <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <DeskListHeader kind="sources" count="1,284 sources" />
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {sources.map((s, i) => (
                <div key={s.id} style={{ borderLeft: `2px solid ${i === 0 ? 'var(--accent)' : 'transparent'}`, background: i === 0 ? 'var(--accent-soft)' : 'transparent', padding: '2px 12px' }}>
                  <SourceItem s={s} last />
                </div>
              ))}
            </div>
          </div>
          <DeskDetail kind="sources" />
        </React.Fragment>
      ) : (
        <DeskDetail kind="wiki" dir={dir} />
      )}
    </DeskRailShell>
  );
}

function DeskRailShell({ active, children }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', overflow: 'hidden' }}>
      <DeskTopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <DeskRail active={active} />
        {children}
      </div>
    </div>
  );
}

function DeskDetail({ kind, dir }) {
  const tabs = kind === 'wiki' ? ['Read', 'Edit', 'History', 'Sources'] : ['Preview', 'Raw source', 'Extracted text', 'History', 'Details'];
  const title = kind === 'wiki' ? WIKI_PAGE.topic : 'Hooke 1665.pdf';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ padding: '14px 28px 0', borderBottom: '1px solid var(--border)' }}>
        {kind === 'wiki' && <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--fg-muted)', marginBottom: 9 }}>Wiki <span>›</span> {WIKI_PAGE.project} <span>›</span> <span style={{ color: 'var(--fg)' }}>{title}</span></div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Icon name={kind === 'wiki' ? 'wiki' : 'file'} size={18} color="var(--fg-muted)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: kind === 'wiki' ? 24 : 17, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{title}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={cwGhost()}><Icon name={kind === 'wiki' ? 'sparkles' : 'refresh'} size={14} /> {kind === 'wiki' ? 'Audit' : 'Re-ingest'}</button>
            <button style={cwPrimary()}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', margin: '8px 0 6px' }}>{kind === 'wiki' ? 'v7 · updated 1h ago by alice · 3 sources' : 'pdf · 8.4 MB · ingested · uploaded by alice'}</div>
        <div style={{ display: 'flex', gap: 18 }}>
          {tabs.map((t, i) => (
            <div key={t} style={{ position: 'relative', height: 40, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: i === 0 ? 600 : 500, color: i === 0 ? 'var(--fg)' : 'var(--fg-muted)' }}>
              {t}{i === 0 && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '22px 28px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}><MiniMD text={kind === 'wiki' ? WIKI_PAGE.content : SOURCES[0].extracted} /></div>
      </div>
    </div>
  );
}

function DesktopFrame({ kind, dir }) {
  if (dir === 'B') return <DesktopB kind={kind} />;
  return <DesktopApp kind={kind} dir={dir} />;
}

// ── DESKTOP · Direction B ────────────────────────────────────────────────────
// Consolidated to match the wiki page today: sidebar (small filter-dropdown
// chips + collapsible project tree) ▸ detail. No middle list pane, no chip rail
// in a list header (the sidebar already carries scope).
function ProjectHead({ label, count, open }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 8px', borderRadius: 7, cursor: 'pointer' }}>
      <Icon name={open ? 'chevDown' : 'chevRight'} size={12} color="var(--fg-muted)" />
      <Icon name="folder" size={13} color="var(--fg-muted)" />
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>
    </div>
  );
}
function NestedRow({ icon, label, on, tone, badge, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 31, padding: '0 10px 0 27px', borderRadius: 7, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>
      <Icon name={icon} size={13.5} color={tone ? CWTONE[tone] : (on ? 'var(--accent)' : 'var(--fg-faint)')} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {badge && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', letterSpacing: '0.04em' }}>{badge}</span>}
      {meta && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{meta}</span>}
    </div>
  );
}
function DeskSidebarB({ kind }) {
  const chips = kind === 'wiki'
    ? [{ icon: 'sliders', label: 'Filters' }]
    : [{ icon: 'tag', label: 'All tags' }, { icon: 'layers', label: 'All status' }];
  return (
    <div style={{ width: 252, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={{ ...cwPrimary(36), width: '100%', justifyContent: 'center', fontSize: 13 }}><Icon name="plus" size={14} color="#fff" /> {kind === 'wiki' ? 'New page' : 'Ingest sources'}</button>
        <DropdownChipRow size="s" chips={chips} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 31, padding: '0 10px', borderRadius: 7, marginBottom: 2, cursor: 'pointer' }}>
          <Icon name="layers" size={14} color="var(--fg-muted)" />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--fg-muted)' }}>{kind === 'wiki' ? 'All pages' : 'All sources'}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{kind === 'wiki' ? WIKI_PAGES.length : SOURCE_TREE.total}</span>
        </div>
        {kind === 'wiki' ? (
          WIKI_TREE.map((g, gi) => (
            <div key={g.project} style={{ marginTop: 2 }}>
              <ProjectHead label={g.project} count={g.pages.length} open={gi === 0} />
              {gi === 0 && g.pages.map((p) => <NestedRow key={p.topic} icon="wiki" label={p.topic} on={p.topic === 'Cell theory'} badge={p.isNew ? 'NEW' : null} meta={'v' + p.v} />)}
            </div>
          ))
        ) : (
          SOURCE_TREE.projects.map((pr, gi) => (
            <div key={pr.label} style={{ marginTop: 2 }}>
              <ProjectHead label={pr.label} count={pr.count} open={gi === 0} />
              {gi === 0 && SOURCES.slice(0, 5).map((s, i) => {
                const chip = STATUS_CHIP[s.status];
                return <NestedRow key={s.id} icon={TYPE_ICON[s.type] || 'file'} label={s.name} on={i === 0} meta={null} tone={null} />;
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
function DesktopB({ kind }) {
  return (
    <DeskRailShell active={kind}>
      <DeskSidebarB kind={kind} />
      <DeskDetail kind={kind} />
    </DeskRailShell>
  );
}

Object.assign(window, { ScopeButton, ChipRail, FilterChip, DropdownChipRow, ChipMenu, GroupHeader, SourcesMobile, WikiMobile, DetailPhone, DesktopFrame });
