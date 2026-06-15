import { useState } from 'react';
import { Toggle } from '@/components/ui/Toggle';
import { SCard, SRow } from '@/components/settings/SettingsCard';

interface Tool { op: string; desc: string; on: boolean; }

const INITIAL_TOOLS: Tool[] = [
  { op: 'run_query',      desc: 'Read-only knowledge queries',                     on: true  },
  { op: 'wiki:get',       desc: 'Read wiki pages',                                  on: true  },
  { op: 'wiki:put',       desc: 'Edit wiki pages (optimistic-lock)',                on: true  },
  { op: 'sources:read',   desc: 'Read raw + extracted sources',                    on: true  },
  { op: 'sources:ingest', desc: 'Upload and re-ingest sources',                    on: false },
  { op: 'models:create',  desc: 'Create and configure models',                     on: false },
];

export function ToolsSection() {
  const [tools, setTools] = useState(INITIAL_TOOLS);
  const toggle = (op: string) => setTools((ts) => ts.map((t) => t.op === op ? { ...t, on: !t.on } : t));

  return (
    <SCard
      title="Operations"
      desc="Globally enable the ops agents may call. The chat tool-allowlist is the intersection of these and each user's permissions."
    >
      {tools.map((t, i) => (
        <SRow
          key={t.op}
          last={i === tools.length - 1}
          label={<span style={{ fontFamily: 'var(--mono-font)', fontSize: 13 }}>{t.op}</span>}
          desc={t.desc}
        >
          <Toggle on={t.on} onClick={() => toggle(t.op)} aria-label={`Toggle ${t.op}`} />
        </SRow>
      ))}
    </SCard>
  );
}
