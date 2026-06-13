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
  const base = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 8, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', whiteSpace: 'nowrap' };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--border)' };
  return { ...base, background: 'transparent', color: 'var(--fg)', borderColor: 'var(--border)' };
}
const ROLE_TONE = { Owner: 'accent', Admin: 'accent', Editor: 'success', Viewer: 'muted', Member: 'muted' };
function RoleBadge({ role }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: STONE[ROLE_TONE[role]], background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px' }}>{role}</span>;
}

// ── row overflow menu (3 dots) — holds destructive / secondary row actions ───
function RowMenu({ items }) {
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'inline-flex' }}>
      <IngMenu width={210} align="right" trigger={(open) => (
        <button title="More actions" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid ' + (open ? 'var(--border-strong)' : 'transparent'), background: open ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="more" size={16} color="var(--fg-muted)" />
        </button>
      )}>
        {(close) => (
          <div style={{ padding: 6 }}>
            {items.map((it, i) => (
              <React.Fragment key={i}>
                {it.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />}
                <button onClick={() => { it.onClick(); close(); }} style={{ ...ingRowBtn(), color: it.danger ? 'var(--destructive)' : 'var(--fg)' }}>
                  <Icon name={it.icon} size={14} color={it.danger ? 'var(--destructive)' : 'var(--fg-muted)'} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{it.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </IngMenu>
    </span>
  );
}

// ── email field with a directory suggestion dropdown ─────────────────────────
// Suggests known people as you type; still accepts any free-typed email.
function EmailSuggest({ value, onChange, candidates, onEnter, placeholder = 'Enter email address' }) {
  const [focused, setFocused] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const blurT = React.useRef(null);
  const q = value.trim().toLowerCase();
  const matches = (q ? candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)) : candidates).slice(0, 6);
  const open = focused && matches.length > 0;
  const pick = (c) => { onChange(c.email); setFocused(false); setActiveIdx(0); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[activeIdx]) pick(matches[activeIdx]); else onEnter && onEnter(); }
    else if (e.key === 'Escape') { setFocused(false); }
  };
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input value={value} type="email" placeholder={placeholder}
        style={{ width: '100%', height: 38, padding: '0 34px 0 12px', borderRadius: 9, border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none', boxShadow: focused ? '0 0 0 3px var(--accent-soft)' : 'none', transition: 'border-color .12s, box-shadow .12s' }}
        onChange={(e) => { onChange(e.target.value); setActiveIdx(0); }}
        onFocus={() => { clearTimeout(blurT.current); setFocused(true); }}
        onBlur={() => { blurT.current = setTimeout(() => setFocused(false), 130); }}
        onKeyDown={onKey} />
      <span style={{ position: 'absolute', right: 11, top: 11, color: 'var(--fg-faint)', pointerEvents: 'none' }}><Icon name="search" size={15} color="var(--fg-faint)" /></span>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.4)', overflow: 'hidden', padding: 5 }}>
          {matches.map((c, i) => (
            <button key={c.u} onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActiveIdx(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: activeIdx === i ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
              <Avatar u={c.u} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

// ── Members — organization directory ─────────────────────────────────────────
// People belong to the org and hold a role *per workspace* — Admin or Member.
// The org Owner is implicitly admin of every workspace. Vault-only collaborators
// (Editor / Viewer) are guests and live in their own tab.
const TENANT_ROLE_DESC = {
  Owner: 'Owns the organization — admin of every workspace, plus billing and org settings.',
  Admin: 'Manage members, workspaces and organization settings.',
  Member: 'Access only the workspaces they are added to.',
};
const WS_LABEL = { default: 'default', 'research-q3': 'research-q3', engineering: 'engineering', personal: 'personal' };
const WS_LIST = Object.keys(WS_LABEL);
const WS_ROLE_DESC = {
  Admin: 'Manage members and every vault in this workspace.',
  Member: 'Read and write all vaults in this workspace.',
};
const wsRoleOpts = ['Admin', 'Member'].map((r) => ({ id: r, label: r, icon: 'shield', desc: WS_ROLE_DESC[r] }));
const wsOpts = WS_LIST.map((w) => ({ id: w, label: WS_LABEL[w] || w, icon: 'layers' }));

const TENANT_SEED = [
  { u: 'alice', you: true, owner: true, presence: 'active', last: 'Active now', ws: [] },
  { u: 'bob', presence: 'active', last: '2h ago', ws: [{ w: 'engineering', role: 'Admin' }, { w: 'default', role: 'Member' }, { w: 'research-q3', role: 'Member' }] },
  { u: 'grace', presence: 'active', last: '1d ago', ws: [{ w: 'engineering', role: 'Admin' }] },
  { u: 'carol', presence: 'active', last: '5h ago', ws: [{ w: 'default', role: 'Member' }, { w: 'research-q3', role: 'Member' }] },
  { u: 'eve', presence: 'away', last: '3d ago', ws: [{ w: 'research-q3', role: 'Member' }] },
  { u: 'frank', presence: 'away', last: '1w ago', ws: [{ w: 'research-q3', role: 'Member' }, { w: 'engineering', role: 'Member' }] },
  { u: 'henry', presence: 'active', last: '4h ago', ws: [{ w: 'engineering', role: 'Member' }, { w: 'default', role: 'Member' }] },
  { u: 'dan', status: 'invited', presence: 'offline', last: 'Invited 2d ago', ws: [{ w: 'default', role: 'Member' }] },
];

// Vault-only guests — external collaborators with access to specific vaults only.
const VAULT_LIST = ['Cell biology', 'Microscopy', 'Q3 research', 'Engineering docs'];
const GUEST_LEVEL_DESC = { Editor: 'Read and write the vaults they are added to.', Viewer: 'Read-only access to specific vaults.' };
const guestLevelOpts = ['Editor', 'Viewer'].map((r) => ({ id: r, label: r, icon: r === 'Editor' ? 'pencil' : 'file', desc: GUEST_LEVEL_DESC[r] }));
const GUEST_SEED = [
  { u: 'mia@partner.io', name: 'Mia Tran', presence: 'active', vaults: [{ v: 'Q3 research', level: 'Viewer' }] },
  { u: 'leo@contractor.dev', name: 'Leo Marsh', presence: 'offline', vaults: [{ v: 'Engineering docs', level: 'Editor' }, { v: 'Cell biology', level: 'Viewer' }] },
];

// Groups bundle people so an access level can be granted once and applied to
// everyone inside. Owner is intentionally excluded — ownership can't be auto-granted.
const ROLE_RANK = { Owner: 3, Admin: 2, Member: 1 };

// presence dot overlaid on an avatar
function PresenceAvatar({ u, size = 36, presence }) {
  const tone = presence === 'active' ? 'var(--success)' : presence === 'away' ? 'var(--warning)' : null;
  return (
    <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
      <Avatar u={u} size={size} />
      {tone && <span title={presence === 'active' ? 'Active now' : 'Away'} style={{ position: 'absolute', right: -1, bottom: -1, width: Math.round(size * 0.3), height: Math.round(size * 0.3), borderRadius: '50%', background: tone, border: '2px solid var(--surface)' }} />}
    </span>
  );
}

// inline "add to workspace / share a vault" expander used in member + guest rows
function AddScopeRow({ label, taken, allOpts, levelOpts, defaultLevel, onAdd }) {
  const [open, setOpen] = React.useState(false);
  const avail = allOpts.filter((o) => !taken.includes(o.id));
  const [scope, setScope] = React.useState(avail.length ? avail[0].id : null);
  const [level, setLevel] = React.useState(defaultLevel);
  React.useEffect(() => { if (!avail.some((o) => o.id === scope)) setScope(avail.length ? avail[0].id : null); }, [taken]);
  if (!avail.length) return null;
  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ ...sbtn(), marginTop: 12, height: 32 }}><Icon name="plus" size={13} /> {label}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <LevelSelect value={scope} options={avail} onPick={setScope} width={180} />
      <LevelSelect value={level} options={levelOpts} onPick={setLevel} width={150} />
      <button onClick={() => { onAdd(scope, level); setOpen(false); }} style={{ ...sbtn('primary'), height: 38 }}>Add</button>
      <button onClick={() => setOpen(false)} style={{ ...sbtn(), height: 38 }}>Cancel</button>
    </div>
  );
}
// Groups now carry per-workspace roles just like people — a group can be Admin
// of one workspace and Member of another. Everyone in the group inherits them.
const GROUP_SEED = [
  { id: 'research-team', name: 'Research team', ws: [{ w: 'research-q3', role: 'Member' }, { w: 'default', role: 'Member' }], members: ['carol', 'eve', 'frank'] },
  { id: 'eng-leads', name: 'Engineering leads', ws: [{ w: 'engineering', role: 'Admin' }, { w: 'default', role: 'Member' }], members: ['grace', 'henry'] },
];

// ── shared per-workspace role list ───────────────────────────────────────────
// Used by BOTH people rows and group rows. Each workspace carries its own
// Admin/Member level. `inherited` rows (granted by a group) render locked — they
// can only be changed from the Groups tab.
function WsRoleEditor({ ws, inherited = [], setRole, removeWs, addWs, emptyText = 'Not in any workspace yet.' }) {
  const wsIcon = { width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0 };
  return (
    <React.Fragment>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>Workspace roles</div>
      {(ws.length > 0 || inherited.length > 0) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ws.map((x) => (
            <div key={x.w} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={wsIcon}><Icon name="layers" size={13} /></span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{WS_LABEL[x.w] || x.w}</span>
              <MiniSelect value={x.role} width={210} icon="shield"
                options={[...wsRoleOpts, { id: '__remove', label: 'Remove from workspace', icon: 'trash', danger: true, divider: true }]}
                onPick={(v) => { if (v === '__remove') removeWs(x.w); else setRole(x.w, v); }} />
            </div>
          ))}
          {inherited.map((x, i) => (
            <div key={'inh-' + x.w + '-' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ ...wsIcon, color: 'var(--fg-faint)' }}><Icon name="layers" size={13} /></span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{WS_LABEL[x.w] || x.w}</span>
                <span title={`Granted via the ${x.via} group`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 5, color: 'var(--fg-muted)', background: 'var(--surface-2)' }}><Icon name="users" size={10} color="var(--fg-muted)" /> {x.via}</span>
              </span>
              <span title="Granted by a group — change it from the Groups tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                <Icon name="lock" size={12} color="var(--fg-faint)" /> {x.role}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>{emptyText}</div>
      )}
      {addWs && <AddScopeRow label="Add to workspace" taken={ws.map((x) => x.w)} allOpts={wsOpts} levelOpts={wsRoleOpts} defaultLevel="Member" onAdd={addWs} />}
    </React.Fragment>
  );
}

// small confirm / notice modal
function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)' }} />
      <div style={{ position: 'relative', width: 420, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', color: danger ? 'var(--destructive)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={danger ? 'shield' : 'key'} size={19} /></span>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</div>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{body}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '18px 20px' }}>
          <button onClick={onClose} style={sbtn()}>{onConfirm ? 'Cancel' : 'OK'}</button>
          {onConfirm && <button onClick={() => { onConfirm(); onClose(); }} style={danger ? { ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' } : sbtn('primary')}>{confirmLabel}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Groups — access bundles ──────────────────────────────────────────────────
// A group holds per-workspace roles + a member list. Every role on the group is
// applied to all its members automatically — so a group can be Admin of one
// workspace and Member of another, exactly like a person.
function GroupsPanel({ groups, setGroups, members, dir, setDialog }) {
  const [name, setName] = React.useState('');
  const [expanded, setExpanded] = React.useState(() => new Set(groups.length ? [groups[0].id] : []));
  const toggleExp = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const nm = name.trim();
  const dupName = groups.some((g) => g.name.toLowerCase() === nm.toLowerCase());
  const create = () => {
    if (!nm || dupName) return;
    const id = nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 5);
    setGroups((gs) => [...gs, { id, name: nm, ws: [], members: [] }]);
    setExpanded((s) => new Set([...s, id]));
    setName('');
  };
  const setWsRole = (id, w, role) => setGroups((gs) => gs.map((g) => g.id === id ? { ...g, ws: g.ws.map((x) => x.w === w ? { ...x, role } : x) } : g));
  const removeWs = (id, w) => setGroups((gs) => gs.map((g) => g.id === id ? { ...g, ws: g.ws.filter((x) => x.w !== w) } : g));
  const addWs = (id, w, role) => setGroups((gs) => gs.map((g) => g.id === id ? (g.ws.some((x) => x.w === w) ? g : { ...g, ws: [...g.ws, { w, role }] }) : g));
  const addMember = (id, u) => setGroups((gs) => gs.map((g) => g.id === id ? (g.members.includes(u) ? g : { ...g, members: [...g.members, u] }) : g));
  const removeMember = (id, u) => setGroups((gs) => gs.map((g) => g.id === id ? { ...g, members: g.members.filter((x) => x !== u) } : g));
  const removeGroup = (g) => setDialog({ title: `Delete “${g.name}”?`, danger: true, confirmLabel: 'Delete group', body: `The ${g.members.length} ${g.members.length === 1 ? 'person' : 'people'} in this group lose the workspace access it granted. Their own direct roles are unchanged.`, onConfirm: () => setGroups((gs) => gs.filter((x) => x.id !== g.id)) });

  const groupTop = (g) => g.ws.some((x) => x.role === 'Admin') ? 'Admin' : 'Member';
  const candidates = (g) => members.filter((m) => !g.members.includes(m.u)).map((m) => ({ u: m.u, name: dir(m.u).name, email: dir(m.u).email }));
  const createInput = { flex: 1, minWidth: 0, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };

  return (
    <SCard title="Groups" desc="Bundle people together and grant workspace access once. Every role you set on a group applies to everyone in it — and a group can be admin of one workspace and member of another, just like a person.">
      {/* create bar — just a name; grant workspace access after, per row */}
      <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Create a group</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input value={name} placeholder="Group name — e.g. Research team" style={createInput}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
          <button onClick={create} disabled={!nm || dupName} style={{ ...sbtn('primary'), height: 38, flexShrink: 0, opacity: (nm && !dupName) ? 1 : 0.5, cursor: (nm && !dupName) ? 'pointer' : 'not-allowed' }}>
            <Icon name="plus" size={14} color="#fff" /> Create group
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 8 }}>New groups start with no workspace access — expand the group to grant it.</div>
        {dupName && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>A group with that name already exists.</div>}
      </div>

      {/* group rows — same shape as the People list */}
      <div>
        {groups.map((g, i) => {
          const open = expanded.has(g.id);
          const last = i === groups.length - 1;
          const tr = groupTop(g);
          return (
            <div key={g.id} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }} onClick={() => toggleExp(g.id)}>
                <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="users" size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{g.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{g.members.length} {g.members.length === 1 ? 'person' : 'people'}</div>
                </div>
                <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                    {g.ws.length > 0
                      ? <React.Fragment><Icon name="layers" size={12} color="var(--fg-muted)" /><span>{g.ws.length} workspace{g.ws.length === 1 ? '' : 's'}</span></React.Fragment>
                      : <span style={{ color: 'var(--fg-faint)' }}>No access yet</span>}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}><RoleBadge role={tr} /></div>
                <RowMenu items={[{ label: 'Delete group', icon: 'trash', danger: true, onClick: () => removeGroup(g) }]} />
              </div>

              {open && (
                <div style={{ padding: '4px 0 16px 60px' }}>
                  <WsRoleEditor ws={g.ws}
                    setRole={(w, v) => setWsRole(g.id, w, v)}
                    removeWs={(w) => removeWs(g.id, w)}
                    addWs={(w, role) => addWs(g.id, w, role)}
                    emptyText="No workspace access yet — add one below." />

                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '18px 0 8px' }}>Members · {g.members.length}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 12px', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                    <Icon name="shield" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                    <span>Everyone below inherits the roles above. They show on each person's row, locked.</span>
                  </div>
                  <AddPersonBar candidates={candidates(g)} hideLevel defaultLevel="__inherit" levelOptions={[]}
                    placeholder="Add a person to this group" onAdd={(u) => addMember(g.id, u)} />
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.members.map((u) => {
                      const p = dir(u);
                      return (
                        <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                          <Avatar u={u} size={30} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
                          </div>
                          <button onClick={() => removeMember(g.id, u)} title="Remove from group" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} color="var(--fg-muted)" /></button>
                        </div>
                      );
                    })}
                    {g.members.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '8px 0' }}>No one in this group yet — add someone above.</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No groups yet. Create one above to grant access in bulk.</div>
        )}
      </div>
    </SCard>
  );
}

