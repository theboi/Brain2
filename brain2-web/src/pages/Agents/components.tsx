/*
 * Brain2 Console — configured runtimes, durable queue, and conversations.
 */
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { MiniMD } from '@/components/browse/MiniMD';
import { sse } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import { useTodo } from '@/hooks/useAgents';
import { useWorkspacesOverview } from '@/hooks/useWorkspaces';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { Complexity, ModelConfig, RuntimeModelProvider } from '@/lib/types';
import type { Agent, Message, Todo, Tool } from './data';
import { COMPLEXITIES, eligibleAgentsForComplexity } from './logic';

// ── helpers ───────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const AG_TINT = ['#7C8CFF', '#34D399', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8', '#FB7185', '#2DD4BF'];

export function eligibleAgentModels(
  models: ModelConfig[],
): Array<ModelConfig & { provider: RuntimeModelProvider }> {
  return models.filter(
    (model): model is ModelConfig & { provider: RuntimeModelProvider } =>
      model.status === 'ready'
      && (model.provider === 'anthropic'
        || model.provider === 'ollama'
        || model.provider === 'openrouter'),
  );
}

export function canManageAgents(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner';
}

export function revalidateAgentModelSelection(
  selectedModelId: string,
  models: ModelConfig[],
  currentModelId: string | null,
): string {
  if (!selectedModelId) return '';
  const selected = models.find((model) => model.model_id === selectedModelId);
  if (!selected) return '';
  if (selectedModelId === currentModelId) return selectedModelId;
  return eligibleAgentModels([selected]).length === 1 ? selectedModelId : '';
}

export function canCreateAgent(input: {
  name: string;
  modelId: string;
  complexity: string;
  pending?: boolean;
}): boolean {
  return Boolean(
    input.name.trim()
    && input.modelId
    && COMPLEXITIES.some((item) => item.id === input.complexity)
    && !input.pending,
  );
}

export interface AgentDraft {
  name: string;
  modelId: string;
  complexity: Complexity;
  enabled: boolean;
}

function agentDraftFrom(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    modelId: agent.modelId ?? '',
    complexity: agent.complexity,
    enabled: agent.enabled,
  };
}

/** Signature of remotely editable configuration only; live runtime polling is excluded. */
export function agentConfigSignature(agent: Agent): string {
  return JSON.stringify([agent.name, agent.modelId, agent.complexity, agent.enabled]);
}

export function agentUpdateChanges(
  current: Agent,
  draft: AgentDraft,
): { name?: string; model_id?: string; complexity?: Complexity; enabled?: boolean } {
  const changes: { name?: string; model_id?: string; complexity?: Complexity; enabled?: boolean } = {};
  const name = draft.name.trim();
  if (name !== current.name) changes.name = name;
  // Omitting an unchanged model matters when the referenced model is paused:
  // the backend validates only a genuinely new model binding as ready.
  if (draft.modelId !== current.modelId) changes.model_id = draft.modelId;
  if (draft.complexity !== current.complexity) changes.complexity = draft.complexity;
  if (draft.enabled !== current.enabled) changes.enabled = draft.enabled;
  return changes;
}

export function todoStatusView(status: Todo['status'], cancelRequested = false): {
  icon: IconName;
  label: string;
  tone: string;
  spin: boolean;
} {
  if (status === 'running' && cancelRequested) return { icon: 'loader', label: 'Stopping', tone: 'var(--warning)', spin: true };
  if (status === 'running') return { icon: 'loader', label: 'Running', tone: 'var(--success)', spin: true };
  if (status === 'queued') return { icon: 'clock', label: 'Queued', tone: 'var(--fg-muted)', spin: false };
  if (status === 'failed') return { icon: 'alert', label: 'Failed', tone: 'var(--destructive)', spin: false };
  return { icon: 'check', label: 'Done', tone: 'var(--success)', spin: false };
}

export function canContinueTodo(status: Todo['status']): boolean {
  return status === 'done' || status === 'failed';
}

export function todoAgentDisplayName(todo: Pick<Todo, 'agentName'>, agent?: Agent | null): string | null {
  return todo.agentName ?? agent?.name ?? null;
}

function providerLabel(provider: Agent['modelProvider'] | ModelConfig['provider'] | null): string {
  if (!provider) return 'provider unknown';
  return provider === 'openrouter' ? 'OpenRouter' : provider[0].toUpperCase() + provider.slice(1);
}

export function canSubmitTodo(input: {
  title: string;
  workspaceId: string;
  complexity: string;
  pending?: boolean;
  workspaceReady?: boolean;
}): boolean {
  return Boolean(
    input.title.trim()
    && input.workspaceId
    && COMPLEXITIES.some((item) => item.id === input.complexity)
    && !input.pending
    && input.workspaceReady !== false,
  );
}

export function Av({ name, size = 30 }: { name?: string; size?: number }) {
  const nm = name || '?';
  let h = 0;
  for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) & 0xffff;
  const c = AG_TINT[h % AG_TINT.length];
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, color: c, background: hexToRgba(c, 0.16), fontFamily: 'var(--ui-font)' }}>
      {nm[0].toUpperCase()}
    </span>
  );
}

export function agBtnPrimary(): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
}
export function agBtnGhost(): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: '0 13px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
}
function agChip(tone?: string): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontFamily: 'var(--mono-font)', fontSize: 11, fontWeight: 500, color: tone || 'var(--fg-muted)', background: 'var(--surface-2)', whiteSpace: 'nowrap' };
}
function iconBtn(): CSSProperties {
  return { width: 44, height: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
}

function AccessTag({ user, level }: { user: string; level: string }) {
  return (
    <span title={`Runs with ${user}'s access`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 7px 0 6px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>
      <Icon name="lock" size={11} color="var(--accent)" /> {level}
    </span>
  );
}

function PriorityBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 6px', borderRadius: 5, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', flexShrink: 0 }}>
      <Icon name="zap" size={10} color="var(--warning)" /> HIGH
    </span>
  );
}

