/*
 * Brain2 Console — Wiki Audit drawer. Right slide-over: prompt the auditor,
 * choose agent/scope/citation policy, run, then accept / edit / dismiss the
 * streamed suggestions (each a diff + rationale + cited sources). Uncited
 * suggestions block Accept until overridden. Faithful port of the AuditDrawer
 * tree in docs/design/v1 app-wiki.jsx.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { btnGhost, btnPrimary } from '@/components/browse/Browse';
import { DiffView } from '@/components/browse/DiffView';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  useStartAudit, subscribeAuditStream, useLatestAudit,
  useAcceptSuggestion, useDismissSuggestion,
} from '@/hooks/useVault';
import type { DiffHunk } from '@/lib/wiki';

interface LiveSuggestion {
  id: string;
  section: string;
  cited: boolean;
  sourcesCited: string[];
  diff: DiffHunk[];
  why: string;
}
type SgState = 'pending' | 'accepted' | 'dismissed';
interface SgWithState extends LiveSuggestion { state: SgState; }

function suggestionFromWire(raw: any): SgWithState {
  const sourcesCited = raw.sourcesCited ?? raw.sources_cited ?? [];
  return {
    id: raw.id ?? raw.suggestion_id,
    section: raw.section ?? 'Page',
    cited: raw.cited ?? sourcesCited.length > 0,
    sourcesCited,
    diff: raw.diff ?? [],
    why: raw.why ?? raw.rationale ?? '',
    state: 'pending',
  };
}

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, color: 'var(--fg)', padding: '4px 0' }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
      </span>
      {label}
    </button>
  );
}

function SuggestionCard({ sg, onAccept, onDismiss }: { sg: SgWithState; onAccept: () => void; onDismiss: () => void }) {
  if (sg.state === 'accepted') {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--success-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="check" size={16} color="var(--success)" />
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>Applied to <b>{sg.section}</b> · new revision v8</span>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Section</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{sg.section}</span>
        {!sg.cited && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 6, padding: '2px 7px' }}><Icon name="alert" size={11} /> uncited</span>}
      </div>
      <DiffView hunks={sg.diff} compact />
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5, margin: '11px 0' }}><b style={{ color: 'var(--fg)' }}>Why:</b> {sg.why}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Sources cited:</span>
        {sg.sourcesCited.length ? sg.sourcesCited.map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--success)', background: 'var(--success-soft)', borderRadius: 6, padding: '2px 7px' }}><Icon name="check" size={11} /> {s}</span>
        )) : <span style={{ fontSize: 11.5, color: 'var(--warning)' }}>none found</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onAccept} disabled={!sg.cited} title={!sg.cited ? 'Resolve citation before accepting' : ''} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: 'none', cursor: sg.cited ? 'pointer' : 'not-allowed', background: sg.cited ? 'var(--success)' : 'var(--surface-2)', color: sg.cited ? '#fff' : 'var(--fg-faint)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>
          <Icon name="check" size={14} color={sg.cited ? '#fff' : 'var(--fg-faint)'} /> Accept
        </button>
        <button style={btnGhost()}>Edit then accept</button>
        <button onClick={onDismiss} style={{ ...btnGhost(), marginLeft: 'auto', width: 32, padding: 0, justifyContent: 'center' }}><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}

export function AuditDrawer({ open, onClose, topic }: { open: boolean; onClose: () => void; topic: string }) {
  const { projectId } = useWorkspace();
  const [sugs, setSugs] = useState<SgWithState[]>([]);
  const [running, setRunning] = useState(false);
  const [auditStatus, setAuditStatus] = useState<string>('');
  const [prompt, setPrompt] = useState('Check the Origins section is accurate per the sources. Tighten wording and add a citation if one is missing.');
  const [scope, setScope] = useState<'selection' | 'page'>('selection');
  const [citationRequired, setCitationRequired] = useState(true);
  const unsubRef = useRef<(() => void) | null>(null);

  const { data: latest } = useLatestAudit(projectId, topic || null);
  const startAudit = useStartAudit(projectId, topic);
  const acceptSuggestion = useAcceptSuggestion();
  const dismissSuggestion = useDismissSuggestion();

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);

  // cleanup SSE on close
  useEffect(() => {
    if (!open && unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
  }, [open]);

  useEffect(() => {
    if (!open || running || !latest) return;
    setSugs((latest.suggestions ?? []).map(suggestionFromWire));
  }, [open, running, latest]);

  const handleRunAudit = () => {
    if (!projectId || !topic || running) return;
    setSugs([]);
    setAuditStatus('Starting audit…');
    setRunning(true);
    startAudit.mutate(
      { agent_id: 'editor', instructions: prompt, scope, citation_policy: citationRequired ? 'must_cite' : 'optional' },
      {
        onSuccess: (res) => {
          setAuditStatus('Running…');
          const unsub = subscribeAuditStream(res.audit_id, (event) => {
            if (event.type === 'suggestion') {
              setSugs((xs) => [...xs, suggestionFromWire(event.suggestion ?? event)]);
            } else if (event.type === 'done') {
              setRunning(false); setAuditStatus('Done');
              unsub(); unsubRef.current = null;
            } else if (event.type === 'error') {
              setRunning(false); setAuditStatus('Error: ' + (event.message ?? 'unknown'));
              unsub(); unsubRef.current = null;
            }
          });
          unsubRef.current = unsub;
        },
        onError: (err) => {
          setRunning(false);
          setAuditStatus('Failed to start: ' + (err as Error).message);
        },
      },
    );
  };

  if (!open) return null;

  const pending = sugs.filter((s) => s.state !== 'dismissed');
  const unresolved = pending.filter((s) => s.state === 'pending');
  const verdict = (() => {
    if (unresolved.some((s) => !s.cited)) return { label: 'needs review', color: 'var(--warning)' };
    if (unresolved.length) return { label: 'warn', color: 'var(--warning)' };
    if (latest?.audit) return { label: 'pass', color: 'var(--success)' };
    return null;
  })();
  const setLocalState = (id: string, state: SgState) =>
    setSugs((xs) => xs.map((s) => s.id === id ? { ...s, state } : s));

  const handleAccept = (sg: SgWithState) => {
    acceptSuggestion.mutate(
      { suggestion_id: sg.id },
      { onSuccess: () => setLocalState(sg.id, 'accepted') },
    );
  };
  const handleDismiss = (sg: SgWithState) => {
    dismissSuggestion.mutate(
      { suggestion_id: sg.id },
      { onSuccess: () => setLocalState(sg.id, 'dismissed') },
    );
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(8,9,12,0.4)' }} />
      <div className="b2-anim-fade" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '100%', zIndex: 190, background: 'var(--bg)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', animation: 'b2slide 0.22s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="sparkles" size={17} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 15.5, fontWeight: 600, color: 'var(--fg)' }}>Audit: {topic}</span>
          {verdict && <span style={{ fontSize: 11, fontWeight: 700, color: verdict.color, background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px' }}>{verdict.label}</span>}
          <button onClick={onClose} style={{ marginLeft: 'auto', ...btnGhost(), width: 30, padding: 0, justifyContent: 'center' }}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {/* prompt */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 8 }}>Prompt the auditor</div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
            style={{ width: '100%', resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, lineHeight: 1.5, padding: 11, outline: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Agent</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>
                <StatusDot status="active" pulse={false} /> Editor <Icon name="chevDown" size={12} color="var(--fg-muted)" />
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 6 }}>
            <div><div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 2 }}>Scope</div>
              <Radio checked={scope === 'selection'} label="Selection" onClick={() => setScope('selection')} />
              <Radio checked={scope === 'page'} label="Whole page" onClick={() => setScope('page')} />
            </div>
            <div><div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 2 }}>Citation policy</div>
              <Radio checked={citationRequired} label="Must cite source" onClick={() => setCitationRequired(true)} />
              <Radio checked={!citationRequired} label="Citations optional" onClick={() => setCitationRequired(false)} />
            </div>
          </div>
          <button onClick={handleRunAudit} disabled={running || !projectId} style={{ ...btnPrimary(), height: 36, width: '100%', justifyContent: 'center', background: running ? 'var(--fg-muted)' : 'var(--success)', marginTop: 6 }}>
            <Icon name="zap" size={15} color="#fff" /> {running ? 'Running…' : 'Run audit'}
          </button>
          {auditStatus && <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)' }}>{auditStatus}</div>}

          <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />

          {/* pending */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Icon name="chevDown" size={13} color="var(--fg-muted)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Pending suggestions</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 6px' }}>{pending.filter((s) => s.state === 'pending').length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((s) => (
              <SuggestionCard key={s.id} sg={s}
                onAccept={() => handleAccept(s)}
                onDismiss={() => handleDismiss(s)} />
            ))}
            {!pending.length && !running && (
              <div style={{ textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13, padding: 20 }}>
                {sugs.length > 0 || latest?.audit ? 'All suggestions resolved.' : 'Run an audit to see suggestions.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
