/* Brain2 Console — Settings page sections + primitives. */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

const STONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };

// ── primitives ───────────────────────────────────────────────────────────────
function SCard({ title, desc, action, children, pad = 20 }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', marginBottom: 18 }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: `16px ${pad}px`, borderBottom: children ? '1px solid var(--border)' : 'none' }}>
          <div style={{ flex: 1 }}>
            {title && <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</h3>}
            {desc && <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{desc}</p>}
          </div>
          {action}
        </div>
      )}
      {children && <div style={{ padding: pad }}>{children}</div>}
    </section>
  );
}
function SRow({ label, desc, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--fg)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}
function Field({ label, value, placeholder, mono, type = 'text', wide }) {
  return (
    <label style={{ display: 'block', width: wide ? '100%' : 'auto' }}>
      {label && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>{label}</span>}
      <input defaultValue={value} placeholder={placeholder} type={type} style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: mono ? 'var(--mono-font)' : 'var(--ui-font)', fontSize: 13, outline: 'none' }} />
    </label>
  );
}
function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 40, height: 23, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 2, background: on ? 'var(--accent)' : 'var(--surface-3)', transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
  );
}
function sbtn(kind) {
  const base = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 8, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent' };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--border)' };
  return { ...base, background: 'transparent', color: 'var(--fg)', borderColor: 'var(--border)' };
}
const ROLE_TONE = { Owner: 'accent', Admin: 'accent', Editor: 'success', Viewer: 'muted' };
function RoleBadge({ role }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: STONE[ROLE_TONE[role]], background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px' }}>{role}</span>;
}

// ── Profile ──────────────────────────────────────────────────────────────────
function ProfileSection() {
  return (
    <div>
      <SCard title="Profile" desc="How you appear across the workspace.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, fontFamily: 'var(--display-font)' }}>A</span>
          <div>
            <button style={sbtn()}>Change avatar</button>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 6 }}>PNG or JPG, up to 2 MB.</div>
          </div>
          <span style={{ marginLeft: 'auto' }}><RoleBadge role="Owner" /></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Display name" value="Alice Chen" />
          <Field label="Username" value="alice" mono />
          <Field label="Email" value="alice@brain2.dev" type="email" />
          <Field label="Timezone" value="UTC−5 · New York" />
        </div>
        <div style={{ marginTop: 14 }}><Field label="Bio" value="Knowledge ops lead. Keeping the wiki honest." wide /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button style={sbtn()}>Cancel</button>
          <button style={sbtn('primary')}>Save changes</button>
        </div>
      </SCard>
      <SCard title="Password" desc="Update your sign-in credentials.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Current password" value="" placeholder="••••••••" type="password" />
          <div />
          <Field label="New password" value="" placeholder="••••••••" type="password" />
          <Field label="Confirm new password" value="" placeholder="••••••••" type="password" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button style={sbtn('primary')}>Update password</button></div>
      </SCard>
    </div>
  );
}

