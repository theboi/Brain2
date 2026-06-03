/* Brain2 Console — Plugins: installed list, marketplace, detail drawer. */

function pbtn(kind) {
  const base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 8,
    fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', whiteSpace: 'nowrap' };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--border)' };
  if (kind === 'installed') return { ...base, background: 'var(--success-soft)', color: 'var(--success)', cursor: 'default' };
  return { ...base, background: 'transparent', color: 'var(--fg)', borderColor: 'var(--border)' };
}

function PToggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 40, height: 23, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0,
      background: on ? 'var(--accent)' : 'var(--surface-3)', transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

function FirstPartyBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap',
      flexShrink: 0, background: 'var(--accent-soft)', borderRadius: 6, padding: '2px 7px' }}>
      <Icon name="shield" size={11} color="var(--accent)" /> 1st party
    </span>
  );
}

function CategoryTag({ children }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px' }}>{children}</span>
  );
}

function PermChip({ children }) {
  return (
    <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px' }}>{children}</span>
  );
}

function PluginIcon({ name, size = 44, icon = 18 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--accent-soft)', color: 'var(--accent)' }}>
      <Icon name={name} size={icon} />
    </span>
  );
}

// Footer action that reflects install state (shared by card + drawer).
function InstallAction({ p, st, busy, onInstall, onUninstall, block }) {
  const style = block ? { width: '100%', height: 38 } : {};
  if (busy) return <button disabled style={{ ...pbtn('secondary'), ...style, color: 'var(--fg-muted)', cursor: 'default' }}><Icon name="loader" size={14} color="var(--fg-muted)" /> Installing…</button>;
  if (st.installed) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...pbtn('installed'), ...style }}><Icon name="check" size={14} color="var(--success)" /> Installed</span>
        {block && <button onClick={onUninstall} style={pbtn('secondary')}>Uninstall</button>}
      </span>
    );
  }
  return <button onClick={onInstall} style={{ ...pbtn('primary'), ...style }}><Icon name="download" size={14} color="#fff" /> Install</button>;
}

// ── Installed list ──────────────────────────────────────────────────────────
function InstalledRow({ p, st, onToggle, onConfigure, onUninstall, onOpen }) {
  return (
    <section onClick={onOpen} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: 18, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', cursor: 'pointer', marginBottom: 14 }}>
      <PluginIcon name={p.icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{p.name}</span>
          <FirstPartyBadge />
          <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>v{p.version}</span>
          <span style={{ fontSize: 11.5, color: st.enabled ? 'var(--success)' : 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.enabled ? 'var(--success)' : 'var(--fg-faint)' }} />
            {st.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5, maxWidth: 560 }}>{p.tagline}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11, alignItems: 'center' }}>
          <CategoryTag>{p.category}</CategoryTag>
          {p.actions && p.actions.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginRight: 2 }}>
              <Icon name="zap" size={12} color="var(--accent)" /> {p.actions.length} {p.actions.length === 1 ? 'quick action' : 'quick actions'}
            </span>
          )}
          {p.permissions.map((pm) => <PermChip key={pm}>{pm}</PermChip>)}
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <PToggle on={st.enabled} onClick={onToggle} />
        <button onClick={onConfigure} style={pbtn('secondary')}><Icon name="settings" size={13} color="var(--fg-muted)" /> Configure</button>
        <button onClick={onUninstall} title="Uninstall" style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="trash" size={15} color="var(--fg-muted)" /></button>
      </div>
    </section>
  );
}

function InstalledEmpty() {
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px', border: '1.5px dashed var(--border-strong)', borderRadius: 14, color: 'var(--fg-muted)' }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--surface-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name="plug" size={22} color="var(--fg-muted)" />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>No plugins installed</div>
      <div style={{ fontSize: 12.5, marginTop: 4 }}>Browse the marketplace to extend Brain2.</div>
    </div>
  );
}