function accessOf(by: string): string {
  return by === 'you' ? 'your access' : 'requester';
}

const fieldStyle: CSSProperties = {
  width: '100%',
  minHeight: 44,
  border: '1px solid var(--border-strong)',
  borderRadius: 9,
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 14,
  padding: '9px 11px',
};

let openDialogCount = 0;
let appRootPreviousAriaHidden: string | null = null;
let appRootPreviousInert = false;

function isolateApplicationRoot(): () => void {
  const appRoot = document.getElementById('root');
  if (!appRoot) return () => undefined;
  if (openDialogCount === 0) {
    appRootPreviousAriaHidden = appRoot.getAttribute('aria-hidden');
    appRootPreviousInert = appRoot.inert;
    appRoot.setAttribute('aria-hidden', 'true');
    appRoot.inert = true;
  }
  openDialogCount += 1;
  return () => {
    openDialogCount = Math.max(0, openDialogCount - 1);
    if (openDialogCount !== 0) return;
    appRoot.inert = appRootPreviousInert;
    if (appRootPreviousAriaHidden === null) appRoot.removeAttribute('aria-hidden');
    else appRoot.setAttribute('aria-hidden', appRootPreviousAriaHidden);
    appRootPreviousAriaHidden = null;
  };
}

function ModalFrame({
  title,
  description,
  blocked = false,
  onClose,
  children,
}: {
  title: string;
  description: string;
  blocked?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const blockedRef = useRef(blocked);
  const closeRef = useRef(onClose);
  useEffect(() => { blockedRef.current = blocked; }, [blocked]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const restoreApplicationRoot = isolateApplicationRoot();
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    const focusTimer = requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) {
        (focusable()[0] ?? dialogRef.current)?.focus();
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!blockedRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', onKey);
      restoreApplicationRoot();
      previousFocusRef.current?.focus();
    };
  }, []);
  const requestClose = () => {
    if (!blockedRef.current) closeRef.current();
  };
  return createPortal(
    <div className="b2-agent-modal-shell" style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'max(5vh, 20px) 16px 20px' }}>
      <div aria-hidden="true" onClick={requestClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', cursor: blocked ? 'wait' : 'default' }} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ position: 'relative', width: 600, maxWidth: '100%', maxHeight: '90dvh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 20px 0' }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="robot" size={19} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{description}</p>
          </div>
          <button className="b2-agent-focus" type="button" onClick={requestClose} disabled={blocked} aria-label={`Close ${title}`} style={{ ...iconBtn(), opacity: blocked ? 0.45 : 1 }}><Icon name="x" size={17} color="var(--fg-muted)" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} role="alert" style={{ color: 'var(--destructive)', fontSize: 12, marginTop: 5 }}>{children}</div>;
}

export function AddAgentModal({
  models,
  modelsPending = false,
  modelsError = null,
  onRetryModels,
  pending,
  error,
  onClose,
  onAdd,
}: {
  models: ModelConfig[];
  modelsPending?: boolean;
  modelsError?: string | null;
  onRetryModels?: () => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (input: { name: string; modelId: string; complexity: Complexity }) => void;
}) {
  const readyModels = eligibleAgentModels(models);
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('');
  const [complexity, setComplexity] = useState<Complexity>('medium');
  const [touched, setTouched] = useState(false);
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const submitLockedRef = useRef(false);
  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    if (!modelsPending && !modelsError) {
      setModelId((selected) => revalidateAgentModelSelection(selected, models, null));
    }
  }, [models, modelsError, modelsPending]);
  useEffect(() => { if (!pending) submitLockedRef.current = false; }, [pending]);
  const valid = canCreateAgent({ name, modelId, complexity, pending })
    && !modelsPending
    && !modelsError
    && readyModels.some((model) => model.model_id === modelId);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (!modelId) {
      modelRef.current?.focus();
      return;
    }
    if (!valid || submitLockedRef.current) return;
    submitLockedRef.current = true;
    try {
      onAdd({ name: name.trim(), modelId, complexity });
    } catch (submitError) {
      submitLockedRef.current = false;
      throw submitError;
    }
  };
  return (
    <ModalFrame title="Add agent" description="Create a configured runtime bound to one registered model and one exact complexity." blocked={pending} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="b2-agent-modal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '20px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${formId}-name`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Name</label>
            <input ref={nameRef} className="b2-agent-focus" id={`${formId}-name`} value={name} disabled={pending} onChange={(event) => setName(event.target.value)} aria-invalid={touched && !name.trim()} aria-describedby={touched && !name.trim() ? `${formId}-name-error` : undefined} style={fieldStyle} />
            {touched && !name.trim() && <FieldError id={`${formId}-name-error`}>Enter an agent name.</FieldError>}
          </div>
          <div>
            <label htmlFor={`${formId}-model`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Model</label>
            <select ref={modelRef} className="b2-agent-focus" id={`${formId}-model`} value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={pending || modelsPending || Boolean(modelsError) || readyModels.length === 0} aria-invalid={touched && !modelId} aria-describedby={touched && !modelId ? `${formId}-model-error` : undefined} style={fieldStyle}>
              <option value="">Select a ready model</option>
              {readyModels.map((model) => <option key={model.model_id} value={model.model_id}>{model.name} · {providerLabel(model.provider)}</option>)}
            </select>
            {touched && !modelId && readyModels.length > 0 && <FieldError id={`${formId}-model-error`}>Select a ready model.</FieldError>}
          </div>
          <div>
            <label htmlFor={`${formId}-complexity`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Exact complexity</label>
            <select className="b2-agent-focus" id={`${formId}-complexity`} value={complexity} disabled={pending} onChange={(event) => setComplexity(event.target.value as Complexity)} style={fieldStyle}>
              {COMPLEXITIES.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            {modelsPending && <div role="status" style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Loading registered models…</div>}
            {!modelsPending && modelsError && <div role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>Could not load models: {modelsError} {onRetryModels && <button className="b2-agent-focus" type="button" onClick={onRetryModels} style={{ ...agBtnGhost(), marginLeft: 8 }}>Retry</button>}</div>}
            {!modelsPending && !modelsError && readyModels.length === 0 && <div role="status" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.5 }}>No ready Ollama, Anthropic, or OpenRouter model is available. <a className="b2-agent-focus" href="/settings#models" style={{ color: 'var(--accent)' }}>Configure a model in Settings</a>.</div>}
            {error && <div role="alert" style={{ marginTop: 10, color: 'var(--destructive)', fontSize: 13 }}>{error}</div>}
          </div>
        </div>
        <div className="b2-agent-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 20px' }}>
          <button className="b2-agent-focus" type="button" onClick={onClose} disabled={pending} style={{ ...agBtnGhost(), opacity: pending ? 0.5 : 1 }}>Cancel</button>
          <button className="b2-agent-focus" type="submit" disabled={!valid} style={{ ...agBtnPrimary(), opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }}><Icon name={pending ? 'loader' : 'plus'} className={pending ? 'b2-spin' : undefined} size={15} /> {pending ? 'Creating…' : 'Create agent'}</button>
        </div>
      </form>
    </ModalFrame>
  );
}

