/* Brain2 Console — Graph inspector. Two variants the user can switch between:
   • 'panel' — docked right-side panel (Settings-drawer style)
   • 'card'  — compact floating card, bottom-right
   Same content either way: identity header + access breakdown for the
   selected node (person / guest / group / workspace / vault / page). */

function giRoleBadge(role, via) {
  const tone = role === 'Owner' || role === 'Admin' ? 'var(--accent)' : role === 'Viewer' ? 'var(--fg-faint)' : 'var(--fg-muted)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)', color: tone, padding: '2px 8px', borderRadius: 999, border: `1px solid ${role === 'Owner' || role === 'Admin' ? 'var(--accent-line)' : 'var(--border)'}`, background: role === 'Owner' || role === 'Admin' ? 'var(--accent-soft)' : 'transparent', whiteSpace: 'nowrap' }}>
      {role}{via && <Icon name="users" size={10} color={tone} />}
    </span>
  );
}

function GiRow({ icon, iconColor, title, sub, badge, onClick }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 8px', borderRadius: 8, border: 'none', cursor: onClick ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'var(--ui-font)', background: hov && onClick ? 'var(--surface-2)' : 'transparent' }}>
      <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexToRgbaSafe(iconColor, 0.12), flexShrink: 0 }}>
        <Icon name={icon} size={13} color={iconColor} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
      {badge}
    </button>
  );
}
function hexToRgbaSafe(c, a) { return c && c.startsWith('#') ? hexToRgba(c, a) : 'var(--surface-2)'; }

