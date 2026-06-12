/* Brain2 Console — scheduled report runs (clean model).
   time:          queue time in minutes from midnight for TODAY (no duration).
   enabled:       boolean — on/off. Once a run fires it leaves scheduling; no pause.
   cadenceId:     'daily' | 'weekdays' | 'weekly' | 'monthly' | 'quarterly' | 'custom'
   cadenceDetail: plain-English description shown in the UI
   cronExpr:      underlying cron expression (source of truth) */

const SCHED_NOW  = 14 * 60 + 18;   // 14:18 on Jun 9, 2026
const SCHED_DAY  = { weekday: 'Tuesday', date: 'Jun 9, 2026', short: 'Jun 9' };

const hhmm  = (m) => `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
const pad2  = (n) => String(n).padStart(2, '0');

const SCHEDULES = [
  { id:'s01', time: 6*60,      title:'Daily Ops Pulse',            format:'deck', runner:'Editor',     cadenceId:'daily',     cadenceDetail:'Every day · 06:00',                cronExpr:'0 6 * * *',        enabled:true,  sources:6,  cat:'Operations' },
  { id:'s02', time: 7*60+30,   title:'Overnight Ingest Digest',    format:'doc',  runner:'Summariser', cadenceId:'daily',     cadenceDetail:'Every day · 07:30',                cronExpr:'30 7 * * *',       enabled:true,  sources:18, cat:'Knowledge'  },
  { id:'s03', time: 9*60,      title:'Weekly Ops Review',          format:'deck', runner:'Researcher', cadenceId:'weekly',    cadenceDetail:'Tuesdays · 09:00',                 cronExpr:'0 9 * * 2',        enabled:true,  sources:9,  cat:'Operations' },
  { id:'s04', time: 9*60,      title:'Jun Financial Report',       format:'doc',  runner:'Researcher', cadenceId:'monthly',   cadenceDetail:'1st of month · 09:00',             cronExpr:'0 9 1 * *',        enabled:true,  sources:12, cat:'Financial'  },
  { id:'s05', time:11*60,      title:'Sales Performance Summary',  format:'doc',  runner:'Researcher', cadenceId:'weekly',    cadenceDetail:'Tuesdays · 11:00',                 cronExpr:'0 11 * * 2',       enabled:true,  sources:8,  cat:'Financial'  },
  { id:'s06', time:12*60+30,   title:'Voice-of-Customer Summary',  format:'doc',  runner:'Archivist',  cadenceId:'weekly',    cadenceDetail:'Tuesdays · 12:30',                 cronExpr:'30 12 * * 2',      enabled:true,  sources:21, cat:'Customer'   },
  { id:'s07', time:14*60+10,   title:'Research Digest',            format:'video',runner:'Summariser', cadenceId:'daily',     cadenceDetail:'Every day · 14:10',                cronExpr:'10 14 * * *',      enabled:true,  sources:12, cat:'Knowledge'  },
  { id:'s08', time:16*60,      title:'SLA & Uptime Report',        format:'deck', runner:'Editor',     cadenceId:'weekly',    cadenceDetail:'Tuesdays · 16:00',                 cronExpr:'0 16 * * 2',       enabled:true,  sources:7,  cat:'Operations' },
  { id:'s09', time:17*60+30,   title:'Investor Update',            format:'doc',  runner:'Summariser', cadenceId:'monthly',   cadenceDetail:'1st of month · 17:30',             cronExpr:'30 17 1 * *',      enabled:true,  sources:16, cat:'Executive'  },
  { id:'s10', time:18*60,      title:'Headcount & Cost Snapshot',  format:'doc',  runner:'Editor',     cadenceId:'weekly',    cadenceDetail:'Tuesdays · 18:00',                 cronExpr:'0 18 * * 2',       enabled:false, sources:7,  cat:'Operations' },
  { id:'s11', time:19*60+30,   title:'Burn & Runway Snapshot',     format:'deck', runner:'Researcher', cadenceId:'custom',    cadenceDetail:'Every 2 weeks (Tue) · 19:30',      cronExpr:'30 19 * * 2/2',    enabled:true,  sources:10, cat:'Financial'  },
];

Object.assign(window, { SCHEDULES, SCHED_NOW, SCHED_DAY, hhmm, pad2 });
