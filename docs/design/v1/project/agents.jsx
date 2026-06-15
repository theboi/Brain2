/* Brain2 Console — Agents page components (roster, queue, drawer, add-todo). */

const AG_TINT = ['#7C8CFF', '#34D399', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8', '#FB7185', '#2DD4BF'];
function Av({ name, size = 30 }) {
  const nm = name || '?';
  let h = 0; for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) & 0xffff;
  const c = AG_TINT[h % AG_TINT.length];
  return <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, color: c, background: hexToRgba(c, 0.16), fontFamily: 'var(--ui-font)' }}>{nm[0].toUpperCase()}</span>;
}
function agBtnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function agBtnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function agChip(tone) { return { display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontFamily: 'var(--mono-font)', fontSize: 11, fontWeight: 500, color: tone || 'var(--fg-muted)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }; }
function AccessTag({ user, level }) {
  return <span title={`Runs with ${user}'s access`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 7px 0 6px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)' }}><Icon name="lock" size={11} color="var(--accent)" /> {level}</span>;
}
function PriorityBadge() {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 6px', borderRadius: 5, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', flexShrink: 0 }}><Icon name="zap" size={10} color="var(--warning)" /> HIGH</span>;
}
function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
function accessOf(by) { return (AG_PEOPLE[by] || {}).access || 'read'; }