function GiSection({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 8px', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

// ── per-kind content ─────────────────────────────────────────────────────────
function giContent(nodeId, graph, theme, helpers) {
  const { onGo, onFocusVault } = helpers;
  const n = graph.byId[nodeId]; if (!n) return null;
  const wsName = (id) => (ORG_WS.find((w) => w.id === id) || {}).name || id;
  const wsCol = (id) => ogWsColor(id, theme);
  const groupTone = theme === 'light' ? '#5B6472' : '#9AA6B8';

  if (n.kind === 'person' || n.kind === 'guest') {
    const acc = orgPersonAccess(n.u); const d = ORG_DIR[n.u];
    const m = ORG_MEMBERS.find((x) => x.u === n.u);
    return {
      icon: null, title: d.name, color: 'var(--accent)',
      tag: n.kind === 'guest' ? 'External guest' : m && m.invited ? 'Invited · pending' : m && m.owner ? 'Org owner' : 'Member',
      sub: d.email,
      avatar: d.name[0],
      dashed: n.kind === 'guest' || (m && m.invited),
      body: (
        <React.Fragment>
          {acc.wsRows.length > 0 && (
            <GiSection label={`Workspace access · ${acc.wsRows.length}`}>
              {acc.wsRows.map((r) => (
                <GiRow key={r.w} icon="layers" iconColor={wsCol(r.w)} title={wsName(r.w)}
                  sub={r.via ? `via ${r.via}` : 'direct'} badge={giRoleBadge(r.role, r.via)} onClick={() => onGo('ws:' + r.w)} />
              ))}
            </GiSection>
          )}
          {acc.guestVaults.length > 0 && (
            <GiSection label={`Vault shares · ${acc.guestVaults.length}`}>
              {acc.guestVaults.map((s) => (
                <GiRow key={s.v} icon="folder" iconColor={wsCol(vaultWsOf(s.v))} title={(ORG_VAULT_INDEX[s.v] || {}).name}
                  sub={`in ${wsName(vaultWsOf(s.v))}`} badge={giRoleBadge(s.level)} onClick={() => onGo('vault:' + s.v)} />
              ))}
            </GiSection>
          )}
          {acc.groups.length > 0 && (
            <GiSection label={`Groups · ${acc.groups.length}`}>
              {acc.groups.map((g) => (
                <GiRow key={g.id} icon="users" iconColor={groupTone} title={g.name}
                  sub={g.ws.map((r) => `${wsName(r.w)} · ${r.role}`).join('  ·  ')} onClick={() => onGo('g:' + g.id)} />
              ))}
            </GiSection>
          )}
          {acc.wsRows.length === 0 && acc.guestVaults.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>No workspace access yet.</div>
          )}
        </React.Fragment>
      ),
    };
  }

  if (n.kind === 'group') {
    const g = ORG_GROUPS.find((x) => x.id === n.group);
    const col = groupTone;
    return {
      icon: 'users', title: g.name, color: col, tag: `${g.members.length} members`, sub: 'Group — members inherit its access',
      body: (
        <React.Fragment>
          <GiSection label={`Grants · ${g.ws.length}`}>
            {g.ws.map((r) => (
              <GiRow key={r.w} icon="layers" iconColor={wsCol(r.w)} title={wsName(r.w)} badge={giRoleBadge(r.role)} onClick={() => onGo('ws:' + r.w)} />
            ))}
          </GiSection>
          <GiSection label={`Members · ${g.members.length}`}>
            {g.members.map((u) => (
              <GiRow key={u} icon="user" iconColor="var(--accent)" title={ORG_DIR[u].name} sub={ORG_DIR[u].email} onClick={() => onGo('p:' + u)} />
            ))}
          </GiSection>
        </React.Fragment>
      ),
    };
  }

  if (n.kind === 'ws') {
    const ws = ORG_WS.find((w) => w.id === n.ws);
    const members = orgWsMembers(ws.id);
    const col = wsCol(ws.id);
    return {
      icon: ws.private ? 'lock' : 'layers', title: ws.name, color: col,
      tag: ws.private ? 'Private workspace' : 'Workspace', sub: `${ws.vaults.length} vaults · ${members.length} people`,
      body: (
        <React.Fragment>
          <GiSection label={`Vaults · ${ws.vaults.length}`}>
            {ws.vaults.map((v) => (
              <GiRow key={v.id} icon="folder" iconColor={col} title={v.name}
                sub={`${(ORG_VAULT_PAGES[v.id] || { pages: [] }).pages.length} pages · ${v.mode}`} onClick={() => onGo('vault:' + v.id)} />
            ))}
          </GiSection>
          <GiSection label={`People with access · ${members.length}`}>
            {members.map((mm) => (
              <GiRow key={mm.u} icon="user" iconColor="var(--accent)" title={ORG_DIR[mm.u].name}
                sub={mm.via ? `via ${mm.via}` : mm.invited ? 'invited' : 'direct'} badge={giRoleBadge(mm.role, mm.via)} onClick={() => onGo('p:' + mm.u)} />
            ))}
          </GiSection>
        </React.Fragment>
      ),
    };
  }

  if (n.kind === 'vault') {
    const v = ORG_VAULT_INDEX[n.vault];
    const ppl = orgVaultPeople(v.id);
    const col = wsCol(v.ws);
    const pages = (ORG_VAULT_PAGES[v.id] || { pages: [], links: [] });
    return {
      icon: 'folder', title: v.name, color: col, tag: `Vault · ${v.mode}`, sub: `${wsName(v.ws)} · ${pages.pages.length} pages · ${pages.links.length} links`,
      cta: { label: 'Open vault graph', onClick: () => onFocusVault(v.id) },
      body: (
        <React.Fragment>
          {ppl.guests.length > 0 && (
            <GiSection label={`Guest shares · ${ppl.guests.length}`}>
              {ppl.guests.map((g) => (
                <GiRow key={g.u} icon="user" iconColor="var(--warning, #E8A33D)" title={ORG_DIR[g.u].name} sub="external guest" badge={giRoleBadge(g.level)} onClick={() => onGo('p:' + g.u)} />
              ))}
            </GiSection>
          )}
          <GiSection label={`Access via ${wsName(v.ws)} · ${ppl.members.length}`}>
            {ppl.members.map((mm) => (
              <GiRow key={mm.u} icon="user" iconColor="var(--accent)" title={ORG_DIR[mm.u].name}
                sub={mm.via ? `via ${mm.via}` : 'direct'} badge={giRoleBadge(mm.role, mm.via)} onClick={() => onGo('p:' + mm.u)} />
            ))}
          </GiSection>
        </React.Fragment>
      ),
    };
  }

  if (n.kind === 'source') {
    const v = ORG_VAULT_INDEX[n.vault] || {};
    const srcCol = theme === 'light' ? '#A9762E' : '#D9A441';
    const cited = [];
    graph.links.forEach((l) => { if (l.kind === 'cites' && l.s === n.id) cited.push(graph.byId[l.t]); });
    return {
      icon: ORG_SRC_GLYPH[n.srcType] || 'file', title: n.label, color: srcCol,
      tag: 'Source · ' + (n.srcType || 'file').toUpperCase(), sub: `${v.name} · ${wsName(n.ws)}`,
      body: (
        <GiSection label={`Cited by · ${cited.length}`}>
          {cited.length ? cited.map((p) => (
            <GiRow key={p.id} icon="file" iconColor={wsCol(p.ws)} title={p.label} onClick={() => onGo(p.id)} />
          )) : <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>Not cited by any page yet.</div>}
        </GiSection>
      ),
    };
  }

  // page
  const v = ORG_VAULT_INDEX[n.vault] || {};
  const srcCol = theme === 'light' ? '#A9762E' : '#D9A441';
  const mode = n.mode || 'wiki';
  const modeTag = mode === 'static' ? 'Static page' : mode === 'dynamic' ? 'Dynamic page' : 'Wiki page';
  const neighbors = [];
  graph.links.forEach((l) => {
    if (l.kind !== 'wikilink') return;
    if (l.s === n.id) neighbors.push(graph.byId[l.t]);
    if (l.t === n.id) neighbors.push(graph.byId[l.s]);
  });
  const sources = orgPageSources(n.vault, n.label);
  return {
    icon: mode === 'static' ? 'file' : mode === 'dynamic' ? 'zap' : 'wiki', title: n.label, color: wsCol(n.ws), tag: modeTag, sub: `${v.name} · ${wsName(n.ws)}`,
    cta: mode === 'wiki' ? { label: 'Open page', icon: 'arrowRight', onClick: () => window.open('Wiki.html#page=' + encodeURIComponent(n.label), '_blank') } : null,
    body: (
      <React.Fragment>
        {neighbors.length > 0 && (
          <GiSection label={`Linked pages · ${neighbors.length}`}>
            {neighbors.map((p) => (
              <GiRow key={p.id} icon="file" iconColor={wsCol(p.ws)} title={p.label} onClick={() => onGo(p.id)} />
            ))}
          </GiSection>
        )}
        {sources.length > 0 && (
          <GiSection label={`Sources · ${sources.length}`}>
            {sources.map((s) => (
              <GiRow key={s.id} icon={ORG_SRC_GLYPH[s.type] || 'file'} iconColor={srcCol} title={s.name} sub={(s.type || 'file').toUpperCase()} onClick={() => onGo('src:' + n.vault + ':' + s.id)} />
            ))}
          </GiSection>
        )}
        {!neighbors.length && !sources.length && (
          <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>No links or sources yet.</div>
        )}
      </React.Fragment>
    ),
  };
}

// ── shell ────────────────────────────────────────────────────────────────────
function GraphInspector({ nodeId, graph, theme, isMobile, variant, setVariant, onClose, onGo, onFocusVault }) {
  const c = giContent(nodeId, graph, theme, { onGo, onFocusVault });
  if (!c) return null;
  const asCard = variant === 'card' || isMobile;

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hexToRgbaSafe(c.color, 0.13), border: `1.5px ${c.dashed ? 'dashed' : 'solid'} ${c.color}` }}>
        {c.avatar
          ? <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--ui-font)', color: c.color }}>{c.avatar}</span>
          : <Icon name={c.icon} size={15} color={c.color} />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-faint)', padding: '1.5px 7px', borderRadius: 999, border: '1px solid var(--border)', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.tag}</span>
        </div>
        {c.sub && <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{c.sub}</div>}
      </div>
      <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--fg-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );

  const body = (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {c.body}
      {c.cta && (
        <button onClick={c.cta.onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 32, margin: '0 8px', borderRadius: 8, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name={c.cta.icon || 'graph'} size={13} color="var(--accent)" />{c.cta.label}
        </button>
      )}
    </div>
  );

  const shell = { display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' };
  if (asCard) return (
    <div style={{ ...shell, border: '1px solid var(--border-strong)', position: 'absolute', right: 14, bottom: 14, width: isMobile ? 'calc(100% - 28px)' : 308, maxHeight: '62%', borderRadius: 13, animation: 'giIn 0.16s ease-out' }}>
      {header}{body}
      <style>{'@keyframes giIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }'}</style>
    </div>
  );
  return (
    <div style={{ ...shell, borderLeft: '1px solid var(--border-strong)', position: 'absolute', right: 0, top: 0, bottom: 0, width: 312, animation: 'giSlide 0.18s ease-out' }}>
      {header}{body}
      <style>{'@keyframes giSlide { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }'}</style>
    </div>
  );
}

Object.assign(window, { GraphInspector });
