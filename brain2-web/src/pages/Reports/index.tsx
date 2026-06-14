import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel, MoreLink, SectionLabel } from '@/components/ui/Panel';
import { Popover } from '@/components/ui/Popover';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/StatusDot';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useMe } from '@/hooks/me';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { usePersona } from '@/hooks/usePersona';
import { useAgents, useCreateSchedule, useGenerateReport, useReports } from '@/hooks/useReports';
import { useSchedules } from '@/hooks/useSchedules';
import { CronBuilder } from '@/components/reports/CronBuilder';
import { buildCron, cadenceLabel } from '@/lib/cron';
import { parsePersona } from '@/lib/persona';
import { HistoryOverlay } from './HistoryOverlay';
import { ScheduledRunsOverlay } from './ScheduledRunsOverlay';

type ReportFormatId = 'doc' | 'deck' | 'video';
type ScheduleId = 'oneoff' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
type RunScheduleId = 'now' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
type ReportTone = 'accent' | 'success' | 'warning' | 'muted' | 'destructive';

interface ReportFormat {
  id: ReportFormatId;
  label: string;
  sub: string;
  icon: IconName;
}

interface SuggestedReport {
  id: string;
  title: string;
  icon: IconName;
  tone: ReportTone;
  desc: string;
  formats: ReportFormatId[];
  best: ReportFormatId;
  sources: number;
  est: string;
  category: string;
  why: string;
  match: number;
  isNew?: boolean;
}

interface CatalogReport {
  id: string;
  title: string;
  icon: IconName;
  formats: ReportFormatId[];
  desc?: string;
  category?: string;
}

interface ReportParamOption {
  id: string;
  label: string;
  hint?: string;
}

interface ReportParam {
  id: string;
  label: string;
  icon: IconName;
  default: string;
  options: ReportParamOption[];
}

interface ReportAction {
  id: string;
  plugin: string;
  icon: IconName;
  tone: ReportTone;
  title: string;
  runner: string;
  est?: string;
  sources?: number;
  coverage?: string;
  category?: string;
  params: ReportParam[];
  initial: Record<string, string>;
  buildPrompt: (values: Record<string, string>) => string;
}

const TONE: Record<ReportTone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  muted: 'var(--fg-muted)',
  destructive: 'var(--destructive)',
};

const TONE_SOFT: Record<ReportTone, string> = {
  accent: 'var(--accent-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  muted: 'var(--surface-2)',
  destructive: 'var(--destructive-soft)',
};

const REPORT_FORMATS: ReportFormat[] = [
  { id: 'doc', label: 'Document', sub: 'DOCX · Markdown', icon: 'file' },
  { id: 'deck', label: 'Deck', sub: 'Slides · PDF', icon: 'panelLeft' },
  { id: 'video', label: 'Video', sub: 'Narrated overview', icon: 'play' },
];

const SCHEDULE_OPTIONS = [
  { id: 'oneoff' as const, label: 'Run now', sub: 'generate now', icon: 'zap' as IconName },
  { id: 'weekly' as const, label: 'Every week', sub: 'Mondays · 9:00', icon: 'calendar' as IconName },
  { id: 'monthly' as const, label: 'Every month', sub: '1st · 9:00', icon: 'calendar' as IconName },
  { id: 'quarterly' as const, label: 'Every quarter', sub: 'start of quarter', icon: 'calendar' as IconName },
  { id: 'custom' as const, label: 'Custom cron', sub: 'pick a cadence + time', icon: 'sliders' as IconName },
];

const RUN_SCHEDULE_OPTIONS = [
  { id: 'now' as const, label: 'Run once now', sub: 'generate immediately', icon: 'zap' as IconName },
  { id: 'weekly' as const, label: 'Every week', sub: 'Mondays · 9:00', icon: 'calendar' as IconName },
  { id: 'monthly' as const, label: 'Every month', sub: '1st · 9:00', icon: 'calendar' as IconName },
  { id: 'quarterly' as const, label: 'Every quarter', sub: 'start of quarter', icon: 'calendar' as IconName },
  { id: 'custom' as const, label: 'Custom cron', sub: 'pick a cadence + time', icon: 'sliders' as IconName },
];