// ── controlled overflow menu ──────────────────────────────────────────────────
function DotsMenu({ open, onToggle, items }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button onClick={onToggle} title="More actions" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid ' + (open ? 'var(--border-strong)' : 'transparent'), background: open ? 'var(--surface-2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="more" size={16} color="var(--fg-muted)" /></button>
      {open && (
        <React.Fragment>
          <div onClick={onToggle} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 238, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.5)', padding: 6 }}>
            {items.map((it, i) => (
              <React.Fragment key={i}>
                {it.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />}
                <button onClick={() => { onToggle(); it.onClick && it.onClick(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 9px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, color: it.danger ? 'var(--destructive)' : 'var(--fg)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <Icon name={it.icon} size={14} color={it.danger ? 'var(--destructive)' : 'var(--fg-muted)'} /> {it.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

// ── agent roster ──────────────────────────────────────────────────────────────
function RosterCard({ a, todo, onOpen }) {
  const working = a.status === 'busy';
  const off = a.status === 'offline';
  return (
    <div onClick={() => working && todo && onOpen(todo.id)} style={{ width: 250, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 13, display: 'flex', flexDirection: 'column', gap: 10, opacity: off ? 0.6 : 1, cursor: working ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ position: 'relative' }}>
          <Av name={a.name} size={34} />
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--surface)', background: working ? 'var(--success)' : off ? 'var(--destructive)' : 'var(--fg-faint)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: working ? 'var(--success)' : 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {working ? <React.Fragment><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} color="var(--success)" /></span> Working</React.Fragment> : off ? 'Offline' : 'Idle · free'}
          </div>
        </div>
      </div>
      {working && todo ? (
        <React.Fragment>
          <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>{todo.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={agChip(todo.loc === 'cloud' ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={todo.loc === 'cloud' ? 'cloud' : 'cpu'} size={11} /> {todo.model}</span>
            <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{fmtTime(todo.elapsed)}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}><Av name={todo.by} size={16} /> {todo.by}</span>
          </div>
        </React.Fragment>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 60, color: 'var(--fg-faint)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 9, background: 'var(--bg)' }}>
          {off ? <React.Fragment><Icon name="alert" size={14} /> Reconnect runtime</React.Fragment> : <React.Fragment><Icon name="clock" size={14} /> Waiting for the queue</React.Fragment>}
        </div>
      )}
    </div>
  );
}

// ── one todo row ──────────────────────────────────────────────────────────────
function rowMenu(t, actions) {
  if (t.status === 'running') return [
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    { divider: true, icon: 'repeat', label: 'Stop task and re-queue', danger: true, onClick: () => actions.stop(t.id) },
  ];
  if (t.status === 'queued') return [
    t.priority ? { icon: 'zap', label: 'Remove high priority', onClick: () => actions.priority(t.id) } : { icon: 'zap', label: 'Mark high priority', onClick: () => actions.priority(t.id) },
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    { divider: true, icon: 'trash', label: 'Remove from queue', danger: true, onClick: () => actions.remove(t.id) },
  ];
  return [
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    { icon: 'refresh', label: 'Re-run as new todo', onClick: () => actions.open(t.id) },
    { divider: true, icon: 'trash', label: 'Delete', danger: true, onClick: () => actions.remove(t.id) },
  ];
}
function TodoRow({ t, agent, menuOpen, onMenu, actions }) {
  const ICON = { running: { name: 'loader', spin: true, c: 'var(--success)' }, queued: { name: 'clock', c: 'var(--fg-muted)' }, done: { name: 'check', c: 'var(--success)' } }[t.status];
  return (
    <div onClick={() => actions.open(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: t.priority && t.status === 'queued' ? 'var(--warning-soft)' : 'transparent', borderLeft: '2px solid ' + (t.priority && t.status === 'queued' ? 'var(--warning)' : 'transparent') }}
      onMouseEnter={(e) => { if (!(t.priority && t.status === 'queued')) e.currentTarget.style.background = 'var(--surface-2)'; }} onMouseLeave={(e) => { if (!(t.priority && t.status === 'queued')) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {ICON.spin ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name={ICON.name} size={16} color={ICON.c} /></span> : <Icon name={ICON.name} size={16} color={ICON.c} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t.priority && t.status === 'queued' && <PriorityBadge />}
          <span style={{ fontSize: 13.5, fontWeight: 600, color: t.status === 'done' ? 'var(--fg-muted)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--fg-muted)' }}><Av name={t.by} size={16} /> {t.by}</span>
          <AccessTag user={t.by} level={accessOf(t.by)} />
          <span style={agChip((t.loc === 'cloud') ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={t.loc === 'cloud' ? 'cloud' : 'cpu'} size={11} /> {t.model || (t.modelPref === 'cloud' ? 'cloud · auto' : t.modelPref === 'local' ? 'local · auto' : 'auto')}</span>
          {t.status === 'queued' && <span style={{ fontSize: 11.5, color: t.loc === 'cloud' ? 'var(--accent)' : 'var(--fg-faint)' }}>· {t.priority ? 'cuts the queue' : (t.loc === 'cloud' ? 'starts on a free agent' : 'waiting for a free agent')}</span>}
        </div>
      </div>
      {t.status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg)' }}><Av name={agent ? agent.name : '?'} size={20} /> {agent ? agent.name : ''}</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', width: 40, textAlign: 'right' }}>{fmtTime(t.elapsed)}</span>
        </div>
      )}
      {t.status === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span title="Conversation archived; KV cache flushed from RAM" className="b2-hide-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: 'var(--fg-muted)', background: 'var(--surface-2)' }}><Icon name="cpu" size={11} /> memory flushed</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{t.when}</span>
          <span className="b2-hide-sm" style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', width: 64, textAlign: 'right' }}>{t.tokens}</span>
        </div>
      )}
      <DotsMenu open={menuOpen} onToggle={() => onMenu(menuOpen ? null : t.id)} items={rowMenu(t, actions)} />
    </div>
  );
}

function GroupHead({ icon, label, n, tone, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
      <Icon name={icon} size={14} color={tone || 'var(--fg-muted)'} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg)' }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-3)', borderRadius: 6, padding: '1px 7px' }}>{n}</span>
      {note && <span className="b2-hide-sm" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--fg-faint)' }}>{note}</span>}
    </div>
  );
}

// ── message + tool rendering (shared by drawer) ───────────────────────────────
function ToolLine({ tool }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)', marginBottom: 8, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono-font)', fontSize: 11.5 }}>
      {tool.running ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={13} color="var(--accent)" /></span> : <Icon name="check" size={13} color="var(--success)" />}
      <span style={{ color: 'var(--accent)' }}>{tool.name}</span>
      <span style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>({tool.args})</span>
      <span style={{ marginLeft: 'auto', color: 'var(--fg-faint)', flexShrink: 0 }}>{tool.running ? '…' : '└ ' + tool.result}</span>
    </div>
  );
}
function MessageBlock({ m, agent }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 18 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 5 }}>{m.by || 'you'}</span>
        <div style={{ maxWidth: '86%', padding: '10px 13px', borderRadius: 13, borderTopRightRadius: 4, background: 'var(--accent-soft)', border: '1px solid var(--border)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--fg)' }}><MiniMD text={m.text} /></div>
      </div>
    );
  }
  const words = (m.text || '').split(/(\s+)/);
  const streaming = m.reveal != null;
  const shown = streaming ? words.slice(0, m.reveal * 2).join('') : m.text;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{agent ? agent.name[0] : <Icon name="robot" size={13} />}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{agent ? agent.name : 'Agent'}</span>
      </div>
      <div style={{ paddingLeft: 30 }}>
        {(m.tools || []).map((t, i) => <ToolLine key={i} tool={t} />)}
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg)' }}><MiniMD text={shown} />{streaming && <span className="b2-caret" />}</div>
        {m.footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={11} /> {m.footer.latency}</span><span>{m.footer.tokens}</span><span>{m.footer.cost}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── conversation drawer (live or done) ────────────────────────────────────────
function ConversationDrawer({ todo, agent, onClose, onContinue }) {
  const [shown, setShown] = React.useState(false);
  const [text, setText] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); document.removeEventListener('keydown', k); };
  }, [onClose]);
  React.useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [todo.messages]);
  if (!todo) return null;
  const running = todo.status === 'running';
  const done = todo.status === 'done';
  const queued = todo.status === 'queued';
  const send = () => { if (text.trim()) { onContinue(todo.id, text.trim()); setText(''); } };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(2px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width: 'min(640px, 94vw)', maxHeight: '90vh', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 28px 80px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', transform: shown ? 'none' : 'translateY(12px) scale(0.98)', opacity: shown ? 1 : 0, transition: 'transform .24s cubic-bezier(.32,.72,0,1), opacity .2s' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ position: 'relative', flexShrink: 0 }}>
            <Av name={agent ? agent.name : 'Q'} size={36} />
            <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--surface)', background: running ? 'var(--success)' : done ? 'var(--fg-faint)' : 'var(--warning)' }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{todo.title}</div>
            <div style={{ fontSize: 11.5, marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, color: running ? 'var(--success)' : 'var(--fg-muted)' }}>
              {running && <React.Fragment><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} color="var(--success)" /></span> Running · {agent && agent.name} · {fmtTime(todo.elapsed)}</React.Fragment>}
              {done && <React.Fragment><Icon name="check" size={12} color="var(--fg-muted)" /> Completed {todo.when} · {agent && agent.name}</React.Fragment>}
              {queued && <React.Fragment><Icon name="clock" size={12} color="var(--warning)" /> Queued{todo.priority ? ' · high priority' : ''}</React.Fragment>}
            </div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>
        {/* body */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <div style={{ marginBottom: 16 }}>
            <DMeta label="Requested by"><Av name={todo.by} size={18} /> {todo.by} <AccessTag user={todo.by} level={accessOf(todo.by)} /></DMeta>
            <DMeta label="Model">{todo.model ? <span style={agChip(todo.loc === 'cloud' ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={todo.loc === 'cloud' ? 'cloud' : 'cpu'} size={11} /> {todo.model}</span> : <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>resolved when an agent picks it up</span>}</DMeta>
            {done && <DMeta label="Memory"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-muted)' }}><Icon name="cpu" size={12} /> KV cache flushed · transcript restored from cold storage</span></DMeta>}
          </div>
          {queued && todo.messages.length <= 1 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 16 }}>
              <Icon name="clock" size={15} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>Waiting in the queue. A free agent will pick this up and run it with {todo.by}’s access. Add a note below to refine the task before it starts.</div>
            </div>
          )}
          {todo.messages.map((m, i) => <MessageBlock key={i} m={m} agent={agent} />)}
        </div>
        {/* composer */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '12px 16px 14px' }}>
          <div style={{ border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} rows={2}
              placeholder={done ? 'Continue this task…' : 'Reply or add a follow-up instruction…'}
              style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, lineHeight: 1.5, padding: '12px 13px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
              <Icon name="atSign" size={15} color="var(--fg-muted)" />
              <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>re-queues with the full history</span>
              <button onClick={send} disabled={!text.trim()} style={{ ...agBtnPrimary(), height: 32, marginLeft: 'auto', opacity: text.trim() ? 1 : 0.5, cursor: text.trim() ? 'pointer' : 'not-allowed' }}><Icon name="plus" size={14} color="#fff" /> Add to queue</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function DMeta({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 11.5, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>{children}</span>
    </div>
  );
}

// ── small dropdown ────────────────────────────────────────────────────────────
function Dropdown({ value, options, onPick, width = 220, icon }) {
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.id === value) || options[0];
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, width, height: 34, padding: '0 11px', borderRadius: 9, border: '1px solid ' + (open ? 'var(--accent)' : 'var(--border)'), background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, cursor: 'pointer' }}>
        <Icon name={cur.icon || icon || 'dot'} size={14} color={cur.tone || 'var(--fg-muted)'} />
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.label}</span>
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </button>
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 306, width: Math.max(width, 240), maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', padding: 6 }}>
            {options.map((o) => (
              o.header ? <div key={o.id} style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '8px 8px 4px' }}>{o.label}</div> :
              <button key={o.id} onClick={() => { onPick(o.id); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 9px', borderRadius: 8, border: 'none', background: o.id === value ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
                <Icon name={o.icon || 'dot'} size={14} color={o.tone || (o.id === value ? 'var(--accent)' : 'var(--fg-muted)')} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)' }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{o.hint}</span>}
                {o.id === value && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

// ── add-a-todo modal ──────────────────────────────────────────────────────────
function AddTodoModal({ agents, freeCount, onClose, onAdd }) {
  const [text, setText] = React.useState('');
  const [assign, setAssign] = React.useState('any');
  const [model, setModel] = React.useState('auto');
  React.useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const assignOpts = [{ id: 'any', label: 'Any free agent', icon: 'robot', tone: 'var(--accent)' }, ...agents.filter((a) => a.status !== 'offline').map((a) => ({ id: a.id, label: a.name, icon: 'user', hint: a.status === 'busy' ? 'busy' : 'free' }))];
  const modelOpts = [
    { id: 'auto', label: 'Auto', icon: 'cpu', hint: 'cheapest capable' },
    { id: 'h-cloud', label: 'Cloud', header: true }, ...PICK_MODELS.cloud.map((m) => ({ id: m.id, label: m.label, icon: 'cloud', tone: 'var(--accent)' })),
    { id: 'h-local', label: 'Local', header: true }, ...PICK_MODELS.local.map((m) => ({ id: m.id, label: m.label, icon: 'cpu', hint: m.host })),
  ];
  const isCloud = model === 'auto' ? false : PICK_MODELS.cloud.some((m) => m.id === model);
  const submit = () => { if (!text.trim()) return; onAdd({ title: text.trim(), assign, model }); };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '11vh 20px 20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)' }} />
      <div style={{ position: 'relative', width: 580, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 0' }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>Add a todo to the queue</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>A free agent will pick it up — you don’t wait on this screen.</div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} rows={3}
            placeholder="What should an agent do?  @mention sources or wiki pages…"
            style={{ width: '100%', resize: 'none', border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, lineHeight: 1.5, padding: 14, outline: 'none', marginBottom: 16 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 78, fontSize: 12.5, color: 'var(--fg-muted)' }}>Assign to</span>
              <Dropdown value={assign} options={assignOpts} onPick={setAssign} width={220} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 78, fontSize: 12.5, color: 'var(--fg-muted)' }}>Model</span>
              <Dropdown value={model} options={modelOpts} onPick={setModel} width={220} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 78, fontSize: 12.5, color: 'var(--fg-muted)' }}>Access</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg)' }}><AccessTag user="alice" level="admin" /> runs with your access — alice</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginTop: 16 }}>
            <Icon name="zap" size={15} color="var(--accent)" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5 }}>{isCloud ? <React.Fragment><b>Cloud model — starts immediately.</b> Cloud is elastic, so it won’t wait for a worker.</React.Fragment> : <React.Fragment><b>Local / auto — queues for a worker.</b> There {freeCount === 1 ? 'is' : 'are'} <b>{freeCount} free agent{freeCount === 1 ? '' : 's'}</b> right now.</React.Fragment>}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 18px' }}>
          <button onClick={onClose} style={agBtnGhost()}>Cancel</button>
          <button onClick={submit} disabled={!text.trim()} style={{ ...agBtnPrimary(), opacity: text.trim() ? 1 : 0.5, cursor: text.trim() ? 'pointer' : 'not-allowed' }}><Icon name="plus" size={14} color="#fff" /> Add to queue</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Av, agBtnPrimary, agBtnGhost, AccessTag, PriorityBadge, fmtTime, accessOf, DotsMenu, RosterCard, TodoRow, GroupHead, ConversationDrawer, AddTodoModal, Dropdown });
