/* Brain2 Console — reference boards: typography specimens + color tokens. */

function TypeSpecimen({ theme, accent, fontKey }) {
  const vars = getTokens(theme, accent, fontKey);
  const f = FONTS[fontKey];
  const scale = [36, 28, 22, 18, 16, 14, 13, 12];
  return (
    <div style={{ ...vars, height: '100%', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', padding: 28, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
        <span style={{ fontFamily: 'var(--display-font)', fontSize: 22, fontWeight: 700, letterSpacing: 'var(--display-track)' }}>{f.label}</span>
        <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--fg-muted)' }}>+ {f.mono.match(/'([^']+)'/)[1]}</span>
      </div>

      <div>
        <div style={{ fontFamily: 'var(--display-font)', fontSize: 30, fontWeight: 700, letterSpacing: 'var(--display-track)' }}>Good morning, Alice</div>
        <div style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.55, marginTop: 8 }}>
          A focused, calm knowledge-work surface. Body copy at 14px with 1.55 line-height keeps long passages comfortable to read across both themes.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {scale.map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--fg-faint)', width: 26, textAlign: 'right' }}>{s}</span>
            <span style={{ fontSize: s, fontWeight: s >= 22 ? 600 : 400, letterSpacing: s >= 22 ? 'var(--display-track)' : 0, fontFamily: s >= 22 ? 'var(--display-font)' : 'var(--ui-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>The quick brown agent</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--mono-font)', fontSize: 12.5, color: 'var(--fg-muted)' }}>id 4f2a · 1,840 tok · $0.014</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <StatusDot status="active" pulse={false} />
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>Researcher</span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>Claude 3.5 Sonnet</span>
        </div>
      </div>
    </div>
  );
}

// Color token swatch board for one theme.
const TOKEN_ROWS = [
  ['--bg', 'bg', 'app background'],
  ['--surface', 'surface', 'cards, panels'],
  ['--surface-2', 'surface-2', 'nested, hover'],
  ['--border', 'border', 'hairlines'],
  ['--fg', 'fg', 'primary text'],
  ['--fg-muted', 'fg-muted', 'secondary text'],
  ['--accent', 'accent', 'brand, actions'],
  ['--accent-soft', 'accent-soft', 'selection, ring'],
  ['--success', 'success', 'run, accepted'],
  ['--warning', 'warning', 'drift, review'],
  ['--destructive', 'destructive', 'delete, revoke'],
];

function ColorBoard({ theme, accent }) {
  const vars = getTokens(theme, accent, 'inter');
  return (
    <div style={{ ...vars, height: '100%', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', padding: 26, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} color="var(--fg-muted)" />
        <span style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{theme === 'dark' ? 'Dark' : 'Light'} theme</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)' }}>WCAG AA</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TOKEN_ROWS.map(([v, name, use]) => (
          <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <span style={{ width: 38, height: 38, borderRadius: 9, background: vars[v], border: '1px solid var(--border)', flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.06)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--mono-font)', color: 'var(--fg)' }}>{name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{use}</div>
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap' }}>{String(vars[v]).replace(/\s+/g, '')}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        {['success', 'warning', 'destructive'].map((k) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '4px 9px', borderRadius: 7,
            background: vars[`--${k}-soft`] || 'var(--surface-2)', color: vars[`--${k}`] }}>
            <Icon name={k === 'success' ? 'check' : k === 'warning' ? 'alert' : 'alert'} size={13} /> {k}
          </span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TypeSpecimen, ColorBoard });
