/* Brain2 Console — Wiki app: shell + audit drawer. */

function Radio({ checked, label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, color: 'var(--fg)', padding: '4px 0' }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
      </span>
      {label}
    </button>
  );
}

function SuggestionCard({ sg, onAccept, onDismiss }) {
  if (sg.status === 'accepted') {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--success-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="check" size={16} color="var(--success)" />
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>Applied to <b>{sg.section}</b> · new revision v8</span>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Section</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{sg.section}</span>
        {!sg.cited && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 6, padding: '2px 7px' }}><Icon name="alert" size={11} /> uncited</span>}
      </div>
      <DiffView hunks={sg.diff} compact />
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5, margin: '11px 0' }}><b style={{ color: 'var(--fg)' }}>Why:</b> {sg.why}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Sources cited:</span>
        {sg.sourcesCited.length ? sg.sourcesCited.map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--success)', background: 'var(--success-soft)', borderRadius: 6, padding: '2px 7px' }}><Icon name="check" size={11} /> {s}</span>
        )) : <span style={{ fontSize: 11.5, color: 'var(--warning)' }}>none found</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onAccept} disabled={!sg.cited} title={!sg.cited ? 'Resolve citation before accepting' : ''} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: 'none', cursor: sg.cited ? 'pointer' : 'not-allowed', background: sg.cited ? 'var(--success)' : 'var(--surface-2)', color: sg.cited ? '#fff' : 'var(--fg-faint)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>
          <Icon name="check" size={14} color={sg.cited ? '#fff' : 'var(--fg-faint)'} /> Accept
        </button>
        <button style={wbtnGhost()}>Edit then accept</button>
        <button onClick={onDismiss} style={{ ...wbtnGhost(), marginLeft: 'auto', width: 32, padding: 0, justifyContent: 'center' }}><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}

