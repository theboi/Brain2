/* Brain2 Console — Sources app: shell + drag overlay + ingest modal. */

const DROPPED = [
  { name: 'darwin-1859.pdf', type: 'pdf', size: '11.2 MB', project: 'research-q3', topic: 'Origin of Species', mode: 'wiki' },
  { name: 'mendel-1866.pdf', type: 'pdf', size: '2.1 MB', project: 'default', topic: 'Cell theory', collision: true, mode: 'wiki' },
  { name: 'schwann-1839.pdf', type: 'pdf', size: '5.1 MB', project: 'default', topic: 'Cell theory', mode: 'wiki' },
  { name: 'lab-readings.csv', type: 'file', size: '420 KB', project: 'default', topic: 'Microscopy', mode: 'dynamic' },
  { name: 'gateway.py', type: 'code', size: '18 KB', project: 'launch-docs', topic: 'LLM Gateway', mode: 'static' },
];

function useIsMobile(bp = 820) {
  const [m, setM] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= bp : false));
  React.useEffect(() => {
    const on = () => setM(window.innerWidth <= bp);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [bp]);
  return m;
}

function SourcesApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo'); // chosen on Settings → Appearance
  const vars = getTokens(theme, accent, 'inter');
  const isMobile = useIsMobile(820);
  const isTablet = useIsMobile(1080) && !isMobile; // 821–1080: tree becomes a drawer, list + preview stay side-by-side
  const drawer = isMobile || isTablet;
  const [filter, setFilter] = React.useState('all');
  const [selectedId, setSelectedId] = React.useState(SOURCES[0].id);
  const [modal, setModal] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const dragCount = React.useRef(0);
  const [treeW, setTreeW] = React.useState(244);
  const [listW, setListW] = React.useState(340);
  const [mobileView, setMobileView] = React.useState('list'); // 'list' | 'detail'
  const [treeOpen, setTreeOpen] = React.useState(false);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  React.useEffect(() => {
    const onEnter = (e) => { e.preventDefault(); if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragCount.current++; setDragging(true); } };
    const onOver = (e) => { e.preventDefault(); };
    const onLeave = (e) => { e.preventDefault(); dragCount.current = Math.max(0, dragCount.current - 1); if (!dragCount.current) setDragging(false); };
    const onDrop = (e) => { e.preventDefault(); dragCount.current = 0; setDragging(false); setModal(true); };
    window.addEventListener('dragenter', onEnter); window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave); window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragover', onOver); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); };
  }, []);

  // filter the list by tree selection
  const items = SOURCES.filter((s) => {
    if (filter === 'all') return true;
    if (filter.startsWith('s:')) return s.status === filter.slice(2);
    if (filter.startsWith('t:')) return s.tags.includes(filter.slice(2)) || (filter === 't:untagged' && !s.tags.length);
    return true;
  });
  const selected = SOURCES.find((s) => s.id === selectedId) || SOURCES[0];

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <LeftRail active="sources" />
        {drawer ? (
          <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', overflow: 'hidden' }}>
            {treeOpen && (
              <React.Fragment>
                <div onClick={() => setTreeOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(8,9,12,0.45)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 41, display: 'flex', maxWidth: '86%', boxShadow: '10px 0 36px rgba(0,0,0,0.4)', animation: 'b2slide 0.2s ease-out' }}>
                  <TreePane filter={filter} setFilter={(f) => { setFilter(f); setTreeOpen(false); }} width={280} onIngest={() => { setModal(true); setTreeOpen(false); }} />
                </div>
              </React.Fragment>
            )}
            {isMobile ? (
              mobileView === 'list'
                ? <ListPane items={items} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMobileView('detail'); }} mobile onOpenTree={() => setTreeOpen(true)} />
                : <PreviewPane s={selected} mobile onBack={() => setMobileView('list')} />
            ) : (
              <React.Fragment>
                <ListPane items={items} selectedId={selectedId} onSelect={setSelectedId} width={listW} onOpenTree={() => setTreeOpen(true)} />
                <Resizer onResize={(d) => setListW((w) => clamp(w + d, 260, 460))} />
                <PreviewPane s={selected} />
              </React.Fragment>
            )}
          </div>
        ) : (
          <React.Fragment>
            <TreePane filter={filter} setFilter={setFilter} width={treeW} onIngest={() => setModal(true)} />
            <Resizer onResize={(d) => setTreeW((w) => clamp(w + d, 190, 420))} />
            <ListPane items={items} selectedId={selectedId} onSelect={setSelectedId} width={listW} />
            <Resizer onResize={(d) => setListW((w) => clamp(w + d, 260, 560))} />
            <PreviewPane s={selected} />
          </React.Fragment>
        )}
      </div>

      {dragging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'var(--accent-soft)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: '70%', height: '70%', border: '2.5px dashed var(--accent)', borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--accent)' }}>
            <Icon name="download" size={42} color="var(--accent)" />
            <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--display-font)', color: 'var(--fg)' }}>Drop to ingest into default</span>
            <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>PDFs, markdown, text, images — multi-file OK</span>
          </div>
        </div>
      )}
      <IngestModal open={modal} onClose={() => setModal(false)} files={DROPPED} />
      <BottomNav active="sources" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<SourcesApp />);