// ── Marketplace card ──────────────────────────────────────────────────────────
function MarketCard({ p, st, busy, onInstall, onUninstall, onOpen }) {
  return (
    <section onClick={onOpen} style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, boxShadow: 'var(--shadow-card)', padding: 18, cursor: 'pointer', minHeight: 196 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <PluginIcon name={p.icon} size={40} icon={17} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>by {p.author} · <span style={{ fontFamily: 'var(--mono-font)' }}>v{p.version}</span></div>
        </div>
        <FirstPartyBadge />
      </div>
      <p style={{ margin: '13px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5, flex: 1 }}>{p.tagline}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <CategoryTag>{p.category}</CategoryTag>
        {p.actions && p.actions.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
            <Icon name="zap" size={12} color="var(--accent)" /> {p.actions.length} {p.actions.length === 1 ? 'action' : 'actions'}
          </span>
        )}
        <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex' }}>
          <InstallAction p={p} st={st} busy={busy} onInstall={onInstall} onUninstall={onUninstall} />
        </span>
      </div>
    </section>
  );
}

// ── Detail drawer ───────────────────────────────────────────────────────────
function PluginDrawer({ p, st, busy, onInstall, onUninstall, onToggle, onClose }) {
  if (!p) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(8,9,12,0.4)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '100%', zIndex: 190, background: 'var(--bg)',
        borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', animation: 'b2slide 0.22s ease-out' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <PluginIcon name={p.icon} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display-font)', fontSize: 17, fontWeight: 700, color: 'var(--fg)', letterSpacing: 'var(--display-track)' }}>{p.name}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>by {p.author} · <span style={{ fontFamily: 'var(--mono-font)' }}>v{p.version}</span></div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 30, height: 30 }}><Icon name="x" size={15} color="var(--fg-muted)" /></button>
        </div>
        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', gap: 7, marginBottom: 16 }}>
            <FirstPartyBadge />
            <CategoryTag>{p.category}</CategoryTag>
            {st.installed && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--success)', background: 'var(--success-soft)', borderRadius: 6, padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} color="var(--success)" /> Installed</span>}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.6 }}>{p.long}</p>

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '22px 0 11px' }}>What it adds</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {p.features.map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Icon name="check" size={15} color="var(--accent)" style={{ marginTop: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.45 }}>{f}</span>
              </div>
            ))}
          </div>

          {p.actions && p.actions.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '22px 0 11px' }}>Quick actions it adds</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {p.actions.map((act) => (
                  <div key={act.title} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      <Icon name="zap" size={14} />
                    </span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{act.title}</span>
                    {act.est && <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{act.est}</span>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 9, lineHeight: 1.5 }}>
                {st.installed ? 'These appear under Quick actions on Home.' : 'Install to add these to Quick actions on Home.'}
              </div>
            </>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '22px 0 11px' }}>Permissions requested</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {p.permissions.map((pm) => <PermChip key={pm}>{pm}</PermChip>)}
          </div>

          {st.installed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, padding: '13px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{st.enabled ? 'Enabled' : 'Disabled'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Agents can use this plugin while enabled.</div>
              </div>
              <PToggle on={st.enabled} onClick={onToggle} />
            </div>
          )}
        </div>
        {/* footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {st.installed ? (
            <>
              <button style={{ ...pbtn('primary'), flex: 1, height: 38 }}><Icon name="settings" size={14} color="#fff" /> Configure</button>
              <button onClick={onUninstall} style={{ ...pbtn('danger'), height: 38 }}><Icon name="trash" size={14} color="var(--destructive)" /> Uninstall</button>
            </>
          ) : (
            <InstallAction p={p} st={st} busy={busy} onInstall={onInstall} onUninstall={onUninstall} block />
          )}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { pbtn, PToggle, FirstPartyBadge, CategoryTag, PermChip, PluginIcon, InstallAction, InstalledRow, InstalledEmpty, MarketCard, PluginDrawer });