function AuditDrawer({ open, onClose }) {
  const [sugs, setSugs] = React.useState(() => AUDIT_SUGGESTIONS.map((s) => ({ ...s, status: 'pending' })));
  const [prompt, setPrompt] = React.useState('Check the Origins section is accurate per the sources. Tighten wording and add a citation if one is missing.');
  const [scope, setScope] = React.useState('selection');
  const [logOpen, setLogOpen] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!open) { setShown(false); return; }
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [open, onClose]);
  const pending = sugs.filter((s) => s.status !== 'dismissed');
  if (!open) return null;
  const set = (id, status) => setSugs((xs) => xs.map((s) => s.id === id ? { ...s, status } : s));

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width: 540, maxWidth: '100%', maxHeight: '88vh', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.985)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="sparkles" size={17} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 15.5, fontWeight: 600, color: 'var(--fg)' }}>Audit: Cell theory</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', ...wbtnGhost(), width: 30, padding: 0, justifyContent: 'center' }}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {/* prompt */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 8 }}>Prompt the auditor</div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
            style={{ width: '100%', resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, lineHeight: 1.5, padding: 11, outline: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Agent</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>
                <StatusDot status="active" pulse={false} /> Editor <span style={{ fontFamily: 'var(--mono-font)', fontWeight: 400, color: 'var(--fg-muted)' }}>llama3 8B</span> <Icon name="chevDown" size={12} color="var(--fg-muted)" />
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 6 }}>
            <div><div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 2 }}>Scope</div>
              <Radio checked={scope === 'selection'} label="Selection" onClick={() => setScope('selection')} />
              <Radio checked={scope === 'page'} label="Whole page" onClick={() => setScope('page')} />
            </div>
            <div><div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 2 }}>Citation policy</div>
              <Radio checked label="Must cite source" onClick={() => {}} />
              <Radio checked={false} label="Citations optional" onClick={() => {}} />
            </div>
          </div>
          <button style={{ ...wbtnPrimary(), height: 36, width: '100%', justifyContent: 'center', background: 'var(--success)', marginTop: 6 }}><Icon name="zap" size={15} color="#fff" /> Run audit</button>

          <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />

          {/* pending */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Icon name="chevDown" size={13} color="var(--fg-muted)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Pending suggestions</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 6px' }}>{pending.filter((s) => s.status === 'pending').length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((s) => <SuggestionCard key={s.id} sg={s} onAccept={() => set(s.id, 'accepted')} onDismiss={() => set(s.id, 'dismissed')} />)}
            {!pending.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13, padding: 20 }}>All suggestions resolved.</div>}
          </div>

          {/* log */}
          <button onClick={() => setLogOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 18, padding: '10px 0', border: 'none', borderTop: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)' }}>
            <Icon name={logOpen ? 'chevDown' : 'chevRight'} size={13} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Audit log</span>
            <span style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>{AUDIT_LOG.length} prior audits</span>
          </button>
          {logOpen && AUDIT_LOG.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 8px 21px', fontSize: 12.5, color: 'var(--fg-muted)' }}>
              <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{l.t}</span>
              <span>{l.agent} · {l.who}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--success)' }}>{l.accepted}✓</span>
              <span style={{ color: 'var(--fg-faint)' }}>{l.dismissed}✕</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WikiApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo'); // chosen on Settings → Appearance
  const vars = getTokens(theme, accent, 'inter');
  const readHashTopic = () => { try { const m = /[#&]page=([^&]+)/.exec(location.hash); if (m) return decodeURIComponent(m[1]); } catch (e) {} return null; };
  const [topic, setTopic] = React.useState(() => readHashTopic() || 'Cell theory');
  const [tab, setTab] = React.useState('Read');
  const [audit, setAudit] = React.useState(false);
  const isMobile = useIsMobile();
  const [wf, setWf] = React.useState({ project: 'all', filter: 'all' });
  const [mobilePage, setMobilePage] = React.useState(null); // null = show picker first
  const page = WIKI_PAGE;
  const curProj = (WIKI_PAGES_FLAT.find((p) => p.topic === topic) || {}).project || page.project;
  // map the wiki project this page lives in to its org-graph vault id, so the
  // Graph tab shows just this vault's page graph in the shared graph UI
  const WIKI_VAULT_OF = { 'default': 'v_general', 'research-q3': 'v_research', 'launch-docs': 'v_gateway' };
  const vaultScope = WIKI_VAULT_OF[curProj] || 'v_general';
  const pad = isMobile ? '12px 16px 0' : '16px 28px 0';
  const bodyPad = isMobile ? '18px 16px 48px' : '22px 28px 40px';
  const editH = isMobile ? 'calc(100vh - 330px)' : 'calc(100vh - 260px)';
  const openPage = (t) => { setTopic(t); setTab('Read'); setMobilePage(t); };
  React.useEffect(() => {
    const onHash = () => { const t = readHashTopic(); if (t) { setTopic(t); setTab('Read'); setMobilePage(t); } };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <LeftRail active="wiki" />
        {!isMobile && <WikiSidebar wf={wf} setWf={setWf} selected={topic} onSelect={setTopic} />}
        {isMobile && !mobilePage ? (
          <WikiPicker wf={wf} setWf={setWf} onSelect={openPage} />
        ) : (
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {/* header */}
          <div style={{ padding: pad, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-muted)' }}>
              {isMobile && <button onClick={() => setMobilePage(null)} aria-label="Back to wiki pages" style={{ ...wbtnGhost(), width: 30, padding: 0, justifyContent: 'center', marginRight: 2 }}><Icon name="chevLeft" size={16} /></button>}
              <a href="#" onClick={(e) => { e.preventDefault(); if (isMobile) setMobilePage(null); }} style={{ color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Wiki</a>
              <span>›</span><span>{page.project}</span><span>›</span><span style={{ color: 'var(--fg)' }}>{topic}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: isMobile ? 22 : 26, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{topic}</h1>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {!isMobile && <button style={wbtnGhost()}><Icon name="chats" size={14} /> Open in chat</button>}
                <button onClick={() => setAudit(true)} style={{ ...wbtnGhost(), color: 'var(--accent)', borderColor: 'var(--accent-line)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Audit <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 6, padding: '1px 6px' }}>{page.audits}</span></button>
                <button onClick={() => setTab('Edit')} style={wbtnPrimary()}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)' }}>v{page.version} · updated {page.updated} by {page.updatedBy} · {page.sources} sources</div>
            <div className="b2-tabscroll" style={{ display: 'flex', gap: 20, marginTop: 8, overflowX: 'auto' }}>
              {['Read', 'Edit', 'History', 'Sources', 'Graph'].map((t) => <WikiTabBtn key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
              <WikiTabBtn label="Audit" active={false} badge={page.audits} onClick={() => setAudit(true)} />
            </div>
          </div>
          {/* body */}
          {tab === 'Graph' ? (
            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <OrgGraphView theme={theme} isMobile={isMobile} scope={vaultScope} openGraphHref="Graph.html" />
            </div>
          ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: bodyPad, paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : undefined }}>
            {tab === 'Read' && <ReadTab page={page} onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} />}
            {tab === 'Edit' && (isMobile ? <EditTab page={page} mobile /> : <div style={{ height: editH }}><EditTab page={page} /></div>)}
            {tab === 'History' && (isMobile ? <HistoryTab mobile /> : <div style={{ height: editH }}><HistoryTab /></div>)}
            {tab === 'Sources' && <SourcesTab />}
          </div>
          )}
        </main>
        )}
      </div>
      <AuditDrawer open={audit} onClose={() => setAudit(false)} />
      <BottomNav active="wiki" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<WikiApp />);
