/* Brain2 Console — Workspaces management: Kanban board of workspaces with
   draggable vault cards, role-preview switcher, and capability gating.
   Depends on globals: Icon, sbtn, RoleBadge (settings.jsx + components.jsx),
   and the drawers/modal from workspaces-panels.jsx. */

// ── seed data ───────────────────────────────────────────────────────────────
const INITIAL_WS = [
  { id: 'default', name: 'default', adminOf: true, members: [
      { u: 'alice', role: 'Owner' }, { u: 'bob', role: 'Admin' }, { u: 'carol', role: 'Editor' }, { u: 'dan', role: 'Viewer', status: 'invited' } ],
    vaults: [
      { id: 'v_general', name: 'General', mode: 'wiki', items: 142, updated: '2h ago' },
      { id: 'v_fin', name: 'Q2 Financials', mode: 'static', items: 38, updated: '1d ago' },
      { id: 'v_handbook', name: 'Company Handbook', mode: 'wiki', items: 64, updated: '5h ago' } ] },
  { id: 'research-q3', name: 'research-q3', adminOf: true, members: [
      { u: 'alice', role: 'Admin' }, { u: 'carol', role: 'Editor' }, { u: 'frank', role: 'Editor' } ],
    vaults: [
      { id: 'v_research', name: 'User Research', mode: 'wiki', items: 98, updated: '3h ago' },
      { id: 'v_launch', name: 'Launch Docs', mode: 'static', items: 34, updated: '2d ago' } ] },
  { id: 'engineering', name: 'engineering', adminOf: false, members: [
      { u: 'bob', role: 'Owner' }, { u: 'grace', role: 'Admin' }, { u: 'alice', role: 'Viewer' }, { u: 'henry', role: 'Editor' } ],
    vaults: [
      { id: 'v_gateway', name: 'LLM Gateway', mode: 'dynamic', items: 21, updated: '12m ago' },
      { id: 'v_runbooks', name: 'Infra Runbooks', mode: 'wiki', items: 47, updated: '1d ago' },
      { id: 'v_archive', name: 'Archive', mode: 'static', items: 212, updated: '30d ago' } ] },
  { id: 'personal', name: 'personal', adminOf: true, private: true, members: [
      { u: 'alice', role: 'Owner' } ],
    vaults: [
      { id: 'v_notes', name: 'Personal Notes', mode: 'wiki', items: 16, updated: '4h ago' } ] },
];

const MODE_ICON = { wiki: 'wand', static: 'file', dynamic: 'layers' };
const MODE_LABEL = { wiki: 'Wiki', static: 'Static', dynamic: 'Dynamic' };

// ── capability model ────────────────────────────────────────────────────────
// pov: 'owner' | 'admin' | 'member' — what perspective we render the page from.
const RO = { canManageMembers: false, canManageVaults: false, canMoveVaults: false, canAddAdmins: false, canDelete: false, readOnly: true };
function wsCaps(pov, ws) {
  if (pov === 'owner') return { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: true, canDelete: true, readOnly: false };
  if (pov === 'admin') return ws.adminOf
    ? { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: false, canDelete: false, readOnly: false }
    : RO;
  return RO;
}
function myRole(pov, ws) {
  if (pov === 'owner') return 'Owner';
  const m = ws.members.find((x) => x.u === 'alice');
  if (pov === 'admin') return ws.adminOf ? 'Admin' : (m ? m.role : 'Viewer');
  return 'Viewer'; // member persona: a plain member everywhere
}

const POVS = [
  { id: 'owner', label: 'Owner', icon: 'shield', blurb: 'Full control everywhere — create or delete workspaces, move any vault, and add admins or members to any workspace.' },
  { id: 'admin', label: 'Admin', icon: 'user', blurb: 'Manage only the workspaces you administer — their members and vaults. You can\'t create or delete workspaces. Others appear read-only.' },
  { id: 'member', label: 'Member', icon: 'users', blurb: 'A read-only view. Browse the workspaces and vaults you belong to; you can\'t move vaults or change access.' },
];

// ── grip handle ─────────────────────────────────────────────────────────────
function Grip({ dim }) {
  return (
    <span style={{ display: 'grid', gridTemplateColumns: '3px 3px', gap: 3, opacity: dim ? 0.4 : 1, cursor: 'grab', flexShrink: 0 }} title="Drag to move">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)' }} />)}
    </span>
  );
}

