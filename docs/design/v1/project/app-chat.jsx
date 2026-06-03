/* Brain2 Console — Agent Chat app: shell + streaming simulation. */

const CANNED = {
  tool: { name: 'wiki:get', args: '"Cell theory"', result: 'got 3.1 KB · v7' },
  text: `Let me check the knowledge base.\n\nBased on the cited sources, the page is mostly well-supported — though I'd flag one passage in **Origins** for review [#1]. The 1839 attribution to Schwann isn't traceable to any of the three cited sources.\n\nWant me to open an **Audit** on that section, or keep reading?`,
  footer: { latency: '2.4s', tokens: '1,120 tok', cost: '$0.009' },
};

function ChatApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');

  const [agentId, setAgentId] = React.useState('researcher');
  const [convoId, setConvoId] = React.useState('c1');
  const [msgs, setMsgs] = React.useState(MESSAGES['c1']);
  const [thinking, setThinking] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const scrollRef = React.useRef(null);
  const timers = React.useRef([]);
  const agent = CHAT_AGENTS.find((a) => a.id === agentId);

  const select = (aid, cid) => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setStreaming(false); setThinking(false);
    setAgentId(aid); setConvoId(cid); setMsgs(MESSAGES[cid] || []);
  };
  const newConvo = (aid) => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setStreaming(false); setThinking(false);
    setAgentId(aid); setConvoId('new-' + aid); setMsgs([]);
  };

  React.useEffect(() => {
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const send = (text) => {
    setMsgs((m) => [...m, { role: 'user', text }]);
    setStreaming(true); setThinking(true);
    const t1 = setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [...m, { role: 'assistant', tools: [CANNED.tool], streamingText: '' }]);
      const words = CANNED.text.split(' ');
      let i = 0;
      const step = () => {
        i += 2;
        setMsgs((m) => { const c = [...m]; const last = { ...c[c.length - 1] }; last.streamingText = words.slice(0, i).join(' '); c[c.length - 1] = last; return c; });
        if (i < words.length) { const t = setTimeout(step, 45); timers.current.push(t); }
        else {
          setMsgs((m) => { const c = [...m]; const last = { ...c[c.length - 1] }; last.text = CANNED.text; last.streamingText = null; last.footer = CANNED.footer; c[c.length - 1] = last; return c; });
          setStreaming(false);
        }
      };
      const t2 = setTimeout(step, 500); timers.current.push(t2);
    }, 700);
    timers.current.push(t1);
  };
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; setStreaming(false); setThinking(false); };

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail active="chats" />
        <ChatRail current={convoId} onSelect={select} onNew={newConvo} />
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {/* conversation header */}
          <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', borderBottom: '1px solid var(--border)' }}>
            <StatusDot status={agent.status} pulse={false} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{agent.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{agent.model}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button style={{ ...iconBtn(), width: 30, height: 30 }} title="Pin"><Icon name="pin" size={15} color="var(--fg-muted)" /></button>
              <button style={{ ...iconBtn(), width: 30, height: 30 }} title="Export"><Icon name="download" size={15} color="var(--fg-muted)" /></button>
              <button style={{ ...iconBtn(), width: 30, height: 30 }} title="Settings"><Icon name="settings" size={15} color="var(--fg-muted)" /></button>
            </span>
          </div>
          {/* messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 8px' }}>
            <div style={{ maxWidth: 820, margin: '0 auto' }}>
              {msgs.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '72px 0', gap: 12 }}>
                  <span style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkles" size={24} /></span>
                  <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--display-font)', color: 'var(--fg)', letterSpacing: 'var(--display-track)' }}>Chat with {agent.name}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--fg-muted)', maxWidth: 360, lineHeight: 1.5 }}>Ask it to query the knowledge base, audit a wiki page, or summarise sources. It calls ops as tools.</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
                    {['Audit the Cell theory page', 'Summarise research-q3', 'Find unsupported claims'].map((s) => (
                      <button key={s} onClick={() => send(s)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12.5 }}><Icon name="sparkles" size={12} color="var(--accent)" /> {s}</button>
                    ))}
                  </div>
                </div>
              ) : msgs.map((m, i) => m.role === 'user' ? <UserMessage key={i} m={m} /> : <AssistantMessage key={i} m={m} agent={agent} />)}
              {thinking && <ThinkingPill agent={agent} />}
            </div>
          </div>
          <Composer onSend={send} streaming={streaming} onStop={stop} />
          <div className="b2-show-sm" style={{ display: 'none', height: 'calc(56px + env(safe-area-inset-bottom, 0px))', flexShrink: 0 }} />
        </main>
      </div>
      <BottomNav active="chats" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ChatApp />);
