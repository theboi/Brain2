import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { SCard } from '@/components/settings/SettingsCard';
import {
  useCreateModel,
  useDeleteModel,
  useModels,
  usePauseModel,
  useResumeModel,
  useTestModel,
  useUpdateModel,
} from '@/hooks/useModels';
import type { ModelConfig, ModelProvider, RuntimeModelProvider } from '@/lib/types';
import {
  acquireMutationLock,
  backendModelFieldErrors,
  modelRowActionsDisabled,
  ModelFormValidationError,
  modelCreatePayload,
  modelUpdatePayload,
  releaseMutationLock,
  shouldCloseMissingModelForm,
  type ModelFormErrors,
  type ModelFormValues,
} from './modelsLogic';

const PROVIDERS: Array<{ id: RuntimeModelProvider; label: string; hint: string }> = [
  { id: 'ollama', label: 'Ollama', hint: 'e.g. qwen2.5:9b' },
  { id: 'anthropic', label: 'Anthropic', hint: 'e.g. claude-sonnet-4-5' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'e.g. anthropic/claude-sonnet-4.5' },
];

const EMPTY_FORM: ModelFormValues = {
  provider: 'ollama',
  name: '',
  model: '',
  endpoint: 'http://127.0.0.1:11434',
  key: '',
  concurrency: '1',
};

function input(extra?: CSSProperties): CSSProperties {
  return {
    minHeight: 44,
    padding: '0 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--fg)',
    fontFamily: 'var(--mono-font)',
    fontSize: 12.5,
    width: '100%',
    ...extra,
  };
}

function button(primary = false, danger = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    padding: '0 14px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#fff' : danger ? 'var(--destructive)' : 'var(--fg)',
    fontFamily: 'var(--ui-font)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  color: 'var(--fg-muted)',
  marginBottom: 5,
};
const errorStyle: CSSProperties = {
  color: 'var(--destructive)',
  fontSize: 12.5,
  marginTop: 6,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed. Please try again.';
}

function providerLabel(provider: ModelProvider): string {
  const labels: Record<ModelProvider, string> = {
    anthropic: 'Anthropic',
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    gemini: 'Gemini',
    openai: 'OpenAI',
    stub: 'Stub',
  };
  return labels[provider];
}

function isRuntimeProvider(provider: ModelProvider): provider is RuntimeModelProvider {
  return provider === 'ollama' || provider === 'anthropic' || provider === 'openrouter';
}