// ── vault card ──────────────────────────────────────────────────────────────
function VaultCard({ vault, caps, dragging, onOpen, onDragStart, onDragEnd }) {
  const [hover, setHover] = React.useState(false);
  const draggable = caps.canMoveVaults;
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', borderRadius: 10,
        border: '1px solid var(--border)', background: hover ? 'var(--surface-3)' : 'var(--surface-2)',
        cursor: draggable ? 'grab' : 'pointer', opacity: dragging ? 0.4 : 1,
        boxShadow: dragging ? '0 12px 28px rgba(0,0,0,0.3)' : 'none', transition: 'background .12s',
      }}>
      {draggable && <span style={{ paddingTop: 5 }}><Grip dim={!hover} /></span>}
      <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name="folder" size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vault.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}><Icon name={MODE_ICON[vault.mode]} size={11} color="var(--accent)" />{MODE_LABEL[vault.mode]}</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{vault.items} src</span>
        </div>
      </div>
      <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ marginTop: 3, opacity: hover ? 1 : 0 }} />
    </div>
  );
}

// ── workspace column ────────────────────────────────────────────────────────
function WsColumn({ ws, pov, drag, dropTarget, onDropHere, setDrag, setDropTarget, onOpenAccess, onOpenVault, onAddVault, onMenu }) {
  const caps = wsCaps(pov, ws);
  const role = myRole(pov, ws);
  const isDropOk = drag && wsCaps(pov, ws).canMoveVaults && drag.fromWs !== ws.id;
  const active = dropTarget === ws.id && isDropOk;

  return (
    <div
      onDragOver={(e) => { if (isDropOk) { e.preventDefault(); setDropTarget(ws.id); } }}
      onDragLeave={(e) => { if (dropTarget === ws.id && !e.currentTarget.contains(e.relatedTarget)) setDropTarget(null); }}
      onDrop={(e) => { if (isDropOk) { e.preventDefault(); onDropHere(ws.id); } }}
      style={{
        width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 14, boxShadow: active ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-card)',
        transition: 'border-color .12s, box-shadow .12s', overflow: 'hidden',
      }}>
      {/* header */}
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'var(--display-font)' }}>{ws.name[0].toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</span>
              {ws.private && <Icon name="key" size={12} color="var(--fg-faint)" title="Private" />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <RoleBadge role={role} />
              {caps.readOnly && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="file" size={10} /> read-only</span>}
            </div>
          </div>
          {(caps.canManageMembers || caps.canManageVaults) && (
            <button onClick={() => onMenu(ws)} style={{ ...iconBtn(), width: 28, height: 28, border: 'none' }} title="Workspace settings"><Icon name="more" size={16} color="var(--fg-muted)" /></button>
          )}
        </div>

        {/* members strip */}
        <button onClick={() => onOpenAccess(ws)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 11, padding: '7px 8px',
          borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--ui-font)',
        }} title={caps.canManageMembers ? 'Manage access' : 'View members'}>
          <div style={{ display: 'flex' }}>
            {ws.members.slice(0, 4).map((m, i) => (
              <span key={m.u} style={{ width: 22, height: 22, borderRadius: '50%', marginLeft: i ? -7 : 0, background: 'var(--surface-3)', border: '2px solid var(--surface)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>{(WS_PEOPLE[m.u] || { name: m.u }).name[0]}</span>
            ))}
          </div>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'var(--fg-muted)' }}>{ws.members.length} {ws.members.length === 1 ? 'member' : 'members'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{caps.canManageMembers ? 'Manage' : 'View'} <Icon name="chevRight" size={12} /></span>
        </button>
      </div>

      {/* vault list */}
      <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 70 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 2px' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Vaults · {ws.vaults.length}</span>
        </div>
        {ws.vaults.map((v) => (
          <VaultCard key={v.id} vault={v} caps={caps} dragging={drag && drag.vaultId === v.id}
            onOpen={() => onOpenVault(ws, v)}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', v.id); } catch {} setDrag({ vaultId: v.id, fromWs: ws.id }); }}
            onDragEnd={() => { setDrag(null); setDropTarget(null); }} />
        ))}
        {ws.vaults.length === 0 && (
          <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 12, color: 'var(--fg-faint)', border: '1px dashed var(--border)', borderRadius: 10 }}>
            {active ? 'Drop vault here' : 'No vaults yet'}
          </div>
        )}
        {caps.canManageVaults && (
          <button onClick={() => onAddVault(ws)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 10, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, marginTop: 2 }}>
            <Icon name="plus" size={14} /> New vault
          </button>
        )}
      </div>
    </div>
  );
}

