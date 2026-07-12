import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { SCard } from '@/components/settings/SettingsCard';
import { RowMenu } from '@/components/ui/RowMenu';
import { useCreateModel, useDeleteModel, useModels, useTestModel } from '@/hooks/useModels';
import type { ModelConfig } from '@/lib/types';

type CloudProvider = 'anthropic' | 'openrouter';
const PROVIDERS: Array<{ id: CloudProvider; label: string; hint: string }> = [
  { id: 'anthropic', label: 'Anthropic', hint: 'e.g. claude-sonnet-4-5' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'e.g. anthropic/claude-sonnet-4.5' },
];

function input(extra?: CSSProperties): CSSProperties {
  return { height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, outline: 'none', width: '100%', ...extra };
}

function button(primary = false): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 8, border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : 'transparent', color: primary ? '#fff' : 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
}

const label: CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5 };
const errorStyle: CSSProperties = { color: 'var(--destructive)', fontSize: 12.5, marginTop: 10 };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed. Please try again.';
}

export function ModelsSection() {
  const modelsQuery = useModels();
  const createModel = useCreateModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();
  const cloud = (modelsQuery.data ?? []).filter(
    (model): model is ModelConfig & { provider: CloudProvider } =>
      model.provider === 'anthropic' || model.provider === 'openrouter',
  );
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ provider: CloudProvider; name: string; model: string; key: string }>({ provider: 'anthropic', name: '', model: '', key: '' });
  const [validation, setValidation] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const resetForm = () => {
    setForm({ provider: 'anthropic', name: '', model: '', key: '' });
    setValidation(null);
    createModel.reset();
  };

  const save = () => {
    if (!form.name.trim() || !form.model.trim() || !form.key.trim()) {
      setValidation('Display name, provider model ID, and API key are required.');
      return;
    }
    setValidation(null);
    createModel.mutate(
      { provider: form.provider, name: form.name.trim(), model: form.model.trim(), api_key: form.key.trim() },
      { onSuccess: () => { resetForm(); setAdding(false); } },
    );
  };

  const runTest = (model: ModelConfig) => {
    if (testingId) return;
    setTestingId(model.model_id);
    testModel.mutate(
      { model_id: model.model_id },
      {
        onSuccess: (result) => setTestResults((current) => ({
          ...current,
          [model.model_id]: { ok: result.ok, text: result.ok ? (result.text || 'Connection succeeded.') : (result.error || 'Connection failed.') },
        })),
        onError: (error) => setTestResults((current) => ({ ...current, [model.model_id]: { ok: false, text: errorMessage(error) } })),
        onSettled: () => setTestingId(null),
      },
    );
  };

  return (
    <SCard
      title="Cloud models"
      desc="Connect Anthropic or OpenRouter. API keys are encrypted at rest and never returned after saving."
      action={<button onClick={() => { setAdding((value) => !value); resetForm(); }} style={button()}><Icon name="plus" size={14} /> Add model</button>}
    >
      {modelsQuery.isPending && <div style={{ padding: '18px 0', color: 'var(--fg-muted)', fontSize: 13 }}>Loading saved models…</div>}
      {modelsQuery.isError && (
        <div style={{ padding: '14px 0', color: 'var(--destructive)', fontSize: 13 }}>
          Could not load models. <button onClick={() => modelsQuery.refetch()} style={{ ...button(), marginLeft: 8 }}>Retry</button>
        </div>
      )}
      {!modelsQuery.isPending && !modelsQuery.isError && cloud.length === 0 && !adding && (
        <div style={{ padding: '18px 0', color: 'var(--fg-muted)', fontSize: 13 }}>No eligible models configured. Add an Anthropic or OpenRouter model before agents can run.</div>
      )}
      {cloud.map((model, index) => {
        const result = testResults[model.model_id];
        return (
          <div key={model.model_id} style={{ padding: '14px 0', borderBottom: index === cloud.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="cloud" size={17} color="var(--accent)" /></span>
              <div style={{ width: 150, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.name}</div><div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{model.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'}</div></div>
              <div style={{ flex: 1, minWidth: 80, fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.model}</div>
              <span style={{ fontSize: 12, color: model.status === 'ready' ? 'var(--success)' : 'var(--fg-muted)' }}>{model.status}</span>
              <button onClick={() => runTest(model)} disabled={testingId !== null} style={{ ...button(), opacity: testingId && testingId !== model.model_id ? 0.5 : 1 }}>{testingId === model.model_id ? 'Testing…' : 'Test'}</button>
              <RowMenu items={[{ label: 'Remove model', icon: 'trash', danger: true, onClick: () => deleteModel.mutate({ model_id: model.model_id }) }]} />
            </div>
            {result && <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '9px 0 0 46px', fontSize: 12, color: result.ok ? 'var(--success)' : 'var(--destructive)' }}><Icon name={result.ok ? 'check' : 'alert'} size={13} /> {result.text}</div>}
          </div>
        );
      })}
      {adding && (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: '0 1 130px' }}><span style={label}>Provider</span><select aria-label="Provider" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as CloudProvider, model: '' })} style={input({ fontFamily: 'var(--ui-font)' })}>{PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
            <label style={{ flex: '1 1 150px' }}><span style={label}>Display name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Team Sonnet" style={input({ fontFamily: 'var(--ui-font)' })} /></label>
            <label style={{ flex: '1 1 210px' }}><span style={label}>Provider model ID</span><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder={PROVIDERS.find((provider) => provider.id === form.provider)?.hint} style={input()} /></label>
            <label style={{ flex: '1 1 210px' }}><span style={label}>API key</span><input type="password" autoComplete="off" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="Paste API key" style={input()} /></label>
            <button onClick={save} disabled={createModel.isPending} style={{ ...button(true), opacity: createModel.isPending ? 0.6 : 1 }}>{createModel.isPending ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { resetForm(); setAdding(false); }} style={button()}>Cancel</button>
          </div>
          {validation && <div style={errorStyle}>{validation}</div>}
          {createModel.isError && <div style={errorStyle}>{errorMessage(createModel.error)}</div>}
          {deleteModel.isError && <div style={errorStyle}>{errorMessage(deleteModel.error)}</div>}
        </div>
      )}
      {!adding && deleteModel.isError && <div style={errorStyle}>{errorMessage(deleteModel.error)}</div>}
    </SCard>
  );
}
