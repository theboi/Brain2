/* Brain2 Console — Workspaces: slide-over drawers + new-workspace modal.
   Mounted INSIDE the app root so the theme CSS vars resolve.
   Depends on globals from components.jsx: Icon, IngMenu, ingPill, ingRowBtn,
   ModePicker, ACCESS_LEVELS, RoleBadge, sbtn. */

// ── people directory (shared with workspaces.jsx via window) ────────────────
const WS_PEOPLE = {
  alice: { name: 'Alice Chen', email: 'alice@brain2.dev' },
  bob:   { name: 'Bob Ng', email: 'bob@brain2.dev' },
  carol: { name: 'Carol Diaz', email: 'carol@brain2.dev' },
  dan:   { name: 'Dan Park', email: 'dan@brain2.dev' },
  eve:   { name: 'Eve Liu', email: 'eve@brain2.dev' },
  frank: { name: 'Frank Oyelaran', email: 'frank@brain2.dev' },
  grace: { name: 'Grace Kim', email: 'grace@brain2.dev' },
  henry: { name: 'Henry Voss', email: 'henry@brain2.dev' },
};
const ROLE_ORDER = ['Owner', 'Admin', 'Editor', 'Viewer'];
const ROLE_DESC = {
  Owner: 'Full control of the workspace and its vaults.',
  Admin: 'Manage members and vaults. Cannot delete the workspace.',
  Editor: 'Read and write vault contents.',
  Viewer: 'Read-only access to vaults.',
};

function Avatar({ u, size = 32 }) {
  const p = WS_PEOPLE[u] || { name: u };
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600 }}>{p.name[0]}</span>
  );
}

