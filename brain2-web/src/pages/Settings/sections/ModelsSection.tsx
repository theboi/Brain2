/*
 * ModelsSection — manage the cloud and local models agents can run.
 *   · Local models  — Ollama / LM Studio / vLLM endpoints (inline-editable)
 *   · Cloud models  — bring-your-own-key provider model configs
 * Wired to the real models:* ops via useModels; styled to the v1 design.
 */
import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { SCard } from '@/components/settings/SettingsCard';
import { RowMenu } from '@/components/ui/RowMenu';
import {
  useModels,
  useCreateModel,
  useUpdateModel,
  useDeleteModel,
  useTestModel,
} from '@/hooks/useModels';
import type { ModelConfig } from '@/lib/types';

const CLOUD_PROVIDERS: ModelConfig['provider'][] = ['anthropic', 'gemini', 'openai'];

// ── Small style primitives (ported from the v1 design) ───────────────────────
function mInput(extra?: CSSProperties): CSSProperties {
  return {
    height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5,
    outline: 'none', width: '100%', ...extra,
  };
}
function sbtn(kind?: 'primary' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px',
    borderRadius: 8, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', border: '1px solid transparent', whiteSpace: 'nowrap',
  };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--border)' };
  return { ...base, background: 'transparent', color: 'var(--fg)', borderColor: 'var(--border)' };
}
const fieldLabel: CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5 };
const labelTxt: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function statusView(status: ModelConfig['status']) {
  if (status === 'ready') return { color: 'var(--success)', fill: true, label: 'Ready' };
  if (status === 'paused') return { color: 'var(--warning)', fill: true, label: 'Paused' };
  return { color: 'var(--fg-faint)', fill: false, label: 'Disabled' };
}