const REPORT_PARAMS: ReportParam[] = [
  {
    id: 'format', label: 'Document type', icon: 'file', default: 'doc',
    options: [
      { id: 'doc', label: 'Document', hint: 'DOCX · Markdown' },
      { id: 'deck', label: 'Deck', hint: 'Slides · PDF' },
      { id: 'video', label: 'Video', hint: 'Narrated overview' },
    ],
  },
  {
    id: 'period', label: 'Period', icon: 'calendar', default: 'q2',
    options: [
      { id: 'q2', label: 'Q2 FY26' },
      { id: 'q1', label: 'Q1 FY26' },
      { id: 'month', label: 'This month' },
      { id: 'ytd', label: 'Year to date' },
    ],
  },
  {
    id: 'audience', label: 'Audience', icon: 'users', default: 'board',
    options: [
      { id: 'board', label: 'Board' },
      { id: 'exec', label: 'Exec team' },
      { id: 'team', label: 'Wider team' },
      { id: 'investors', label: 'Investors' },
    ],
  },
  {
    id: 'depth', label: 'Depth', icon: 'layers', default: 'standard',
    options: [
      { id: 'brief', label: 'One-pager' },
      { id: 'standard', label: 'Standard' },
      { id: 'deep', label: 'Deep dive' },
    ],
  },
];

const SUGGESTED_REPORTS: SuggestedReport[] = [
  {
    id: 'fin-q2', title: 'Q2 Financial Report', icon: 'barChart', tone: 'accent',
    desc: 'P&L, burn and runway with every figure cited back to your finance sources.',
    formats: ['doc', 'deck'], best: 'doc', sources: 12, est: '~2 min', category: 'Financial',
    why: 'You own the finance sources and open the Q2 folder daily.', match: 98,
  },
  {
    id: 'board', title: 'Board Briefing', icon: 'briefcase', tone: 'accent',
    desc: 'A one-page executive summary of the quarter, written for your board.',
    formats: ['deck', 'doc'], best: 'deck', sources: 24, est: '~3 min', category: 'Executive',
    why: 'Board meeting in 6 days, per your linked calendar.', match: 95,
  },
  {
    id: 'sales', title: 'Sales Performance Summary', icon: 'trendingUp', tone: 'success',
    desc: 'Pipeline, wins and churn for the month, broken down by segment.',
    formats: ['doc', 'deck'], best: 'doc', sources: 9, est: '~2 min', category: 'Financial',
    why: 'Pulls from the sales dashboards you ingested last week.', match: 88,
  },
  {
    id: 'video-q2', title: 'Q2 Earnings Walkthrough', icon: 'play', tone: 'warning',
    desc: 'A 4-minute narrated overview of the quarter, ready to send to the team.',
    formats: ['video'], best: 'video', sources: 12, est: '~6 min', category: 'Executive',
    why: 'New: turn your Q2 numbers into something shareable.', match: 84, isNew: true,
  },
  {
    id: 'headcount', title: 'Headcount & Cost Snapshot', icon: 'users', tone: 'muted',
    desc: 'Team size and spend versus plan, with a hiring-vs-attrition view.',
    formats: ['doc', 'deck'], best: 'doc', sources: 6, est: '~90 s', category: 'Operations',
    why: 'Frequently requested in your weekly ops review.', match: 79,
  },
  {
    id: 'investor', title: 'Investor Update', icon: 'mail', tone: 'muted',
    desc: 'Monthly update with metrics, highlights, lowlights and a clear ask.',
    formats: ['doc'], best: 'doc', sources: 18, est: '~2 min', category: 'Executive',
    why: 'Matches the cadence of your last three updates.', match: 74,
  },
];

