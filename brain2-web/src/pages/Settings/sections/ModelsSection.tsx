import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SCard } from '@/components/settings/SettingsCard';
import {
  useCreateModel,
  useDeleteModel,
  useModels,
  useTestModel,
} from '@/hooks/useModels';
import type { ModelConfig } from '@/lib/types';

const CLOUD: ModelConfig['provider'][] = ['anthropic', 'gemini', 'openai'];

const selectStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontFamily: 'var(--ui-font)',
  fontSize: 13,
};

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', width: '100%' }}>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
        {label}
      </span>
      <select style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function ModelRow({
  model,
  onTest,
  onDelete,
  testing,
  deleting,
}: {
  model: ModelConfig;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
  deleting: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: 'var(--surface-2)',
          color: 'var(--fg-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name={model.provider === 'ollama' ? 'cpu' : 'cloud'} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
          {model.name}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--fg-faint)',
            fontFamily: 'var(--mono-font)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={[
            model.model,
            model.param_count,
            model.ollama_base_url,
          ].filter(Boolean).join(' · ')}
        >
          {model.model}
          {model.param_count ? ` · ${model.param_count}` : ''}
          {model.ollama_base_url ? ` · ${model.ollama_base_url}` : ''}
        </div>
      </div>
      <Button variant="ghost" size="sm" icon="play" onClick={onTest} loading={testing}>
        Test
      </Button>
      <Button variant="danger" size="sm" icon="trash" onClick={onDelete} loading={deleting}>
        Remove
      </Button>
    </div>
  );
}

export function ModelsSection() {
  const { data: models = [] } = useModels();
  const createModel = useCreateModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();

  const local = models.filter((m) => m.provider === 'ollama');
  const cloud = models.filter((m) => m.provider !== 'ollama');
  const [testResult, setTestResult] = useState<string | null>(null);

  const [lName, setLName] = useState('');
  const [lUrl, setLUrl] = useState('');
  const [lModel, setLModel] = useState('');
  const [lParams, setLParams] = useState('');
  const addLocal = () => {
    if (!lName || !lUrl || !lModel) return;
    createModel.mutate(
      {
        name: lName,
        provider: 'ollama',
        model: lModel,
        ollama_base_url: lUrl,
        param_count: lParams || undefined,
      },
      {
        onSuccess: () => {
          setLName('');
          setLUrl('');
          setLModel('');
          setLParams('');
        },
      },
    );
  };

  const [cProvider, setCProvider] = useState<ModelConfig['provider']>('anthropic');
  const [cName, setCName] = useState('');
  const [cModel, setCModel] = useState('');
  const [cKey, setCKey] = useState('');
  const addCloud = () => {
    if (!cName || !cModel) return;
    createModel.mutate(
      {
        name: cName,
        provider: cProvider,
        model: cModel,
        api_key: cKey || undefined,
      },
      {
        onSuccess: () => {
          setCName('');
          setCModel('');
          setCKey('');
        },
      },
    );
  };

  const test = (model: ModelConfig) => {
    setTestResult(null);
    testModel.mutate(
      { model_id: model.model_id },
      {
        onSuccess: (result) => {
          setTestResult(result.ok
            ? `${model.name}: ${result.text ?? 'ok'}`
            : `${model.name}: ${result.error ?? 'test failed'}`);
        },
      },
    );
  };

  return (
    <div>
      {testResult && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            color: 'var(--fg-muted)',
            fontSize: 12.5,
          }}
        >
          <Icon name="check" size={14} color="var(--success)" />
          {testResult}
        </div>
      )}

      <SCard title="Local models" desc="Ollama endpoints and workstation-hosted models.">
        {local.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--fg-faint)', marginBottom: 14 }}>
            No local models yet.
          </div>
        ) : (
          <div style={{ marginTop: -12, marginBottom: 16 }}>
            {local.map((model) => (
              <ModelRow
                key={model.model_id}
                model={model}
                onTest={() => test(model)}
                onDelete={() => deleteModel.mutate({ model_id: model.model_id })}
                testing={testModel.isPending}
                deleting={deleteModel.isPending}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Display name" value={lName} onChange={(e) => setLName(e.target.value)} />
          </div>
          <div style={{ flex: '2 1 220px' }}>
            <Field label="Base URL" value={lUrl} onChange={(e) => setLUrl(e.target.value)} mono />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <Field label="Model" value={lModel} onChange={(e) => setLModel(e.target.value)} mono />
          </div>
          <div style={{ flex: '0 1 100px' }}>
            <Field label="Params" value={lParams} onChange={(e) => setLParams(e.target.value)} mono />
          </div>
          <Button
            variant="primary"
            icon="plus"
            onClick={addLocal}
            loading={createModel.isPending}
            disabled={!lName || !lUrl || !lModel}
          >
            Add
          </Button>
        </div>
      </SCard>

      <SCard title="Cloud models" desc="Provider model configs with encrypted API keys.">
        {cloud.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--fg-faint)', marginBottom: 14 }}>
            No cloud models yet.
          </div>
        ) : (
          <div style={{ marginTop: -12, marginBottom: 16 }}>
            {cloud.map((model) => (
              <ModelRow
                key={model.model_id}
                model={model}
                onTest={() => test(model)}
                onDelete={() => deleteModel.mutate({ model_id: model.model_id })}
                testing={testModel.isPending}
                deleting={deleteModel.isPending}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: '0 1 130px' }}>
            <SelectField label="Provider" value={cProvider} onChange={(value) => setCProvider(value as ModelConfig['provider'])}>
              {CLOUD.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </SelectField>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Display name" value={cName} onChange={(e) => setCName(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <Field label="Model" value={cModel} onChange={(e) => setCModel(e.target.value)} mono />
          </div>
          <div style={{ flex: '1 1 170px' }}>
            <Field label="API key" type="password" value={cKey} onChange={(e) => setCKey(e.target.value)} mono />
          </div>
          <Button
            variant="primary"
            icon="plus"
            onClick={addCloud}
            loading={createModel.isPending}
            disabled={!cName || !cModel}
          >
            Add
          </Button>
        </div>
      </SCard>
    </div>
  );
}
