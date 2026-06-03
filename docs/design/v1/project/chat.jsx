/* Brain2 Console — Agent Chat: rail, message stream, composer. */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

// ── Conversation rail ────────────────────────────────────────────────────────
function ChatRail({ current, onSelect, onNew }) {
  const [open, setOpen] = React.useState({ researcher: true, coder: true, editor: true, summariser: false });
  return (
    <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={15} color="var(--fg-muted)" />
          <input placeholder="Search conversations…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {CHAT_AGENTS.map((a) => (
          <div key={a.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
              <button onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <Icon name={open[a.id] ? 'chevDown' : 'chevRight'} size={12} color="var(--fg-faint)" />
                <StatusDot status={a.status} pulse={false} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</span>
              </button>
              <button onClick={() => onNew(a.id)} title="New conversation" style={{ ...iconBtn(), width: 24, height: 24, border: 'none' }}><Icon name="plus" size={14} color="var(--fg-muted)" /></button>
            </div>
            {open[a.id] && (CONVERSATIONS[a.id].length ? CONVERSATIONS[a.id].map((c) => {
              const on = c.id === current;
              return (
                <button key={c.id} onClick={() => onSelect(a.id, c.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px 8px 26px', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: on ? 'var(--accent-soft)' : 'transparent', fontFamily: 'var(--ui-font)' }}>
                  <Icon name="chats" size={14} color={on ? 'var(--accent)' : 'var(--fg-faint)'} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                  {c.streaming && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />}
                  <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>{c.time}</span>
                </button>
              );
            }) : <div style={{ padding: '4px 10px 4px 26px', fontSize: 12, color: 'var(--fg-faint)' }}>No conversations</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tool-call card ───────────────────────────────────────────────────────────
function ToolCard({ tool, running }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', marginBottom: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--mono-font)', fontSize: 12 }}>
        {running ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={13} color="var(--accent)" /></span> : <Icon name="check" size={13} color="var(--success)" />}
        <span style={{ color: 'var(--fg-muted)' }}>tool ▸</span>
        <span style={{ color: 'var(--accent)' }}>{tool.name}</span>
        <span style={{ color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>({tool.args})</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-faint)' }}>{running ? '…' : '└ ' + tool.result}</span>
        <Icon name="chevDown" size={12} color="var(--fg-faint)" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`→ ${tool.name}(${tool.args})\n← ${tool.result}`}</pre>
      )}
    </div>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────
function UserMessage({ m }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 22 }}>
      <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5, marginRight: 2 }}>alice</span>
      <div style={{ maxWidth: '74%', padding: '11px 15px', borderRadius: 14, borderTopRightRadius: 4, background: 'var(--accent-soft)', border: '1px solid var(--border)', color: 'var(--fg)', fontSize: 14, lineHeight: 1.55 }}>
        <MiniMD text={m.text} />
      </div>
    </div>
  );
}

function MsgAction({ icon, label }) {
  return <button title={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--fg-faint)' }}><Icon name={icon} size={14} /></button>;
}

function AssistantMessage({ m, agent }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkles" size={13} /></span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{agent.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{agent.model}</span>
      </div>
      <div style={{ paddingLeft: 30 }}>
        {m.tools && m.tools.map((t, i) => <ToolCard key={i} tool={t} />)}
        {m.text && <div style={{ fontSize: 14 }}><MiniMD text={m.text} /></div>}
        {m.streamingText != null && <div style={{ fontSize: 14 }}><MiniMD text={m.streamingText} /><span className="b2-caret" /></div>}
        {m.footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={12} /> {m.footer.latency}</span>
            <span>{m.footer.tokens}</span>
            <span>{m.footer.cost}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <MsgAction icon="thumbUp" label="Good" /><MsgAction icon="thumbDown" label="Bad" /><MsgAction icon="refresh" label="Regenerate" /><MsgAction icon="copy" label="Copy" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingPill({ agent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 30, marginBottom: 24, color: 'var(--fg-muted)' }}>
      <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={14} color="var(--accent)" /></span>
      <span style={{ fontSize: 13 }}>{agent.name} is thinking…</span>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────
function Composer({ onSend, streaming, onStop }) {
  const [text, setText] = React.useState('');
  const [tools, setTools] = React.useState(COMPOSER_TOOLS);
  const send = () => { if (text.trim() && !streaming) { onSend(text.trim()); setText(''); } };
  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '14px 24px 18px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', border: '1px solid var(--border-strong)', borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          rows={2} placeholder="Message the agent…  @mention to attach context, / for commands"
          style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, lineHeight: 1.5, padding: '13px 15px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
          <button style={{ ...iconBtn(), width: 30, height: 30 }} title="Attach"><Icon name="plus" size={16} color="var(--fg-muted)" /></button>
          <button style={{ ...iconBtn(), width: 30, height: 30 }} title="Mention"><Icon name="atSign" size={15} color="var(--fg-muted)" /></button>
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
          <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>Tools</span>
          {tools.map((t) => (
            <button key={t.id} onClick={() => setTools((xs) => xs.map((x) => x.id === t.id ? { ...x, on: !x.on } : x))}
              style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--mono-font)', fontSize: 11,
                background: t.on ? 'var(--accent-soft)' : 'transparent', color: t.on ? 'var(--accent)' : 'var(--fg-faint)' }}>
              {t.on ? <Icon name="check" size={11} /> : <Icon name="x" size={11} />} {t.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <kbd style={kbdStyle()}>⌘↵</kbd>
            {streaming ? (
              <button onClick={onStop} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}><Icon name="stop" size={13} /> Stop</button>
            ) : (
              <button onClick={send} disabled={!text.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 8, border: 'none', cursor: text.trim() ? 'pointer' : 'not-allowed', background: text.trim() ? 'var(--accent)' : 'var(--surface-2)', color: text.trim() ? '#fff' : 'var(--fg-faint)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}><Icon name="send" size={14} color={text.trim() ? '#fff' : 'var(--fg-faint)'} /> Send</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { useStored, ChatRail, ToolCard, UserMessage, AssistantMessage, ThinkingPill, Composer });