// ── Members / user management ────────────────────────────────────────────────
const MEMBERS = [
  { name: 'Alice Chen', email: 'alice@brain2.dev', role: 'Owner', you: true, status: 'active' },
  { name: 'Bob Ng', email: 'bob@brain2.dev', role: 'Admin', status: 'active' },
  { name: 'Carol Diaz', email: 'carol@brain2.dev', role: 'Editor', status: 'active' },
  { name: 'Dan Park', email: 'dan@brain2.dev', role: 'Viewer', status: 'invited' },
];
function MembersSection() {
  return (
    <div>
      <SCard title="Members" desc="People with access to the default workspace. Roles map to the operations each member can call."
        action={<button style={sbtn('primary')}><Icon name="plus" size={14} color="#fff" /> Invite</button>}>
        <div>
          {MEMBERS.map((m, i) => (
            <div key={m.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i === MEMBERS.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>{m.name[0]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>{m.name}{m.you && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>you</span>}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{m.email}</div>
              </div>
              {m.status === 'invited' && <span style={{ fontSize: 11, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 6, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={11} /> invited</span>}
              <button style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: m.you ? 'default' : 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, opacity: m.you ? 0.6 : 1 }}>
                <RoleBadge role={m.role} /> {!m.you && <Icon name="chevDown" size={12} color="var(--fg-muted)" />}
              </button>
              <button style={{ ...iconBtn(), width: 30, height: 30, opacity: m.you ? 0.4 : 1 }}><Icon name="more" size={15} color="var(--fg-muted)" /></button>
            </div>
          ))}
        </div>
      </SCard>
      <SCard title="Ownership" desc="Transfer ownership of this workspace to another admin. This cannot be undone.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}><Field value="" placeholder="Select an admin to transfer to…" /></div>
          <button style={sbtn('danger')}>Transfer ownership</button>
        </div>
      </SCard>
    </div>
  );
}

// ── Integrations (Telegram etc) ──────────────────────────────────────────────
function IntegrationsSection() {
  const [tg, setTg] = React.useState('idle'); // idle | linking | connected
  const [token, setToken] = React.useState('');
  const Integration = ({ icon, name, desc, children }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={19} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
        {children}
      </div>
    </div>
  );
  return (
    <SCard title="Integrations" desc="Connect Brain2 to the tools your team already uses. Agents can post and receive messages through linked channels." pad={20}>
      <Integration icon="telegram" name="Telegram" desc="Chat with your agents and ingest forwarded messages from a Telegram bot.">
        {tg === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'var(--success-soft)', border: '1px solid var(--border)' }}>
            <Icon name="check" size={15} color="var(--success)" />
            <span style={{ fontSize: 13, color: 'var(--fg)' }}>Connected as <b style={{ fontFamily: 'var(--mono-font)' }}>@brain2_ops_bot</b></span>
            <button onClick={() => setTg('idle')} style={{ ...sbtn(), marginLeft: 'auto', height: 28 }}>Disconnect</button>
          </div>
        ) : tg === 'linking' ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field value={token} placeholder="Paste bot token from @BotFather" mono /></div>
            <button onClick={() => setTg('connected')} style={sbtn('primary')}>Link bot</button>
            <button onClick={() => setTg('idle')} style={sbtn()}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setTg('linking')} style={{ ...sbtn('primary'), marginTop: 12 }}><Icon name="plug" size={14} color="#fff" /> Connect Telegram</button>
        )}
      </Integration>
      <Integration icon="chats" name="Slack" desc="Post audit results and activity to a Slack channel.">
        <button style={{ ...sbtn(), marginTop: 12 }}><Icon name="plug" size={14} /> Connect</button>
      </Integration>
      <Integration icon="mail" name="Email digest" desc="A daily summary of ingests, audits and agent activity.">
        <button style={{ ...sbtn(), marginTop: 12 }}><Icon name="plug" size={14} /> Connect</button>
      </Integration>
      <div style={{ paddingTop: 16 }}>
        <SRow label="Outgoing webhook" desc="POST events to your own endpoint." last><Toggle on={false} onClick={() => {}} /></SRow>
      </div>
    </SCard>
  );
}

// ── Providers ────────────────────────────────────────────────────────────────
const PROVIDERS = [
  { name: 'Anthropic', desc: 'Claude models · cloud', set: true, key: 'sk-ant-••••••••••••3f2a' },
  { name: 'Google Gemini', desc: 'Gemini models · cloud', set: true, key: 'AIza••••••••••••9kL2' },
  { name: 'OpenAI', desc: 'GPT models · cloud', set: false, key: '' },
];
function ProvidersSection() {
  return (
    <div>
      <SCard title="Model providers" desc="API keys are encrypted at rest (AES-256-GCM) and never shown again after saving.">
        {PROVIDERS.map((p, i) => (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i === PROVIDERS.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{p.desc}</div>
            </div>
            <div style={{ flex: 1 }}><Field value={p.key} placeholder="Paste API key…" mono /></div>
            {p.set ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)' }}><Icon name="check" size={13} /> Saved</span> : <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Not set</span>}
            <button style={sbtn()}>Test</button>
          </div>
        ))}
      </SCard>
      <SCard title="Local runtime" desc="Ollama endpoint for local models.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Ollama base URL" value="http://localhost:11434" mono /></div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)', height: 36 }}><Icon name="check" size={13} /> Reachable</span>
          <button style={sbtn()}>Test</button>
        </div>
      </SCard>
    </div>
  );
}