// ── small per-workspace menu (rename / delete) ──────────────────────────────
function WsMenu({ ws, caps, onClose, onRename, onAccess, onDelete }) {
  React.useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const Item = ({ icon, label, onClick, danger }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 9px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, color: danger ? 'var(--destructive)' : 'var(--fg)', textAlign: 'left' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
      <Icon name={icon} size={15} color={danger ? 'var(--destructive)' : 'var(--fg-muted)'} />{label}
    </button>
  );
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 211, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto', width: 220, padding: 6, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>{ws.name}</div>
          <Item icon="users" label="Manage access" onClick={() => { onClose(); onAccess(ws); }} />
          <Item icon="pencil" label="Rename workspace" onClick={() => { const n = prompt('Rename workspace', ws.name); if (n) onRename(ws.id, n); onClose(); }} />
          {caps.canAddAdmins && <React.Fragment>
            <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />
            <Item icon="trash" label="Delete workspace" danger onClick={() => { if (confirm(`Delete “${ws.name}” and all its vaults?`)) onDelete(ws.id); onClose(); }} />
          </React.Fragment>}
        </div>
      </div>
    </React.Fragment>
  );
}

// ── the section ─────────────────────────────────────────────────────────────
function WorkspacesSection() {
  const [pov, setPov] = useStored('b2-ws-pov', 'owner');
  const [workspaces, setWorkspaces] = React.useState(INITIAL_WS);
  const [drag, setDrag] = React.useState(null);
  const [dropTarget, setDropTarget] = React.useState(null);
  const [accessWs, setAccessWs] = React.useState(null);
  const [vaultCtx, setVaultCtx] = React.useState(null); // {ws, vault}
  const [menuWs, setMenuWs] = React.useState(null);
  const [creating, setCreating] = React.useState(false);

  const povMeta = POVS.find((p) => p.id === pov) || POVS[0];
  const canCreate = pov === 'owner';
  // member POV only shows workspaces alice belongs to (she belongs to all here)
  const visible = workspaces;

  // ── mutations ──
  const moveVault = (toWsId) => {
    if (!drag) return;
    setWorkspaces((prev) => {
      let moved = null;
      const stripped = prev.map((w) => w.id !== drag.fromWs ? w : { ...w, vaults: w.vaults.filter((v) => { if (v.id === drag.vaultId) { moved = v; return false; } return true; }) });
      return stripped.map((w) => w.id !== toWsId || !moved ? w : { ...w, vaults: [...w.vaults, moved] });
    });
    setDrag(null); setDropTarget(null);
  };
  const upd = (wsId, fn) => setWorkspaces((prev) => prev.map((w) => w.id === wsId ? fn(w) : w));
  const liveWs = (id) => workspaces.find((w) => w.id === id);

  const onSaveVault = (ws, nv) => { upd(ws.id, (w) => ({ ...w, vaults: w.vaults.map((v) => v.id === nv.id ? nv : v) })); setVaultCtx(null); };
  const onMoveVaultTo = (fromId, vaultId, toId) => {
    setWorkspaces((prev) => {
      let moved = null;
      const stripped = prev.map((w) => w.id !== fromId ? w : { ...w, vaults: w.vaults.filter((v) => { if (v.id === vaultId) { moved = v; return false; } return true; }) });
      return stripped.map((w) => (w.id !== toId || !moved) ? w : { ...w, vaults: [...w.vaults, moved] });
    });
  };
  const onDeleteVault = (ws, vault) => { upd(ws.id, (w) => ({ ...w, vaults: w.vaults.filter((v) => v.id !== vault.id) })); setVaultCtx(null); };
  const onAddVault = (ws) => { const n = prompt('New vault name', 'Untitled'); if (n) upd(ws.id, (w) => ({ ...w, vaults: [...w.vaults, { id: 'v_' + Date.now(), name: n, mode: 'wiki', items: 0, updated: 'just now' }] })); };

  const onChangeRole = (wsId, u, role) => upd(wsId, (w) => ({ ...w, members: w.members.map((m) => m.u === u ? { ...m, role } : m) }));
  const onRemoveMember = (wsId, u) => upd(wsId, (w) => ({ ...w, members: w.members.filter((m) => m.u !== u) }));
  const onAddMember = (wsId, u, role) => upd(wsId, (w) => w.members.some((m) => m.u === u) ? w : ({ ...w, members: [...w.members, { u, role }] }));

  const onCreateWs = ({ name, desc, invited }) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('ws-' + Date.now());
    const members = [{ u: 'alice', role: 'Owner' }, ...invited.map((i) => ({ u: i.u, role: i.role }))];
    setWorkspaces((prev) => [...prev, { id, name, desc: desc || '', adminOf: true, members, vaults: [] }]);
    setCreating(false);
  };

  // live (re-derived) versions so drawers see current state
  const accessLive = accessWs ? liveWs(accessWs.id) : null;
  const vaultLive = vaultCtx ? (() => { const w = liveWs(vaultCtx.ws.id); return w ? { ws: w, vault: w.vaults.find((v) => v.id === vaultCtx.vault.id) } : null; })() : null;

  return (
    <div>
      {/* role-preview switcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px', marginBottom: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Viewing as</span>
          <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9 }}>
            {POVS.map((p) => {
              const on = pov === p.id;
              return (
                <button key={p.id} onClick={() => setPov(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
                  <Icon name={p.icon} size={14} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />{p.label}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ flex: 1, minWidth: 240, margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{povMeta.blurb}</p>
        {canCreate
          ? <button onClick={() => setCreating(true)} style={sbtn('primary')}><Icon name="plus" size={14} color="#fff" /> New workspace</button>
          : <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="shield" size={13} /> Only owners can create workspaces</span>}
      </div>

      {/* board */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 18 }}>
        {visible.map((ws) => (
          <WsColumn key={ws.id} ws={ws} pov={pov} drag={drag} dropTarget={dropTarget}
            setDrag={setDrag} setDropTarget={setDropTarget} onDropHere={moveVault}
            onOpenAccess={(w) => setAccessWs(w)} onOpenVault={(w, v) => setVaultCtx({ ws: w, vault: v })}
            onAddVault={onAddVault} onMenu={(w) => setMenuWs(w)} />
        ))}
        {canCreate && (
          <button onClick={() => setCreating(true)} style={{ width: 300, flexShrink: 0, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={20} color="var(--fg-muted)" /></span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>New workspace</span>
          </button>
        )}
      </div>

      {/* drawers + modal */}
      {accessLive && (
        <AccessDrawer ws={accessLive} caps={wsCaps(pov, accessLive)} meRole={myRole(pov, accessLive)} isTenantOwner={pov === 'owner'} onClose={() => setAccessWs(null)}
          onChangeRole={(u, r) => onChangeRole(accessLive.id, u, r)}
          onRemove={(u) => onRemoveMember(accessLive.id, u)}
          onAdd={(u, r) => onAddMember(accessLive.id, u, r)}
          onSaveMeta={(name, desc) => upd(accessLive.id, (w) => ({ ...w, name, desc }))}
          onArchive={() => setAccessWs(null)}
          onDelete={() => { setWorkspaces((prev) => prev.filter((w) => w.id !== accessLive.id)); setAccessWs(null); }}
          onTransfer={() => {}} />
      )}
      {vaultLive && vaultLive.vault && (
        <VaultDrawer vault={vaultLive.vault} ws={vaultLive.ws} allWorkspaces={workspaces} caps={wsCaps(pov, vaultLive.ws)}
          onClose={() => setVaultCtx(null)}
          onSave={(nv) => onSaveVault(vaultLive.ws, nv)}
          onMove={(toId) => onMoveVaultTo(vaultLive.ws.id, vaultLive.vault.id, toId)}
          onArchive={() => setVaultCtx(null)}
          onDelete={() => onDeleteVault(vaultLive.ws, vaultLive.vault)} />
      )}
      {menuWs && (
        <WsMenu ws={menuWs} caps={wsCaps(pov, menuWs)} onClose={() => setMenuWs(null)}
          onAccess={(w) => setAccessWs(w)} onRename={(id, n) => upd(id, (w) => ({ ...w, name: n }))}
          onDelete={(id) => setWorkspaces((prev) => prev.filter((w) => w.id !== id))} />
      )}
      {creating && <NewWorkspaceModal onClose={() => setCreating(false)} onCreate={onCreateWs} />}
    </div>
  );
}

Object.assign(window, { WorkspacesSection });
