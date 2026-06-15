/*
 * Brain2 Console — Agents page: shared queue + live simulation.
 * Faithful TS port of docs/design/v1/project/app-agents.jsx. Mock-only — the
 * world advances on a local timer; no live data is wired yet.
 *
 * TopBar / LeftRail / BottomNav and theme tokens come from AppShell, so this
 * page renders only the main content column and its overlays.
 */
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  PICK_MODELS, SEED_AGENTS, SEED_TODOS, CANNED_REPLY, asst,
  type Agent, type Loc, type Todo,
} from './data';
import {
  agBtnGhost, agBtnPrimary, RosterCard, TodoRow, GroupHead,
  ConversationDrawer, AddTodoModal, type TodoActions,
} from './components';

interface World { agents: Agent[]; todos: Todo[]; }

function resolveModel(pref: string): { model: string; loc: Loc } {
  const c = PICK_MODELS.cloud.find((m) => m.id === pref);
  if (c) return { model: c.label, loc: 'cloud' };
  const l = PICK_MODELS.local.find((m) => m.id === pref);
  if (l) return { model: l.label, loc: 'local' };
  if (pref === 'cloud') return { model: 'Claude Sonnet 4.5', loc: 'cloud' };
  return { model: 'llama3.3 · 70B', loc: 'local' };
}

// advance the world one tick: stream running tasks, complete them, assign queued → free agents
function advance(w: World): World {
  let agents = w.agents.map((a) => ({ ...a }));
  let todos = w.todos.map((t) => ({ ...t }));

  todos = todos.map((t) => {
    if (t.status !== 'running') return t;
    const nt: Todo = { ...t, elapsed: (t.elapsed || 0) + 1 };
    const msgs = nt.messages.slice();
    const li = msgs.length - 1;
    if (li >= 0 && msgs[li].role === 'assistant' && msgs[li].reveal != null) {
      const m = { ...msgs[li] };
      const units = Math.ceil(((m.text || '').split(/(\s+)/)).length / 2);
      m.reveal = Math.min(units, (m.reveal as number) + 3);
      if ((nt.elapsed || 0) > 3) m.tools = (m.tools || []).map((tt) => tt.running ? { ...tt, running: false, result: tt.result || 'done' } : tt);
      msgs[li] = m; nt.messages = msgs;
    }
    if ((nt.elapsed || 0) >= (nt.dur || 0)) {
      const footer = { latency: ((nt.dur || 0) / 10).toFixed(1) + 's', tokens: nt.loc === 'cloud' ? Math.round(600 + (nt.dur || 0) * 12) + ' tok' : 'local', cost: nt.loc === 'cloud' ? '$' + (0.002 + (nt.dur || 0) * 0.0003).toFixed(3) : 'local' };
      const fmsgs = nt.messages.map((m, idx) => (idx === nt.messages.length - 1 && m.role === 'assistant')
        ? { ...m, reveal: null, tools: (m.tools || []).map((tt) => ({ ...tt, running: false, result: tt.result || 'done' })), footer: m.footer || footer } : m);
      const done: Todo = { ...nt, status: 'done', messages: fmsgs, when: 'just now', tokens: footer.tokens, memoryFlushed: true, doneAt: Date.now() + Math.random() };
      agents = agents.map((a) => a.id === done.agentId ? { ...a, status: 'idle', taskId: null } : a);
      return done;
    }
    return nt;
  });

  for (const ag of agents) {
    if (ag.status !== 'idle') continue;
    const cand = todos.map((t, i) => ({ t, i })).filter((x) => x.t.status === 'queued' && (!x.t.preferredAgent || x.t.preferredAgent === ag.id));
    cand.sort((a, b) => (b.t.priority ? 1 : 0) - (a.t.priority ? 1 : 0) || a.i - b.i);
    if (!cand.length) continue;
    const pick = cand[0];
    const rm = resolveModel(pick.t.modelPref || 'auto');
    const dur = rm.loc === 'cloud' ? 16 : 30;
    const assistant = asst(CANNED_REPLY, [{ name: 'wiki:get', args: 'context', result: 'loaded', done: true }], null, 0);
    todos = todos.map((t, i) => i === pick.i ? { ...t, status: 'running', agentId: ag.id, model: rm.model, loc: rm.loc, elapsed: 0, dur, messages: t.messages.concat([assistant]) } : t);
    ag.status = 'busy'; ag.taskId = pick.t.id;
  }
  return { agents, todos };
}