// ── Appearance (accent picker lives here) ────────────────────────────────────
function AppearanceSection({ theme, setTheme, accent, setAccent }) {
  return (
    <div>
      <SCard title="Theme" desc="Switch between light and dark. Honors your system setting on first load.">
        <div style={{ display: 'flex', gap: 12 }}>
          {[['dark', 'moon', 'Dark'], ['light', 'sun', 'Light']].map(([k, ic, label]) => {
            const on = theme === k;
            return (
              <button key={k} onClick={() => setTheme(k)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, cursor: 'pointer', background: 'var(--bg)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={ic} size={17} /></span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
                {on && <span style={{ marginLeft: 'auto' }}><Icon name="check" size={16} color="var(--accent)" /></span>}
              </button>
            );
          })}
        </div>
      </SCard>
      <SCard title="Accent color" desc="Used for primary actions, links and selection across the console.">
        <div style={{ display: 'flex', gap: 12 }}>
          {Object.keys(ACCENTS).map((k) => {
            const on = accent === k;
            const col = theme === 'light' ? ACCENTS[k].light : ACCENTS[k].dark;
            return (
              <button key={k} onClick={() => setAccent(k)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px 9px 10px', borderRadius: 10, cursor: 'pointer', background: 'var(--bg)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: col }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{ACCENTS[k].label}</span>
                {on && <Icon name="check" size={15} color="var(--accent)" />}
              </button>
            );
          })}
        </div>
      </SCard>
      <SCard title="Interface">
        <SRow label="Density" desc="Comfortable spacing, or compact for more on screen.">
          <SegInline value="Comfortable" options={['Comfortable', 'Compact']} />
        </SRow>
        <SRow label="Reduce motion" desc="Minimise animations and transitions." last><Toggle on={false} onClick={() => {}} /></SRow>
      </SCard>
    </div>
  );
}
function SegInline({ value, options }) {
  const [v, setV] = React.useState(value);
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--surface-2)', borderRadius: 8 }}>
      {options.map((o) => (
        <button key={o} onClick={() => setV(o)} style={{ height: 26, padding: '0 11px', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: v === o ? 600 : 500, background: v === o ? 'var(--surface)' : 'transparent', color: v === o ? 'var(--fg)' : 'var(--fg-muted)' }}>{o}</button>
      ))}
    </div>
  );
}

// ── Tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  { op: 'run_query', desc: 'Read-only knowledge queries', on: true },
  { op: 'wiki:get', desc: 'Read wiki pages', on: true },
  { op: 'wiki:put', desc: 'Edit wiki pages (optimistic-lock)', on: true },
  { op: 'sources:read', desc: 'Read raw + extracted sources', on: true },
  { op: 'sources:ingest', desc: 'Upload and re-ingest sources', on: false },
  { op: 'agents:create', desc: 'Create and configure agents', on: false },
];
function ToolsSection() {
  return (
    <SCard title="Operations" desc="Globally enable the ops agents may call. The chat tool-allowlist is the intersection of these and each user’s permissions.">
      {TOOLS.map((t, i) => (
        <SRow key={t.op} last={i === TOOLS.length - 1}
          label={<span style={{ fontFamily: 'var(--mono-font)', fontSize: 13 }}>{t.op}</span>} desc={t.desc}>
          <Toggle on={t.on} onClick={() => {}} />
        </SRow>
      ))}
    </SCard>
  );
}

// ── Audit log ────────────────────────────────────────────────────────────────
const AUDIT_EVENTS = [
  { t: '14:02', who: 'alice', ev: 'agent.message', detail: 'Researcher · 1,840 tok' },
  { t: '13:31', who: 'alice', ev: 'wiki.put', detail: 'Cell theory v7 (LLM audit)' },
  { t: '13:12', who: 'system', ev: 'breaker.open', detail: 'Archivist · per-tenant limit' },
  { t: '11:46', who: 'bob', ev: 'source.ingest', detail: 'standup-04-12.md' },
  { t: '09:20', who: 'alice', ev: 'member.role', detail: 'carol → Editor' },
];
function AuditSection() {
  return (
    <SCard title="Audit log" desc="Every mutation, from the events outbox." action={<button style={sbtn()}><Icon name="download" size={13} /> Export</button>}>
      {AUDIT_EVENTS.map((e, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i === AUDIT_EVENTS.length - 1 ? 'none' : '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40 }}>{e.t}</span>
          <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--accent)', width: 130 }}>{e.ev}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)' }}>{e.detail}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{e.who}</span>
        </div>
      ))}
    </SCard>
  );
}

// ── Danger zone ──────────────────────────────────────────────────────────────
function DangerSection() {
  return (
    <SCard title="Danger zone">
      <SRow label="Sign out everywhere" desc="End all active sessions on every device."><button style={sbtn()}>Sign out all</button></SRow>
      <SRow label="Delete workspace" desc="Permanently remove the default workspace, all sources, wiki pages and chats." last><button style={sbtn('danger')}><Icon name="trash" size={14} /> Delete workspace</button></SRow>
    </SCard>
  );
}

Object.assign(window, { useStored, ProfileSection, MembersSection, IntegrationsSection, ProvidersSection, AppearanceSection, ToolsSection, AuditSection, DangerSection, sbtn });
