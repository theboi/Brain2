/* Brain2 Console — Sources page (three-pane Obsidian-style). */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}
const TONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };

// ── Tree pane ───────────────────────────────────────────────────────────────
function TreeGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function TreeRow({ icon, label, count, tone, active, onClick, indent = 0 }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 32, padding: `0 10px 0 ${10 + indent * 14}px`, border: 'none', borderRadius: 7,
      background: active ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', color: active ? 'var(--fg)' : 'var(--fg-muted)' }}>
      {icon && <Icon name={icon} size={15} color={tone ? TONE[tone] : 'currentColor'} />}
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count != null && <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono-font)' }}>{count}</span>}
    </button>
  );
}
function TreePane({ filter, setFilter, width = 244, onIngest }) {
  const t = SOURCE_TREE;
  return (
    <div style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 10px 0' }}>
        <button onClick={onIngest} style={{ ...btnPrimary(), width: '100%', height: 36, justifyContent: 'center', fontSize: 13 }}>
          <Icon name="plus" size={15} color="#fff" /> Ingest sources
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 8px 8px' }}>
        <TreeGroup title="Projects">
          {t.projects.map((p) => <TreeRow key={p.label} icon="folder" label={p.label} count={p.count} active={filter === 'p:' + p.label} onClick={() => setFilter('p:' + p.label)} />)}
        </TreeGroup>
        <TreeGroup title="Tags">
          {t.tags.map((p) => <TreeRow key={p.label} icon="tag" label={p.label} count={p.count} active={filter === 't:' + p.label} onClick={() => setFilter('t:' + p.label)} />)}
        </TreeGroup>
        <TreeGroup title="Status">
          {t.status.map((p) => <TreeRow key={p.id} icon={p.icon} tone={p.tone} label={p.label} count={p.count} active={filter === 's:' + p.id} onClick={() => setFilter('s:' + p.id)} />)}
        </TreeGroup>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: 8 }}>
        <TreeRow icon="plus" label="New folder" onClick={() => {}} />
      </div>
    </div>
  );
}