export function ModelsSection() {
  const modelsQuery = useModels();
  const createModel = useCreateModel();
  const updateModel = useUpdateModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();
  const pauseModel = usePauseModel();
  const resumeModel = useResumeModel();
  const formId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const formWasOpen = useRef(false);
  const saveLock = useRef(false);
  const testLock = useRef(false);
  const deleteLock = useRef(false);
  const statusLock = useRef(false);
  const models = modelsQuery.data ?? [];
  const [formMode, setFormMode] = useState<'create' | string | null>(null);
  const [form, setForm] = useState<ModelFormValues>(EMPTY_FORM);
  const [validation, setValidation] = useState<ModelFormErrors>({});
  const [editingHasApiKey, setEditingHasApiKey] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    if (formMode !== null) {
      formWasOpen.current = true;
      nameInputRef.current?.focus();
    } else if (formWasOpen.current) {
      formWasOpen.current = false;
      addButtonRef.current?.focus();
    }
  }, [formMode]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setValidation({});
    setEditingHasApiKey(false);
    createModel.reset();
    updateModel.reset();
  };

  const closeForm = () => {
    resetForm();
    setFormMode(null);
  };

  useEffect(() => {
    const queryReady = !modelsQuery.isPending && !modelsQuery.isError;
    if (shouldCloseMissingModelForm(
      formMode,
      models.map((model) => model.model_id),
      queryReady,
    )) {
      closeForm();
    }
  }, [formMode, models, modelsQuery.isError, modelsQuery.isPending]);

  const openCreate = () => {
    resetForm();
    setFormMode('create');
  };

  const openEdit = (model: ModelConfig) => {
    if (!isRuntimeProvider(model.provider)) return;
    createModel.reset();
    updateModel.reset();
    setValidation({});
    setEditingHasApiKey(model.has_api_key);
    setTestResults((current) => {
      const next = { ...current };
      delete next[model.model_id];
      return next;
    });
    setForm({
      provider: model.provider,
      name: model.name,
      model: model.model,
      endpoint: model.ollama_base_url ?? '',
      key: '',
      concurrency: String(model.max_concurrency),
    });
    setFormMode(model.model_id);
  };

  const changeForm = (field: keyof ModelFormValues, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setValidation((current) => ({ ...current, [field]: undefined }));
    createModel.reset();
    updateModel.reset();
  };

  const save = () => {
    try {
      if (formMode === 'create') {
        const payload = modelCreatePayload(form);
        if (!acquireMutationLock(saveLock)) return;
        if (form.provider !== 'ollama') {
          if (keyInputRef.current) keyInputRef.current.value = '';
          setForm((current) => ({ ...current, key: '' }));
        }
        setValidation({});
        createModel.mutate(payload, {
          onSuccess: closeForm,
          onSettled: () => releaseMutationLock(saveLock),
        });
      } else if (formMode) {
        const modelId = formMode;
        const payload = modelUpdatePayload(modelId, form, editingHasApiKey);
        if (!acquireMutationLock(saveLock)) return;
        if (form.provider !== 'ollama') {
          if (keyInputRef.current) keyInputRef.current.value = '';
          setForm((current) => ({ ...current, key: '' }));
        }
        setValidation({});
        updateModel.mutate(payload, {
          onSuccess: () => {
            setTestResults((current) => {
              const next = { ...current };
              delete next[modelId];
              return next;
            });
            closeForm();
          },
          onSettled: () => releaseMutationLock(saveLock),
        });
      }
    } catch (error) {
      if (error instanceof ModelFormValidationError) setValidation(error.errors);
      else throw error;
    }
  };

  const runTest = (model: ModelConfig) => {
    if (!acquireMutationLock(testLock)) return;
    setTestingId(model.model_id);
    setTestResults((current) => {
      const next = { ...current };
      delete next[model.model_id];
      return next;
    });
    testModel.mutate(
      { model_id: model.model_id },
      {
        onSuccess: (result) => setTestResults((current) => ({
          ...current,
          [model.model_id]: {
            ok: result.ok,
            text: result.ok
              ? (result.text || 'Connection succeeded.')
              : (result.error || 'Connection failed.'),
          },
        })),
        onError: (error) => setTestResults((current) => ({
          ...current,
          [model.model_id]: { ok: false, text: errorMessage(error) },
        })),
        onSettled: () => {
          releaseMutationLock(testLock);
          setTestingId(null);
        },
      },
    );
  };

  const remove = (model: ModelConfig) => {
    if (!acquireMutationLock(deleteLock)) return;
    setRemovingId(model.model_id);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[model.model_id];
      return next;
    });
    deleteModel.mutate(
      { model_id: model.model_id },
      {
        onError: (error) => setRowErrors((current) => ({
          ...current,
          [model.model_id]: errorMessage(error),
        })),
        onSettled: () => {
          releaseMutationLock(deleteLock);
          setRemovingId(null);
        },
      },
    );
  };

  const setStatus = (model: ModelConfig) => {
    if (!acquireMutationLock(statusLock)) return;
    setStatusId(model.model_id);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[model.model_id];
      return next;
    });
    const mutation = model.status === 'ready' ? pauseModel : resumeModel;
    mutation.mutate(
      { model_id: model.model_id },
      {
        onSuccess: () => setTestResults((current) => {
          const next = { ...current };
          delete next[model.model_id];
          return next;
        }),
        onError: (error) => setRowErrors((current) => ({
          ...current,
          [model.model_id]: errorMessage(error),
        })),
        onSettled: () => {
          releaseMutationLock(statusLock);
          setStatusId(null);
        },
      },
    );
  };

  const isSaving = createModel.isPending || updateModel.isPending;
  const rawFormError = createModel.isError
    ? errorMessage(createModel.error)
    : updateModel.isError
      ? errorMessage(updateModel.error)
      : null;
  const backendFieldErrors = rawFormError ? backendModelFieldErrors(rawFormError) : {};
  const formError = rawFormError && Object.keys(backendFieldErrors).length === 0
    ? rawFormError
    : null;

  return (
    <SCard
      title="Registered models"
      desc="Register local Ollama or cloud Anthropic and OpenRouter runtimes. API keys are write-only and never shown after saving."
      action={formMode === null ? (
        <button ref={addButtonRef} type="button" onClick={openCreate} style={button()}>
          <Icon name="plus" size={14} /> Add model
        </button>
      ) : undefined}
    >
      {formMode !== null && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          style={{ marginBottom: 16, padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}
        >
          <div style={{ marginBottom: 12, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
            {formMode === 'create' ? 'Register a model' : 'Edit registered model'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12, alignItems: 'start' }}>
            <Field label="Provider" id={`${formId}-provider`} error={undefined}>
              <select
                id={`${formId}-provider`}
                className="b2-model-field"
                value={form.provider}
                disabled={formMode !== 'create' || isSaving}
                onChange={(event) => {
                  const provider = event.target.value as RuntimeModelProvider;
                  setForm((current) => ({
                    ...current,
                    provider,
                    endpoint: provider === 'ollama' ? (current.endpoint || EMPTY_FORM.endpoint) : '',
                    key: '',
                  }));
                  setValidation({});
                  createModel.reset();
                  updateModel.reset();
                }}
                style={input({ fontFamily: 'var(--ui-font)' })}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Display name" id={`${formId}-name`} error={validation.name}>
              <input
                ref={nameInputRef}
                id={`${formId}-name`}
                className="b2-model-field"
                value={form.name}
                disabled={isSaving}
                onChange={(event) => changeForm('name', event.target.value)}
                placeholder="Team model"
                aria-invalid={Boolean(validation.name)}
                aria-describedby={validation.name ? `${formId}-name-error` : undefined}
                style={input({ fontFamily: 'var(--ui-font)' })}
              />
            </Field>
            <Field label="Provider model ID" id={`${formId}-model`} error={validation.model}>
              <input
                id={`${formId}-model`}
                className="b2-model-field"
                value={form.model}
                disabled={isSaving}
                onChange={(event) => changeForm('model', event.target.value)}
                placeholder={PROVIDERS.find((provider) => provider.id === form.provider)?.hint}
                aria-invalid={Boolean(validation.model)}
                aria-describedby={validation.model ? `${formId}-model-error` : undefined}
                style={input()}
              />
            </Field>
            {form.provider === 'ollama' ? (
              <Field label="Local endpoint" id={`${formId}-endpoint`} error={validation.endpoint ?? backendFieldErrors.endpoint}>
                <input
                  id={`${formId}-endpoint`}
                  className="b2-model-field"
                  type="url"
                  value={form.endpoint}
                  disabled={isSaving}
                  onChange={(event) => changeForm('endpoint', event.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  aria-invalid={Boolean(validation.endpoint ?? backendFieldErrors.endpoint)}
                  aria-describedby={(validation.endpoint ?? backendFieldErrors.endpoint) ? `${formId}-endpoint-error` : undefined}
                  style={input()}
                />
              </Field>
            ) : (
              <Field
                label={formMode === 'create' || !editingHasApiKey ? 'API key' : 'New API key (optional)'}
                id={`${formId}-key`}
                error={validation.key ?? backendFieldErrors.key}
              >
                <input
                  ref={keyInputRef}
                  id={`${formId}-key`}
                  className="b2-model-field"
                  type="password"
                  autoComplete="off"
                  value={form.key}
                  disabled={isSaving}
                  onChange={(event) => changeForm('key', event.target.value)}
                  placeholder={formMode === 'create' || !editingHasApiKey ? 'Paste API key' : 'Leave blank to keep saved key'}
                  aria-invalid={Boolean(validation.key ?? backendFieldErrors.key)}
                  aria-describedby={(validation.key ?? backendFieldErrors.key) ? `${formId}-key-error` : undefined}
                  style={input()}
                />
              </Field>
            )}
            <Field label="Max concurrency" id={`${formId}-concurrency`} error={validation.concurrency ?? backendFieldErrors.concurrency}>
              <input
                id={`${formId}-concurrency`}
                className="b2-model-field"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={form.concurrency}
                disabled={isSaving}
                onChange={(event) => changeForm('concurrency', event.target.value)}
                aria-invalid={Boolean(validation.concurrency ?? backendFieldErrors.concurrency)}
                aria-describedby={(validation.concurrency ?? backendFieldErrors.concurrency) ? `${formId}-concurrency-error` : undefined}
                style={input()}
              />
            </Field>
          </div>
          {formError && <div role="alert" style={{ ...errorStyle, marginTop: 12 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button type="submit" disabled={isSaving} style={{ ...button(true), opacity: isSaving ? 0.6 : 1 }}>
              {isSaving ? 'Saving…' : formMode === 'create' ? 'Register model' : 'Save changes'}
            </button>
            <button type="button" onClick={closeForm} disabled={isSaving} style={{ ...button(), opacity: isSaving ? 0.6 : 1 }}>Cancel</button>
          </div>
        </form>
      )}

      {modelsQuery.isPending && (
        <div role="status" style={{ padding: '18px 0', color: 'var(--fg-muted)', fontSize: 13 }}>Loading registered models…</div>
      )}
      {modelsQuery.isError && (
        <div role="alert" style={{ padding: '14px 0', color: 'var(--destructive)', fontSize: 13 }}>
          Could not load models.{' '}
          <button
            type="button"
            onClick={() => modelsQuery.refetch()}
            disabled={modelsQuery.isFetching}
            style={{ ...button(), opacity: modelsQuery.isFetching ? 0.6 : 1 }}
          >
            {modelsQuery.isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      {!modelsQuery.isPending && !modelsQuery.isError && models.length === 0 && (
        <div style={{ padding: '18px 0', color: 'var(--fg-muted)', fontSize: 13 }}>
          No models registered. Add Ollama, Anthropic, or OpenRouter before creating an agent.
        </div>
      )}
      {!modelsQuery.isPending && !modelsQuery.isError && models.map((model, index) => {
        const result = testResults[model.model_id];
        const legacy = !isRuntimeProvider(model.provider);
        const testing = testingId === model.model_id;
        const removing = removingId === model.model_id;
        const statusChanging = statusId === model.model_id;
        const mutationPending = isSaving || testingId !== null || removingId !== null || statusId !== null;
        const rowActionPending = modelRowActionsDisabled(
          formMode,
          model.model_id,
          mutationPending,
        );
        return (
          <div key={model.model_id} style={{ padding: '14px 0', borderBottom: index === models.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span aria-hidden="true" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={model.provider === 'ollama' ? 'cpu' : 'cloud'} size={17} color="var(--accent)" />
              </span>
              <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', overflowWrap: 'anywhere' }}>{model.name}</div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--fg-muted)' }}>
                  {providerLabel(model.provider)}{legacy ? ' · Legacy' : model.provider === 'ollama' ? ' · Local' : ' · Cloud'}
                </div>
              </div>
              <div style={{ flex: '2 1 230px', minWidth: 0, color: 'var(--fg-muted)' }}>
                <div style={{ fontFamily: 'var(--mono-font)', fontSize: 12, overflowWrap: 'anywhere' }}>{model.model}</div>
                <div style={{ marginTop: 3, fontSize: 11.5, overflowWrap: 'anywhere' }}>
                  {model.provider === 'ollama'
                    ? (model.ollama_base_url || 'Local endpoint unavailable')
                    : model.provider === 'anthropic' || model.provider === 'openrouter'
                      ? model.has_api_key ? 'API key saved · secret hidden' : 'API key required'
                      : 'Stored legacy registration'}
                  {' · '}Concurrency: {model.max_concurrency}
                </div>
              </div>
              <span style={{ fontSize: 12, color: model.status === 'ready' ? 'var(--success)' : 'var(--fg-muted)', textTransform: 'capitalize' }}>
                {model.status}
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                <button
                  type="button"
                  aria-label={`Test ${model.name}`}
                  onClick={() => runTest(model)}
                  disabled={rowActionPending}
                  style={{ ...button(), opacity: rowActionPending && !testing ? 0.5 : 1 }}
                >
                  {testing ? 'Testing…' : 'Test'}
                </button>
                {!legacy && (
                  <button
                    type="button"
                    aria-label={`Edit ${model.name}`}
                    onClick={() => openEdit(model)}
                    disabled={rowActionPending}
                    style={{ ...button(), opacity: rowActionPending ? 0.5 : 1 }}
                  >
                    Edit
                  </button>
                )}
                {(model.status === 'ready' || model.status === 'paused') && (
                  <button
                    type="button"
                    aria-label={`${model.status === 'ready' ? 'Pause' : 'Resume'} ${model.name}`}
                    onClick={() => setStatus(model)}
                    disabled={rowActionPending}
                    style={{ ...button(), opacity: rowActionPending && !statusChanging ? 0.5 : 1 }}
                  >
                    {statusChanging
                      ? model.status === 'ready' ? 'Pausing…' : 'Resuming…'
                      : model.status === 'ready' ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${model.name}`}
                  onClick={() => remove(model)}
                  disabled={rowActionPending}
                  style={{ ...button(false, true), opacity: rowActionPending && !removing ? 0.5 : 1 }}
                >
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
            {result && (
              <div
                role={result.ok ? 'status' : 'alert'}
                style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '9px 0 0 56px', fontSize: 12, color: result.ok ? 'var(--success)' : 'var(--destructive)' }}
              >
                <Icon name={result.ok ? 'check' : 'alert'} size={13} /> {result.text}
              </div>
            )}
            {rowErrors[model.model_id] && (
              <div role="alert" style={{ ...errorStyle, margin: '9px 0 0 56px' }}>{rowErrors[model.model_id]}</div>
            )}
          </div>
        );
      })}
    </SCard>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children}
      {error && <div id={`${id}-error`} role="alert" style={errorStyle}>{error}</div>}
    </div>
  );
}