// ── generic right slide-over ────────────────────────────────────────────────
function WsDrawer({ title, sub, icon, onClose, children, footer, width = 452 }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(2px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${width}px, 94vw)`, background: 'var(--surface)', borderLeft: '1px solid var(--border-strong)', boxShadow: '-16px 0 48px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column', transform: shown ? 'none' : 'translateX(100%)', transition: 'transform .26s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }} title="Close"><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── centered overlay shell (same prop surface as WsDrawer) ──────────────────
function OverlayShell({ title, sub, icon, onClose, children, footer, width = 520 }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    // rAF can be throttled in background/preview frames — pair it with a timeout
    // so the entrance state always lands and the card never stays at opacity 0.
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width, maxWidth: '100%', maxHeight: '88vh', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.985)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }} title="Close"><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── tiny dropdown (role / access level / workspace) ─────────────────────────
function MiniSelect({ value, options, onPick, disabled, width = 168, align = 'right', icon }) {
  const cur = options.find((o) => o.id === value) || options[0];
  if (disabled) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}>
        {icon && <Icon name={cur.icon || icon} size={13} color="var(--fg-faint)" />}{cur.label}
      </span>
    );
  }
  return (
    <IngMenu width={width} align={align} trigger={(open) => (
      <button style={ingPill(open)}>
        {(icon || cur.icon) && <Icon name={cur.icon || icon} size={13} color="var(--fg-muted)" />}
        <span>{cur.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {options.map((o) => (
            <React.Fragment key={o.id}>
              {o.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />}
              <button onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '8px 9px' }}>
                {o.icon && <Icon name={o.icon} size={14} color={o.danger ? 'var(--destructive)' : (value === o.id ? 'var(--accent)' : 'var(--fg-muted)')} style={{ marginTop: 1 }} />}
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontWeight: 600, fontSize: 12.5, color: o.danger ? 'var(--destructive)' : 'var(--fg)' }}>{o.label}</b>{value === o.id && !o.danger && <Icon name="check" size={13} color="var(--accent)" />}</span>
                  {o.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>}
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

// ── level / role dropdown sized to sit beside the add-member input ──────────
function LevelSelect({ value, options, onPick, width = 200 }) {
  const cur = options.find((o) => o.id === value) || options[0];
  return (
    <IngMenu width={width} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 11px', borderRadius: 9, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <Icon name={cur.icon || 'shield'} size={13} color="var(--fg-muted)" />
        <span>{cur.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '8px 9px' }}>
              <Icon name={o.icon || 'shield'} size={14} color={value === o.id ? 'var(--accent)' : 'var(--fg-muted)'} style={{ marginTop: 1 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--fg)' }}>{o.label}</b>{value === o.id && <Icon name="check" size={13} color="var(--accent)" />}</span>
                {o.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

// ── Add-member bar ──────────────────────────────────────────────────────────
// Type a name or email → live suggestions drop down → pick an access level on
// the right → press "+" to push onto the list. Used by every access surface.
// onAdd(key, level): key is a directory id for known people, or the raw email
// for an external invite.
function AddPersonBar({ candidates, levelOptions, defaultLevel, onAdd, placeholder = 'Enter email or name' }) {
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState(null); // candidate {u, name, email}
  const [level, setLevel] = React.useState(defaultLevel);
  const [focused, setFocused] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const blurT = React.useRef(null);

  const q = query.trim().toLowerCase();
  const matches = (q
    ? candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
    : candidates).slice(0, 6);
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query.trim());
  const exact = candidates.find((c) => c.name.toLowerCase() === q || (c.email || '').toLowerCase() === q);
  const showExternal = isEmail && !exact;
  const open = focused && !picked && (matches.length > 0 || showExternal);
  const canAdd = !!picked || !!exact || showExternal;

  const pick = (c) => { setPicked(c); setQuery(c.name); setFocused(false); setActiveIdx(0); };
  const reset = () => { setPicked(null); setQuery(''); setActiveIdx(0); };
  const commit = () => {
    if (picked) onAdd(picked.u, level);
    else if (exact) onAdd(exact.u, level);
    else if (showExternal) onAdd(query.trim(), level);
    else return;
    reset();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[activeIdx]) pick(matches[activeIdx]); else commit(); }
    else if (e.key === 'Escape') { setFocused(false); }
  };

  const inputStyle = { width: '100%', height: 38, padding: '0 34px 0 12px', borderRadius: 9, border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none', boxShadow: focused ? '0 0 0 3px var(--accent-soft)' : 'none', transition: 'border-color .12s, box-shadow .12s' };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <input value={query} placeholder={placeholder} style={inputStyle}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); setActiveIdx(0); }}
          onFocus={() => { clearTimeout(blurT.current); setFocused(true); }}
          onBlur={() => { blurT.current = setTimeout(() => setFocused(false), 130); }}
          onKeyDown={onKey} />
        {picked
          ? <span style={{ position: 'absolute', right: 11, top: 11, color: 'var(--accent)' }}><Icon name="check" size={16} color="var(--accent)" /></span>
          : <span style={{ position: 'absolute', right: 11, top: 11, color: 'var(--fg-faint)', pointerEvents: 'none' }}><Icon name="search" size={15} color="var(--fg-faint)" /></span>}
        {open && (
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.4)', overflow: 'hidden', padding: 5 }}>
            {matches.map((c, i) => (
              <button key={c.u} onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActiveIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: activeIdx === i ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
                <Avatar u={c.u} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  {c.email && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</span>}
                </span>
              </button>
            ))}
            {showExternal && (
              <button onMouseDown={(e) => { e.preventDefault(); onAdd(query.trim(), level); reset(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={14} color="var(--accent)" /></span>
                <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>Invite <b style={{ fontWeight: 600 }}>{query.trim()}</b> by email</span>
              </button>
            )}
          </div>
        )}
      </div>
      <LevelSelect value={level} options={levelOptions} onPick={setLevel} />
      <button onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={!canAdd} title="Add to list"
        style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 9, border: 'none', background: canAdd ? 'var(--accent)' : 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canAdd ? 'pointer' : 'not-allowed' }}>
        <Icon name="plus" size={18} color={canAdd ? '#fff' : 'var(--fg-faint)'} />
      </button>
    </div>
  );
}

// ── shared access row — used by workspace members AND vault access ───────────
// One row: avatar, name (+ tags), sub-line, and a single dropdown that holds
// both the role/level choices and a red "Remove access" action. No cross button.
function AccessRow({ u, name, sub, tag, value, options, locked, badge, canRemove, onChange, onRemove, avatarSize = 32 }) {
  const opts = canRemove
    ? [...options, { id: '__remove', label: 'Remove access', icon: 'trash', danger: true, divider: true }]
    : options;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
      <Avatar u={u} size={avatarSize} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>{name}{tag}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      {locked
        ? badge
        : <MiniSelect value={value} width={188} icon="shield" options={opts}
            onPick={(v) => { if (v === '__remove') onRemove(); else onChange(v); }} />}
    </div>
  );
}

// ── Access / members drawer ─────────────────────────────────────────────────
// caps.canManageMembers — can touch member rows at all
// caps.canAddAdmins     — owner: may grant Admin; admin: members only
// isTenantOwner         — viewing as the tenant owner (sudo over every workspace)
// Shell defaults to the centered overlay; pass Shell={WsDrawer} to reuse the
// original slide-over pullover chrome instead.
function AccessDrawer({ ws, caps, meRole, isTenantOwner, Shell = OverlayShell, onClose, onChangeRole, onRemove, onAdd, onTransfer, onSaveMeta, onArchive, onDelete }) {
  const canEdit = caps.canManageMembers;
  const canDelete = caps.canDelete;
  const [name, setName] = React.useState(ws.name);
  const [desc, setDesc] = React.useState(ws.desc || '');
  const [confirmDel, setConfirmDel] = React.useState(false);

  const present = new Set(ws.members.map((m) => m.u));
  const candidates = Object.keys(WS_PEOPLE).filter((u) => !present.has(u)).map((u) => ({ u, name: WS_PEOPLE[u].name, email: WS_PEOPLE[u].email }));
  const roleOpts = (caps.canAddAdmins ? ['Admin', 'Editor', 'Viewer'] : ['Editor', 'Viewer']).map((r) => ({ id: r, label: r, icon: 'shield', desc: ROLE_DESC[r] }));

  // a row is locked when the actor can't manage it:
  //  - the Owner row is always locked here (transfer is a separate action)
  //  - an admin actor can only manage Editor/Viewer rows
  const rowLocked = (m) => {
    if (!caps.canManageMembers) return true;
    if (m.role === 'Owner') return true;
    if (!caps.canAddAdmins && (m.role === 'Admin')) return true; // admin can't touch other admins
    return false;
  };
  // Workspace owners/admins can hand off ownership; the tenant owner has sudo
  // everywhere, so the action is meaningless for them — hide it.
  const showTransfer = caps.canManageMembers && !isTenantOwner;

  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle = { width: '100%', height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: canEdit ? 'var(--bg)' : 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const dirty = name !== ws.name || desc !== (ws.desc || '');

  return (
    <Shell icon="settings" title={ws.name} sub="Manage workspace" onClose={onClose}
      footer={canEdit
        ? (<React.Fragment>
            <button onClick={onClose} style={sbtn()}>Cancel</button>
            <button onClick={() => { if (onSaveMeta) onSaveMeta(name.trim() || ws.name, desc); onClose(); }} style={{ ...sbtn('primary'), opacity: dirty ? 1 : 0.6 }}>Save changes</button>
          </React.Fragment>)
        : <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>You have read-only access to this workspace.</span>}>

      {!caps.canManageMembers && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', marginBottom: 16, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <Icon name="shield" size={15} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>You're a member here. Only owners and workspace admins can change these settings.</span>
        </div>
      )}

      {/* workspace settings */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Workspace name</label>
        <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      {/* members */}
      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Members · {ws.members.length}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: canEdit ? 12 : 8 }}>People who can access this workspace and its vaults.</div>
        {canEdit && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar candidates={candidates} levelOptions={roleOpts} defaultLevel="Viewer" placeholder="Enter email or name" onAdd={(u, role) => onAdd(u, role)} />
            {!caps.canAddAdmins && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>As an admin you can add Editors and Viewers. Only the owner can grant Admin.</div>}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...ws.members].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).map((m) => {
            const p = WS_PEOPLE[m.u] || { name: m.u, email: '' };
            const locked = rowLocked(m);
            const isMe = m.u === 'alice';
            const displayRole = (isMe && meRole) ? meRole : m.role;
            const tag = (
              <React.Fragment>
                {isMe && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>you</span>}
                {m.status === 'invited' && <span style={{ fontSize: 10, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clock" size={10} /> invited</span>}
              </React.Fragment>
            );
            return (
              <AccessRow key={m.u} u={m.u} name={p.name} sub={p.email} tag={tag}
                value={m.role}
                options={[...(caps.canAddAdmins ? ['Admin'] : []), 'Editor', 'Viewer'].map((r) => ({ id: r, label: r, desc: ROLE_DESC[r] }))}
                locked={locked} badge={<RoleBadge role={displayRole} />}
                canRemove={!locked && !isMe}
                onChange={(r) => onChangeRole(m.u, r)}
                onRemove={() => onRemove(m.u)} />
            );
          })}
        </div>
      </div>

      {showTransfer && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>Transfer ownership</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', margin: '3px 0 10px', lineHeight: 1.45 }}>Hand this workspace to another admin. You'll become an Admin.</div>
          <button onClick={onTransfer} style={sbtn('danger')}>Transfer ownership…</button>
        </div>
      )}

      {/* danger zone — owners only */}
      {canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from everyone; keep all vaults and data.</div>
            </div>
            <button onClick={() => { if (onArchive) onArchive(); }} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Removes {ws.vaults ? ws.vaults.length : 0} vault{(ws.vaults ? ws.vaults.length : 0) === 1 ? '' : 's'} and all sources permanently.</div>
            </div>
            {confirmDel
              ? <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={() => { if (onDelete) onDelete(); }} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              : <button onClick={() => setConfirmDel(true)} style={sbtn('danger')}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!canDelete && caps.canManageMembers && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this workspace.
        </div>
      )}
    </Shell>
  );
}

// ── Vault management drawer ─────────────────────────────────────────────────
const VAULT_MODE_OPTS = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'LLM-summarised wiki pages' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Stored as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Linked live database' },
];
function seedVaultAccess() {
  return [
    { u: 'alice', level: 'admin' },
    { u: 'bob', level: 'write' },
    { u: 'carol', level: 'read' },
  ];
}
function VaultDrawer({ vault, ws, allWorkspaces, caps, Shell = OverlayShell, onClose, onSave, onMove, onArchive, onDelete }) {
  const ro = !caps.canManageVaults;
  const [name, setName] = React.useState(vault.name);
  const [desc, setDesc] = React.useState(vault.desc || '');
  const [mode, setMode] = React.useState(vault.mode);
  const [access, setAccess] = React.useState(vault.access || seedVaultAccess());
  const [moveTo, setMoveTo] = React.useState(ws.id); // pending until Save changes
  const [confirmDel, setConfirmDel] = React.useState(false);

  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle = { width: '100%', height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: ro ? 'var(--surface-2)' : 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' };
  const moveTargets = allWorkspaces.filter((w) => w.id !== ws.id && (caps.canMoveVaults));
  const pendingMove = moveTo !== ws.id;
  const moveTargetName = (allWorkspaces.find((w) => w.id === moveTo) || {}).name;

  return (
    <Shell icon="folder" title={vault.name} sub={`in ${ws.name} · ${vault.items} sources`} onClose={onClose}
      footer={ro ? <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Read-only — you can't edit this vault.</span> : (
        <React.Fragment>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button onClick={() => { onSave({ ...vault, name, desc, mode, access }); if (pendingMove) onMove(moveTo); }} style={sbtn('primary')}>Save changes</button>
        </React.Fragment>
      )}>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Vault name</label>
        <input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={ro} onChange={(e) => setDesc(e.target.value)} placeholder="What lives in this vault?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Default ingestion mode</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>How new sources are processed.</div>
        </div>
        <MiniSelect value={mode} disabled={ro} width={236} options={VAULT_MODE_OPTS} onPick={setMode} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Move to workspace</div>
          <div style={{ fontSize: 11.5, color: pendingMove ? 'var(--accent)' : 'var(--fg-muted)', marginTop: 2 }}>{!caps.canMoveVaults ? 'You can\'t move this vault.' : pendingMove ? `Moves to “${moveTargetName}” when you save.` : 'Relocate this vault and its sources.'}</div>
        </div>
        <MiniSelect value={moveTo} disabled={ro || !moveTargets.length} width={210}
          options={[{ id: ws.id, label: ws.name + ' (current)', icon: 'folder' }, ...moveTargets.map((w) => ({ id: w.id, label: w.name, icon: 'folder' }))]}
          onPick={(t) => setMoveTo(t)} />
      </div>

      {/* per-vault access — same row UI as workspace access */}
      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Who can access this vault</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: ro ? 8 : 12 }}>Overrides the workspace role for this vault only.</div>
        {!ro && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={Object.keys(WS_PEOPLE).filter((u) => !access.some((a) => a.u === u)).map((u) => ({ u, name: WS_PEOPLE[u].name, email: WS_PEOPLE[u].email }))}
              levelOptions={ACCESS_LEVELS.filter((l) => l.id !== 'none').map((l) => ({ id: l.id, label: l.label, icon: l.icon }))}
              defaultLevel="read" placeholder="Enter email or name"
              onAdd={(u, level) => setAccess((prev) => prev.some((x) => x.u === u) ? prev : [...prev, { u, level }])} />
          </div>
        )}
        {access.map((a) => {
          const p = WS_PEOPLE[a.u] || { name: a.u, email: '' };
          const lv = ACCESS_LEVELS.find((l) => l.id === a.level) || ACCESS_LEVELS[0];
          return (
            <AccessRow key={a.u} u={a.u} name={p.name} sub={p.email}
              value={a.level}
              options={ACCESS_LEVELS.filter((l) => l.id !== 'none').map((l) => ({ id: l.id, label: l.label, icon: l.icon }))}
              locked={ro} badge={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}><Icon name={lv.icon} size={13} color="var(--fg-faint)" />{lv.label}</span>}
              canRemove={!ro}
              onChange={(level) => setAccess(access.map((x) => x.u === a.u ? { ...x, level } : x))}
              onRemove={() => setAccess(access.filter((x) => x.u !== a.u))} />
          );
        })}
      </div>

      {/* danger — owners only */}
      {caps.canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from agents; keep the data.</div>
            </div>
            <button onClick={onArchive} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Removes {vault.items} sources permanently.</div>
            </div>
            {confirmDel
              ? <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={onDelete} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              : <button onClick={() => setConfirmDel(true)} style={sbtn('danger')}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!caps.canDelete && !ro && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this vault.
        </div>
      )}
    </Shell>
  );
}

// ── New workspace modal ─────────────────────────────────────────────────────
function NewWorkspaceModal({ onClose, onCreate }) {
  const [shown, setShown] = React.useState(false);
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [invited, setInvited] = React.useState([]); // {u, role}
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);

  const inputStyle = { width: '100%', height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const taken = new Set([...invited.map((i) => i.u), 'alice']);
  const candidates = Object.keys(WS_PEOPLE).filter((u) => !taken.has(u)).map((u) => ({ u, name: WS_PEOPLE[u].name, email: WS_PEOPLE[u].email }));
  const roleOpts = ['Admin', 'Editor', 'Viewer'].map((r) => ({ id: r, label: r, icon: 'shield', desc: ROLE_DESC[r] }));

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 220, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 20px 20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width: 500, maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.98)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>New workspace</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>You'll be the owner.</div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Workspace name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. marketing" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Description <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}>· optional</span></label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <label style={labelStyle}>Members</label>
          <div style={{ marginBottom: 10 }}>
            <AddPersonBar candidates={candidates} levelOptions={roleOpts} defaultLevel="Editor" placeholder="Enter email or name"
              onAdd={(u, role) => setInvited((prev) => prev.some((x) => x.u === u) ? prev : [...prev, { u, role }])} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* owner is always a member */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
              <Avatar u="alice" size={26} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{WS_PEOPLE.alice.name} <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', fontWeight: 400 }}>you</span></span>
              </span>
              <RoleBadge role="Owner" />
              <span style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-faint)' }} title="The owner can't be removed"><Icon name="key" size={13} color="var(--fg-faint)" /></span>
            </div>
            {invited.map((i) => (
              <div key={i.u} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
                <Avatar u={i.u} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{WS_PEOPLE[i.u].name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{WS_PEOPLE[i.u].email}</span>
                </span>
                <RoleBadge role={i.role} />
                <button onClick={() => setInvited(invited.filter((x) => x.u !== i.u))} style={{ ...iconBtn(), width: 26, height: 26, border: 'none' }} title="Remove"><Icon name="x" size={13} color="var(--fg-muted)" /></button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), desc: desc.trim(), invited })} style={{ ...sbtn('primary'), opacity: name.trim() ? 1 : 0.5 }}>Create workspace</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WS_PEOPLE, ROLE_ORDER, ROLE_DESC, Avatar, WsDrawer, OverlayShell, MiniSelect, LevelSelect, AddPersonBar, AccessRow, AccessDrawer, VaultDrawer, NewWorkspaceModal, VAULT_MODE_OPTS });