export function AgentsPage() {
  const [world, setWorld] = useState<World>({ agents: SEED_AGENTS, todos: SEED_TODOS });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'done'>('all');

  useEffect(() => {
    const iv = setInterval(() => setWorld((w) => advance(w)), 1000);
    return () => clearInterval(iv);
  }, []);

  const { agents, todos } = world;
  const agentOf = (id: string | null) => agents.find((a) => a.id === id) || null;
  const freeCount = agents.filter((a) => a.status === 'idle').length;
  const running = todos.filter((t) => t.status === 'running');
  const queued = todos.filter((t) => t.status === 'queued').sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  const done = todos.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  // ── mutations ───────────────────────────────────────────────────────────────
  const actions: TodoActions = {
    open: (id) => { setMenuId(null); setOpenId(id); },
    priority: (id) => setWorld((w) => ({ ...w, todos: w.todos.map((t) => t.id === id ? { ...t, priority: !t.priority } : t) })),
    stop: (id) => setWorld((w) => ({
      agents: w.agents.map((a) => a.taskId === id ? { ...a, status: 'idle', taskId: null } : a),
      todos: w.todos.map((t) => t.id === id ? { ...t, status: 'queued', agentId: null, elapsed: 0, model: undefined, modelPref: t.modelPref || (t.loc === 'cloud' ? 'cloud' : 'auto'), messages: t.messages.filter((m) => m.role === 'user') } : t),
    })),
    remove: (id) => { setOpenId((o) => (o === id ? null : o)); setWorld((w) => ({ agents: w.agents.map((a) => a.taskId === id ? { ...a, status: 'idle', taskId: null } : a), todos: w.todos.filter((t) => t.id !== id) })); },
    rerun: (id) => setWorld((w) => {
      const s = w.todos.find((t) => t.id === id); if (!s) return w;
      const um = s.messages.find((m) => m.role === 'user') || { role: 'user' as const, text: s.title, by: s.by };
      const nt: Todo = { id: 'n' + Date.now(), title: s.title, by: s.by, priority: false, status: 'queued', agentId: null, modelPref: s.modelPref || (s.loc === 'cloud' ? 'cloud' : 'auto'), loc: s.loc, messages: [{ ...um }] };
      return { ...w, todos: [...w.todos, nt] };
    }),
    continue: (id, text) => setWorld((w) => ({
      agents: w.agents.map((a) => a.taskId === id ? { ...a, status: 'idle', taskId: null } : a),
      todos: w.todos.map((t) => t.id === id ? {
        ...t, status: 'queued', agentId: null, elapsed: 0, memoryFlushed: false, model: undefined,
        modelPref: t.modelPref || (t.loc === 'cloud' ? 'cloud' : 'auto'),
        messages: [...t.messages.map((m) => (m.reveal != null ? { ...m, reveal: null } : m)), { role: 'user', text, by: 'alice' }],
      } : t),
    })),
    add: ({ title, assign, model }) => {
      const rm = resolveModel(model === 'auto' ? 'auto' : model);
      const nt: Todo = { id: 'n' + Date.now(), title, by: 'alice', priority: false, status: 'queued', agentId: null, modelPref: model === 'auto' ? 'auto' : model, loc: rm.loc, preferredAgent: assign === 'any' ? null : assign, messages: [{ role: 'user', text: title, by: 'alice' }] };
      setWorld((w) => ({ ...w, todos: [...w.todos, nt] }));
      setAdding(false);
    },
  };

  const openTodo = openId ? todos.find((t) => t.id === openId) : null;
  useEffect(() => { if (openId && !todos.find((t) => t.id === openId)) setOpenId(null); }, [todos, openId]);

  const chips: Array<[typeof filter, string, number]> = [['all', 'All', todos.length], ['running', 'Running', running.length], ['queued', 'Queued', queued.length], ['done', 'Done', done.length]];
  const showGroup = (g: 'running' | 'queued' | 'done') => filter === 'all' || filter === g;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px 14px', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: 23, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Agents</h1>
          <div className="b2-hide-sm" style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>A shared queue. Free agents pick up the next todo and run it with the requester’s access.</div>
        </div>
        <Link to="/settings#models" style={{ ...agBtnGhost(), textDecoration: 'none' }}><Icon name="cpu" size={15} color="var(--fg-muted)" /> <span className="b2-hide-sm">Manage models</span></Link>
        <button onClick={() => setAdding(true)} style={agBtnPrimary()}><Icon name="plus" size={15} color="#fff" /> Add a todo</button>
      </div>

      {/* roster */}
      <div style={{ flexShrink: 0, padding: '4px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Agents</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{agents.length} total · {freeCount} free</span>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {agents.map((a) => <RosterCard key={a.id} a={a} todo={a.taskId ? todos.find((t) => t.id === a.taskId) || null : null} onOpen={actions.open} />)}
        </div>
      </div>

      {/* queue */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 28px' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'visible', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Shared todo list</span>
            <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9, marginLeft: 6 }}>
              {chips.map(([id, l, n]) => {
                const on = filter === id;
                return <button key={id} onClick={() => setFilter(id)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 27, padding: '0 11px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>{l}<span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{n}</span></button>;
              })}
            </div>
            <span className="b2-hide-sm" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}><Icon name="lock" size={13} color="var(--fg-faint)" /> each todo runs with its requester’s access</span>
          </div>

          {showGroup('running') && running.length > 0 && <GroupHead icon="loader" label="Running" n={running.length} tone="var(--success)" note={running.length + ' agent' + (running.length === 1 ? '' : 's') + ' busy'} />}
          {showGroup('running') && running.map((t) => <TodoRow key={t.id} t={t} agent={agentOf(t.agentId)} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {showGroup('queued') && queued.length > 0 && <GroupHead icon="clock" label="Queued" n={queued.length} note="high-priority items jump the queue" />}
          {showGroup('queued') && queued.map((t) => <TodoRow key={t.id} t={t} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {showGroup('done') && done.length > 0 && <GroupHead icon="check" label="Done · archived" n={done.length} tone="var(--success)" note="transcripts kept · memory flushed" />}
          {showGroup('done') && done.map((t) => <TodoRow key={t.id} t={t} agent={agentOf(t.agentId)} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {((filter === 'running' && !running.length) || (filter === 'queued' && !queued.length) || (filter === 'done' && !done.length)) && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>Nothing here right now.</div>
          )}
        </div>
        <div className="b2-show-sm" style={{ display: 'none', height: 'calc(56px + env(safe-area-inset-bottom, 0px))' }} />
      </div>

      {adding && <AddTodoModal agents={agents} freeCount={freeCount} onClose={() => setAdding(false)} onAdd={actions.add} />}
      {openTodo && <ConversationDrawer todo={openTodo} agent={agentOf(openTodo.agentId)} onClose={() => setOpenId(null)} onContinue={actions.continue} />}
    </div>
  );
}