function TestBtn({ testing, ok, onClick }: { testing?: boolean; ok?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={testing} style={{ ...sbtn(), opacity: testing ? 0.7 : 1, cursor: testing ? 'default' : 'pointer' }}>
      {testing ? (
        <>
          <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={13} color="var(--fg-muted)" /></span> Testing…
        </>
      ) : ok ? (
        <><Icon name="check" size={13} color="var(--success)" /> Test</>
      ) : (
        'Test'
      )}
    </button>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
export function ModelsSection() {
  const { data: models = [] } = useModels();
  const createModel = useCreateModel();
  const updateModel = useUpdateModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();

  const local = models.filter((m) => m.provider === 'ollama');
  const cloud = models.filter((m) => m.provider !== 'ollama');

  const [adding, setAdding] = useState(false);
  const [addingCloud, setAddingCloud] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', url: '', params: '' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<string | null>(null);

  const [nf, setNf] = useState({ name: '', url: 'http://', model: '', params: '' });
  const [ncf, setNcf] = useState<{ provider: ModelConfig['provider']; name: string; model: string; key: string }>({ provider: 'anthropic', name: '', model: '', key: '' });

  const startEdit = (m: ModelConfig) => {
    setEditId(m.model_id);
    setEdit({ name: m.name, url: m.ollama_base_url ?? '', params: m.param_count ?? '' });
  };
  const saveEdit = (id: string) => {
    updateModel.mutate(
      { model_id: id, name: edit.name, ollama_base_url: edit.url, param_count: edit.params },
      { onSuccess: () => setEditId(null) },
    );
  };

  const addLocal = () => {
    if (!nf.name.trim() || !nf.url.trim() || !nf.model.trim()) return;
    createModel.mutate(
      { name: nf.name.trim(), provider: 'ollama', model: nf.model.trim(), ollama_base_url: nf.url.trim(), param_count: nf.params.trim() || undefined },
      { onSuccess: () => { setNf({ name: '', url: 'http://', model: '', params: '' }); setAdding(false); } },
    );
  };
  const addCloud = () => {
    if (!ncf.name.trim() || !ncf.model.trim()) return;
    createModel.mutate(
      { name: ncf.name.trim(), provider: ncf.provider, model: ncf.model.trim(), api_key: ncf.key.trim() || undefined },
      { onSuccess: () => { setNcf({ provider: 'anthropic', name: '', model: '', key: '' }); setAddingCloud(false); } },
    );
  };

  const runTest = (m: ModelConfig) => {
    if (testingId) return;
    setTestResult(null);
    setTestingId(m.model_id);
    testModel.mutate(
      { model_id: m.model_id },
      {
        onSuccess: (result) => {
          if (result.ok) setTested((t) => ({ ...t, [m.model_id]: true }));
          setTestResult(result.ok ? `${m.name}: ${result.text ?? 'ok'}` : `${m.name}: ${result.error ?? 'test failed'}`);
        },
        onSettled: () => setTestingId(null),
      },
    );
  };

  return (
    <div>
      {testResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: 'var(--fg-muted)', fontSize: 12.5 }}>
          <Icon name="check" size={14} color="var(--success)" />
          {testResult}
        </div>
      )}

      {/* ── Local models ─────────────────────────────────────────────── */}
      <SCard
        title="Local models"
        desc="Point at a runtime URL (Ollama, LM Studio, vLLM…). Name each endpoint, record its size, and the agents can run it."
        action={<button onClick={() => setAdding((a) => !a)} style={sbtn()}><Icon name="plus" size={14} /> Add local model</button>}
      >
        {local.length === 0 && !adding && (
          <div style={{ fontSize: 13, color: 'var(--fg-faint)', padding: '6px 0' }}>No local models yet.</div>
        )}
        {local.map((m, i) => {
          const editing = editId === m.model_id;
          const sv = statusView(m.status);
          return (
            <div key={m.model_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i === local.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'var(--surface-2)', color: sv.fill ? 'var(--success)' : 'var(--fg-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="cpu" size={17} />
              </span>
              <div style={{ width: 132, flexShrink: 0 }}>
                {editing ? (
                  <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} title="Rename endpoint" style={mInput({ height: 26, fontFamily: 'var(--ui-font)', fontWeight: 600, fontSize: 13.5 })} />
                ) : (
                  <div style={labelTxt}>{m.name}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', paddingLeft: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</div>
              </div>
              {editing ? (
                <input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} style={mInput({ flex: 1, minWidth: 90 })} />
              ) : (
                <div style={{ flex: 1, minWidth: 90, fontFamily: 'var(--mono-font)', fontSize: 12.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.ollama_base_url}</div>
              )}
              {editing ? (
                <input value={edit.params} onChange={(e) => setEdit({ ...edit, params: e.target.value })} title="Parameter count — free-form" style={mInput({ width: 72, textAlign: 'center', fontWeight: 600 })} />
              ) : (
                <div style={{ width: 72, textAlign: 'center', fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{m.param_count || '—'}</div>
              )}
              <span className="b2-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: sv.color, width: 88 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sv.fill ? sv.color : 'transparent', border: sv.fill ? 'none' : `1.5px solid ${sv.color}` }} /> {sv.label}
              </span>
              {editing ? (
                <button onClick={() => saveEdit(m.model_id)} style={sbtn('primary')}><Icon name="check" size={14} color="#fff" /> Done</button>
              ) : (
                <TestBtn testing={testingId === m.model_id} ok={tested[m.model_id]} onClick={() => runTest(m)} />
              )}
              <RowMenu items={editing
                ? [{ label: 'Done editing', icon: 'check', onClick: () => saveEdit(m.model_id) }, { divider: true, label: 'Remove endpoint', icon: 'trash', danger: true, onClick: () => deleteModel.mutate({ model_id: m.model_id }) }]
                : [{ label: 'Edit', icon: 'pencil', onClick: () => startEdit(m) }, { divider: true, label: 'Remove endpoint', icon: 'trash', danger: true, onClick: () => deleteModel.mutate({ model_id: m.model_id }) }]} />
            </div>
          );
        })}
        {adding && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Add a local model</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '1 1 130px' }}>
                <span style={fieldLabel}>Name</span>
                <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="mac-studio-2" style={mInput({ fontFamily: 'var(--ui-font)' })} />
              </label>
              <label style={{ flex: '2 1 220px' }}>
                <span style={fieldLabel}>Base URL</span>
                <input value={nf.url} onChange={(e) => setNf({ ...nf, url: e.target.value })} placeholder="http://10.0.0.9:11434" style={mInput()} />
              </label>
              <label style={{ flex: '1 1 130px' }}>
                <span style={fieldLabel}>Model</span>
                <input value={nf.model} onChange={(e) => setNf({ ...nf, model: e.target.value })} placeholder="llama3.3" style={mInput()} />
              </label>
              <label style={{ flex: '0 1 100px' }}>
                <span style={fieldLabel}>Parameters</span>
                <input value={nf.params} onChange={(e) => setNf({ ...nf, params: e.target.value })} placeholder="90B · 1T" style={mInput()} />
              </label>
              <button onClick={addLocal} disabled={createModel.isPending} style={{ ...sbtn('primary'), height: 34 }}><Icon name="check" size={14} color="#fff" /> Add</button>
              <button onClick={() => { setNf({ name: '', url: 'http://', model: '', params: '' }); setAdding(false); }} style={{ ...sbtn(), height: 34 }}>Cancel</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 9 }}>Parameter count is free-form — use the model’s own scale (e.g. 10M, 8B, 90B, 1T).</div>
          </div>
        )}
      </SCard>

      {/* ── Cloud models ─────────────────────────────────────────────── */}
      <SCard
        title="Cloud models"
        desc="Bring your own API keys. Keys are encrypted at rest (AES-256-GCM) and never shown again after saving."
        action={<button onClick={() => setAddingCloud((a) => !a)} style={sbtn()}><Icon name="plus" size={14} /> Add provider</button>}
      >
        {cloud.length === 0 && !addingCloud && (
          <div style={{ fontSize: 13, color: 'var(--fg-faint)', padding: '6px 0' }}>No cloud models yet.</div>
        )}
        {cloud.map((m, i) => {
          const sv = statusView(m.status);
          return (
            <div key={m.model_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: i === cloud.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="cloud" size={17} />
              </span>
              <div style={{ width: 132, flexShrink: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'capitalize' }}>{m.provider}</div>
              </div>
              <div style={{ flex: 1, fontFamily: 'var(--mono-font)', fontSize: 12.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</div>
              <span className="b2-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: sv.color, width: 88 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sv.fill ? sv.color : 'transparent', border: sv.fill ? 'none' : `1.5px solid ${sv.color}` }} /> {sv.label}
              </span>
              <TestBtn testing={testingId === m.model_id} ok={tested[m.model_id]} onClick={() => runTest(m)} />
              <RowMenu items={[{ label: 'Remove model', icon: 'trash', danger: true, onClick: () => deleteModel.mutate({ model_id: m.model_id }) }]} />
            </div>
          );
        })}
        {addingCloud && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Add a cloud model</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '0 1 120px' }}>
                <span style={fieldLabel}>Provider</span>
                <select value={ncf.provider} onChange={(e) => setNcf({ ...ncf, provider: e.target.value as ModelConfig['provider'] })} style={mInput({ fontFamily: 'var(--ui-font)', textTransform: 'capitalize' })}>
                  {CLOUD_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ flex: '1 1 130px' }}>
                <span style={fieldLabel}>Name</span>
                <input value={ncf.name} onChange={(e) => setNcf({ ...ncf, name: e.target.value })} placeholder="Claude Sonnet" style={mInput({ fontFamily: 'var(--ui-font)' })} />
              </label>
              <label style={{ flex: '1 1 150px' }}>
                <span style={fieldLabel}>Model</span>
                <input value={ncf.model} onChange={(e) => setNcf({ ...ncf, model: e.target.value })} placeholder="claude-sonnet-4-5" style={mInput()} />
              </label>
              <label style={{ flex: '2 1 180px' }}>
                <span style={fieldLabel}>API key</span>
                <input type="password" value={ncf.key} onChange={(e) => setNcf({ ...ncf, key: e.target.value })} placeholder="Paste API key…" style={mInput()} />
              </label>
              <button onClick={addCloud} disabled={createModel.isPending} style={{ ...sbtn('primary'), height: 34 }}><Icon name="check" size={14} color="#fff" /> Add</button>
              <button onClick={() => { setNcf({ provider: 'anthropic', name: '', model: '', key: '' }); setAddingCloud(false); }} style={{ ...sbtn(), height: 34 }}>Cancel</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 9 }}>The key is encrypted at rest and never shown again after saving.</div>
          </div>
        )}
      </SCard>
    </div>
  );
}
