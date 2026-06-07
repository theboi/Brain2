/*
 * Home Dashboard (Variant B).
 *
 * Layout:
 *   HeroBand                      ← greeting + stats + Ingest CTA
 *   QuickActions                  ← plugin jobs + open-ended chat tile
 *   [Focus column]  [Sidebar]
 *     Agents grid                   Activity feed (→ ActivityModal)
 *     Knowledge stats               Wiki health
 *       Sources + Queries tiles     Wiki pages by project (bars)
 *       Token stacked area
 *
 * Modals: IngestModal, ActivityModal, ManageAgentsModal, AddAgentModal
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Panel, MoreLink, SectionLabel } from '@/components/ui/Panel';
import { StackedArea } from '@/components/charts/StackedArea';
import { BarsH } from '@/components/charts/BarsH';
import { AgentCard, AddAgentTile } from '@/components/dashboard/AgentCard';
import { StatTile, Legend } from '@/components/dashboard/StatTile';
import { ActivityPanel } from '@/components/dashboard/ActivityPanel';
import { WikiHealth } from '@/components/dashboard/WikiHealth';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { ActivityModal, ManageAgentsModal, AddAgentModal } from '@/components/home/HomeModals';
import { IngestModal } from '@/pages/Sources/IngestModal';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import {
  AGENTS, HERO_STATS, ACTIVITY, WIKI_HEALTH, WIKI_BY_PROJECT,
  SOURCES_OVER_TIME, QUERIES_SERVED, TOKENS_BY_PROVIDER, QUICK_ACTIONS,
} from '@/lib/mockData';

type ModalId = 'ingest' | 'activity' | 'agents' | 'addAgent' | null;

// ── Hero Band ────────────────────────────────────────────────────────────────
function HeroBand({ onIngest }: { onIngest: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--display-font)',
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: 'var(--display-track)',
            color: 'var(--fg)',
          }}
        >
          Good morning, Alice
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 0 }}>
          {HERO_STATS.map((m, i) => (
            <span key={m.label} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && (
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--fg-faint)', margin: '0 12px', display: 'inline-block' }} />
              )}
              <span style={{ fontSize: 14, color: 'var(--fg-muted)' }}>
                <b style={{ color: 'var(--fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{m.value}</b> {m.label}
              </span>
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={onIngest}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px',
          borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff',
          fontFamily: 'var(--ui-font)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          transition: 'opacity var(--duration-fast)',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
      >
        <Icon name="plus" size={16} color="#fff" /> Ingest source
      </button>
    </div>
  );
}

// ── Provider colors for stacked area ────────────────────────────────────────
const PROVIDER_COLORS = ['var(--accent)', '#2DD4BF', '#94A3B8'];
const legendItems = () => [
  { label: 'Anthropic', color: PROVIDER_COLORS[0] },
  { label: 'Gemini',    color: PROVIDER_COLORS[1] },
  { label: 'Ollama',    color: PROVIDER_COLORS[2] },
];

// ── Page ─────────────────────────────────────────────────────────────────────
export function HomePage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const [modal, setModal] = useState<ModalId>(null);

  return (
    <>
      {/* Scrollable page content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        <div
          style={{
            maxWidth: 1560,
            margin: '0 auto',
            padding: isMobile ? '16px 14px 88px' : 28,
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 18 : 22,
          }}
        >
          <HeroBand onIngest={() => setModal('ingest')} />
          <QuickActions actions={QUICK_ACTIONS} isMobile={isMobile} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 380px',
              gap: isMobile ? 18 : 22,
              alignItems: 'start',
            }}
          >
            {/* Focus column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
              {/* Agents */}
              <div>
                <SectionLabel action={<MoreLink onClick={() => setModal('agents')}>Manage agents</MoreLink>}>
                  Agents
                </SectionLabel>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                    gap: isMobile ? 10 : 14,
                  }}
                >
                  {AGENTS.map((a) => <AgentCard key={a.id} agent={a} />)}
                  <AddAgentTile onClick={() => setModal('addAgent')} />
                </div>
              </div>

              {/* Knowledge stats */}
              <div>
                <SectionLabel>Knowledge stats</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 10 : 16 }}>
                    <StatTile label="Sources ingested"      value="1,284" delta="3.4%"  data={SOURCES_OVER_TIME} id="src" />
                    <StatTile label="Queries served · today" value="89"  delta="12%"   data={QUERIES_SERVED}    id="qry" />
                  </div>
                  <Panel title="LLM tokens used" action={<Legend items={legendItems()} />}>
                    <StackedArea series={TOKENS_BY_PROVIDER} colors={PROVIDER_COLORS} h={150} id="tok" />
                  </Panel>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, position: isMobile ? 'static' : 'sticky', top: 0 }}>
              <ActivityPanel rows={ACTIVITY} onViewAll={() => setModal('activity')} />
              <WikiHealth
                score={WIKI_HEALTH.score}
                label={WIKI_HEALTH.label}
                coverage={WIKI_HEALTH.coverage}
                rows={WIKI_HEALTH.rows}
              />
              <Panel title="Wiki pages by project" action={<MoreLink href="/wiki">Open wiki</MoreLink>}>
                <div style={{ paddingTop: 4 }}>
                  <BarsH data={WIKI_BY_PROJECT} />
                </div>
              </Panel>
            </aside>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal === 'ingest'   && <IngestModal open onClose={() => setModal(null)} />}
      {modal === 'activity' && <ActivityModal onClose={() => setModal(null)} />}
      {modal === 'agents'   && (
        <ManageAgentsModal
          onClose={() => setModal(null)}
          onAddAgent={() => setModal('addAgent')}
        />
      )}
      {modal === 'addAgent' && <AddAgentModal onClose={() => setModal(null)} />}
    </>
  );
}