const REPORT_CATALOG: { category: string; types: CatalogReport[] }[] = [
  { category: 'Financial', types: [
    { id: 'revenue', title: 'Revenue Breakdown', icon: 'barChart', formats: ['doc', 'deck'] },
    { id: 'burn', title: 'Burn & Runway', icon: 'trendingUp', formats: ['doc', 'deck'] },
    { id: 'expense', title: 'Expense Audit', icon: 'clipboard', formats: ['doc'] },
  ] },
  { category: 'Operations', types: [
    { id: 'ops-weekly', title: 'Weekly Ops Review', icon: 'calendar', formats: ['doc', 'deck'] },
    { id: 'postmortem', title: 'Incident Postmortem', icon: 'alert', formats: ['doc'] },
    { id: 'sla', title: 'SLA & Uptime Report', icon: 'shield', formats: ['doc', 'deck'] },
  ] },
  { category: 'Customer', types: [
    { id: 'voc', title: 'Voice-of-Customer Summary', icon: 'chats', formats: ['doc', 'deck', 'video'] },
    { id: 'support', title: 'Support Trends', icon: 'users', formats: ['doc'] },
    { id: 'churn', title: 'Churn Analysis', icon: 'trendingUp', formats: ['doc', 'deck'] },
  ] },
  { category: 'Knowledge', types: [
    { id: 'research', title: 'Research Digest', icon: 'sparkles', formats: ['doc', 'video'] },
    { id: 'litreview', title: 'Literature Review', icon: 'wiki', formats: ['doc'] },
    { id: 'landscape', title: 'Competitive Landscape', icon: 'globe', formats: ['doc', 'deck'] },
  ] },
];

function fmtById(id: string) {
  return REPORT_FORMATS.find((f) => f.id === id) ?? REPORT_FORMATS[0];
}

function scheduleById(id: ScheduleId) {
  return SCHEDULE_OPTIONS.find((o) => o.id === id) ?? SCHEDULE_OPTIONS[0];
}

function runScheduleById(id: RunScheduleId) {
  return RUN_SCHEDULE_OPTIONS.find((o) => o.id === id) ?? RUN_SCHEDULE_OPTIONS[0];
}

function paramDefaults(params: ReportParam[]) {
  return params.reduce<Record<string, string>>((acc, param) => {
    acc[param.id] = param.default ?? param.options[0]?.id;
    return acc;
  }, {});
}

function buildReportPrompt(ctx: { title: string; coverage?: string; sources?: number }, values: Record<string, string>) {
  const fmt = {
    doc: 'a fully cited document (DOCX / Markdown)',
    deck: 'a board-ready slide deck',
    video: 'a short narrated video walkthrough',
  }[values.format] ?? 'a fully cited document';
  const period = {
    q2: 'Q2 FY26',
    q1: 'Q1 FY26',
    month: 'this month',
    ytd: 'the year so far',
  }[values.period] ?? 'the selected period';
  const audience = {
    board: 'the board',
    exec: 'the exec team',
    team: 'the wider team',
    investors: 'investors',
  }[values.audience] ?? 'the intended audience';
  const depth = {
    brief: 'Keep it to a single page of headline numbers.',
    standard: 'Use the standard sections and length.',
    deep: 'Go deep: full breakdowns, method notes and an appendix.',
  }[values.depth] ?? 'Use the standard sections and length.';
  const sourceCopy = ctx.sources ? `${ctx.sources} cited sources` : 'cited sources';
  const coverage = ctx.coverage ? `${ctx.coverage} ` : '';

  return `Generate ${fmt} for ${audience}: "${ctx.title}", covering ${period}.\n\n${coverage}Pull every figure from ${sourceCopy} and reference each one inline. ${depth}`;
}

