import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { LiveTodo, TodoMessage, Worker } from '@/lib/types';
import type { Agent, Message, Todo } from '@/pages/Agents/data';

export function mapWorker(worker: Worker): Agent {
  return {
    id: worker.agent_id,
    name: worker.name,
    status: worker.status,
    taskId: worker.current_todo_id,
  };
}

export function mapMessage(message: TodoMessage): Message {
  return {
    role: message.role === 'tool' ? 'assistant' : message.role,
    text: message.content,
    reveal: null,
    tools: message.role === 'tool' && message.tool_name
      ? [{ name: message.tool_name, args: '', result: message.content, done: true }]
      : [],
  };
}

export function mapTodo(todo: LiveTodo, messages: TodoMessage[]): Todo {
  return {
    id: todo.todo_id,
    workspace_id: todo.workspace_id,
    title: todo.title,
    by: todo.requester_user_id,
    priority: todo.priority > 0,
    status: todo.status,
    agentId: todo.assigned_agent_id,
    preferredAgent: todo.preferred_agent_id,
    modelPref: todo.model_pref ?? undefined,
    model: todo.model_name ?? undefined,
    modelProvider: todo.model_provider === 'anthropic' || todo.model_provider === 'openrouter'
      ? todo.model_provider
      : undefined,
    memoryFlushed: todo.memory_flushed === 1,
    doneAt: todo.completed_at ? Date.parse(todo.completed_at) : undefined,
    completedLabel: todo.completed_at ? new Date(todo.completed_at).toLocaleString() : undefined,
    tokens: todo.tokens_total != null ? `${todo.tokens_total} tok` : undefined,
    messages: messages.map(mapMessage),
  };
}

export function useWorkers() {
  return useQuery({
    queryKey: qk.workers(),
    queryFn: () =>
      ops<{ agents: Worker[] }>('agents:list')
        .then((result) => result.agents.map(mapWorker)),
    refetchInterval: 4000,
  });
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

function useTodoMutation<V>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: V) => ops(name, params as object),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.todos() });
      qc.invalidateQueries({ queryKey: qk.workers() });
    },
  });
}

export const useCreateTodo = () =>
  useTodoMutation<{
    title: string;
    workspace_id: string;
    model_pref?: string;
    preferred_agent_id?: string;
  }>('todos:create');

export const useSetTodoPriority = () =>
  useTodoMutation<{ todo_id: string; priority: number }>('todos:set_priority');

export const useStopTodo = () => useTodoMutation<{ todo_id: string }>('todos:stop');

export const useDeleteTodo = () => useTodoMutation<{ todo_id: string }>('todos:delete');

export const useContinueTodo = () =>
  useTodoMutation<{ todo_id: string; text: string }>('todos:continue');
