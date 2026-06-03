/* Brain2 Console — app: global toolbar + design-canvas layout. */

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'rgba(0,0,0,0.05)', borderRadius: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
            background: on ? '#fff' : 'transparent', color: on ? '#1a1714' : '#6b6258', fontWeight: on ? 600 : 500,
            fontFamily: '-apple-system, system-ui, sans-serif', fontSize: 12.5, boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}>
            {o.icon && <span style={{ display: 'flex', color: on ? '#1a1714' : '#8a8178' }}>{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToolGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#a59c90' }}>{label}</span>
      {children}
    </div>
  );
}

function Toolbar({ theme, setTheme, font, setFont, accent, setAccent }) {
  return (
    <div style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
      display: 'flex', alignItems: 'center', gap: 18, padding: '8px 14px', borderRadius: 12,
      background: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      boxShadow: '0 4px 24px rgba(40,30,20,0.14), 0 0 0 1px rgba(0,0,0,0.05)', fontFamily: '-apple-system, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
        <div style={{ width: 18, height: 18, borderRadius: 5, background: ACCENTS[accent].dark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 7, height: 7, background: '#fff', borderRadius: 1.5, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1714' }}>Brain2 · Home</span>
      </div>
      <div style={{ width: 1, height: 22, background: 'rgba(0,0,0,0.1)' }} />
      <ToolGroup label="Theme">
        <Segmented value={theme} onChange={setTheme} options={[
          { value: 'dark', label: 'Dark', icon: <Icon name="moon" size={13} /> },
          { value: 'light', label: 'Light', icon: <Icon name="sun" size={13} /> },
        ]} />
      </ToolGroup>
      <ToolGroup label="Type">
        <Segmented value={font} onChange={setFont} options={[
          { value: 'inter', label: 'Inter' }, { value: 'geist', label: 'Geist' }, { value: 'plex', label: 'Plex' },
        ]} />
      </ToolGroup>
      <ToolGroup label="Accent">
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(ACCENTS).map((k) => (
            <button key={k} onClick={() => setAccent(k)} title={ACCENTS[k].label} style={{
              width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', background: ACCENTS[k].dark,
              border: accent === k ? '2px solid #1a1714' : '2px solid transparent', boxShadow: accent === k ? '0 0 0 1.5px #fff inset' : 'none' }} />
          ))}
        </div>
      </ToolGroup>
    </div>
  );
}

function App() {
  const [theme, setTheme] = React.useState('dark');
  const [font, setFont] = React.useState('inter');
  const [accent, setAccent] = React.useState('indigo');
  const p = { theme, accent, font };

  return (
    <>
      <Toolbar theme={theme} setTheme={setTheme} font={font} setFont={setFont} accent={accent} setAccent={setAccent} />
      <DesignCanvas>
        <DCSection id="layouts" title="Layout directions" subtitle="Three takes on the Home / Agents dashboard — toolbar controls reskin all three live.">
          <DCArtboard id="A" label="A · Classic grid" width={1440} height={1540}><VariantA {...p} /></DCArtboard>
          <DCArtboard id="B" label="B · Focus + sidebar" width={1440} height={1040}><VariantB {...p} /></DCArtboard>
          <DCArtboard id="C" label="C · Editorial / minimal" width={1440} height={1056}><VariantC {...p} /></DCArtboard>
        </DCSection>

        <DCSection id="themes" title="Dark / Light" subtitle="Variant A in both themes — same tokens, AA-safe in each.">
          <DCArtboard id="dark" label="Dark" width={1440} height={1540}><VariantA theme="dark" accent={accent} font={font} /></DCArtboard>
          <DCArtboard id="light" label="Light" width={1440} height={1540}><VariantA theme="light" accent={accent} font={font} /></DCArtboard>
        </DCSection>

        <DCSection id="type" title="Typography" subtitle="Inter (specced) · Geist · IBM Plex — same surface, three voices. Follows the toolbar theme + accent.">
          <DCArtboard id="t-inter" label="Inter + JetBrains Mono" width={460} height={580}><TypeSpecimen theme={theme} accent={accent} fontKey="inter" /></DCArtboard>
          <DCArtboard id="t-geist" label="Geist + Geist Mono" width={460} height={580}><TypeSpecimen theme={theme} accent={accent} fontKey="geist" /></DCArtboard>
          <DCArtboard id="t-plex" label="IBM Plex Sans + Mono" width={460} height={580}><TypeSpecimen theme={theme} accent={accent} fontKey="plex" /></DCArtboard>
        </DCSection>

        <DCSection id="colors" title="Color tokens" subtitle="Semantic tokens — never raw hex in components. Both themes, WCAG AA.">
          <DCArtboard id="c-dark" label="Dark tokens" width={440} height={620}><ColorBoard theme="dark" accent={accent} /></DCArtboard>
          <DCArtboard id="c-light" label="Light tokens" width={440} height={620}><ColorBoard theme="light" accent={accent} /></DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
