import { useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  useDeleteTag,
  useProjectTags,
  useRenameTag,
  useTagCounts,
  type SourceTagCount,
} from '@/hooks/useSources';

interface ManageTagsOverlayProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
}

const iconBtn = (): CSSProperties => ({
  width: 30,
  height: 30,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
});

const btn = (kind: 'ghost' | 'primary' | 'danger' = 'ghost'): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 34,
  padding: '0 13px',
  borderRadius: 8,
  border: kind === 'ghost' ? '1px solid var(--border)' : 'none',
  background: kind === 'primary' ? 'var(--accent)' : kind === 'danger' ? 'var(--destructive)' : 'transparent',
  color: kind === 'ghost' ? 'var(--fg-muted)' : '#fff',
  fontFamily: 'var(--ui-font)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
});

function TagRow({
  tag,
  count,
  editing,
  editValue,
  onStartEdit,
  onEditChange,
  onConfirmEdit,
  onCancelEdit,
  onDelete,
  mergeSelected,
  onSelectForMerge,
  busy,
}: {
  tag: string;
  count: number;
  editing: boolean;
  editValue: string;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  mergeSelected: boolean;
  onSelectForMerge: () => void;
  busy?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 4px', borderBottom: '1px solid var(--border)' }}>
      {editing ? (
        <>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            style={{ flex: 1, minWidth: 0, height: 32, padding: '0 9px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' }}
          />
          <button onClick={onConfirmEdit} disabled={busy} title="Save" aria-label="Save tag name" style={{ ...iconBtn(), opacity: busy ? 0.5 : 1 }}><Icon name="check" size={14} /></button>
          <button onClick={onCancelEdit} disabled={busy} title="Cancel" aria-label="Cancel rename" style={{ ...iconBtn(), opacity: busy ? 0.5 : 1 }}><Icon name="x" size={14} /></button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--fg)', fontWeight: 600 }}>
            <Icon name="hash" size={12} color="var(--accent)" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{count} source{count === 1 ? '' : 's'}</span>
          <button onClick={onStartEdit} title="Rename" aria-label={`Rename ${tag}`} style={iconBtn()}><Icon name="pencil" size={13} /></button>
          <button onClick={onSelectForMerge} title="Merge into another tag" aria-label={`Merge ${tag}`} style={{ ...iconBtn(), color: mergeSelected ? 'var(--accent)' : 'var(--fg-muted)', borderColor: mergeSelected ? 'var(--accent)' : 'var(--border)', background: mergeSelected ? 'var(--accent-soft)' : 'transparent' }}>
            <Icon name="merge" size={13} />
          </button>
          <button onClick={onDelete} title="Delete tag" aria-label={`Delete ${tag}`} style={{ ...iconBtn(), color: 'var(--destructive)' }}><Icon name="trash" size={13} /></button>
        </>
      )}
    </div>
  );
}

