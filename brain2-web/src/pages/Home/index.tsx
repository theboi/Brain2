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
 * Modals: IngestModal, ActivityModal, AddAgentModal
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
import { ActivityModal, AddAgentModal } from '@/components/home/HomeModals';
import { IngestModal } from '@/pages/Sources/IngestModal';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { useMe } from '@/hooks/me';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import {
  useStatsOverview,
  useStatsSources,
  useStatsQueries,
  useStatsLlmTokens,
  useStatsWikiByProject,
} from '@/hooks/useStats';
import { useWorkers } from '@/hooks/useAgents';
import { useActivity } from '@/hooks/useActivity';
import { agentAvailability } from '@/lib/agentAvailability';
import { bucketsToSeries, pivotTokenSeries, seriesDelta } from '@/lib/stats';
import { eventToActivityItem } from '@/lib/activity';
import { WIKI_HEALTH, QUICK_ACTIONS, type Agent as DashboardAgent } from '@/lib/mockData';
import type { Agent as LiveAgent } from '@/pages/Agents/data';

type ModalId = 'ingest' | 'activity' | 'addAgent' | null;

// ── Hero Band ────────────────────────────────────────────────────────────────
function HeroBand({ onIngest, name, stats }: { onIngest: () => void; name: string; stats: { label: string; value: string }[] }) {
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
          Good morning, {name}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 0 }}>
          {stats.map((m, i) => (
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

// ── Token colors for stacked area ───────────────────────────────────────────
const TOKEN_COLORS = ['var(--accent)', '#2DD4BF'];
const tokenLegend = () => [
  { label: 'Tokens in',  color: TOKEN_COLORS[0] },
  { label: 'Tokens out', color: TOKEN_COLORS[1] },
];

function dashboardAgent(agent: LiveAgent): DashboardAgent {
  const busy = agent.status === 'busy';
  const offline = agent.status === 'offline';
  return {
    id: agent.id,
    name: agent.name,
    model: busy ? 'Worker assigned' : 'Auto model pool',
    provider: 'Agents queue',
    status: busy ? 'active' : offline ? 'error' : 'idle',
    statusLabel: busy ? 'running todo' : offline ? 'offline' : 'idle',
    last: busy ? 'now' : 'available',
    msgs: 0,
    cost: offline ? 'offline' : 'live',
    spark: busy ? [1, 3, 4, 5, 7, 6, 8, 9, 10] : [1, 1, 2, 1, 2, 1, 1, 2, 1],
    note: busy && agent.taskId ? `todo ${agent.taskId.slice(0, 8)}` : undefined,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function HomePage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const [modal, setModal] = useState<ModalId>(null);
  const { workspaceId } = useWorkspace();
  const me = useMe().data;
  const overviewQuery = useStatsOverview();
  const sourcesQuery = useStatsSources(30);
  const queriesQuery = useStatsQueries(30);
  const tokensQuery = useStatsLlmTokens(30);
  const wikiByProjectQuery = useStatsWikiByProject();
  const activityQuery = useActivity(25);
  const { data: agents = [] } = useWorkers();
  const { data: projects = [] } = useProjects(workspaceId);

  const overview = overviewQuery.data;
  const name = me?.display_name?.trim() || 'there';
  const availability = agentAvailability(agents);
  const dashboardAgents = agents.map(dashboardAgent);
  const heroStats = [
    { label: 'agents online', value: String(availability.online) },
    { label: 'sources', value: (overview?.sources_total ?? 0).toLocaleString() },
    { label: 'wiki pages', value: (overview?.wiki_pages_total ?? 0).toLocaleString() },
    { label: 'queries today', value: String(overview?.queries_today ?? 0) },
  ];

  const sourcesSeries = bucketsToSeries(sourcesQuery.data?.buckets ?? [], 30);
  const queriesSeries = bucketsToSeries(queriesQuery.data?.buckets ?? [], 30);
  const sourcesDelta = seriesDelta(sourcesSeries);
  const queriesDelta = seriesDelta(queriesSeries);
  const tokenSeries = pivotTokenSeries(tokensQuery.data?.rows ?? [], 30);

  const projectName = (id: string) => projects.find((p) => p.project_id === id)?.name ?? id.slice(0, 8);
  const wikiBars = (wikiByProjectQuery.data?.buckets ?? []).map((b) => ({ label: projectName(b.project_id), value: b.count }));
  const events = activityQuery.data?.events ?? [];
  const activityRows = events.map(eventToActivityItem);

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
          <HeroBand onIngest={() => setModal('ingest')} name={name} stats={heroStats} />
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
                <SectionLabel action={<MoreLink href="/agents">Manage agents</MoreLink>}>
                  Agents
                </SectionLabel>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                    gap: isMobile ? 10 : 14,
                  }}
                >
                  {dashboardAgents.map((a) => <AgentCard key={a.id} agent={a} />)}
                  {!dashboardAgents.length && (
                    <div
                      style={{
                        minHeight: 120,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: 16,
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        background: 'var(--surface)',
                        color: 'var(--fg-faint)',
                        fontSize: 12.5,
                        lineHeight: 1.4,
                      }}
                    >
                      No live workers registered yet.
                    </div>
                  )}
                  <AddAgentTile onClick={() => setModal('addAgent')} />
                </div>
              </div>

              {/* Knowledge stats */}
              <div>
                <SectionLabel>Knowledge stats</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 10 : 16 }}>
                    <StatTile label="Sources ingested"       value={(overview?.sources_total ?? 0).toLocaleString()} delta={sourcesDelta?.delta} deltaUp={sourcesDelta?.up ?? true} data={sourcesSeries} id="src" />
                    <StatTile label="Queries served · today" value={String(overview?.queries_today ?? 0)}             delta={queriesDelta?.delta} deltaUp={queriesDelta?.up ?? true} data={queriesSeries} id="qry" />
                  </div>
                  <Panel title="LLM tokens used" action={<Legend items={tokenLegend()} />}>
                    <StackedArea series={tokenSeries} colors={TOKEN_COLORS} h={150} id="tok" />
                  </Panel>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, position: isMobile ? 'static' : 'sticky', top: 0 }}>
              <ActivityPanel rows={activityRows} onViewAll={() => setModal('activity')} />
              {WIKI_HEALTH && (
                <WikiHealth
                  score={WIKI_HEALTH.score}
                  label={WIKI_HEALTH.label}
                  coverage={WIKI_HEALTH.coverage}
                  rows={WIKI_HEALTH.rows}
                />
              )}
              <Panel title="Wiki pages by project" action={<MoreLink href="/wiki">Open wiki</MoreLink>}>
                <div style={{ paddingTop: 4 }}>
                  {wikiBars.length ? <BarsH data={wikiBars} /> : <div style={{ padding: '8px 0', fontSize: 12.5, color: 'var(--fg-faint)' }}>No wiki pages yet.</div>}
                </div>
              </Panel>
            </aside>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal === 'ingest'   && <IngestModal open onClose={() => setModal(null)} />}
      {modal === 'activity' && <ActivityModal events={events} onClose={() => setModal(null)} />}
      {modal === 'addAgent' && <AddAgentModal onClose={() => setModal(null)} />}
    </>
  );
}
