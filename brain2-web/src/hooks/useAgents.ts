import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { invalidateTodoQueries, qk } from '@/lib/queryClient';
import type {
  Complexity,
  LiveTodo,
  ModelProvider,
  TodoMessage,
  Worker,
} from '@/lib/types';
import type { Agent, Message, Todo } from '@/pages/Agents/data';

const MODEL_PROVIDERS: readonly ModelProvider[] = [
  'anthropic', 'ollama', 'openrouter', 'gemini', 'openai', 'stub',
];

function responseProvider(value: unknown): ModelProvider | null {
  return typeof value === 'string'
    && MODEL_PROVIDERS.includes(value as ModelProvider)
    ? value as ModelProvider
    : null;
}

export function mapAgent(worker: Worker): Agent {
  return {
    id: worker.agent_id,
    name: worker.name,
    modelId: worker.model_id ?? null,
    modelName: worker.model_name ?? null,
    modelProvider: responseProvider(worker.model_provider),
    modelStatus: worker.model_status ?? null,
    complexity: worker.complexity,
    enabled: worker.enabled ?? false,
    status: worker.status,
    taskId: worker.current_todo_id ?? null,
    lastHeartbeat: worker.last_heartbeat ?? null,
    todoSummary: worker.todo_summary ?? null,
  };
}

/** Compatibility export for callers migrating to the configured-agent name. */
export const mapWorker = mapAgent;

export function mapMessage(message: TodoMessage): Message {
  return {
    role: message.role === 'tool' ? 'assistant' : message.role,
    text: message.content,
    messageId: message.message_id,
    conversationId: message.conversation_id,
    createdAt: message.created_at,
    tokensIn: message.tokens_in,
    tokensOut: message.tokens_out,
    costMicros: message.cost_micros,
    latencyMs: message.latency_ms,
    reveal: null,
    tools: message.role === 'tool' && message.tool_name
      ? [{
          name: message.tool_name,
          args: message.tool_calls_json ?? '',
          result: message.content,
          done: true,
        }]
      : [],
  };
}

export function mapTodo(todo: LiveTodo, messages: TodoMessage[]): Todo {
  const modelProvider = responseProvider(todo.model_provider);
  return {
    id: todo.todo_id,
    workspace_id: todo.workspace_id,
    title: todo.title,
    by: todo.requester_user_id,
    priority: todo.priority > 0,
    status: todo.status,
    complexity: todo.complexity,
    error: todo.error ?? null,
    assignedAgentId: todo.assigned_agent_id ?? null,
    agentId: todo.agent_id ?? null,
    agentName: todo.agent_name ?? null,
    preferredAgent: todo.preferred_agent_id ?? null,
    modelPref: todo.model_pref ?? undefined,
    modelId: todo.model_id ?? null,
    modelName: todo.model_name ?? null,
    modelProvider,
    model: todo.model_name ?? undefined,
    conversationId: todo.conversation_id ?? null,
    runs: (todo.runs ?? []).map((run) => ({
      ...run,
      model_provider: responseProvider(run.model_provider),
    })),
    memoryFlushed: todo.memory_flushed === 1,
    doneAt: todo.completed_at ? Date.parse(todo.completed_at) : undefined,
    completedLabel: todo.completed_at
      ? new Date(todo.completed_at).toLocaleString()
      : undefined,
    tokens: todo.tokens_total != null ? `${todo.tokens_total} tok` : undefined,
    messages: messages.map(mapMessage),
  };
}

export function useAgents() {
  return useQuery({
    queryKey: qk.agents(),
    queryFn: () =>
      ops<{ agents: Worker[] }>('agents:list')
        .then((result) => result.agents.map(mapAgent)),
    refetchInterval: 4000,
  });
}

/** Compatibility alias while existing page callers migrate to useAgents. */
export function useWorkers() {
  return useAgents();
}

export function useTodos(status: string | null = null) {
  return useQuery({
    queryKey: qk.todos(status),
    queryFn: () =>
      ops<{ todos: LiveTodo[] }>('todos:list', status ? { status } : {})
        .then((result) => result.todos.map((todo) => mapTodo(todo, []))),
    refetchInterval: 4000,
  });
}

export function useTodo(todoId: string | null) {
  return useQuery({
    queryKey: todoId ? qk.todo(todoId) : ['todo', '_'],
    queryFn: () =>
      ops<{ todo: LiveTodo; messages: TodoMessage[] }>('todos:get', { todo_id: todoId })
        .then((result) => mapTodo(result.todo, result.messages)),
    enabled: !!todoId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  });
}

function invalidateAgentRoster(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.agents() });
}

function useAgentMutation<V extends object>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: V) => ops(name, params),
    onSuccess: () => {
      invalidateAgentRoster(qc);
      invalidateTodoQueries(qc);
    },
  });
}

export const useCreateAgent = () => useAgentMutation<{
  name: string;
  model_id: string;
  complexity: Complexity;
}>('agents:create');

export const useUpdateAgent = () => useAgentMutation<{
  agent_id: string;
  name?: string;
  model_id?: string;
  complexity?: Complexity;
  enabled?: boolean;
}>('agents:update');

export const useDeleteAgent = () =>
  useAgentMutation<{ agent_id: string }>('agents:delete');

function useTodoMutation<V extends object>(
  name: string,
  invalidateActiveTodo = false,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: V) => ops(name, params),
    onSuccess: (_result, variables) => {
      invalidateTodoQueries(qc);
      invalidateAgentRoster(qc);
      if (invalidateActiveTodo && 'todo_id' in variables) {
        const todoId = variables.todo_id;
        if (typeof todoId === 'string') {
          qc.invalidateQueries({ queryKey: qk.todo(todoId) });
        }
      }
    },
  });
}

export const useCreateTodo = () =>
  useTodoMutation<{
    title: string;
    workspace_id: string;
    complexity: Complexity;
    preferred_agent_id?: string;
  }>('todos:create');

export const useSetTodoPriority = () =>
  useTodoMutation<{ todo_id: string; priority: number }>('todos:set_priority');

export const useStopTodo = () =>
  useTodoMutation<{ todo_id: string }>('todos:stop', true);

export const useDeleteTodo = () =>
  useTodoMutation<{ todo_id: string }>('todos:delete');

export const useContinueTodo = () =>
  useTodoMutation<{ todo_id: string; text: string }>('todos:continue', true);