function reportActionConfig(report: SuggestedReport | CatalogReport, format: ReportFormatId): ReportAction {
  const params = REPORT_PARAMS;
  const initial = { ...paramDefaults(params), format };
  const fallbackDesc = `Create a cited ${report.title.toLowerCase()} from the most relevant workspace sources.`;
  return {
    id: report.id,
    plugin: 'Reports',
    icon: report.icon,
    tone: 'tone' in report ? report.tone : 'accent',
    title: report.title,
    runner: 'Researcher',
    est: 'est' in report ? report.est : '~2 min',
    sources: 'sources' in report ? report.sources : 12,
    coverage: 'desc' in report ? report.desc ?? fallbackDesc : fallbackDesc,
    category: report.category,
    params,
    initial,
    buildPrompt: (values) => buildReportPrompt({
      title: report.title,
      coverage: 'desc' in report ? report.desc ?? fallbackDesc : fallbackDesc,
      sources: 'sources' in report ? report.sources : 12,
    }, values),
  };
}

function customReportConfig(text: string, format: ReportFormatId): ReportAction {
  const raw = text.trim();
  const coverage = raw || 'Summarise the most important numbers for the period.';
  return {
    id: 'custom',
    plugin: 'Reports',
    icon: 'wand',
    tone: 'accent',
    title: 'Custom report',
    runner: 'Researcher',
    est: '~2 min',
    sources: 12,
    coverage,
    params: REPORT_PARAMS,
    initial: { ...paramDefaults(REPORT_PARAMS), format },
    buildPrompt: (values) => buildReportPrompt({ title: 'Custom report', coverage, sources: 12 }, values),
  };
}

function PersonaCrest({ size = 26, pulse = false }: { size?: number; pulse?: boolean }) {
  return (
    <span
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: size * 0.3,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
      }}
    >
      {pulse && <span className="b2-pulse" style={{ position: 'absolute', inset: 0, borderRadius: size * 0.3, background: 'var(--accent)', opacity: 0.16 }} />}
      <Icon name="sparkles" size={size * 0.5} />
    </span>
  );
}

function ScheduleDropdown({ value, onChange, cron, onCronChange }: {
  value: ScheduleId;
  onChange: (value: ScheduleId) => void;
  cron: string;
  onCronChange: (cron: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const opt = scheduleById(value);
  const active = value !== 'oneoff';
  const label = value === 'custom' ? cadenceLabel(cron) : opt.label;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px',
          borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12,
          fontWeight: 600, border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border-strong)'}`,
          background: active ? 'var(--accent-soft)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--fg)',
        }}
      >
        <Icon name={opt.icon} size={14} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? 'var(--accent)' : 'var(--fg-faint)' }}>Schedule</span>
        <span>{label}</span>
        <Icon name="chevDown" size={12} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-end" style={{ width: 296, padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Schedule this report for...</div>
          {SCHEDULE_OPTIONS.map((o) => {
            const on = o.id === value;
            return (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); if (o.id !== 'custom') setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 8, border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  <Icon name={o.icon} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{o.sub}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
          {value === 'custom' && (
            <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <CronBuilder value={cron} onChange={onCronChange} />
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

function MatchPill({ n, tone = 'accent' }: { n: number; tone?: ReportTone }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: TONE[tone], background: TONE_SOFT[tone], borderRadius: 6, padding: '2px 7px' }}>
      <Icon name="sparkles" size={11} /> {n}% match
    </span>
  );
}

function ActionButton({ scheduled, onClick, full = false }: { scheduled: boolean; onClick: () => void; full?: boolean }) {
  return (
    <Button variant="primary" icon={scheduled ? 'calendar' : 'wand'} onClick={onClick} style={{ width: full ? '100%' : 'auto', height: 34 }}>
      {scheduled ? 'Schedule' : 'Generate'}
    </Button>
  );
}

function SuggestCard({ report, scheduled, schedule, onGenerate }: {
  report: SuggestedReport;
  scheduled: boolean;
  schedule: ScheduleId;
  onGenerate: (action: ReportAction, schedule: ScheduleId) => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={() => onGenerate(reportActionConfig(report, report.best), schedule)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 11, padding: 16, borderRadius: 12, cursor: 'pointer',
        minWidth: 0, textAlign: 'left', border: `1px solid ${hover ? 'var(--accent-line)' : 'var(--border)'}`,
        background: 'var(--surface)', boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.18)' : 'var(--shadow-card)',
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast)',
        fontFamily: 'var(--ui-font)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: TONE_SOFT[report.tone], color: TONE[report.tone] }}>
          <Icon name={report.icon} size={17} />
        </span>
        {report.isNew && <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '2px 6px', letterSpacing: '0.04em' }}>NEW</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 9px' }}>{report.category}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{report.title}</div>
        <MatchPill n={report.match} tone={report.tone === 'muted' ? 'accent' : report.tone} />
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.45, flex: 1, textWrap: 'pretty' }}>{report.desc}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}>
        <Icon name="sparkles" size={12} color="var(--accent)" />
        <span style={{ color: 'var(--fg-muted)' }}>{report.why}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>
          <Icon name="sources" size={12} /> {report.sources} sources · {report.est}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: hover ? 'var(--accent)' : 'var(--fg-muted)' }}>
          {scheduled ? 'Schedule' : 'Configure'} <Icon name="arrowRight" size={14} color={hover ? 'var(--accent)' : 'var(--fg-muted)'} />
        </span>
      </div>
    </button>
  );
}