export function ManageTagsOverlay({ open, onClose, projectId }: ManageTagsOverlayProps) {
  const { data: tagNames = [] } = useProjectTags(projectId);
  const { data: counts = [], isLoading } = useTagCounts(projectId);
  const rename = useRenameTag(projectId);
  const del = useDeleteTag(projectId);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [mergeTo, setMergeTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tagCounts = useMemo<SourceTagCount[]>(() => {
    const byName = new Map(counts.map((row) => [row.tag, row.count]));
    const names = new Set([...tagNames, ...counts.map((row) => row.tag)]);
    return [...names].sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag, count: byName.get(tag) ?? 0 }));
  }, [counts, tagNames]);

  if (!open) return null;

  const confirmRename = (oldTag: string) => {
    const next = editValue.trim();
    if (!next || next === oldTag) {
      setEditingTag(null);
      return;
    }
    setError(null);
    rename.mutate(
      { oldTag, newTag: next },
      {
        onSuccess: () => setEditingTag(null),
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not rename tag.'),
      },
    );
  };

  const confirmMerge = () => {
    if (!mergeFrom || !mergeTo) return;
    setError(null);
    rename.mutate(
      { oldTag: mergeFrom, newTag: mergeTo },
      {
        onSuccess: () => { setMergeFrom(null); setMergeTo(null); },
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not merge tags.'),
      },
    );
  };

  const confirmDeleteTag = () => {
    if (!confirmDelete) return;
    setError(null);
    del.mutate(
      { tag: confirmDelete },
      {
        onSuccess: () => setConfirmDelete(null),
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not delete tag.'),
      },
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: 480, maxWidth: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <Icon name="hash" size={18} color="var(--accent)" />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>Manage Tags</span>
          <button onClick={onClose} aria-label="Close manage tags" style={{ ...iconBtn(), marginLeft: 'auto' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {!projectId && (
          <div role="alert" style={{ padding: 12, borderRadius: 9, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 12.5, marginBottom: 12 }}>
            Select a vault before managing tags.
          </div>
        )}
        {error && (
          <div role="alert" style={{ padding: 12, borderRadius: 9, background: 'var(--destructive-soft)', color: 'var(--destructive)', fontSize: 12.5, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 120 }}>
          {isLoading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>Loading tags...</div>}
          {!isLoading && tagCounts.map(({ tag, count }) => (
            <TagRow
              key={tag}
              tag={tag}
              count={count}
              editing={editingTag === tag}
              editValue={editingTag === tag ? editValue : ''}
              onStartEdit={() => { setEditingTag(tag); setEditValue(tag); }}
              onEditChange={setEditValue}
              onConfirmEdit={() => confirmRename(tag)}
              onCancelEdit={() => setEditingTag(null)}
              onDelete={() => setConfirmDelete(tag)}
              mergeSelected={mergeFrom === tag}
              onSelectForMerge={() => { setMergeFrom(mergeFrom === tag ? null : tag); setMergeTo(null); }}
              busy={rename.isPending}
            />
          ))}
          {!isLoading && tagCounts.length === 0 && (
            <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', padding: 32, margin: 0, lineHeight: 1.5 }}>
              No tags yet. Add tags to sources when ingesting.
            </p>
          )}
        </div>

        {mergeFrom && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--fg-muted)', margin: '0 0 8px' }}>
              Merging <b style={{ color: 'var(--fg)' }}>{mergeFrom}</b> into:
            </p>
            <select
              value={mergeTo ?? ''}
              onChange={(e) => setMergeTo(e.target.value || null)}
              style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13 }}
            >
              <option value="">Select target tag...</option>
              {tagCounts.filter((t) => t.tag !== mergeFrom).map(({ tag }) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button disabled={!mergeTo || rename.isPending} onClick={confirmMerge} style={{ ...btn('primary'), flex: 1, opacity: mergeTo && !rename.isPending ? 1 : 0.45 }}>
                <Icon name="merge" size={14} color="#fff" /> Merge
              </button>
              <button onClick={() => { setMergeFrom(null); setMergeTo(null); }} style={btn()}>Cancel</button>
            </div>
          </div>
        )}

        <p style={{ fontSize: 11.5, color: 'var(--fg-muted)', margin: '14px 0 0', textAlign: 'center', lineHeight: 1.45 }}>
          Deleting a tag removes it from all sources but does not delete the sources.
        </p>
      </div>

      {confirmDelete && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.32)', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 22, width: 360, maxWidth: '100%', border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,0.45)' }}>
            <p style={{ fontSize: 14, color: 'var(--fg)', margin: '0 0 10px', lineHeight: 1.45 }}>
              Delete tag <b>"{confirmDelete}"</b> from all sources?
            </p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
              This removes the tag everywhere it was applied. The sources themselves are not deleted.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmDeleteTag} disabled={del.isPending} style={{ ...btn('danger'), flex: 1, opacity: del.isPending ? 0.6 : 1 }}>
                <Icon name="trash" size={14} color="#fff" /> {del.isPending ? 'Deleting...' : 'Delete Tag'}
              </button>
              <button onClick={() => setConfirmDelete(null)} disabled={del.isPending} style={btn()}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