// ── Guests — vault-only collaborators ────────────────────────────────────────
// Guests aren't org members. Each is granted Editor/Viewer on specific vaults.
function GuestsPanel({ guests, setGuests, setDialog }) {
  const [email, setEmail] = React.useState('');
  const [vault, setVault] = React.useState(VAULT_LIST[0]);
  const [level, setLevel] = React.useState('Viewer');
  const [expanded, setExpanded] = React.useState(() => new Set(guests.length ? [guests[0].u] : []));
  const toggleExp = (u) => setExpanded((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const guestVaultOpts = VAULT_LIST.map((v) => ({ id: v, label: v, icon: 'folder' }));

  const addr = email.trim();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr);
  const exists = guests.some((g) => g.u.toLowerCase() === addr.toLowerCase());
  // directory people not already guests → invite suggestions
  const guestCandidates = Object.keys(window.WS_PEOPLE || {})
    .filter((u) => { const em = (window.WS_PEOPLE[u].email || '').toLowerCase(); return !guests.some((g) => g.u.toLowerCase() === em); })
    .map((u) => ({ u, name: window.WS_PEOPLE[u].name, email: window.WS_PEOPLE[u].email }));
  const invite = () => {
    if (!validEmail || exists) return;
    const known = Object.keys(window.WS_PEOPLE || {}).find((u) => (window.WS_PEOPLE[u].email || '').toLowerCase() === addr.toLowerCase());
    const handle = known ? window.WS_PEOPLE[known].name : addr.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setGuests((gs) => [...gs, { u: addr, name: handle, presence: 'offline', vaults: [{ v: vault, level }] }]);
    setExpanded((s) => new Set([...s, addr]));
    setEmail(''); setVault(VAULT_LIST[0]); setLevel('Viewer');
  };
  const setVaultLevel = (u, v, lvl) => setGuests((gs) => gs.map((g) => g.u === u ? { ...g, vaults: g.vaults.map((x) => x.v === v ? { ...x, level: lvl } : x) } : g));
  const removeVault = (u, v) => setGuests((gs) => gs.map((g) => g.u === u ? { ...g, vaults: g.vaults.filter((x) => x.v !== v) } : g));
  const addVault = (u, v, lvl) => setGuests((gs) => gs.map((g) => g.u === u ? (g.vaults.some((x) => x.v === v) ? g : { ...g, vaults: [...g.vaults, { v, level: lvl }] }) : g));
  const removeGuest = (g) => setDialog({ title: `Remove ${g.name}?`, danger: true, confirmLabel: 'Remove guest', body: 'They lose access to every vault shared with them. Your content stays.', onConfirm: () => setGuests((gs) => gs.filter((x) => x.u !== g.u)) });

  const inviteInput = { flex: 1, minWidth: 0, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };

  return (
    <SCard title="Guests" desc="External collaborators with access to specific vaults only — never a whole workspace. Grant Editor or Viewer per vault.">
      {/* invite bar */}
      <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Invite a guest</div>
        <EmailSuggest value={email} onChange={setEmail} candidates={guestCandidates} onEnter={invite} placeholder="Enter email or name…" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Share</span>
          <LevelSelect value={vault} options={guestVaultOpts} onPick={setVault} width={180} />
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>as</span>
          <LevelSelect value={level} options={guestLevelOpts} onPick={setLevel} width={150} />
          <button onClick={invite} disabled={!validEmail || exists} style={{ ...sbtn('primary'), height: 38, marginLeft: 'auto', opacity: (validEmail && !exists) ? 1 : 0.5, cursor: (validEmail && !exists) ? 'pointer' : 'not-allowed' }}>
            <Icon name="plus" size={14} color="#fff" /> Invite guest
          </button>
        </div>
        {addr && !validEmail && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>Enter a valid email address.</div>}
        {exists && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>That guest already has access.</div>}
      </div>

      {/* guest list — same row shape as the People tab */}
      <div>
        {guests.map((g, i) => {
          const open = expanded.has(g.u);
          const last = i === guests.length - 1;
          const taken = g.vaults.map((x) => x.v);
          const topLevel = g.vaults.some((x) => x.level === 'Editor') ? 'Editor' : 'Viewer';
          return (
            <div key={g.u} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
              <div onClick={() => toggleExp(g.u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }}>
                <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                <PresenceAvatar u={g.u} size={36} presence={g.presence} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>{g.name}<span style={{ fontSize: 10, color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 5, padding: '1px 6px' }}>guest</span></div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.u}</div>
                </div>
                <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                    {g.vaults.length > 0
                      ? <React.Fragment><Icon name="folder" size={12} color="var(--fg-muted)" /><span>{g.vaults.length} vault{g.vaults.length === 1 ? '' : 's'}</span></React.Fragment>
                      : <span style={{ color: 'var(--fg-faint)' }}>No vaults yet</span>}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}><RoleBadge role={topLevel} /></div>
                <RowMenu items={[{ label: 'Remove guest', icon: 'trash', danger: true, onClick: () => removeGuest(g) }]} />
              </div>
              {open && (
                <div style={{ padding: '4px 0 16px 60px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>Vault access</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.vaults.map((x) => (
                      <div key={x.v} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                        <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0 }}><Icon name="folder" size={13} /></span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{x.v}</span>
                        <MiniSelect value={x.level} width={188} icon="shield"
                          options={[...guestLevelOpts, { id: '__remove', label: 'Remove vault', icon: 'trash', danger: true, divider: true }]}
                          onPick={(v) => { if (v === '__remove') removeVault(g.u, x.v); else setVaultLevel(g.u, x.v, v); }} />
                      </div>
                    ))}
                    {g.vaults.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>No vaults shared yet.</div>}
                  </div>
                  <AddScopeRow label="Share a vault" taken={taken} allOpts={guestVaultOpts} levelOpts={guestLevelOpts} defaultLevel="Viewer" onAdd={(v, lvl) => addVault(g.u, v, lvl)} />
                </div>
              )}
            </div>
          );
        })}
        {guests.length === 0 && (
          <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No guests yet. Invite one above to share a vault.</div>
        )}
      </div>
    </SCard>
  );
}