export function ConfigureAgentModal({
  agent,
  models,
  modelsReady,
  pending,
  error,
  deletePending,
  deleteError,
  onClose,
  onSave,
  onDelete,
}: {
  agent: Agent;
  models: ModelConfig[];
  modelsReady: boolean;
  pending: boolean;
  error: string | null;
  deletePending: boolean;
  deleteError: string | null;
  onClose: () => void;
  onSave: (changes: ReturnType<typeof agentUpdateChanges>) => void;
  onDelete: () => void;
}) {
  const readyModels = eligibleAgentModels(models);
  const currentModelInList = readyModels.some((model) => model.model_id === agent.modelId);
  const currentModel = models.find((model) => model.model_id === agent.modelId);
  const includeCurrentModel = Boolean(
    agent.modelId
    && !currentModelInList
    && (!modelsReady || currentModel),
  );
  const modelOptions: Array<{
    model_id: string;
    name: string;
    provider: Agent['modelProvider'];
    status: ModelConfig['status'];
  }> = !includeCurrentModel
    ? readyModels.map((model) => ({
        model_id: model.model_id,
        name: model.name,
        provider: model.provider,
        status: model.status,
      }))
    : [{
        model_id: agent.modelId!,
        name: currentModel?.name ?? agent.modelName ?? 'Current model',
        provider: currentModel?.provider ?? agent.modelProvider,
        status: currentModel?.status ?? agent.modelStatus ?? 'paused',
      }, ...readyModels.map((model) => ({
        model_id: model.model_id,
        name: model.name,
        provider: model.provider,
        status: model.status,
      }))];
  const [draft, setDraft] = useState<AgentDraft>(() => agentDraftFrom(agent));
  const [baselineSignature, setBaselineSignature] = useState(() => agentConfigSignature(agent));
  const configConflict = agentConfigSignature(agent) !== baselineSignature;
  const nameRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const formId = useId();
  const submitLockedRef = useRef(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    if (!modelsReady || configConflict) return;
    setDraft((current) => ({
      ...current,
      modelId: revalidateAgentModelSelection(current.modelId, models, agent.modelId),
    }));
  }, [agent.modelId, configConflict, models, modelsReady]);
  useEffect(() => {
    if (!pending && !deletePending) submitLockedRef.current = false;
  }, [deletePending, pending]);
  const busy = agent.status === 'busy';
  const changes = agentUpdateChanges(agent, draft);
  const hasBusyProtectedChanges = busy
    && ('model_id' in changes || 'complexity' in changes || 'enabled' in changes);
  const modelChangeUnavailable = 'model_id' in changes && !modelsReady;
  const valid = canCreateAgent({ name: draft.name, modelId: draft.modelId, complexity: draft.complexity, pending: pending || deletePending })
    && !hasBusyProtectedChanges
    && !modelChangeUnavailable
    && !configConflict;
  const editLocked = pending || deletePending || configConflict;
  const reloadLatest = () => {
    setDraft(agentDraftFrom(agent));
    setBaselineSignature(agentConfigSignature(agent));
    setTouched(false);
    submitLockedRef.current = false;
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!draft.name.trim()) { nameRef.current?.focus(); return; }
    if (!draft.modelId) { modelRef.current?.focus(); return; }
    if (!valid || submitLockedRef.current) return;
    submitLockedRef.current = true;
    try {
      onSave(changes);
    } catch (submitError) {
      submitLockedRef.current = false;
      throw submitError;
    }
  };
  const confirmDelete = () => {
    if (busy || pending || deletePending || configConflict || submitLockedRef.current) return;
    if (window.confirm(`Delete ${agent.name}? Historical todo attribution will be preserved.`)) {
      submitLockedRef.current = true;
      try {
        onDelete();
      } catch (deleteCallError) {
        submitLockedRef.current = false;
        throw deleteCallError;
      }
    }
  };
  return (
    <ModalFrame title={`Configure ${agent.name}`} description="Edit this runtime’s identity, model route, exact complexity, and availability." blocked={pending || deletePending} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="b2-agent-modal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '20px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${formId}-name`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Name</label>
            <input ref={nameRef} className="b2-agent-focus" id={`${formId}-name`} value={draft.name} disabled={editLocked} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={touched && !draft.name.trim()} aria-describedby={touched && !draft.name.trim() ? `${formId}-name-error` : undefined} style={fieldStyle} />
            {touched && !draft.name.trim() && <FieldError id={`${formId}-name-error`}>Enter an agent name.</FieldError>}
          </div>
          <div>
            <label htmlFor={`${formId}-model`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Model</label>
            <select ref={modelRef} className="b2-agent-focus" id={`${formId}-model`} value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} disabled={busy || editLocked || !modelsReady} aria-invalid={touched && !draft.modelId} aria-describedby={touched && !draft.modelId ? `${formId}-model-error` : undefined} style={fieldStyle}>
              <option value="">{modelOptions.length ? 'Select a ready model' : 'No model available'}</option>
              {modelOptions.map((model) => <option key={model.model_id} value={model.model_id}>{model.name} · {providerLabel(model.provider)}{model.status !== 'ready' ? ` · ${model.status}` : ''}</option>)}
            </select>
            {touched && !draft.modelId && <FieldError id={`${formId}-model-error`}>Select a ready model.</FieldError>}
          </div>
          <div>
            <label htmlFor={`${formId}-complexity`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Exact complexity</label>
            <select className="b2-agent-focus" id={`${formId}-complexity`} value={draft.complexity} onChange={(event) => setDraft({ ...draft, complexity: event.target.value as Complexity })} disabled={busy || editLocked} style={fieldStyle}>
              {COMPLEXITIES.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}
            </select>
          </div>
          <label style={{ gridColumn: '1 / -1', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, cursor: busy ? 'not-allowed' : 'pointer' }}>
            <input className="b2-agent-focus" type="checkbox" checked={draft.enabled} disabled={busy || editLocked} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} style={{ width: 20, height: 20 }} />
            <span><strong>Enabled</strong><span style={{ display: 'block', color: 'var(--fg-muted)', fontSize: 12, marginTop: 2 }}>Enabled runtimes may claim exact-complexity work when their model is ready.</span></span>
          </label>
          {busy && <div role="status" style={{ gridColumn: '1 / -1', color: 'var(--fg-muted)', fontSize: 12.5 }}>This agent is busy. Its model, complexity, enabled state, and deletion become available when the current todo finishes.</div>}
          {configConflict && <div role="alert" style={{ gridColumn: '1 / -1', border: '1px solid var(--warning)', borderRadius: 9, padding: 10, color: 'var(--fg)', fontSize: 12.5, lineHeight: 1.5 }}>This agent’s configuration changed elsewhere. Reload the latest values before making more edits. <button className="b2-agent-focus" type="button" onClick={reloadLatest} disabled={pending || deletePending} style={{ ...agBtnGhost(), marginLeft: 8 }}>Reload latest</button></div>}
          {!modelsReady && <div role="status" style={{ gridColumn: '1 / -1', color: 'var(--fg-muted)', fontSize: 12.5 }}>Refreshing registered models…</div>}
          {error && <div role="alert" style={{ gridColumn: '1 / -1', color: 'var(--destructive)', fontSize: 13 }}>{error}</div>}
          {deleteError && <div role="alert" style={{ gridColumn: '1 / -1', color: 'var(--destructive)', fontSize: 13 }}>{deleteError}</div>}
        </div>
        <div className="b2-agent-modal-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 20px' }}>
          <button className="b2-agent-focus" type="button" onClick={confirmDelete} disabled={busy || editLocked} style={{ ...agBtnGhost(), color: 'var(--destructive)', opacity: busy || editLocked ? 0.45 : 1, cursor: busy || configConflict ? 'not-allowed' : 'pointer', marginRight: 'auto' }}><Icon name="trash" size={15} /> {deletePending ? 'Deleting…' : 'Delete agent'}</button>
          <button className="b2-agent-focus" type="button" onClick={onClose} disabled={pending || deletePending} style={agBtnGhost()}>Cancel</button>
          <button className="b2-agent-focus" type="submit" disabled={!valid} style={{ ...agBtnPrimary(), opacity: valid ? 1 : 0.5 }}>{pending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </ModalFrame>
  );
}

