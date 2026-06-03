/* Brain2 Console — three Home/Dashboard layout variations.
   Each receives {theme, accent, font} and applies token vars on its root. */

const PROVIDER_COLORS = ['var(--accent)', '#2DD4BF', '#94A3B8'];

function DashFrame({ theme, accent, font, active = 'home', expanded = false, children }) {
  const vars = getTokens(theme, accent, font);
  return (
    <div style={{ ...vars, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)',
      color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, overflow: 'hidden' }}>
      <TopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail active={active} expanded={expanded} />
        <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>{children}</main>
      </div>
    </div>
  );
}

function SectionLabel({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{children}</h2>
      {action}
    </div>
  );
}

// ── Variant A — Classic grid ────────────────────────────────────────────────
function VariantA(props) {
  return (
    <DashFrame {...props}>
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <HeroBand />
        <div>
          <SectionLabel action={<MoreLink>Manage agents</MoreLink>}>Agents</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {DATA.agents.map((a) => <AgentCard key={a.id} a={a} />)}
            <AddAgentTile />
          </div>
        </div>
        <div>
          <SectionLabel>Knowledge stats</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Panel title="Sources over time" action={<span style={metaTag()}>30d</span>}>
              <LineChart data={DATA.sourcesOverTime} h={120} />
            </Panel>
            <Panel title="Wiki pages by project">
              <div style={{ paddingTop: 6 }}><BarsH data={DATA.wikiByProject} /></div>
            </Panel>
            <Panel title="Queries served" action={<span style={metaTag()}>30d</span>}>
              <AreaChart data={DATA.queriesServed} h={120} id="qa" />
            </Panel>
            <Panel title="LLM tokens used" action={<Legend items={legendItems()} />}>
              <StackedArea series={DATA.tokensByProvider} colors={PROVIDER_COLORS} h={120} id="ta" />
            </Panel>
          </div>
        </div>
        <Panel title="Recent activity" action={<MoreLink>View all</MoreLink>}>
          <ActivityFeed />
        </Panel>
      </div>
    </DashFrame>
  );
}

// ── Variant B — Focus + sidebar stats ───────────────────────────────────────
function VariantB(props) {
  return (
    <DashFrame {...props}>
      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 340px', gap: 22, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <HeroBand />
          <div>
            <SectionLabel action={<MoreLink>Manage agents</MoreLink>}>Agents</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {DATA.agents.map((a) => <AgentCard key={a.id} a={a} />)}
              <AddAgentTile />
            </div>
          </div>
          <Panel title="LLM tokens used" action={<Legend items={legendItems()} />}>
            <StackedArea series={DATA.tokensByProvider} colors={PROVIDER_COLORS} h={150} id="tb" />
          </Panel>
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
          <StatTile label="Sources ingested" value="1,284" delta="3.4%" data={DATA.sourcesOverTime} id="sb" />
          <StatTile label="Queries served · today" value="89" delta="12%" data={DATA.queriesServed} id="qb" />
          <Panel title="Wiki pages by project">
            <div style={{ paddingTop: 4 }}><BarsH data={DATA.wikiByProject.slice(0, 4)} /></div>
          </Panel>
          <Panel title="Recent activity" action={<MoreLink>All</MoreLink>}>
            <ActivityFeed rows={DATA.activity.slice(0, 4)} dense />
          </Panel>
        </aside>
      </div>
    </DashFrame>
  );
}

// ── Variant C — Editorial / minimal ─────────────────────────────────────────
function VariantC(props) {
  return (
    <DashFrame {...props} expanded>
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 1000, padding: '40px 36px', display: 'flex', flexDirection: 'column', gap: 40 }}>
          {/* hero */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginBottom: 12 }}>Saturday · 1 June</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 40, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{DATA.greeting}.</h1>
            <div style={{ display: 'flex', gap: 36, marginTop: 22, flexWrap: 'wrap' }}>
              {DATA.hero.map((m) => (
                <div key={m.label}>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--display-font)', color: 'var(--fg)', letterSpacing: 'var(--display-track)', fontVariantNumeric: 'tabular-nums' }}>{m.value}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>{m.label}</div>
                </div>
              ))}
              <button style={{ marginLeft: 'auto', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px',
                borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <Icon name="plus" size={16} color="#fff" /> Ingest source
              </button>
            </div>
          </div>

          {/* agents list */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>Agents</h2>
              <button style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>
                <Icon name="plus" size={14} color="var(--accent)" /> Add agent
              </button>
            </div>
            {DATA.agents.map((a) => <AgentRow key={a.id} a={a} />)}
          </div>

          {/* stats: one hero chart + mini trio */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 36 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Sources over time</h3>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>+34 this week · 30d</span>
              </div>
              <AreaChart data={DATA.sourcesOverTime} h={150} id="cc" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'center' }}>
              {[{ l: 'Queries served', v: '89', d: DATA.queriesServed },
                { l: 'Wiki pages', v: '312', d: DATA.tokensByProvider.Anthropic },
                { l: 'Tokens · 30d', v: '4.1M', d: DATA.tokensByProvider.Gemini }].map((s) => (
                <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--display-font)', color: 'var(--fg)', letterSpacing: 'var(--display-track)', fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.l}</div>
                  </div>
                  <Sparkline data={s.d} w={88} h={30} fill />
                </div>
              ))}
            </div>
          </div>

          {/* activity */}
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Recent activity</h3>
            <ActivityFeed />
          </div>
        </div>
      </div>
    </DashFrame>
  );
}

function metaTag() {
  return { fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' };
}
function legendItems() {
  return [
    { label: 'Anthropic', color: PROVIDER_COLORS[0] },
    { label: 'Gemini', color: PROVIDER_COLORS[1] },
    { label: 'Ollama', color: PROVIDER_COLORS[2] },
  ];
}

Object.assign(window, { VariantA, VariantB, VariantC, DashFrame });
