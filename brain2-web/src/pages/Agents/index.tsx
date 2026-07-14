import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { agentAvailability } from '@/lib/agentAvailability';
import { useModels } from '@/hooks/useModels';
import {
  useAgents,
  useContinueTodo,
  useCreateAgent,
  useCreateTodo,
  useDeleteAgent,
  useDeleteTodo,
  useSetTodoPriority,
  useStopTodo,
  useTodos,
  useUpdateAgent,
} from '@/hooks/useAgents';
import {
  AddAgentModal,
  AddTodoModal,
  ConfigureAgentModal,
  ConversationDrawer,
  GroupHead,
  RosterCard,
  TodoRow,
  agBtnGhost,
  agBtnPrimary,
  type TodoActions,
} from './components';
import type { Agent } from './data';
import { eligibleAgentsForComplexity } from './logic';

type QueueFilter = 'all' | 'running' | 'queued' | 'done' | 'failed';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export function AgentsPage() {
  const agentsQuery = useAgents();
  const modelsQuery = useModels();
  const todosQuery = useTodos();
  const agents = agentsQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const todos = todosQuery.data ?? [];
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const createTodo = useCreateTodo();
  const setPriority = useSetTodoPriority();
  const stopTodo = useStopTodo();
  const deleteTodo = useDeleteTodo();
  const continueTodo = useContinueTodo();

  const [menuId, setMenuId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingTodo, setAddingTodo] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  const [configuring, setConfiguring] = useState<Agent | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');

  const agentOf = (id: string | null) => agents.find((agent) => agent.id === id) || null;
  const availability = agentAvailability(agents);
  const running = todos.filter((todo) => todo.status === 'running');
  const queued = todos.filter((todo) => todo.status === 'queued').sort((a, b) => Number(b.priority) - Number(a.priority));
  const done = todos.filter((todo) => todo.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const failed = todos.filter((todo) => todo.status === 'failed').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

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
      createTodo.mutate({
        title,
        workspace_id: workspaceId,
        complexity,
        preferred_agent_id: preferredAgentId,
      }, { onSuccess: () => setAddingTodo(false) });
    },
  };

  const chips: Array<[QueueFilter, string, number]> = [
    ['all', 'All', todos.length],
    ['running', 'Running', running.length],
    ['queued', 'Queued', queued.length],
    ['done', 'Done', done.length],
    ['failed', 'Failed', failed.length],
  ];
  const showGroup = (group: Exclude<QueueFilter, 'all'>) => filter === 'all' || filter === group;
  const visibleCount = filter === 'all'
    ? todos.length
    : { running, queued, done, failed }[filter].length;

  const openAddAgent = () => {
    createAgent.reset();
    setAddingAgent(true);
  };
  const openConfigure = (agent: Agent) => {
    updateAgent.reset();
    deleteAgent.reset();
    setConfiguring(agent);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="b2-agents-header" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: 23, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Agents</h1>
          <div className="b2-hide-sm" style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>Configured runtimes claim durable todos only when complexity matches exactly and their model is available.</div>
        </div>
        <Link className="b2-agent-focus" to="/settings#models" style={{ ...agBtnGhost(), textDecoration: 'none' }}><Icon name="cpu" size={15} color="var(--fg-muted)" /> Models</Link>
        <button className="b2-agent-focus" onClick={openAddAgent} style={agBtnGhost()}><Icon name="robot" size={15} /> Add agent</button>
        <button className="b2-agent-focus" onClick={() => { createTodo.reset(); setAddingTodo(true); }} style={agBtnPrimary()}><Icon name="plus" size={15} color="#fff" /> Add todo</button>
      </div>

      <section aria-labelledby="agent-roster-title" style={{ flexShrink: 0, padding: '4px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 id="agent-roster-title" style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Configured agents</h2>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{availability.total} total · {availability.free} idle</span>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {agentsQuery.isPending && <div role="status" style={{ padding: '24px 4px', color: 'var(--fg-muted)', fontSize: 13 }}>Loading configured runtimes…</div>}
          {agentsQuery.isError && <div role="alert" style={{ padding: '16px 0', color: 'var(--destructive)', fontSize: 13 }}>Could not load configured runtimes: {errorText(agentsQuery.error)} <button className="b2-agent-focus" onClick={() => agentsQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}
          {!agentsQuery.isPending && !agentsQuery.isError && agents.length === 0 && <div style={{ padding: '20px 4px', color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.5 }}>No configured agent runtimes yet. Add an agent after registering a ready model.</div>}
          {agents.map((agent) => <RosterCard key={agent.id} a={agent} todo={agent.taskId ? todos.find((todo) => todo.id === agent.taskId) || null : null} onOpen={actions.open} onConfigure={openConfigure} />)}
        </div>
      </section>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 28px' }}>
        <section aria-labelledby="todo-queue-title" style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'visible', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <h2 id="todo-queue-title" style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Durable todo queue</h2>
            <div className="b2-agent-filters" role="group" aria-label="Filter todos by status" style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9, marginLeft: 6, overflowX: 'auto', maxWidth: '100%' }}>
              {chips.map(([id, label, count]) => {
                const selected = filter === id;
                return <button className="b2-agent-focus" key={id} onClick={() => setFilter(id)} aria-pressed={selected} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 11px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: selected ? 600 : 500, background: selected ? 'var(--surface)' : 'transparent', color: id === 'failed' && count ? 'var(--destructive)' : selected ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: selected ? 'var(--shadow-card)' : 'none' }}>{id === 'failed' && <Icon name="alert" size={13} />}{label}<span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'inherit' }}>{count}</span></button>;
              })}
            </div>
            <span className="b2-hide-sm" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}><Icon name="lock" size={13} /> requester access is enforced for every run</span>
          </div>

          {todosQuery.isPending && <div role="status" style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Loading durable queue…</div>}
          {todosQuery.isError && <div role="alert" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--destructive)', fontSize: 13 }}>Could not load the queue: {errorText(todosQuery.error)} <button className="b2-agent-focus" onClick={() => todosQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}

          {showGroup('running') && running.length > 0 && <GroupHead icon="loader" label="Running" n={running.length} tone="var(--success)" note={`${running.length} configured agent${running.length === 1 ? '' : 's'} busy`} />}
          {showGroup('running') && running.map((todo) => <TodoRow key={todo.id} t={todo} agent={agentOf(todo.agentId)} menuOpen={menuId === todo.id} onMenu={setMenuId} actions={actions} />)}
          {showGroup('queued') && queued.length > 0 && <GroupHead icon="clock" label="Queued" n={queued.length} note="durable while matching agents are busy or offline" />}
          {showGroup('queued') && queued.map((todo) => <TodoRow key={todo.id} t={todo} agent={agentOf(todo.agentId)} menuOpen={menuId === todo.id} onMenu={setMenuId} actions={actions} />)}
          {showGroup('done') && done.length > 0 && <GroupHead icon="check" label="Done" n={done.length} tone="var(--success)" note="durable transcripts retained" />}
          {showGroup('done') && done.map((todo) => <TodoRow key={todo.id} t={todo} agent={agentOf(todo.agentId)} menuOpen={menuId === todo.id} onMenu={setMenuId} actions={actions} />)}
          {showGroup('failed') && failed.length > 0 && <GroupHead icon="alert" label="Failed" n={failed.length} tone="var(--destructive)" note="sanitized failure transcripts retained" />}
          {showGroup('failed') && failed.map((todo) => <TodoRow key={todo.id} t={todo} agent={agentOf(todo.agentId)} menuOpen={menuId === todo.id} onMenu={setMenuId} actions={actions} />)}

          {!todosQuery.isPending && !todosQuery.isError && visibleCount === 0 && <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>{filter === 'all' ? 'No durable todos yet.' : `No ${filter} todos.`}</div>}
        </section>
        <div className="b2-show-sm" style={{ display: 'none', height: 'calc(56px + env(safe-area-inset-bottom, 0px))' }} />
      </div>

      {addingAgent && <AddAgentModal models={models} modelsPending={modelsQuery.isPending} modelsError={modelsQuery.isError ? errorText(modelsQuery.error) : null} onRetryModels={() => modelsQuery.refetch()} pending={createAgent.isPending} error={createAgent.isError ? errorText(createAgent.error) : null} onClose={() => setAddingAgent(false)} onAdd={({ name, modelId, complexity }) => createAgent.mutate({ name, model_id: modelId, complexity }, { onSuccess: () => setAddingAgent(false) })} />}
      {configuring && <ConfigureAgentModal agent={configuring} models={models} pending={updateAgent.isPending} error={updateAgent.isError ? errorText(updateAgent.error) : null} deletePending={deleteAgent.isPending} deleteError={deleteAgent.isError ? errorText(deleteAgent.error) : null} onClose={() => setConfiguring(null)} onSave={(changes) => Object.keys(changes).length === 0 ? setConfiguring(null) : updateAgent.mutate({ agent_id: configuring.id, ...changes }, { onSuccess: () => setConfiguring(null) })} onDelete={() => deleteAgent.mutate({ agent_id: configuring.id }, { onSuccess: () => setConfiguring(null) })} />}
      {addingTodo && <AddTodoModal agents={agents} pending={createTodo.isPending} error={createTodo.isError ? errorText(createTodo.error) : null} onClose={() => setAddingTodo(false)} onAdd={actions.add} />}
      {openId && <ConversationDrawer todoId={openId} agentOf={agentOf} onClose={() => setOpenId(null)} onContinue={actions.continue} />}
    </div>
  );
}