// ── List pane ────────────────────────────────────────────────────────────────
function SourceRow({ s, selected, onClick, mobile = false }) {
  const chip = STATUS_CHIP[s.status];
  const hi = selected && !mobile; // no selected-highlight in mobile single-pane mode
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderLeft: `2px solid ${hi ? 'var(--accent)' : 'transparent'}`,
      borderBottom: '1px solid var(--border)', background: hi ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', padding: '9px 14px', fontFamily: 'var(--ui-font)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
          <Icon name={TYPE_ICON[s.type] || 'file'} size={13} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: TONE[chip.tone], fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
          <Icon name={chip.icon} size={11} /> {chip.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 33, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{s.size.trim()} · {s.type}</span>
        {s.topic && <span style={{ marginLeft: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Icon name="arrowRight" size={10} color="var(--fg-faint)" /> <span style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.topic}</span></span>}
      </div>
    </button>
  );
}
function ListPane({ items, selectedId, onSelect, width = 340, mobile = false, onOpenTree }) {
  const [q, setQ] = React.useState('');
  const filtered = items.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ ...(mobile ? { flex: 1, width: '100%', minWidth: 0 } : { width, flexShrink: 0, borderRight: '1px solid var(--border)' }), background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {onOpenTree && (
            <button onClick={onOpenTree} aria-label="Browse sources" style={{ ...btnGhost(), height: 34, width: 38, padding: 0, justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="sources" size={16} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Icon name="search" size={15} color="var(--fg-muted)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources…" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{filtered.length} sources</span>
          <button style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <Icon name="filter" size={13} /> Newest <Icon name="chevDown" size={12} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: mobile ? 'calc(68px + env(safe-area-inset-bottom, 0px))' : undefined }}>
        {filtered.map((s) => <SourceRow key={s.id} s={s} selected={s.id === selectedId} onClick={() => onSelect(s.id)} mobile={mobile} />)}
        <button style={{ width: '100%', padding: '14px', border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>Load more (382 more)…</button>
      </div>
    </div>
  );
}

// ── Preview pane ─────────────────────────────────────────────────────────────
function Tab({ label, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 40, padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer',
      color: active ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: active ? 600 : 500 }}>
      {label}
      {badge != null && <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 5px', color: 'var(--fg-muted)' }}>{badge}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
    </button>
  );
}
function InfoRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
      <span style={{ width: 88, flexShrink: 0, color: 'var(--fg-faint)' }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--fg)', minWidth: 0 }}>{children}</span>
    </div>
  );
}
function PreviewPane({ s, mobile = false, onBack }) {
  const [tab, setTab] = React.useState('Preview');
  React.useEffect(() => { setTab(s.status === 'failed' ? 'Extracted text' : 'Preview'); }, [s.id]);
  const tabs = ['Preview', 'Raw source', 'Extracted text', 'History', 'Details'];
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* header */}
      <div style={{ padding: mobile ? '12px 16px 0' : '14px 28px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {mobile && (
            <button onClick={onBack} aria-label="Back to list" style={{ ...btnGhost(), height: 30, width: 34, padding: 0, justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="chevLeft" size={16} />
            </button>
          )}
          <Icon name={TYPE_ICON[s.type] || 'file'} size={18} color="var(--fg-muted)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: mobile ? 15 : 17, fontWeight: 600, color: 'var(--fg)', letterSpacing: 'var(--display-track)', flex: mobile ? 1 : 'none', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
          <span style={{ marginLeft: mobile ? 0 : 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
            {!mobile && <button style={btnGhost()}><Icon name="refresh" size={14} /> Re-ingest</button>}
            <button style={btnPrimary()}><Icon name="pencil" size={14} color="#fff" /> {mobile ? '' : 'Edit MD'}</button>
          </span>
        </div>
        <div className="b2-tabscroll" style={{ display: 'flex', gap: 18, marginTop: 6, overflowX: mobile ? 'auto' : 'visible' }}>
          {tabs.map((t) => <Tab key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
        </div>
      </div>
      {/* body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: mobile ? '18px 16px 48px' : '22px 28px 48px', paddingBottom: mobile ? 'calc(80px + env(safe-area-inset-bottom, 0px))' : undefined }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          {s.status === 'failed' && tab !== 'History' && tab !== 'Details' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid var(--border)', marginBottom: 18 }}>
              <Icon name="alert" size={18} color="var(--warning)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Extraction failed</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{s.error}</div>
              </div>
              <button style={btnGhost()}><Icon name="refresh" size={14} /> Retry</button>
            </div>
          )}
          {tab === 'Preview' && (s.extracted ? <MiniMD text={s.extracted} /> : <EmptyBody label="Nothing to preview yet." />)}
          {tab === 'Raw source' && <RawBody s={s} />}
          {tab === 'Extracted text' && <ExtractedBody s={s} />}
          {tab === 'History' && <HistoryBody s={s} />}
          {tab === 'Details' && <DetailsBody s={s} />}
        </div>
      </div>
    </div>
  );
}
function DetailsBody({ s }) {
  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>Details</h3>
      <InfoRow label="Source ID"><span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{s.id} <Icon name="copy" size={12} color="var(--fg-faint)" /></span></InfoRow>
      <InfoRow label="Uploader">{s.uploader}</InfoRow>
      <InfoRow label="Created">{s.created}</InfoRow>
      <InfoRow label="Updated">{s.updated}</InfoRow>
      <InfoRow label="Size">{s.size.trim()}</InfoRow>
      <InfoRow label="MIME"><span style={{ fontFamily: 'var(--mono-font)', fontSize: 12 }}>{s.mime}</span></InfoRow>
      <InfoRow label="Provenance">{s.provenance}{s.url && <div style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--accent)', marginTop: 2, wordBreak: 'break-all' }}>{s.url}</div>}</InfoRow>
      <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
      <InfoRow label="Wiki topic">
        {s.topic ? <a href="Wiki.html" style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><Icon name="wiki" size={13} /> {s.topic}</a> : <span style={{ color: 'var(--fg-faint)' }}>—</span>}
      </InfoRow>
      <InfoRow label="Tags">
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.tags.length ? s.tags.map((t) => <span key={t} style={tagChip()}>#{t}</span>) : <span style={{ color: 'var(--fg-faint)' }}>untagged</span>}
        </span>
      </InfoRow>
      <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
      <button style={{ ...btnGhost(), color: 'var(--destructive)' }}><Icon name="x" size={14} /> Delete source</button>
    </div>
  );
}

// Draggable vertical divider between panes.
function Resizer({ onResize }) {
  const start = (e) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev) => { onResize(ev.clientX - last); last = ev.clientX; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };
  return (
    <div className="b2-rz" onPointerDown={start} style={{ width: 7, flexShrink: 0, cursor: 'col-resize', display: 'flex', justifyContent: 'center', background: 'var(--surface)', zIndex: 5 }}>
      <div style={{ width: 1, background: 'var(--border)' }} />
    </div>
  );
}
function EmptyBody({ label }) { return <div style={{ color: 'var(--fg-faint)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>{label}</div>; }
function RawBody({ s }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Original {s.type.toUpperCase()} · {s.size.trim()}</span>
        <button style={btnGhost()}><Icon name="download" size={14} /> Download</button>
      </div>
      <div style={{ height: 360, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--fg-faint)' }}>
        <Icon name={TYPE_ICON[s.type] || 'file'} size={34} />
        <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12 }}>{s.name}</span>
        <span style={{ fontSize: 11.5 }}>raw {s.type} viewer</span>
      </div>
    </div>
  );
}
function ExtractedBody({ s }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{s.words} words · {s.tokens} tokens · markitdown</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button style={btnGhost()}>Reset to extracted</button>
          <button style={btnPrimary()}>Save</button>
        </span>
      </div>
      <pre style={{ margin: 0, padding: 16, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>{s.extracted || '(no extracted text — extraction has not completed)'}</pre>
    </div>
  );
}
function HistoryBody({ s }) {
  const rows = [
    { v: 'v3', t: s.updated, who: s.uploader, what: 'edited extraction' },
    { v: 'v2', t: s.created, who: 'system', what: 're-ingested · markitdown' },
    { v: 'v1', t: s.created, who: s.uploader, what: 'uploaded' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div key={r.v} style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ width: 9, marginTop: 5, flexShrink: 0 }}><span style={{ display: 'block', width: 9, height: 9, borderRadius: '50%', background: i ? 'var(--surface-3)' : 'var(--accent)', border: '2px solid var(--border)' }} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--fg)' }}><b style={{ fontFamily: 'var(--mono-font)', fontWeight: 500 }}>{r.v}</b> · {r.what}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{r.who} · {r.t}</div>
          </div>
          <button style={btnGhost()}>Diff</button>
        </div>
      ))}
    </div>
  );
}

function btnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }; }
function btnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }; }
function tagChip() { return { fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px' }; }

Object.assign(window, { TreePane, ListPane, PreviewPane, Resizer, useStored, btnGhost, btnPrimary });
