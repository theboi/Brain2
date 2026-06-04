/* Brain2 Console — Reports Studio (live tab). A+B blend, v2. */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}
function useMedia(query) {
  const [match, setMatch] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = (e) => setMatch(e.matches);
    setMatch(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return match;
}

function SeeAllButton({ onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: 0, border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
      See all report types <Icon name="chevRight" size={13} color="var(--accent)" />
    </button>
  );
}

// ── Full-catalog overlay, grouped by category ──────────────────────────────
function CatalogOverlay({ onClose, schedule }) {
  const [gen, setGen] = React.useState(null);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <React.Fragment>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8,10,13,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg)', boxShadow: '0 24px 60px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="layers" size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>All report types</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Every report Brain2 can generate, grouped by category.</div>
          </div>
          <button onClick={onClose} style={{ width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {REPORT_CATALOG.map((c) => (
            <div key={c.category}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 10 }}>{c.category}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {c.types.map((t) => (
                  <button key={t.id} onClick={() => setGen(reportActionConfig({ ...t, desc: t.desc, tone: 'accent' }, t.formats[0]))} style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--accent)' }}><Icon name={t.icon} size={15} /></span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{t.title}</span>
                    <Icon name="chevRight" size={14} color="var(--fg-faint)" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    {gen && <GenerateOverlay action={gen} schedule={schedule} onClose={() => setGen(null)} />}
    </React.Fragment>
  );
}

function ReportsStudio() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');
  const isMobile = useMedia('(max-width: 820px)');
  const isNarrow = useMedia('(max-width: 1080px)');

  const [schedule, setSchedule] = React.useState('oneoff');
  const scheduled = schedule !== 'oneoff';
  const sOpt = scheduleById(schedule);
  const [catalogOpen, setCatalogOpen] = React.useState(false);

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="b2-hide-sm" style={{ display: 'flex' }}><LeftRail active="reports" /></div>
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '22px 14px 96px' : '34px 28px 36px', display: 'flex', flexDirection: 'column', gap: isMobile ? 22 : 28 }}>

            {/* header */}
            <header style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>
                <Icon name="layers" size={14} color="var(--accent)" /> Studio
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 27, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Generate a report</h1>
                <ScheduleDropdown value={schedule} onChange={setSchedule} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
                <PersonaCrest size={26} pulse={false} />
                <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>Tuned for <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{RP.name}</b> · {RP.role} — {RP.basis}</span>
              </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0,1fr) 340px', gap: isNarrow ? 22 : 26, alignItems: 'start' }}>
              {/* suggested */}
              <div style={{ minWidth: 0 }}>
                <SectionLabel action={<SeeAllButton onClick={() => setCatalogOpen(true)} />}>Suggested for {RP.name}</SectionLabel>

                {scheduled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14, padding: '10px 13px', borderRadius: 10, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
                    <Icon name="calendar" size={15} color="var(--accent)" />
                    <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>
                      <b style={{ fontWeight: 600 }}>Scheduling on.</b> <span style={{ color: 'var(--fg-muted)' }}>Buttons below set up a recurring report — {sOpt.label.toLowerCase()}, {sOpt.sub}.</span>
                    </span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0,1fr))', gap: 14 }}>
                  {SUGGESTED_REPORTS.map((r) => <SuggestCard key={r.id} r={r} scheduled={scheduled} schedule={schedule} />)}
                  <CustomPromptCard scheduled={scheduled} schedule={schedule} />
                </div>
              </div>

              {/* recent (kept from direction A) */}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: isNarrow ? 'static' : 'sticky', top: 0 }}>
                <Panel title="Recent reports" action={<MoreLink>History</MoreLink>}>
                  <div style={{ marginTop: -4 }}>{RECENT_REPORTS.map((r, i) => <RecentRow key={r.id} r={r} border={i > 0} />)}</div>
                </Panel>
              </aside>
            </div>
          </div>
        </main>
      </div>
      <BottomNav active="reports" />
      {catalogOpen && <CatalogOverlay schedule={schedule} onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ReportsStudio />);
