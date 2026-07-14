import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { agentAvailability } from '@/lib/agentAvailability';
import { useMe } from '@/hooks/me';
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
  canManageAgents,
  type TodoActions,
} from './components';
import { eligibleAgentsForComplexity } from './logic';

type QueueFilter = 'all' | 'running' | 'queued' | 'done' | 'failed';
type QueueActionState = {
  todoId: string;
  label: string;
  pending: boolean;
  error: string | null;
  kind: 'mutation' | 'stop-convergence';
};
type QueueMutationCallbacks = {
  onSuccess: () => void;
  onError: (error: Error) => void;
  onSettled: () => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export function AgentsPage() {
  const meQuery = useMe();
  const agentsQuery = useAgents();
  const modelsQuery = useModels();
  const todosQuery = useTodos();
  const agents = agentsQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const todos = todosQuery.data ?? [];
  const mayManageAgents = canManageAgents(meQuery.data?.role);
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
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [queueAction, setQueueAction] = useState<QueueActionState | null>(null);
  const queueActionLockRef = useRef(false);

  const configuringAgent = configuringId
    ? agents.find((agent) => agent.id === configuringId) ?? null
    : null;

  useEffect(() => {
    if (!configuringId || !agentsQuery.isSuccess || configuringAgent) return;
    if (updateAgent.isPending || deleteAgent.isPending) return;
    updateAgent.reset();
    deleteAgent.reset();
    setConfiguringId(null);
  }, [agentsQuery.isSuccess, configuringAgent, configuringId, deleteAgent, updateAgent]);

  useEffect(() => {
    if (!meQuery.isSuccess || mayManageAgents) return;
    if (!createAgent.isPending) setAddingAgent(false);
    if (!updateAgent.isPending && !deleteAgent.isPending) setConfiguringId(null);
  }, [createAgent.isPending, deleteAgent.isPending, mayManageAgents, meQuery.isSuccess, updateAgent.isPending]);

  const agentOf = (id: string | null) => agents.find((agent) => agent.id === id) || null;
  const availability = agentAvailability(agents);
  const running = todos.filter((todo) => todo.status === 'running');
  const queued = todos.filter((todo) => todo.status === 'queued').sort((a, b) => Number(b.priority) - Number(a.priority));
  const done = todos.filter((todo) => todo.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const failed = todos.filter((todo) => todo.status === 'failed').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  useEffect(() => {
    if (queueAction?.kind !== 'stop-convergence') return;
    const todo = todos.find((item) => item.id === queueAction.todoId);
    if (todo?.status === 'running' && !todo.cancelRequested) return;
    queueActionLockRef.current = false;
    setQueueAction((current) => current?.kind === 'stop-convergence' ? null : current);
  }, [queueAction?.kind, queueAction?.todoId, todos]);

  const runQueueAction = (
    todoId: string,
    label: string,
    start: (callbacks: QueueMutationCallbacks) => void,
    afterSuccess?: () => void,
    retainUntilStopConverges = false,
  ) => {
    if (queueActionLockRef.current || continueTodo.isPending) return;
    queueActionLockRef.current = true;
    setMenuId(null);
    setQueueAction({ todoId, label, pending: true, error: null, kind: 'mutation' });
    let waitingForStopConvergence = false;
    const callbacks: QueueMutationCallbacks = {
      onSuccess: () => {
        afterSuccess?.();
        if (retainUntilStopConverges) {
          waitingForStopConvergence = true;
          setQueueAction({
            todoId,
            label: 'Stop requested / waiting for agent',
            pending: true,
            error: null,
            kind: 'stop-convergence',
          });
        } else {
          setQueueAction(null);
        }
      },
      onError: (error) => setQueueAction({ todoId, label, pending: false, error: errorText(error), kind: 'mutation' }),
      onSettled: () => {
        if (!waitingForStopConvergence) queueActionLockRef.current = false;
      },
    };
    try {
      start(callbacks);
    } catch (error) {
      queueActionLockRef.current = false;
      setQueueAction({ todoId, label, pending: false, error: errorText(error), kind: 'mutation' });
    }
  };

  const actions: TodoActions = {
    open: (id) => {
      setMenuId(null);
      continueTodo.reset();
      setOpenId(id);
    },
    priority: (id) => {
      const todo = todos.find((item) => item.id === id);
      runQueueAction(id, todo?.priority ? 'Removing priority…' : 'Setting priority…', (callbacks) => {
        setPriority.mutate({ todo_id: id, priority: todo?.priority ? 0 : 1 }, callbacks);
      });
    },
    stop: (id) => runQueueAction(id, 'Requesting stop…', (callbacks) => {
      stopTodo.mutate({ todo_id: id }, callbacks);
    }, undefined, true),
    remove: (id) => runQueueAction(id, 'Deleting todo…', (callbacks) => {
      deleteTodo.mutate({ todo_id: id }, callbacks);
    }, () => setOpenId((current) => (current === id ? null : current))),
    rerun: (id) => {
      const source = todos.find((item) => item.id === id);
      if (!source?.workspace_id) {
        setQueueAction({ todoId: id, label: 'Re-running todo', pending: false, error: 'This todo has no visible workspace and cannot be re-run.', kind: 'mutation' });
        return;
      }
      runQueueAction(id, 'Creating re-run…', (callbacks) => {
        createTodo.mutate({ title: source.title, workspace_id: source.workspace_id!, complexity: source.complexity }, callbacks);
      });
    },
    add: ({ title, assign, complexity, workspaceId }) => {
      const eligibleAgents = eligibleAgentsForComplexity(agents, complexity);
      const preferredAgentId = eligibleAgents.some((agent) => agent.id === assign) ? assign : undefined;
      createTodo.mutate({ title, workspace_id: workspaceId, complexity, preferred_agent_id: preferredAgentId }, {
        onSuccess: () => setAddingTodo(false),
      });
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
  const visibleCount = filter === 'all' ? todos.length : { running, queued, done, failed }[filter].length;
  const queueMutating = Boolean(queueAction?.pending || continueTodo.isPending);

  const openAddAgent = () => {
    if (!mayManageAgents) return;
    createAgent.reset();
    setAddingAgent(true);
  };
  const openConfigure = (agentId: string) => {
    if (!mayManageAgents) return;
    updateAgent.reset();
    deleteAgent.reset();
    setConfiguringId(agentId);
  };
  const row = (todo: typeof todos[number]) => (
    <TodoRow
      key={todo.id}
      t={todo}
      agent={agentOf(todo.agentId)}
      menuOpen={menuId === todo.id}
      onMenu={setMenuId}
      actions={actions}
      actionPending={queueAction?.pending && queueAction.todoId === todo.id ? queueAction.label : null}
      actionsDisabled={queueMutating}
    />
  );

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="b2-agents-header" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: 23, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Agents</h1>
          <div className="b2-hide-sm" style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>Configured runtimes claim durable todos only when complexity matches exactly and their model is available.</div>
        </div>
        <Link className="b2-agent-focus" to="/settings#models" style={{ ...agBtnGhost(), textDecoration: 'none' }}><Icon name="cpu" size={15} color="var(--fg-muted)" /> Models</Link>
        {mayManageAgents && <button className="b2-agent-focus" onClick={openAddAgent} style={agBtnGhost()}><Icon name="robot" size={15} /> Add agent</button>}
        <button className="b2-agent-focus" disabled={queueMutating || createTodo.isPending} onClick={() => { createTodo.reset(); setAddingTodo(true); }} style={{ ...agBtnPrimary(), opacity: queueMutating || createTodo.isPending ? 0.45 : 1 }}><Icon name="plus" size={15} color="#fff" /> Add todo</button>
      </div>

      <section aria-labelledby="agent-roster-title" style={{ flexShrink: 0, padding: '4px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><h2 id="agent-roster-title" style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Configured agents</h2><span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{availability.total} total · {availability.free} idle</span></div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {agentsQuery.isPending && <div role="status" style={{ padding: '24px 4px', color: 'var(--fg-muted)', fontSize: 13 }}>Loading configured runtimes…</div>}
          {agentsQuery.isError && <div role="alert" style={{ padding: '16px 0', color: 'var(--destructive)', fontSize: 13 }}>Could not load configured runtimes: {errorText(agentsQuery.error)} <button className="b2-agent-focus" onClick={() => agentsQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}
          {!agentsQuery.isPending && !agentsQuery.isError && agents.length === 0 && <div style={{ padding: '20px 4px', color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.5 }}>No configured agent runtimes yet.{mayManageAgents ? ' Add an agent after registering a ready model.' : ''}</div>}
          {agents.map((agent) => <RosterCard key={agent.id} a={agent} todo={agent.taskId ? todos.find((todo) => todo.id === agent.taskId) || null : null} onOpen={actions.open} onConfigure={mayManageAgents ? () => openConfigure(agent.id) : undefined} />)}
        </div>
      </section>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 28px' }}>
        <section aria-labelledby="todo-queue-title" style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'visible', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <h2 id="todo-queue-title" style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Durable todo queue</h2>
            <div className="b2-agent-filters" role="group" aria-label="Filter todos by status" style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9, marginLeft: 6, overflowX: 'auto', maxWidth: '100%' }}>
              {chips.map(([id, label, count]) => { const selected = filter === id; return <button className="b2-agent-focus" key={id} onClick={() => setFilter(id)} aria-pressed={selected} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 11px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: selected ? 600 : 500, background: selected ? 'var(--surface)' : 'transparent', color: id === 'failed' && count ? 'var(--destructive)' : selected ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: selected ? 'var(--shadow-card)' : 'none' }}>{id === 'failed' && <Icon name="alert" size={13} />}{label}<span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'inherit' }}>{count}</span></button>; })}
            </div>
            <span className="b2-hide-sm" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}><Icon name="lock" size={13} /> requester access is enforced for every run</span>
          </div>

          {todosQuery.isPending && <div role="status" style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Loading durable queue…</div>}
          {todosQuery.isError && <div role="alert" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--destructive)', fontSize: 13 }}>Could not load the queue: {errorText(todosQuery.error)} <button className="b2-agent-focus" onClick={() => todosQuery.refetch()} style={agBtnGhost()}>Retry</button></div>}
          {queueAction?.pending && <div role="status" style={{ margin: 12, padding: 10, border: '1px solid var(--accent-line)', borderRadius: 9, color: 'var(--accent)' }}><span className="b2-spin" style={{ display: 'inline-flex', marginRight: 8 }}><Icon name="loader" size={14} /></span>{queueAction.label}</div>}
          {queueAction?.error && <div role="alert" style={{ margin: 12, padding: 10, border: '1px solid var(--destructive)', borderRadius: 9, color: 'var(--destructive)' }}>{queueAction.label}: {queueAction.error} <button className="b2-agent-focus" onClick={() => setQueueAction(null)} style={{ ...agBtnGhost(), marginLeft: 8 }}>Dismiss</button></div>}

          {showGroup('running') && running.length > 0 && <GroupHead icon="loader" label="Running" n={running.length} tone="var(--success)" note={`${running.length} configured agent${running.length === 1 ? '' : 's'} busy`} />}
          {showGroup('running') && running.map(row)}
          {showGroup('queued') && queued.length > 0 && <GroupHead icon="clock" label="Queued" n={queued.length} note="durable while matching agents are busy or offline" />}
          {showGroup('queued') && queued.map(row)}
          {showGroup('done') && done.length > 0 && <GroupHead icon="check" label="Done" n={done.length} tone="var(--success)" note="durable transcripts retained" />}
          {showGroup('done') && done.map(row)}
          {showGroup('failed') && failed.length > 0 && <GroupHead icon="alert" label="Failed" n={failed.length} tone="var(--destructive)" note="sanitized failure transcripts retained" />}
          {showGroup('failed') && failed.map(row)}
          {!todosQuery.isPending && !todosQuery.isError && visibleCount === 0 && <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>{filter === 'all' ? 'No durable todos yet.' : `No ${filter} todos.`}</div>}
        </section>
        <div className="b2-show-sm" style={{ display: 'none', height: 'calc(56px + env(safe-area-inset-bottom, 0px))' }} />
      </div>

      {addingAgent && mayManageAgents && <AddAgentModal models={models} modelsPending={modelsQuery.isPending} modelsError={modelsQuery.isError ? errorText(modelsQuery.error) : null} onRetryModels={() => modelsQuery.refetch()} pending={createAgent.isPending} error={createAgent.isError ? errorText(createAgent.error) : null} onClose={() => setAddingAgent(false)} onAdd={({ name, modelId, complexity }) => createAgent.mutate({ name, model_id: modelId, complexity }, { onSuccess: () => setAddingAgent(false) })} />}
      {configuringAgent && mayManageAgents && <ConfigureAgentModal key={configuringAgent.id} agent={configuringAgent} models={models} modelsReady={modelsQuery.isSuccess} pending={updateAgent.isPending} error={updateAgent.isError ? errorText(updateAgent.error) : null} deletePending={deleteAgent.isPending} deleteError={deleteAgent.isError ? errorText(deleteAgent.error) : null} onClose={() => setConfiguringId(null)} onSave={(changes) => Object.keys(changes).length === 0 ? setConfiguringId(null) : updateAgent.mutate({ agent_id: configuringAgent.id, ...changes }, { onSuccess: () => setConfiguringId(null) })} onDelete={() => deleteAgent.mutate({ agent_id: configuringAgent.id }, { onSuccess: () => setConfiguringId(null) })} />}
      {addingTodo && <AddTodoModal agents={agents} pending={createTodo.isPending} error={createTodo.isError ? errorText(createTodo.error) : null} onClose={() => setAddingTodo(false)} onAdd={actions.add} />}
      {openId && <ConversationDrawer todoId={openId} agentOf={agentOf} continuationPending={continueTodo.isPending} continuationError={continueTodo.isError ? errorText(continueTodo.error) : null} onClose={() => setOpenId(null)} onContinue={(todoId, text, onSuccess) => continueTodo.mutate({ todo_id: todoId, text }, { onSuccess })} />}
    </div>
  );
}