function MembersSection() {
  const [members, setMembers] = React.useState(TENANT_SEED);
  const [groups, setGroups] = React.useState(GROUP_SEED);
  const [guests, setGuests] = React.useState(GUEST_SEED);
  const [view, setView] = React.useState('people');
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [email, setEmail] = React.useState('');
  const [inviteWs, setInviteWs] = React.useState('default');
  const [inviteRole, setInviteRole] = React.useState('Member');
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [dialog, setDialog] = React.useState(null);

  const dir = (u) => (window.WS_PEOPLE && window.WS_PEOPLE[u]) || { name: u, email: u };
  // roles a person picks up from the groups they belong to → [{ w, role, via }]
  const inheritedWs = (u) => groups.filter((g) => g.members.includes(u)).flatMap((g) => g.ws.map((x) => ({ w: x.w, role: x.role, via: g.name })));
  const isAdminAnywhere = (m) => !m.owner && (m.ws.some((x) => x.role === 'Admin') || inheritedWs(m.u).some((x) => x.role === 'Admin'));
  const topRole = (m) => m.owner ? 'Owner' : (isAdminAnywhere(m) ? 'Admin' : 'Member');
  const counts = {
    all: members.length,
    owner: members.filter((m) => m.owner).length,
    admin: members.filter(isAdminAnywhere).length,
    member: members.filter((m) => topRole(m) === 'Member').length,
  };
  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    const p = dir(m.u);
    if (filter !== 'all' && topRole(m).toLowerCase() !== filter) return false;
    if (q && !(p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => ROLE_RANK[topRole(b)] - ROLE_RANK[topRole(a)]);

  const removeM = (u) => setMembers((ms) => ms.filter((m) => m.u !== u));
  const toggleExp = (u) => setExpanded((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; });
  // per-workspace role management
  const setWsRole = (u, w, role) => setMembers((ms) => ms.map((m) => m.u === u ? { ...m, ws: m.ws.map((x) => x.w === w ? { ...x, role } : x) } : m));
  const removeWs = (u, w) => setMembers((ms) => ms.map((m) => m.u === u ? { ...m, ws: m.ws.filter((x) => x.w !== w) } : m));
  const addWs = (u, w, role) => setMembers((ms) => ms.map((m) => m.u === u ? (m.ws.some((x) => x.w === w) ? m : { ...m, ws: [...m.ws, { w, role }] }) : m));
  const requestRemove = (m) => {
    if (m.you) { setDialog({ title: "You can't remove yourself", body: 'Ask another owner to remove your account, or step down first.', onConfirm: null }); return; }
    if (m.owner) { setDialog({ title: "Can't remove the owner", body: 'Transfer ownership to someone else before removing this person.', onConfirm: null }); return; }
    setDialog({ title: `Remove ${dir(m.u).name}?`, danger: true, confirmLabel: 'Remove', body: 'They lose access to the organization and all its workspaces. Their content stays.', onConfirm: () => removeM(m.u) });
  };

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const exists = members.some((m) => (dir(m.u).email || '').toLowerCase() === email.trim().toLowerCase());
  // known directory people who aren't members yet → invite suggestions
  const inviteCandidates = Object.keys(window.WS_PEOPLE || {})
    .filter((u) => !members.some((m) => m.u === u || (dir(m.u).email || '').toLowerCase() === (window.WS_PEOPLE[u].email || '').toLowerCase()))
    .map((u) => ({ u, name: window.WS_PEOPLE[u].name, email: window.WS_PEOPLE[u].email }));
  const invite = () => {
    if (!validEmail || exists) return;
    const addr = email.trim();
    const handle = addr.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const known = Object.keys(window.WS_PEOPLE || {}).find((u) => (window.WS_PEOPLE[u].email || '').toLowerCase() === addr.toLowerCase());
    const key = known || addr;
    if (!known && window.WS_PEOPLE) window.WS_PEOPLE[addr] = { name: handle, email: addr };
    setMembers((ms) => [...ms, { u: key, status: 'invited', presence: 'offline', last: 'Invited just now', ws: [{ w: inviteWs, role: inviteRole }] }]);
    setEmail(''); setInviteWs('default'); setInviteRole('Member');
  };

  const filters = [
    { id: 'all', label: 'All', n: counts.all },
    { id: 'owner', label: 'Owner', n: counts.owner },
    { id: 'admin', label: 'Admins', n: counts.admin },
    { id: 'member', label: 'Members', n: counts.member },
  ];
  const inviteInput = { flex: 1, minWidth: 0, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };

  return (
    <div>
      {/* People / Groups toggle */}
      <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 10, marginBottom: 18 }}>
        {[{ id: 'people', label: 'People', icon: 'user', n: members.length }, { id: 'groups', label: 'Groups', icon: 'users', n: groups.length }, { id: 'guests', label: 'Guests', icon: 'mail', n: guests.length }].map((t) => {
          const on = view === t.id;
          return (
            <button key={t.id} onClick={() => setView(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
              <Icon name={t.icon} size={15} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />{t.label}
              <span style={{ fontSize: 11, color: on ? 'var(--fg-muted)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{t.n}</span>
            </button>
          );
        })}
      </div>
      {view === 'groups' ? (
        <GroupsPanel groups={groups} setGroups={setGroups} members={members} dir={dir} setDialog={setDialog} />
      ) : view === 'guests' ? (
        <GuestsPanel guests={guests} setGuests={setGuests} setDialog={setDialog} />
      ) : (
      <SCard title="Organization members" desc="Everyone in your Brain2 organization. Roles are granted per workspace — expand a row to manage which workspaces someone belongs to and whether they're an admin or member.">
        {/* invite bar */}
        <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Invite someone to the organization</div>
          <EmailSuggest value={email} onChange={setEmail} candidates={inviteCandidates} onEnter={invite} placeholder="Enter email or name…" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Add to</span>
            <LevelSelect value={inviteWs} options={wsOpts} onPick={setInviteWs} width={180} />
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>as</span>
            <LevelSelect value={inviteRole} options={wsRoleOpts} onPick={setInviteRole} width={150} />
            <button onClick={invite} disabled={!validEmail || exists} style={{ ...sbtn('primary'), height: 38, marginLeft: 'auto', opacity: (validEmail && !exists) ? 1 : 0.5, cursor: (validEmail && !exists) ? 'pointer' : 'not-allowed' }}>
              <Icon name="plus" size={14} color="#fff" /> Invite
            </button>
          </div>
          {email.trim() && !validEmail && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>Enter a valid email address.</div>}
          {exists && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>That person is already in your organization.</div>}
        </div>

        {/* toolbar: search + filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
            <span style={{ position: 'absolute', left: 11, top: 9, color: 'var(--fg-faint)', pointerEvents: 'none' }}><Icon name="search" size={15} color="var(--fg-faint)" /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…"
              style={{ width: '100%', height: 34, padding: '0 12px 0 34px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9 }}>
            {filters.map((f) => {
              const on = filter === f.id;
              return (
                <button key={f.id} onClick={() => setFilter(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
                  {f.label}<span style={{ fontSize: 11, color: on ? 'var(--fg-muted)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{f.n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* rows */}
        <div>
          {shown.map((m, i) => {
            const p = dir(m.u);
            const last = i === shown.length - 1;
            const open = expanded.has(m.u);
            const mGroups = groups.filter((g) => g.members.includes(m.u));
            const tr = topRole(m);
            return (
              <div key={m.u} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }} onClick={() => toggleExp(m.u)}>
                  <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                  <PresenceAvatar u={m.u} size={36} presence={m.presence} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
                      {p.name}
                      {m.you && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', fontWeight: 400 }}>you</span>}
                      {m.status === 'invited' && <span style={{ fontSize: 10, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clock" size={10} /> invited</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
                    {mGroups.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                        {mGroups.map((g) => {
                          const gAdmin = g.ws.some((x) => x.role === 'Admin');
                          return (
                            <span key={g.id} title={`Inherits this group's workspace roles${gAdmin ? ' (incl. Admin)' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 5, color: gAdmin ? 'var(--accent)' : 'var(--fg-muted)', background: gAdmin ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
                              <Icon name="users" size={10} color={gAdmin ? 'var(--accent)' : 'var(--fg-muted)'} /> {g.name}{gAdmin ? ' · Admin' : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                      {m.owner
                        ? <span style={{ color: 'var(--fg-muted)' }}>All workspaces</span>
                        : m.ws.length > 0
                          ? <React.Fragment><Icon name="layers" size={12} color="var(--fg-muted)" /><span>{m.ws.length} workspace{m.ws.length === 1 ? '' : 's'}</span></React.Fragment>
                          : <span style={{ color: 'var(--fg-faint)' }}>No workspaces yet</span>}
                    </div>
                    {m.presence !== 'active' && <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 2 }}>{m.last}</div>}
                  </div>

                  <div style={{ flexShrink: 0 }}><RoleBadge role={tr} /></div>
                  {!m.you && <RowMenu items={[{ label: 'Remove from organization', icon: 'trash', danger: true, onClick: () => requestRemove(m) }]} />}
                </div>

                {open && (
                  <div style={{ padding: '4px 0 16px 60px' }}>
                    {m.owner ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                        <Icon name="shield" size={15} color="var(--accent)" />
                        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>As organization owner, {m.you ? 'you are' : 'they are'} an admin of every workspace automatically.</span>
                      </div>
                    ) : (
                    <React.Fragment>
                      <WsRoleEditor ws={m.ws} inherited={inheritedWs(m.u)}
                        setRole={(w, v) => setWsRole(m.u, w, v)}
                        removeWs={(w) => removeWs(m.u, w)}
                        addWs={(w, role) => addWs(m.u, w, role)}
                        emptyText={`Not in any workspace yet.${m.status === 'invited' ? ' Their invite is still pending.' : ''}`} />
                    </React.Fragment>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 && (
            <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No people match your search.</div>
          )}
        </div>
      </SCard>
      )}

      {dialog && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
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
