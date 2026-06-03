/* Brain2 Console — Reports / Studio: four design directions.
   Each exports a full-screen main region wrapped in MiniShell. */

const P = REPORT_PERSONA;

// ── Shared: a faint stand-in for a generated output ────────────────────────
function PreviewStub({ format = 'doc', h = 150, label }) {
  const line = (w, o = 0.5) => <div style={{ height: 6, width: w, borderRadius: 3, background: 'var(--fg-faint)', opacity: o }} />;
  let body;
  if (format === 'deck') {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {line('60%', 0.7)}{line('90%', 0.35)}{line('75%', 0.35)}
          </div>
        ))}
      </div>
    );
  } else if (format === 'video') {
    body = (
      <div style={{ width: '100%', height: '100%', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, position: 'relative' }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="play" size={20} /></span>
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border-strong)' }}><div style={{ width: '34%', height: '100%', borderRadius: 2, background: 'var(--accent)' }} /></div>
          <span style={{ fontSize: 10, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>1:24</span>
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {line('45%', 0.7)}
        {[88, 96, 80, 92, 70].map((w, i) => line(w + '%', 0.3 + (i === 0 ? 0 : 0)))}
        <div style={{ height: 1 }} />
        {line('40%', 0.55)}{line('84%', 0.3)}{line('60%', 0.3)}
      </div>
    );
  }
  return (
    <div style={{ height: h, borderRadius: 10, border: '1px dashed var(--border-strong)', background: 'var(--bg)', padding: 14, display: 'flex', flexDirection: format === 'video' ? 'column' : 'column', overflow: 'hidden', position: 'relative' }}>
      {body}
      {label && <span style={{ position: 'absolute', top: 10, right: 12, fontSize: 10, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>}
    </div>
  );
}

function PageTitle({ kicker = 'Studio', title, sub }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>
        <Icon name="layers" size={14} color="var(--accent)" /> {kicker}
      </div>
      <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 26, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{title}</h1>
      {sub && <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--fg-muted)', maxWidth: 560, lineHeight: 1.5 }}>{sub}</p>}
    </div>
  );
}

function PersonaBanner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
      <PersonaCrest />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Suggested for {P.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>· {P.role}</span></div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>{P.basis}</div>
      </div>
      <div className="rpt-hide-narrow"><SignalChips /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DIRECTION A — STUDIO GRID
   Format toggle biases the page; persona banner; suggested cards in a grid;
   a compact "browse all" catalog; recent reports in a right rail.
   ════════════════════════════════════════════════════════════════════════ */
function VarStudioGrid() {
  const [fmt, setFmt] = React.useState('doc');
  const Card = ({ r }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RTONE_SOFT[r.tone], color: RTONE[r.tone] }}><Icon name={r.icon} size={18} /></span>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{r.title}</span>
        <MatchPill n={r.match} />
      </div>
      <p style={{ margin: 0, fontSize: 12.8, color: 'var(--fg-muted)', lineHeight: 1.45, textWrap: 'pretty' }}>{r.desc}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}>
        <Icon name="sparkles" size={12} color="var(--accent)" /><span style={{ color: 'var(--fg-muted)' }}>{r.why}</span>
      </div>
      <FormatBadgeRow ids={r.formats} best={r.best} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{r.sources} sources · {r.est}</span>
        <span style={{ marginLeft: 'auto' }}><GenerateBtn label="Generate" size="sm" /></span>
      </div>
    </div>
  );
  return (
    <MiniShell>
      <div style={{ height: '100%', overflow: 'hidden', padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <PageTitle title="Generate a report" sub="Board-ready documents, decks and videos — assembled from your workspace and cited back to the source." />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 7 }}>Output format</div>
            <FormatToggle value={fmt} onChange={setFmt} />
          </div>
        </div>
        <PersonaBanner />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 22, alignItems: 'start', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
            <div>
              <SectionLabel action={<MatchPill n={98} />}>Suggested for you</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                {SUGGESTED_REPORTS.slice(0, 4).map((r) => <Card key={r.id} r={r} />)}
              </div>
            </div>
            <div>
              <SectionLabel action={<MoreLink>{REPORT_CATALOG.reduce((n, c) => n + c.types.length, 0)} types</MoreLink>}>Browse all report types</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {REPORT_CATALOG.flatMap((c) => c.types).slice(0, 6).map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}><Icon name={t.icon} size={15} /></span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{t.title}</span>
                    <FormatBadge id={t.formats[0]} subtle />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Panel title="Recent reports" action={<MoreLink>History</MoreLink>}>
              <div style={{ marginTop: -4 }}>{RECENT_REPORTS.map((r, i) => <RecentRow key={r.id} r={r} border={i > 0} />)}</div>
            </Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 12, border: '1px dashed var(--border-strong)', background: 'var(--surface-2)' }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', color: 'var(--accent)' }}><Icon name="calendar" size={16} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Schedule a report</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>monthly · auto-deliver</div>
              </div>
              <Icon name="chevRight" size={15} color="var(--fg-faint)" />
            </div>
          </aside>
        </div>
      </div>
    </MiniShell>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DIRECTION B — PROMPT-LED / GENERATIVE
   A composer hero ("describe the report"), inline format + generate,
   persona-based prompt chips, then suggested feature cards in a row.
   ════════════════════════════════════════════════════════════════════════ */
function VarPromptLed() {
  const [fmt, setFmt] = React.useState('doc');
  const FeatureCard = ({ r }) => (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 11, padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RTONE_SOFT[r.tone], color: RTONE[r.tone] }}><Icon name={r.icon} size={17} /></span>
        {r.isNew && <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '2px 6px', letterSpacing: '0.04em' }}>NEW</span>}
        <span style={{ marginLeft: 'auto' }}><MatchPill n={r.match} /></span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{r.title}</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.45, flex: 1, textWrap: 'pretty' }}>{r.desc}</p>
      <FormatBadgeRow ids={r.formats} best={r.best} />
      <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginTop: 2 }}>
        <Icon name="wand" size={14} color="var(--accent)" /> Use this
      </button>
    </div>
  );
  return (
    <MiniShell>
      <div style={{ height: '100%', overflow: 'hidden', padding: '36px 28px 28px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* composer hero */}
        <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginBottom: 16 }}><PersonaCrest size={34} /></div>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 28, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>What report do you need, {P.name}?</h1>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--fg-muted)' }}>Describe it in plain language, or start from a suggestion. Every figure is cited back to your sources.</p>
          <div style={{ marginTop: 20, textAlign: 'left', borderRadius: 14, border: '1px solid var(--border-strong)', background: 'var(--surface)', boxShadow: '0 8px 30px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 8px', fontSize: 15, color: 'var(--fg-muted)', minHeight: 58 }}>
              Summarise our Q2 finances for the board, highlight burn and runway…
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <FormatToggle value={fmt} onChange={setFmt} size="sm" />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}><Icon name="sources" size={13} /> 12 sources</span>
              <span style={{ marginLeft: 'auto' }}><GenerateBtn label="Generate report" /></span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 }}>
            {QUICK_PROMPTS.map((q) => (
              <button key={q} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12.5, cursor: 'pointer' }}>
                <Icon name="sparkles" size={13} color="var(--accent)" /> {q}
              </button>
            ))}
          </div>
        </div>
        {/* suggested + recent */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel action={<span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{P.role}</span>}>Suggested for you</SectionLabel>
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
            {SUGGESTED_REPORTS.slice(0, 4).map((r) => <FeatureCard key={r.id} r={r} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 4, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Recent</span>
            <div style={{ display: 'flex', gap: 20, flex: 1, overflow: 'hidden' }}>
              {RECENT_REPORTS.map((r) => {
                const f = fmtById(r.format);
                return (
                  <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                    <Icon name={f.icon} size={14} color="var(--fg-muted)" /> {r.title} <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{r.when}</span>
                  </span>
                );
              })}
            </div>
            <MoreLink>All history</MoreLink>
          </div>
        </div>
      </div>
    </MiniShell>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DIRECTION C — TWO-PANE BUILDER
   Left: searchable catalog with "suggested" pinned. Right: a configuration
   + preview pane for the selected type (format, sources, schedule, generate).
   ════════════════════════════════════════════════════════════════════════ */
function VarBuilder() {
  const [sel, setSel] = React.useState(SUGGESTED_REPORTS[0].id);
  const [fmt, setFmt] = React.useState(SUGGESTED_REPORTS[0].best);
  const all = [...SUGGESTED_REPORTS, ...REPORT_CATALOG.flatMap((c) => c.types)];
  const current = all.find((r) => r.id === sel) || SUGGESTED_REPORTS[0];
  const pick = (r) => { setSel(r.id); setFmt(r.best || (r.formats && r.formats[0]) || 'doc'); };
  const CatRow = ({ r, suggested }) => {
    const on = r.id === sel;
    return (
      <button onClick={() => pick(r)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', background: on ? 'var(--accent-soft)' : 'transparent', position: 'relative' }}>
        {on && <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
        <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={r.icon} size={15} /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
        {suggested && <span style={{ fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 700, color: 'var(--accent)' }}>{r.match}%</span>}
      </button>
    );
  };
  return (
    <MiniShell>
      <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
        {/* catalog pane */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Icon name="layers" size={16} color="var(--accent)" />
              <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 16, color: 'var(--fg)' }}>Report types</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-faint)' }}>
              <Icon name="search" size={15} /><span style={{ fontSize: 13 }}>Search report types…</span>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 8px 8px' }}>
              <Icon name="sparkles" size={13} color="var(--accent)" />
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Suggested for {P.name}</span>
            </div>
            {SUGGESTED_REPORTS.slice(0, 4).map((r) => <CatRow key={r.id} r={r} suggested />)}
            {REPORT_CATALOG.slice(0, 2).map((c) => (
              <div key={c.category} style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '8px 8px 4px' }}>{c.category}</div>
                {c.types.slice(0, 3).map((t) => <CatRow key={t.id} r={t} />)}
              </div>
            ))}
          </div>
        </div>
        {/* config + preview pane */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 28, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 28, alignContent: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RTONE_SOFT[current.tone || 'accent'], color: RTONE[current.tone || 'accent'] }}><Icon name={current.icon} size={20} /></span>
                <div style={{ flex: 1 }}>
                  <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 22, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{current.title}</h1>
                  <div style={{ fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', marginTop: 3 }}>{current.category || 'Report'}</div>
                </div>
                {current.match && <MatchPill n={current.match} />}
              </div>
              {current.desc && <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--fg-muted)', lineHeight: 1.5, maxWidth: 540 }}>{current.desc}</p>}
              {current.why && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: 'var(--fg-muted)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> {current.why}</div>}
            </div>
            <div>
              <SectionLabel>Output format</SectionLabel>
              <FormatToggle value={fmt} onChange={setFmt} />
            </div>
            <div>
              <SectionLabel>Configure</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: 'sources', label: 'Sources', value: `${current.sources || 12} cited · finance/`, edit: 'Edit scope' },
                  { icon: 'calendar', label: 'Schedule', value: 'One-off · run now', edit: 'Make recurring' },
                  { icon: 'users', label: 'Deliver to', value: 'You · download', edit: 'Add recipients' },
                ].map((row) => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <Icon name={row.icon} size={16} color="var(--fg-muted)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', width: 92 }}>{row.label}</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{row.value}</span>
                    <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>{row.edit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SectionLabel style={{ marginBottom: 0 }}>Preview</SectionLabel>
            <PreviewStub format={fmt} h={230} label={fmtById(fmt).label} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
              <span>{fmtById(fmt).sub}</span><span>{current.est || '~2 min'}</span>
            </div>
            <GenerateBtn label={`Generate ${fmtById(fmt).label.toLowerCase()}`} full />
            <GhostBtn label="Save as template" icon="copy" />
          </aside>
        </div>
      </div>
    </MiniShell>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DIRECTION D — EDITORIAL GALLERY
   Format filter up top; a big hero feature for the #1 suggestion with a live
   preview; a varied gallery of suggestions; recent reports as a filmstrip.
   ════════════════════════════════════════════════════════════════════════ */
function VarGallery() {
  const [fmt, setFmt] = React.useState('doc');
  const hero = SUGGESTED_REPORTS[0];
  const rest = SUGGESTED_REPORTS.slice(1, 5);
  const Tile = ({ r }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 15, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RTONE_SOFT[r.tone], color: RTONE[r.tone] }}><Icon name={r.icon} size={16} /></span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{r.title}</span>
        {r.isNew && <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '2px 6px' }}>NEW</span>}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.45, flex: 1, textWrap: 'pretty' }}>{r.desc}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FormatBadge id={r.best} />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Generate <Icon name="arrowRight" size={14} /></span>
      </div>
    </div>
  );
  return (
    <MiniShell>
      <div style={{ height: '100%', overflow: 'hidden', padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <PageTitle title="Report studio" sub={null} />
          <FormatToggle value={fmt} onChange={setFmt} size="sm" />
        </div>
        {/* hero feature */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 0, borderRadius: 16, border: '1px solid var(--border-strong)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 10px 36px rgba(0,0,0,0.18)' }}>
          <div style={{ padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <PersonaCrest size={30} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Top pick for {P.name}</span>
              <MatchPill n={hero.match} />
            </div>
            <h2 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 26, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{hero.title}</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.5, maxWidth: 420, textWrap: 'pretty' }}>{hero.desc}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-muted)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> {hero.why}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <FormatBadgeRow ids={hero.formats} best={hero.best} />
              <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{hero.sources} sources · {hero.est}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <GenerateBtn label="Generate report" />
              <GhostBtn label="Customise" icon="sliders" />
            </div>
          </div>
          <div style={{ padding: 22, background: 'var(--surface-2)', borderLeft: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%' }}><PreviewStub format={hero.best} h={210} label={fmtById(hero.best).label} /></div>
          </div>
        </div>
        {/* gallery + filmstrip */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel action={<MoreLink>Browse all types</MoreLink>}>More suggestions</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {rest.map((r) => <Tile key={r.id} r={r} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', flexShrink: 0 }}>Recent</span>
            <div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden' }}>
              {RECENT_REPORTS.map((r) => {
                const f = fmtById(r.format);
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}><Icon name={f.icon} size={13} /></span>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{r.title}</span>
                    <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{r.when}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </MiniShell>
  );
}

Object.assign(window, { VarStudioGrid, VarPromptLed, VarBuilder, VarGallery, PreviewStub });