export interface TodoActions {
  open: (id: string) => void;
  priority: (id: string) => void;
  stop: (id: string) => void;
  remove: (id: string) => void;
  rerun: (id: string) => void;
  add: (opts: {
    title: string;
    assign: string;
    complexity: Complexity;
    workspaceId: string;
  }) => void;
}

interface MenuItem {
  icon?: IconName;
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
}

export function nextMenuItemIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

// ── controlled overflow menu ──────────────────────────────────────────────────
function DotsMenu({ open, onToggle, items, disabled = false }: { open: boolean; onToggle: () => void; items: MenuItem[]; disabled?: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const focusTimer = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onToggleRef.current();
        requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const current = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      const next = nextMenuItemIndex(current, menuItems.length, event.key);
      if (next == null) return;
      event.preventDefault();
      menuItems[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const closeAndRestore = () => {
    onToggle();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button ref={triggerRef} className="b2-agent-focus" onClick={onToggle} disabled={disabled} aria-label="Todo actions" aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} title="Todo actions" style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid ' + (open ? 'var(--border-strong)' : 'transparent'), background: open ? 'var(--surface-2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
        <Icon name="more" size={16} color="var(--fg-muted)" />
      </button>
      {open && (
        <Fragment>
          <div aria-hidden="true" onClick={closeAndRestore} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div ref={menuRef} id={menuId} role="menu" aria-label="Todo actions" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 238, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.5)', padding: 6 }}>
            {items.map((it, i) => (
              <Fragment key={i}>
                {it.divider && <div role="separator" style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />}
                <button role="menuitem" className="b2-agent-focus" onClick={() => { closeAndRestore(); it.onClick?.(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '8px 9px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, color: it.danger ? 'var(--destructive)' : 'var(--fg)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <Icon name={it.icon!} size={14} color={it.danger ? 'var(--destructive)' : 'var(--fg-muted)'} /> {it.label}
                </button>
              </Fragment>
            ))}
          </div>
        </Fragment>
      )}
    </div>
  );
}

// ── agent roster ──────────────────────────────────────────────────────────────
export function RosterCard({
  a,
  todo,
  onOpen,
  onConfigure,
}: {
  a: Agent;
  todo: Todo | null;
  onOpen: (id: string) => void;
  onConfigure?: (agent: Agent) => void;
}) {
  const working = a.status === 'busy';
  const off = a.status === 'offline';
  const statusIcon: IconName = working ? 'loader' : off ? 'alert' : 'check';
  const statusText = `${a.enabled ? 'Enabled' : 'Disabled'} · ${a.status}`;
  const currentTitle = todo?.title ?? a.todoSummary?.title ?? null;
  return (
    <article style={{ width: 276, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={`${a.name}, ${statusText}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Av name={a.name} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: working ? 'var(--success)' : off ? 'var(--destructive)' : 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'capitalize' }}>
            <span className={working ? 'b2-spin' : undefined} style={{ display: 'flex' }}><Icon name={statusIcon} size={12} /></span>
            {statusText}
          </div>
        </div>
        {onConfigure && <button className="b2-agent-focus" onClick={() => onConfigure(a)} aria-label={`Configure ${a.name}`} title={`Configure ${a.name}`} style={iconBtn()}><Icon name="sliders" size={16} color="var(--fg-muted)" /></button>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={agChip()}><Icon name="cpu" size={11} /> {a.modelName ?? 'Model unknown'} · {providerLabel(a.modelProvider)}</span>
        <span style={agChip('var(--accent)')}>Complexity: {a.complexity}</span>
      </div>
      {currentTitle ? (
        <button className="b2-agent-focus" onClick={() => a.taskId && onOpen(a.taskId)} disabled={!a.taskId} style={{ minHeight: 60, width: '100%', padding: '9px 10px', textAlign: 'left', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg)', color: 'var(--fg)', cursor: a.taskId ? 'pointer' : 'default', fontSize: 12.5, lineHeight: 1.4 }}>
          <span style={{ display: 'block', color: 'var(--fg-muted)', fontSize: 11, marginBottom: 3 }}>Current todo</span>{currentTitle}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 60, padding: 10, color: 'var(--fg-muted)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 9, background: 'var(--bg)', lineHeight: 1.4 }}>
          <Icon name={working ? 'loader' : !a.enabled || a.modelStatus !== 'ready' ? 'alert' : 'clock'} size={14} />
          {working
            ? 'Working on a todo you cannot access.'
            : !a.enabled
            ? 'Unavailable while this runtime is disabled.'
            : a.modelStatus !== 'ready'
              ? a.modelStatus
                ? `Unavailable while the configured model is ${a.modelStatus}.`
                : 'Unavailable because configured model status is unknown.'
              : `Waiting for queued ${a.complexity} work.`}
        </div>
      )}
    </article>
  );
}

// ── one todo row ──────────────────────────────────────────────────────────────
function rowMenu(t: Todo, actions: TodoActions): MenuItem[] {
  if (t.status === 'running') return [
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    ...(t.cancelRequested ? [] : [{ divider: true, icon: 'repeat' as IconName, label: 'Stop task and re-queue', danger: true, onClick: () => actions.stop(t.id) }]),
  ];
  if (t.status === 'queued') return [
    t.priority ? { icon: 'zap', label: 'Remove high priority', onClick: () => actions.priority(t.id) } : { icon: 'zap', label: 'Mark high priority', onClick: () => actions.priority(t.id) },
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    { divider: true, icon: 'trash', label: 'Remove from queue', danger: true, onClick: () => actions.remove(t.id) },
  ];
  return [
    { icon: 'history', label: 'Open conversation', onClick: () => actions.open(t.id) },
    { icon: 'refresh', label: 'Re-run as new todo', onClick: () => actions.rerun(t.id) },
    { divider: true, icon: 'trash', label: 'Delete', danger: true, onClick: () => actions.remove(t.id) },
  ];
}

export function TodoRow({ t, agent, menuOpen, onMenu, actions, actionPending, actionsDisabled = false }: { t: Todo; agent?: Agent | null; menuOpen: boolean; onMenu: (id: string | null) => void; actions: TodoActions; actionPending?: string | null; actionsDisabled?: boolean }) {
  const stopping = t.status === 'running' && t.cancelRequested;
  const status = todoStatusView(t.status, t.cancelRequested);
  const assignedName = todoAgentDisplayName(t, agent);
  const isPriorityQueued = t.priority && t.status === 'queued';
  return (
    <div className="b2-todo-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 4px', borderBottom: '1px solid var(--border)', background: isPriorityQueued ? 'var(--warning-soft)' : 'transparent', borderLeft: '2px solid ' + (isPriorityQueued ? 'var(--warning)' : 'transparent') }}
      onMouseEnter={(e) => { if (!isPriorityQueued) e.currentTarget.style.background = 'var(--surface-2)'; }} onMouseLeave={(e) => { if (!isPriorityQueued) e.currentTarget.style.background = 'transparent'; }}>
      <button className="b2-agent-focus" onClick={() => actions.open(t.id)} aria-label={`Open ${t.title}`} style={{ display: 'flex', alignItems: 'center', gap: 13, flex: 1, minWidth: 0, minHeight: 56, padding: '9px 8px', border: 'none', borderRadius: 8, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          {status.spin ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name={status.icon} size={16} color={status.tone} /></span> : <Icon name={status.icon} size={16} color={status.tone} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isPriorityQueued && <PriorityBadge />}
          <span style={{ fontSize: 13.5, fontWeight: 600, color: t.status === 'done' ? 'var(--fg-muted)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--fg-muted)' }}><Av name={t.by} size={16} /> {t.by}</span>
          <AccessTag user={t.by} level={accessOf(t.by)} />
          <span style={agChip('var(--accent)')}>Complexity: {t.complexity}</span>
          {(assignedName || t.assignedAgentId) && <span style={agChip()}><Icon name="robot" size={11} /> {assignedName ?? 'Assigned agent unknown'}</span>}
          {t.modelName
            ? <span style={agChip()}><Icon name="cloud" size={11} /> {t.modelName} · {providerLabel(t.modelProvider)}</span>
            : <span style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>Model unknown</span>}
          {t.status === 'queued' && <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Durable wait for an enabled {t.complexity} agent while matches are busy or offline.</span>}
          {t.status === 'failed' && t.error && <span style={{ fontSize: 11.5, color: 'var(--destructive)', overflowWrap: 'anywhere' }}>{t.error}</span>}
        </div>
        </div>
        {t.status === 'done' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {t.memoryFlushed && <span title="Conversation archived; KV cache flushed from RAM" className="b2-hide-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: 'var(--fg-muted)', background: 'var(--surface-2)' }}><Icon name="cpu" size={11} /> memory flushed</span>}
          <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{t.completedLabel}</span>
          <span className="b2-hide-sm" style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', width: 64, textAlign: 'right' }}>{t.tokens}</span>
          </span>
        )}
        {t.status === 'failed' && <span style={{ fontSize: 11.5, color: 'var(--destructive)', fontWeight: 600 }}>{status.label}</span>}
        {stopping && <span role="status" style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 600 }}>Stop requested / waiting for agent</span>}
        {actionPending && <span role="status" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{actionPending}</span>}
      </button>
      <DotsMenu open={menuOpen} onToggle={() => onMenu(menuOpen ? null : t.id)} items={rowMenu(t, actions)} disabled={actionsDisabled} />
    </div>
  );
}

export function GroupHead({ icon, label, n, tone, note }: { icon: IconName; label: string; n: number; tone?: string; note?: string }) {
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
function ToolLine({ tool }: { tool: Tool }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)', marginBottom: 8, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono-font)', fontSize: 11.5 }}>
      {tool.running ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={13} color="var(--accent)" /></span> : <Icon name="check" size={13} color="var(--success)" />}
      <span style={{ color: 'var(--accent)' }}>{tool.name}</span>
      <span style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>({tool.args})</span>
      <span style={{ marginLeft: 'auto', color: 'var(--fg-faint)', flexShrink: 0 }}>{tool.running ? '…' : '└ ' + tool.result}</span>
    </div>
  );
}

function MessageBlock({ m, agentName }: { m: Message; agentName?: string | null }) {
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
  const shown = streaming ? words.slice(0, (m.reveal as number) * 2).join('') : m.text;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{agentName ? agentName[0] : <Icon name="robot" size={13} />}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{agentName ?? 'Agent unknown'}</span>
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

function DMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 11.5, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>{children}</span>
    </div>
  );
}

// ── conversation drawer (live or done) ────────────────────────────────────────
export function ConversationDrawer({
  todoId,
  agentOf,
  continuationPending,
  continuationError,
  onClose,
  onContinue,
}: {
  todoId: string;
  agentOf: (id: string | null) => Agent | null;
  continuationPending: boolean;
  continuationError: string | null;
  onClose: () => void;
  onContinue: (id: string, text: string, onSuccess: () => void) => void;
}) {
  const todoQuery = useTodo(todoId);
  const todo = todoQuery.data;
  const qc = useQueryClient();
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const continuationLockedRef = useRef(false);
  const blockedRef = useRef(continuationPending);
  const closeRef = useRef(onClose);
  const continuationId = useId();
  useEffect(() => { blockedRef.current = continuationPending; }, [continuationPending]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { if (!continuationPending) continuationLockedRef.current = false; }, [continuationPending]);

  useEffect(() => {
    const restoreApplicationRoot = isolateApplicationRoot();
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    const showTimer = requestAnimationFrame(() => {
      setShown(true);
      (focusable()[0] ?? dialogRef.current)?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!blockedRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(showTimer);
      document.removeEventListener('keydown', onKey);
      restoreApplicationRoot();
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!todo || todo.status !== 'running') return;
    const close = sse(
      `/api/v1/todos/${todoId}/stream`,
      () => qc.invalidateQueries({ queryKey: qk.todo(todoId) }),
    );
    return close;
  }, [todoId, todo?.status, qc]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [todo?.messages]);

  const agent = todo ? agentOf(todo.agentId) : null;
  const actorName = todo ? todoAgentDisplayName(todo, agent) : null;
  const running = todo?.status === 'running';
  const done = todo?.status === 'done';
  const queued = todo?.status === 'queued';
  const failed = todo?.status === 'failed';
  const terminal = todo ? canContinueTodo(todo.status) : false;
  const status = todo ? todoStatusView(todo.status) : null;
  const send = () => {
    const text = draft.trim();
    if (!text || !terminal || continuationPending || continuationLockedRef.current) return;
    continuationLockedRef.current = true;
    try {
      onContinue(todoId, text, () => setDraft(''));
    } catch (continueCallError) {
      continuationLockedRef.current = false;
      throw continueCallError;
    }
  };
  const requestClose = () => { if (!blockedRef.current) closeRef.current(); };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 20px' }}>
      <div className="b2-dialog-backdrop" aria-hidden="true" onClick={requestClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', opacity: shown ? 1 : 0, transition: 'opacity .2s', cursor: continuationPending ? 'wait' : 'default' }} />
      <div ref={dialogRef} tabIndex={-1} className="b2-conversation-drawer" role="dialog" aria-modal="true" aria-label={todo ? `Todo: ${todo.title}` : 'Todo conversation'} style={{ position: 'relative', width: 'min(640px, 94vw)', maxHeight: '90vh', minHeight: 220, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 28px 80px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', transform: shown ? 'none' : 'translateY(12px) scale(0.98)', opacity: shown ? 1 : 0, transition: 'transform .24s cubic-bezier(.32,.72,0,1), opacity .2s' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ position: 'relative', flexShrink: 0 }}>
            <Av name={actorName ?? 'Q'} size={36} />
            <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--surface)', background: running ? 'var(--success)' : done ? 'var(--fg-faint)' : 'var(--warning)' }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{todo?.title ?? 'Todo conversation'}</div>
            <div style={{ fontSize: 11.5, marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, color: running ? 'var(--success)' : 'var(--fg-muted)' }}>
              {todoQuery.isPending && <Fragment><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} /></span> Loading transcript…</Fragment>}
              {todoQuery.isError && <Fragment><Icon name="alert" size={12} color="var(--destructive)" /> Transcript unavailable</Fragment>}
              {running && <Fragment><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} color="var(--success)" /></span> Running · {actorName ?? 'agent unknown'}</Fragment>}
              {done && todo && <Fragment><Icon name="check" size={12} color="var(--fg-muted)" /> Completed {todo.completedLabel} · {actorName ?? 'agent unknown'}</Fragment>}
              {queued && todo && <Fragment><Icon name="clock" size={12} color="var(--warning)" /> Queued{todo.priority ? ' · high priority' : ''}</Fragment>}
              {failed && todo && <Fragment><Icon name="alert" size={12} color="var(--destructive)" /> Failed{todo.completedLabel ? ` · ${todo.completedLabel}` : ''}</Fragment>}
            </div>
          </div>
          <button className="b2-agent-focus" onClick={requestClose} disabled={continuationPending} aria-label="Close todo conversation" style={{ ...iconBtn(), opacity: continuationPending ? 0.45 : 1 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>
        {/* body */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {todoQuery.isPending && <div role="status" style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--fg-muted)' }}>Loading the durable transcript…</div>}
          {todoQuery.isError && <div role="alert" style={{ padding: 16, border: '1px solid var(--destructive)', borderRadius: 10, color: 'var(--destructive)', lineHeight: 1.5 }}>Could not load this todo: {todoQuery.error instanceof Error ? todoQuery.error.message : 'Request failed.'}<div style={{ marginTop: 12 }}><button className="b2-agent-focus" onClick={() => todoQuery.refetch()} style={agBtnGhost()}><Icon name="refresh" size={14} /> Retry</button></div></div>}
          {todo && <Fragment><div style={{ marginBottom: 16 }}>
            <DMeta label="Requested by"><Av name={todo.by} size={18} /> {todo.by} <AccessTag user={todo.by} level={accessOf(todo.by)} /></DMeta>
            <DMeta label="Complexity"><span style={agChip('var(--accent)')}>{todo.complexity}</span></DMeta>
            <DMeta label="Assigned agent">{todo.agentName ?? agent?.name ?? 'Unknown'}</DMeta>
            <DMeta label="Model">{todo.modelName ? <span style={agChip()}><Icon name="cloud" size={11} /> {todo.modelName} · {providerLabel(todo.modelProvider)}</span> : <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Unknown</span>}</DMeta>
            {done && todo.memoryFlushed && <DMeta label="Memory"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-muted)' }}><Icon name="cpu" size={12} /> KV cache flushed; durable transcript retained</span></DMeta>}
          </div>
          {queued && todo.messages.length <= 1 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 16 }}>
              <Icon name="clock" size={15} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>Durably queued for an enabled {todo.complexity} agent. It will wait safely while matching agents are busy or offline and will run with {todo.by}’s access.</div>
            </div>
          )}
          {failed && todo.error && status && <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--destructive)', marginBottom: 16, color: 'var(--destructive)', fontSize: 12.5, lineHeight: 1.5 }}><Icon name="alert" size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><strong>{status.label}:</strong> {todo.error}</span></div>}
          {todo.messages.map((m, i) => <MessageBlock key={i} m={m} agentName={actorName} />)}</Fragment>}
        </div>
        {/* composer */}
        {todo && terminal && <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '12px 16px 14px' }}>
          <div style={{ border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
            <label htmlFor={continuationId} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Continuation instruction</label>
            <textarea id={continuationId} className="b2-agent-focus" value={draft} disabled={continuationPending} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} rows={2}
              placeholder="Continue this task…"
              style={{ width: '100%', resize: 'none', border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, lineHeight: 1.5, padding: '12px 13px' }} />
            {continuationError && <div role="alert" style={{ padding: '8px 12px 0', color: 'var(--destructive)', fontSize: 12.5 }}>{continuationError}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
              <Icon name="atSign" size={15} color="var(--fg-muted)" />
              <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>re-queues with the full history</span>
              <button className="b2-agent-focus" onClick={send} disabled={!draft.trim() || continuationPending} style={{ ...agBtnPrimary(), marginLeft: 'auto', opacity: draft.trim() && !continuationPending ? 1 : 0.5, cursor: draft.trim() && !continuationPending ? 'pointer' : 'not-allowed' }}><Icon className={continuationPending ? 'b2-spin' : undefined} name={continuationPending ? 'loader' : 'plus'} size={14} color="#fff" /> {continuationPending ? 'Continuing…' : 'Add to queue'}</button>
            </div>
          </div>
        </div>}
      </div>
    </div>,
    document.body,
  );
}

// ── add-a-todo modal ──────────────────────────────────────────────────────────
export function AddTodoModal({
  agents,
  pending,
  error,
  onClose,
  onAdd,
}: {
  agents: Agent[];
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onAdd: (opts: {
    title: string;
    assign: string;
    complexity: Complexity;
    workspaceId: string;
  }) => void;
}) {
  const { workspaceId } = useWorkspace();
  const workspaceQuery = useWorkspacesOverview();
  const workspaces = workspaceQuery.data?.workspaces ?? [];
  const [text, setText] = useState('');
  const [ws, setWs] = useState(workspaceId ?? '');
  const [assign, setAssign] = useState('any');
  const [complexity, setComplexity] = useState<Complexity>('medium');
  const [touched, setTouched] = useState(false);
  const formId = useId();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLSelectElement>(null);
  const submitLockedRef = useRef(false);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    if (!workspaceQuery.isSuccess) return;
    setWs((current) => {
      if (workspaces.some((workspace) => workspace.workspace_id === current)) return current;
      if (workspaceId && workspaces.some((workspace) => workspace.workspace_id === workspaceId)) return workspaceId;
      return workspaces[0]?.workspace_id ?? '';
    });
  }, [workspaceId, workspaceQuery.isSuccess, workspaces]);
  useEffect(() => { if (!pending) submitLockedRef.current = false; }, [pending]);
  const eligibleAgents = eligibleAgentsForComplexity(agents, complexity);
  useEffect(() => {
    if (
      assign !== 'any'
      && !eligibleAgentsForComplexity(agents, complexity)
        .some((agent) => agent.id === assign)
    ) {
      setAssign('any');
    }
  }, [agents, assign, complexity]);
  const workspaceReady = workspaceQuery.isSuccess && workspaces.length > 0;
  const canSubmit = canSubmitTodo({ title: text, workspaceId: ws, complexity, pending, workspaceReady });
  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!text.trim()) { titleRef.current?.focus(); return; }
    if (!ws) { workspaceRef.current?.focus(); return; }
    if (!canSubmit || submitLockedRef.current) return;
    submitLockedRef.current = true;
    try {
      onAdd({ title: text.trim(), assign, complexity, workspaceId: ws });
    } catch (submitError) {
      submitLockedRef.current = false;
      throw submitError;
    }
  };
  return (
    <ModalFrame title="Add todo" description="Queue durable work for an enabled agent with the exact selected complexity." blocked={Boolean(pending)} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div style={{ padding: '20px' }}>
          <label htmlFor={`${formId}-title`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Todo</label>
          <textarea ref={titleRef} id={`${formId}-title`} className="b2-agent-focus" value={text} disabled={pending} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} rows={3} aria-invalid={touched && !text.trim()} aria-describedby={touched && !text.trim() ? `${formId}-title-error` : undefined} placeholder="What should an agent do?" style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5, minHeight: 96 }} />
          {touched && !text.trim() && <FieldError id={`${formId}-title-error`}>Describe the todo.</FieldError>}
          <div className="b2-agent-modal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div>
              <label htmlFor={`${formId}-workspace`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Workspace</label>
              <select ref={workspaceRef} id={`${formId}-workspace`} className="b2-agent-focus" value={ws} onChange={(event) => setWs(event.target.value)} disabled={Boolean(pending) || !workspaceReady} aria-invalid={touched && !ws} aria-describedby={touched && !ws ? `${formId}-workspace-error` : undefined} style={fieldStyle}>
                <option value="">{workspaceQuery.isPending ? 'Loading workspaces…' : workspaceQuery.isError ? 'Workspaces unavailable' : workspaces.length ? 'Select a workspace' : 'No accessible workspaces'}</option>
                {workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.name} · {workspace.role}</option>)}
              </select>
              {touched && !ws && workspaceReady && <FieldError id={`${formId}-workspace-error`}>Select a workspace.</FieldError>}
              {workspaceQuery.isPending && <div role="status" style={{ marginTop: 7, color: 'var(--fg-muted)', fontSize: 12 }}>Loading accessible workspaces…</div>}
              {workspaceQuery.isError && <div role="alert" style={{ marginTop: 7, color: 'var(--destructive)', fontSize: 12, lineHeight: 1.5 }}>Could not load workspaces: {workspaceQuery.error instanceof Error ? workspaceQuery.error.message : 'Request failed.'} <button className="b2-agent-focus" type="button" onClick={() => workspaceQuery.refetch()} style={{ ...agBtnGhost(), marginTop: 8 }}>Retry</button></div>}
              {workspaceQuery.isSuccess && workspaces.length === 0 && <div role="status" style={{ marginTop: 7, color: 'var(--fg-muted)', fontSize: 12 }}>No accessible workspace is available for this todo.</div>}
            </div>
            <div>
              <label htmlFor={`${formId}-complexity`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Exact complexity</label>
              <select id={`${formId}-complexity`} className="b2-agent-focus" value={complexity} disabled={pending} onChange={(event) => setComplexity(event.target.value as Complexity)} style={fieldStyle}>
                {COMPLEXITIES.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`${formId}-assignment`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Preferred agent (optional)</label>
              <select id={`${formId}-assignment`} className="b2-agent-focus" value={assign} disabled={pending} onChange={(event) => setAssign(event.target.value)} style={fieldStyle}>
                <option value="any">Any enabled {complexity} agent</option>
                {eligibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.status} · {agent.modelName ?? 'model unknown'}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginTop: 16 }}>
            <Icon name="clock" size={15} color="var(--accent)" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5 }}>This todo remains durable until an enabled {complexity} agent can claim it, including while matching agents are busy or offline.{eligibleAgents.length === 0 ? ' No exact enabled match is currently configured.' : ''} It runs with your access.</div>
          </div>
          {error && <div role="alert" style={{ marginTop: 10, color: 'var(--destructive)', fontSize: 12.5 }}>{error}</div>}
        </div>
        <div className="b2-agent-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 20px' }}>
          <button className="b2-agent-focus" type="button" onClick={onClose} disabled={pending} style={agBtnGhost()}>Cancel</button>
          <button className="b2-agent-focus" type="submit" disabled={!canSubmit} style={{ ...agBtnPrimary(), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}><Icon name={pending ? 'loader' : 'plus'} size={14} className={pending ? 'b2-spin' : undefined} /> {pending ? 'Adding…' : 'Add to queue'}</button>
        </div>
      </form>
    </ModalFrame>
  );
}
