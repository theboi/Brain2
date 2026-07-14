import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { agentAvailability } from '@/lib/agentAvailability';
import {
  useContinueTodo,
  useCreateTodo,
  useDeleteTodo,
  useSetTodoPriority,
  useStopTodo,
  useTodos,
  useWorkers,
} from '@/hooks/useAgents';
import {
  agBtnGhost, agBtnPrimary, RosterCard, TodoRow, GroupHead,
  ConversationDrawer, AddTodoModal, type TodoActions,
} from './components';
import { eligibleAgentsForComplexity } from './logic';

export function AgentsPage() {
  const workersQuery = useWorkers();
  const todosQuery = useTodos();
  const agents = workersQuery.data ?? [];
  const todos = todosQuery.data ?? [];
  const createTodo = useCreateTodo();
  const setPriority = useSetTodoPriority();
  const stopTodo = useStopTodo();
  const deleteTodo = useDeleteTodo();
  const continueTodo = useContinueTodo();

  const [menuId, setMenuId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'done'>('all');

  const agentOf = (id: string | null) => agents.find((a) => a.id === id) || null;
  const availability = agentAvailability(agents);
  const running = todos.filter((t) => t.status === 'running');
  const queued = todos.filter((t) => t.status === 'queued').sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  const done = todos.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const actions: TodoActions = {
    open: (id) => { setMenuId(null); setOpenId(id); },
    priority: (id) => {
      const todo = todos.find((item) => item.id === id);
      setPriority.mutate({ todo_id: id, priority: todo?.priority ? 0 : 1 });
    },
    stop: (id) => stopTodo.mutate({ todo_id: id }),
    remove: (id) => {
      setOpenId((current) => (current === id ? null : current));
      deleteTodo.mutate({ todo_id: id });
    },
    rerun: (id) => {
      const source = todos.find((item) => item.id === id);
      if (!source?.workspace_id) return;
      createTodo.mutate({
        title: source.title,
        workspace_id: source.workspace_id,
        complexity: source.complexity,
      });
    },
    continue: (id, text) => continueTodo.mutate({ todo_id: id, text }),
    add: ({ title, assign, complexity, workspaceId }) => {
      const eligibleAgents = eligibleAgentsForComplexity(agents, complexity);
      const preferredAgentId = eligibleAgents.some((agent) => agent.id === assign)
        ? assign
        : undefined;
      createTodo.mutate(
        {
          title,
          workspace_id: workspaceId,
          complexity,
          preferred_agent_id: preferredAgentId,
        },
        { onSuccess: () => setAdding(false) },
      );
    },
  };

  const chips: Array<[typeof filter, string, number]> = [['all', 'All', todos.length], ['running', 'Running', running.length], ['queued', 'Queued', queued.length], ['done', 'Done', done.length]];
  const showGroup = (g: 'running' | 'queued' | 'done') => filter === 'all' || filter === g;
  const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';

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
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{availability.total} total · {availability.free} free</span>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {workersQuery.isPending && <div style={{ padding: '24px 4px', color: 'var(--fg-muted)', fontSize: 13 }}>Loading live workers…</div>}
          {workersQuery.isError && <div role="alert" style={{ padding: '16px 0', color: 'var(--destructive)', fontSize: 13 }}>Could not load workers: {errorText(workersQuery.error)} <button onClick={() => workersQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}
          {!workersQuery.isPending && !workersQuery.isError && agents.length === 0 && <div style={{ padding: '20px 4px', color: 'var(--fg-muted)', fontSize: 13 }}>No worker runtimes have registered yet. Start a Brain2 worker to process the queue.</div>}
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

          {todosQuery.isPending && <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Loading durable queue…</div>}
          {todosQuery.isError && <div role="alert" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--destructive)', fontSize: 13 }}>Could not load the queue: {errorText(todosQuery.error)} <button onClick={() => todosQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}

          {showGroup('running') && running.length > 0 && <GroupHead icon="loader" label="Running" n={running.length} tone="var(--success)" note={running.length + ' agent' + (running.length === 1 ? '' : 's') + ' busy'} />}
          {showGroup('running') && running.map((t) => <TodoRow key={t.id} t={t} agent={agentOf(t.agentId)} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {showGroup('queued') && queued.length > 0 && <GroupHead icon="clock" label="Queued" n={queued.length} note="high-priority items jump the queue" />}
          {showGroup('queued') && queued.map((t) => <TodoRow key={t.id} t={t} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {showGroup('done') && done.length > 0 && <GroupHead icon="check" label="Done · archived" n={done.length} tone="var(--success)" note="transcripts kept · memory flushed" />}
          {showGroup('done') && done.map((t) => <TodoRow key={t.id} t={t} agent={agentOf(t.agentId)} menuOpen={menuId === t.id} onMenu={setMenuId} actions={actions} />)}

          {!todosQuery.isPending && !todosQuery.isError && ((filter === 'all' && !todos.length) || (filter === 'running' && !running.length) || (filter === 'queued' && !queued.length) || (filter === 'done' && !done.length)) && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>Nothing here right now.</div>
          )}
        </div>
        <div className="b2-show-sm" style={{ display: 'none', height: 'calc(56px + env(safe-area-inset-bottom, 0px))' }} />
      </div>

      {adding && <AddTodoModal agents={agents} pending={createTodo.isPending} error={createTodo.isError ? errorText(createTodo.error) : null} onClose={() => setAdding(false)} onAdd={actions.add} />}
      {openId && <ConversationDrawer todoId={openId} agentOf={agentOf} onClose={() => setOpenId(null)} onContinue={actions.continue} />}
    </div>
  );
}