function CustomPromptCard({ scheduled, schedule, onGenerate }: {
  scheduled: boolean;
  schedule: ScheduleId;
  onGenerate: (action: ReportAction, schedule: ScheduleId) => void;
}) {
  const [text, setText] = useState('');

  const open = () => onGenerate(customReportConfig(text, 'doc'), schedule);

  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 12, border: '1px dashed var(--border-strong)', background: 'var(--surface-2)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Icon name="wand" size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>Custom report</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Describe any report in plain language, cited back to your sources.</div>
        </div>
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Q2 burn vs. plan for the board, with a hiring breakdown..."
        onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
        style={{ width: '100%', height: 42, padding: '0 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}><Icon name="sources" size={12} /> 12 sources</span>
        <span style={{ marginLeft: 'auto' }}><ActionButton scheduled={scheduled} onClick={open} /></span>
      </div>
    </div>
  );
}

function CatalogOverlay({ schedule, onClose, onGenerate }: {
  schedule: ScheduleId;
  onClose: () => void;
  onGenerate: (action: ReportAction, schedule: ScheduleId) => void;
}) {
  return (
    <Modal
      onClose={onClose}
      icon="layers"
      title={
        <span>
          All report types
          <span style={{ display: 'block', marginTop: 3, fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 400, color: 'var(--fg-muted)' }}>Every report Brain2 can generate, grouped by category.</span>
        </span>
      }
      width={760}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {REPORT_CATALOG.map((category) => (
          <div key={category.category}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 10 }}>{category.category}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {category.types.map((report) => (
                <button
                  key={report.id}
                  onClick={() => {
                    onGenerate(reportActionConfig({ ...report, category: category.category }, report.formats[0]), schedule);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--accent)' }}>
                    <Icon name={report.icon} size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{report.title}</span>
                  <Icon name="chevRight" size={14} color="var(--fg-faint)" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ParamChip({ param, value, onChange }: {
  param: ReportParam;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = param.options.find((o) => o.id === value) ?? param.options[0];

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
          borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5,
          fontWeight: 600, lineHeight: 1, border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border)'}`,
          background: open ? 'var(--surface-3)' : 'var(--surface-2)', color: 'var(--fg)',
        }}
      >
        <Icon name={param.icon} size={13} color="var(--accent)" />
        <span style={{ color: 'var(--fg-faint)' }}>{param.label}</span>
        <span>{current.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" style={{ width: 250, padding: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>{param.label}</div>
          {param.options.map((option) => {
            const on = option.id === value;
            return (
              <button
                key={option.id}
                onClick={() => { onChange(option.id); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 8, border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--fg)' }}>{option.label}</span>
                  {option.hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{option.hint}</span>}
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

function AgentSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: agents = [] } = useAgents();
  const current = agents.find((agent) => agent.name === value) ?? agents[0];

  if (!current) {
    return (
      <button
        disabled
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 9, fontFamily: 'var(--ui-font)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-muted)', opacity: 0.72 }}
      >
        <StatusDot status="idle" pulse={false} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>No agents</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>create an agent first</span>
        </span>
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)' }}
      >
        <StatusDot status={current.status} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{current.name}</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{current.model}</span>
        </span>
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" style={{ width: 290, padding: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Submit to agent</div>
          {agents.map((agent) => {
            const on = agent.name === value;
            return (
              <button
                key={agent.agent_id}
                onClick={() => { onChange(agent.name); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 8, border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
              >
                <StatusDot status={agent.status} pulse={false} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{agent.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.model} · {agent.provider}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

function RunScheduleSelect({ value, onChange, cron, onCronChange }: {
  value: RunScheduleId;
  onChange: (value: RunScheduleId) => void;
  cron: string;
  onCronChange: (cron: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = runScheduleById(value);
  const active = value !== 'now';

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: `1px solid ${open || active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-soft)' : 'var(--surface)' }}
      >
        <Icon name={current.icon} size={16} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{current.label}</span>
          <span style={{ fontSize: 10.5, color: active ? 'var(--accent)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{current.sub}</span>
        </span>
        <Icon name="chevDown" size={13} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" style={{ width: 296, padding: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Run this report...</div>
          {RUN_SCHEDULE_OPTIONS.map((option) => {
            const on = option.id === value;
            return (
              <button
                key={option.id}
                onClick={() => { onChange(option.id); if (option.id !== 'custom') setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 8, border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  <Icon name={option.icon} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{option.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{option.sub}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
          {value === 'custom' && (
            <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <CronBuilder value={cron} onChange={onCronChange} />
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

function GenerateOverlay({ action, schedule, initialCron, projectId, onClose }: {
  action: ReportAction;
  schedule: ScheduleId;
  initialCron: string;
  projectId: string | null;
  onClose: () => void;
}) {
  const { data: agents = [] } = useAgents();
  const generate = useGenerateReport(projectId);
  const createSchedule = useCreateSchedule(projectId);
  const [values, setValues] = useState(action.initial);
  const [agent, setAgent] = useState(action.runner);
  const [runSchedule, setRunSchedule] = useState<RunScheduleId>(schedule === 'oneoff' ? 'now' : schedule);
  const [cron, setCron] = useState<string>(initialCron);
  const [override, setOverride] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [page, setPage] = useState(0);

  const setParam = (id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setOverride(null);
  };

  const scheduled = runSchedule !== 'now';
  const draft = action.buildPrompt(values);
  const promptText = override ?? draft;

  const send = () => {
    if (sent) return;
    const agentRow = agents.find((a) => a.name === agent) ?? agents[0];
    if (!agentRow) return;
    setSent(true);
    const opParams = {
      title: action.title,
      prompt: promptText,
      agent_id: agentRow.agent_id,
      project_id: projectId,
      format: (values.format as ReportFormatId) ?? 'doc',
      schedule: 'now' as const,
      ...(action.category ? { category: action.category } : {}),
    };
    const handlers = {
      onSuccess: () => window.setTimeout(onClose, 950),
      onError: () => setSent(false),
    };
    if (runSchedule === 'now') {
      generate.mutate(opParams, handlers);
    } else if (runSchedule === 'custom') {
      createSchedule.mutate({
        op_name: 'reports:generate',
        op_params: opParams,
        cron_expr: cron,
      }, handlers);
    } else {
      createSchedule.mutate({
        op_name: 'reports:generate',
        op_params: opParams,
        frequency: runSchedule,
      }, handlers);
    }
  };

  return (
    <Modal
      onClose={onClose}
      width={640}
      header={
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: TONE_SOFT[action.tone], color: TONE[action.tone] }}>
            <Icon name={action.icon} size={19} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--fg-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono-font)', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px' }}>
                <Icon name="plug" size={11} color="var(--fg-faint)" /> {action.plugin}
              </span>
              <Icon name="arrowRight" size={12} color="var(--fg-faint)" />
              <span>submits to <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{agent}</b></span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="x" size={15} />
          </button>
        </div>
      }
      footer={
        <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: page === 1 ? 'var(--accent)' : 'var(--border-strong)' }} />
              <span style={{ marginLeft: 3 }}>Step {page + 1} of 2</span>
            </span>
            {action.sources != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>· <Icon name="sources" size={13} color="var(--fg-faint)" /> {action.sources} sources</span>}
            {action.est && <span>· {action.est}</span>}
          </span>
          {page === 0 ? (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" iconRight="arrowRight" onClick={() => setPage(1)}>Next</Button>
            </span>
          ) : (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button variant="ghost" icon="chevLeft" onClick={() => setPage(0)}>Back</Button>
              <Button variant="primary" icon={sent ? 'check' : (scheduled ? 'calendar' : 'send')} disabled={sent || agents.length === 0} onClick={send}>
                {agents.length === 0 ? 'No agent available' : sent ? (scheduled ? 'Scheduled' : 'Sent') : (scheduled ? 'Schedule report' : `Send to ${agent}`)}
              </Button>
            </span>
          )}
        </>
      }
    >
      {page === 0 ? (
        <>
          {action.coverage && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--fg-muted)', textWrap: 'pretty' }}>{action.coverage}</p>}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 12 }}>Parameters</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
              {action.params.map((param) => (
                <ParamChip key={param.id} param={param} value={values[param.id]} onChange={(value) => setParam(param.id, value)} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 10 }}>Run with</div>
              <AgentSelect value={agent} onChange={setAgent} />
            </div>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 10 }}>Schedule</div>
              <RunScheduleSelect value={runSchedule} onChange={setRunSchedule} cron={cron} onCronChange={setCron} />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Prompt to {agent}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'var(--mono-font)', color: override != null ? 'var(--accent)' : 'var(--fg-faint)' }}>
                <Icon name={override != null ? 'pencil' : 'wand'} size={11} color={override != null ? 'var(--accent)' : 'var(--fg-faint)'} />
                {override != null ? 'edited' : 'auto-written from parameters'}
              </span>
              {override != null && (
                <button onClick={() => setOverride(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="refresh" size={12} color="var(--accent)" /> Reset
                </button>
              )}
            </div>
            <textarea
              value={promptText}
              onChange={(e) => setOverride(e.target.value)}
              rows={6}
              style={{ width: '100%', resize: 'vertical', minHeight: 132, padding: '13px 15px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, lineHeight: 1.6, outline: 'none' }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

export function ReportsPage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const isNarrow = useMedia('(max-width: 1080px)');
  const { projectId } = useWorkspace();
  const me = useMe().data;
  const persona = usePersona();
  const parsed = parsePersona(persona.data?.content ?? '');
  const displayName = me?.display_name?.trim() || 'you';
  const firstName = displayName.split(/\s+/)[0];
  const { data: recentReports = [] } = useReports(projectId);
  const { data: schedules = [] } = useSchedules();
  const [schedule, setSchedule] = useState<ScheduleId>('oneoff');
  const [headerCron, setHeaderCron] = useState<string>(() => buildCron('weekly', 9 * 60));
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [generateAction, setGenerateAction] = useState<{ action: ReportAction; schedule: ScheduleId; cron: string } | null>(null);
  const activeScheduleCount = schedules.filter((s) => Boolean(s.enabled)).length;

  const scheduled = schedule !== 'oneoff';
  const currentSchedule = scheduleById(schedule);
  const openGenerate = (action: ReportAction, actionSchedule: ScheduleId) =>
    setGenerateAction({ action, schedule: actionSchedule, cron: headerCron });

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '22px 14px 96px' : '34px 28px 36px', display: 'flex', flexDirection: 'column', gap: isMobile ? 22 : 28 }}>
          <header style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>
              <Icon name="layers" size={14} color="var(--accent)" /> Studio
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 27, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Generate a report</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setScheduledOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)' }}
                >
                  <Icon name="calendar" size={14} color="var(--fg-muted)" />
                  Scheduled runs
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--mono-font)', background: 'var(--accent-soft)', color: 'var(--accent)' }}>{activeScheduleCount}</span>
                </button>
                <ScheduleDropdown value={schedule} onChange={setSchedule} cron={headerCron} onCronChange={setHeaderCron} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
              <PersonaCrest size={26} pulse={persona.isLoading} />
              {parsed.isEmpty ? (
                <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>
                  <Link to="/settings" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Set up your persona</Link> to tailor these suggestions.
                </span>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textWrap: 'pretty' }}>
                  Tuned for <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{displayName}</b>{parsed.summary ? <> — {parsed.summary}</> : null}
                </span>
              )}
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0,1fr) 340px', gap: isNarrow ? 22 : 26, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              <SectionLabel
                action={
                  <button onClick={() => setCatalogOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: 0, border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    See all report types <Icon name="chevRight" size={13} color="var(--accent)" />
                  </button>
                }
              >
                Suggested for {firstName}
              </SectionLabel>

              {scheduled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14, padding: '10px 13px', borderRadius: 10, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
                  <Icon name="calendar" size={15} color="var(--accent)" />
                  <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>
                    <b style={{ fontWeight: 600 }}>Scheduling on.</b>{' '}
                    <span style={{ color: 'var(--fg-muted)' }}>Buttons below set up a recurring report: {currentSchedule.label.toLowerCase()}, {currentSchedule.sub}.</span>
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0,1fr))', gap: 14 }}>
                {SUGGESTED_REPORTS.map((report) => (
                  <SuggestCard key={report.id} report={report} scheduled={scheduled} schedule={schedule} onGenerate={openGenerate} />
                ))}
                <CustomPromptCard scheduled={scheduled} schedule={schedule} onGenerate={openGenerate} />
              </div>
            </div>

            <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: isNarrow ? 'static' : 'sticky', top: 0 }}>
              <Panel title="Recent reports" action={<MoreLink onClick={() => setHistoryOpen(true)}>History</MoreLink>}>
                <div style={{ marginTop: -4 }}>
                  {recentReports.length === 0 && (
                    <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--fg-faint)' }}>
                      No reports yet. Generate one to see it here.
                    </div>
                  )}
                  {recentReports.map((report, index) => {
                    const format = fmtById(report.format);
                    return (
                      <button
                        key={report.report_id}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 0', border: 'none', borderTop: index > 0 ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}
                      >
                        <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
                          <Icon name={format.icon} size={15} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, color: 'var(--fg)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{report.title}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{report.status} · {new Date(report.created_at).toLocaleDateString()}</span>
                        </span>
                        <Icon name="chevRight" size={15} color="var(--fg-faint)" />
                      </button>
                    );
                  })}
                </div>
              </Panel>
              <Panel title="Persona signals">
                {parsed.signals.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {parsed.signals.map((signal) => (
                      <span key={signal} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} /> {signal}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--fg-faint)', lineHeight: 1.5 }}>
                    No persona notes yet — add some in <Link to="/settings" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Settings → Profile</Link>.
                  </div>
                )}
              </Panel>
            </aside>
          </div>
        </div>
      </div>

      {catalogOpen && (
        <CatalogOverlay
          schedule={schedule}
          onClose={() => setCatalogOpen(false)}
          onGenerate={(action, actionSchedule) => {
            setCatalogOpen(false);
            openGenerate(action, actionSchedule);
          }}
        />
      )}
      {generateAction && (
        <GenerateOverlay
          action={generateAction.action}
          schedule={generateAction.schedule}
          initialCron={generateAction.cron}
          projectId={projectId}
          onClose={() => setGenerateAction(null)}
        />
      )}
      {historyOpen && <HistoryOverlay projectId={projectId} onClose={() => setHistoryOpen(false)} />}
      {scheduledOpen && <ScheduledRunsOverlay onClose={() => setScheduledOpen(false)} />}
    </>
  );
}
