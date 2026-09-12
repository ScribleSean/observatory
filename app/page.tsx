'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsCoverage } from '../scripts/settings-coverage.mjs';
import { estimate } from '../scripts/api-estimate.mjs';
import { freshness } from '../scripts/freshness.mjs';
import { needsWindowsSetup } from '../scripts/setup-state.mjs';
import WeekTimeline from './week-timeline';
import ToolDetail from './tool-detail';
import Dictation, {type DictationSource} from './dictation';
import { selectTokenDays, aggregateProfiles } from '../scripts/token-periods.mjs';
import telescopeMark from '../public/brand/telescope.svg';
import {imageSource} from '../scripts/image-source.mjs';
import {
  Activity,
  Layers3,
  Workflow,
  Database,
  RefreshCw,
  Monitor,
  Laptop,
  ArrowUpRight,
  Check,
  CircleHelp,
  Terminal,
  Globe,
  Code2,
  Shapes,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Mic,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type Tokens = {
  startDate?: string;
  endDate?: string;
  recordedDays?: number;
  apiEstimate?: { usd: number | null; coveredTokens: number; excluded: number; checked: string };
  date: string;
  totalTokens: number | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;
  models: { model: string; inferred: boolean; inputTokens?: number | null; cacheReadTokens?: number | null; cacheCreationTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null; apiEstimate?: { usd: number | null; parts?:Record<string,number>|null } }[];
};
type ActivityRow = {
  asOf?:string|null;
  latestReadStatus?:string;
  maxDates?:number;
  host: string;
  status: string;
  checkedAt?: string;
  categories?: Record<string, number>;
  latestEvent?: string;
  start?: string;
  end?: string;
  days?: { date: string; seconds: number; hours: number[]; trackedSeconds?:number;trackedHours?:number[];categories: Record<string, number>; apps?:Record<string,Record<string,number>> }[];
};
type Agent = {
  role?:string;
  failure?: string | null;
  id: string;
  model: string;
  status: string;
  seconds: number | null;
  total: number | null;
  recordedAt: string;
};
type Report = {
  dictation?:DictationSource[];
  activityHistory?:ActivityRow[];
  agentSource?:{status:string;checkedAt?:string;skipped:number;limited:boolean};
  quota?: {status:string;checkedAt?:string;windows?:{bucket:string;window:string;remainingPercent:number;durationMinutes:number|null;resetsAt:string|null}[]};
  localModel?: {status:string;checkedAt?:string;records?:{model:string;status:string;recordedAt:string|null;seconds:number|null;input:number|null;cached:number|null;output:number|null;ttft:number|null;peakGpuMiB:number|null}[]};
  settings?: {host:string;status:string;checkedAt?:string;snapshotStable?:boolean;profiles?:{date:string;model:string;effort:string;speed:string;totalTokens:number;inputTokens:number;cacheReadTokens:number;cacheCreationTokens:number;outputTokens:number}[];tools?:{date:string;category:string;count:number;tool?:string|null;namespace?:string}[]}[];
  combinedTokens?: {host:string;status:string;days?:Tokens[];verification?:{status:string}};
  combinedSettings?: NonNullable<Report['settings']>[number];
  combined?: ActivityRow;
  demo?: boolean;
  collectedAt: string;
  activity: ActivityRow[];
  tokens: { host: string; status: string; checkedAt?:string; days?: Tokens[] }[];
  agents: Agent[];
};
type Collector = {state:'running'|'ok'|'partial'|'failed';startedAt:string;finishedAt?:string|null;intervalSeconds:number;maxRunSeconds:number};
const fmt = (n: number | null | undefined) =>
  n == null ? 'Unknown' : new Intl.NumberFormat('en-US').format(n);
const compact = (n: number) =>
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
const time = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
};
const shiftDate = (date: string, days: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dateLabel = (date: string) => date ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',timeZone:'UTC'}) : 'No records';
const sum = (c: Record<string, number> | undefined) =>
  Object.values(c || {}).reduce((s, n) => s + n, 0);
const icons: Record<string, typeof Activity> = {
  'AI apps': Workflow,
  Editors: Code2,
  'Mixed activity': Layers3,
  Coding: Code2,
  Terminal,
  Browser: Globe,
  Other: Shapes,
};
const views = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'tokens', label: 'Tokens', icon: Layers3 },
  { id: 'dictation', label: 'Dictation', icon: Mic },
  { id: 'agents', label: 'Agents', icon: Workflow },
  { id: 'sources', label: 'Sources', icon: Database },
];
function State({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <CircleHelp size={28} />
      <p>{children}</p>
    </div>
  );
}
export default function Home() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const sync = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('usage-theme'); } catch {}
      const next = saved !== 'light';
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      setDark(next);
    };
    sync();
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('storage', sync); };
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('usage-theme', next ? 'dark' : 'light'); } catch {}
  };
  const [data, setData] = useState<Report | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true);
  const [collector,setCollector] = useState<Collector|null>(null);
  const [setupRequired,setSetupRequired] = useState(false);
  const [now,setNow] = useState(0);
  const inFlight = useRef(false);
  const [view, setView] = useState('activity'),
    [host, setHost] = useState('Combined'),
    [selectedDate, setSelectedDate] = useState(''),
    [period, setPeriod] = useState('day'),
    [tokenHost, setTokenHost] = useState('All'),
    [tokenDate, setTokenDate] = useState(''),
    [tokenPeriod, setTokenPeriod] = useState('day'),
    [mobile, setMobile] = useState(false);
  const load = useCallback(async (silent=false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const [r,status,setup] = await Promise.all([
        fetch('./local/usage.json', { cache: 'no-store', signal:AbortSignal.timeout(10000) }).catch(()=>null),
        fetch('./local/collector.json', { cache: 'no-store', signal:AbortSignal.timeout(10000) }).then(async r=>r.ok?await r.json() as Collector:null).catch(()=>null),
        fetch('./local/setup.json', { cache: 'no-store', signal:AbortSignal.timeout(10000) }).then(async r=>r.ok?await r.json():null).catch(()=>null),
      ]);
      setSetupRequired(needsWindowsSetup(setup));
      if (!r?.ok) throw Error();
      const v = (await r.json()) as Report;
      if (
        !v ||
        !Array.isArray(v.activity) ||
        !Array.isArray(v.tokens) ||
        !Array.isArray(v.agents) || !Number.isFinite(Date.parse(v.collectedAt))
      )
        throw Error();
      setData(previous=>previous && Date.parse(previous.collectedAt)>=Date.parse(v.collectedAt)?previous:v);
      setCollector(status && ['running','ok','partial','failed'].includes(status.state) && Number.isFinite(Date.parse(status.startedAt)) && [0,300].includes(status.intervalSeconds) && status.maxRunSeconds===240 ? status : null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setNow(Date.now());
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const hash = location.hash.slice(1);
    if (views.some((v) => v.id === hash)) setView(hash);
    const q = matchMedia('(max-width: 700px)');
    setMobile(q.matches);
    const changed = () => setMobile(q.matches);
    q.addEventListener('change', changed);
    const refresh = () => {
      setNow(Date.now());
      if (document.visibilityState==='visible') void load(true);
    };
    const timer = setInterval(refresh,30000);
    document.addEventListener('visibilitychange',refresh);
    return () => {
      q.removeEventListener('change', changed);
      clearInterval(timer);
      document.removeEventListener('visibilitychange',refresh);
    };
  }, [load]);
  const liveActivity = data ? [...(data.combined ? [data.combined] : []), ...data.activity] : [];
  const activitySources = liveActivity.map(source=>{
    const retained=data?.activityHistory?.find(r=>r.host===source.host);
    return retained && (period==='all' || (selectedDate && selectedDate<(source.days?.[0]?.date || ''))) ? retained : source;
  });
  const current = activitySources.find((a) => a.host === host) || activitySources[0];
  const activeDate = selectedDate || current?.days?.at(-1)?.date || '';
  const dailyActivity = current?.days?.find(d => d.date === activeDate);
  const weekDays = activeDate ? Array.from({length:7},(_,i) => {
    const date = shiftDate(activeDate, i-6);
    return {date, record:current?.days?.find(d => d.date === date)};
  }) : [];
  const weeklyCategories: Record<string, number> = {};
  const shownApps: Record<string,Record<string,number>> = {};
  const shownRecords=period==='all'?current?.days||[]:period==='week'?weekDays.map(d=>d.record):[dailyActivity];
  shownRecords.forEach(record=>Object.entries(record?.apps||{}).forEach(([category,apps])=>{
    shownApps[category] ||= {};
    Object.entries(apps).forEach(([app,n])=>{shownApps[category][app]=(shownApps[category][app]||0)+n;});
  }));
  shownRecords.forEach(record => Object.entries(record?.categories || {}).forEach(([k,v]) => {weeklyCategories[k] = (weeklyCategories[k] || 0) + v;}));
  const shownCategories = period !== 'day' && current?.days ? weeklyCategories : dailyActivity?.categories || (current?.days ? undefined : current?.categories);
  const earliest = current?.days?.[0]?.date, newest = current?.days?.at(-1)?.date;
  const previousDate = activeDate ? shiftDate(activeDate,period === 'week' ? -7 : -1) : '';
  const nextDate = activeDate ? shiftDate(activeDate,period === 'week' ? 7 : 1) : '';
  const seconds = sum(shownCategories),
    clock = time(seconds);
  const tokenSources = data ? [data.combinedTokens || {host:'All',status:'unverified'},...data.tokens] : [];
  const tokenSource = tokenSources.find((t) => t.host === tokenHost),
    days = tokenSource?.days || [],
    tokenAnchor = tokenDate || days.at(-1)?.date || '',
    latest: Tokens | undefined = tokenAnchor ? selectTokenDays(days,tokenPeriod,tokenAnchor) : undefined;
  const tokenStart = tokenPeriod==='all' ? days[0]?.date : tokenPeriod==='week' ? shiftDate(tokenAnchor || '2000-01-01',-6) : tokenAnchor;
  const tokenEnd = tokenPeriod==='all' ? days.at(-1)?.date : tokenAnchor;
  const tokenLabel = tokenPeriod==='day' ? dateLabel(tokenAnchor) : `${dateLabel(tokenStart || '')} to ${dateLabel(tokenEnd || '')}`;
  const tokenPrevious=tokenAnchor?shiftDate(tokenAnchor,tokenPeriod==='week'?-7:-1):'';
  const tokenNext=tokenAnchor?shiftDate(tokenAnchor,tokenPeriod==='week'?7:1):'';
  const sourceRows = data ? [
    ...(data.dictation||[]).map(s=>({host:s.host,kind:`${s.source || 'TypeWhisper'} aggregates`,status:s.status,checkedAt:s.checkedAt})),
    ...(data.agentSource?[{host:'Local',kind:'Handoff receipts',status:data.agentSource.status,checkedAt:data.agentSource.checkedAt}]:[]),
    ...data.activity.map(a=>({...a,kind:'ActivityWatch'})), ...data.tokens.map(t=>({...t,kind:'Codex logs'})),
    ...(data.quota?[{host:'Codex account',kind:'Limits snapshot',status:data.quota.status,checkedAt:data.quota.checkedAt}]:[]),
    ...(data.localModel?[{host:'Ubuntu',kind:'Local model receipts',status:data.localModel.status,checkedAt:data.localModel.checkedAt}]:[]),
    ...(data.settings||[]).map(s=>({host:s.host,kind:'Settings & tool metadata',status:s.status,checkedAt:s.checkedAt}))
  ] : [];
  const sourceCount=sourceRows.filter(x=>x.status==='ok').length;
  const sourceTotal=sourceRows.length;
  const settingsSource=tokenHost==='All'?data?.combinedSettings:data?.settings?.find(s=>s.host===tokenHost);
  const localRecords=data?.localModel?.records || [];
  const providerWindows=data?.quota?.windows || [];
  const snapshotAge=freshness(data?.collectedAt,now || Date.now());
  const collectorAge=freshness(collector?.startedAt,now || Date.now(),collector?.maxRunSeconds || 240);
  const collectorRunning=collector?.state==='running' && collectorAge.state==='recent';
  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            <img src={imageSource(telescopeMark)} width="28" height="28" alt=""/>
          </span>
          <span>
            <span className="wordmark-detail">Workspace </span>Observatory
          </span>
        </div>
        <div className="app-actions">
          <span className="local-label">
            <i />
            {data?.demo ? 'Synthetic demo' : 'Private dashboard'}
          </span>
          <Button
            variant="ghost"
            className="reload"
            aria-label={loading ? 'Loading snapshot' : 'Reload snapshot'}
            onClick={() => void load()}
            disabled={loading}
            title="Check for a newer saved snapshot. This page also checks automatically while visible."
          >
            <RefreshCw size={18} />
            <span>{loading ? 'Loading' : 'Reload snapshot'}</span>
          </Button>
          <Button variant="ghost" className="theme-toggle" onClick={toggleTheme}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          </Button>
        </div>
      </header>
      <Tabs
        value={view}
        onValueChange={(v) => {
          if (typeof v === 'string') {
            setView(v);
            history.replaceState(null, '', '#' + v);
            window.scrollTo(0, 0);
          }
        }}
        orientation={mobile ? 'horizontal' : 'vertical'}
        className="workspace-tabs"
      >
        <TabsList className="nav-rail" aria-label="Usage views">
          {views.map((v) => (
            <TabsTrigger className="rail-item" key={v.id} value={v.id}>
              <span className="rail-icon">
                <v.icon size={23} />
              </span>
              <span>{v.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <main className="workspace-body">
          <div className="context-line">
            <span>WORKSPACE USAGE</span>
            <span className={snapshotAge.state==='stale'?'snapshot-stale':''} title={data?new Date(data.collectedAt).toLocaleString():undefined}>
              {data
                ? data.demo?'Fictional sample records':'Collected ' + snapshotAge.label
                : 'Waiting for snapshot'}
            </span>
          </div>
          {data && !data.demo && !error && (snapshotAge.state==='stale' || collector?.state==='failed' || (collector?.state==='running' && !collectorRunning)) && <p className="error-banner" role="status">
            {collector?.state==='failed'?'The last collection failed. Showing the most recent saved snapshot.':collector?.state==='running'&&!collectorRunning?'Collection has not reported completion. The saved snapshot may be out of date.':'This snapshot is over 10 minutes old. The collector may be stopped or the hosting Mac asleep.'}
          </p>}
          {error && !(setupRequired && !data) && (
            <p className="error-banner" role="alert">
              Could not reload.{' '}
              {data
                ? 'Showing the previous snapshot.'
                : 'Refresh sources on the collecting device, then reload.'}
            </p>
          )}
          {!data ? (
            <State>
              {loading
                ? 'Reading your local snapshot…'
                : setupRequired ? 'Set up Windows collection to create your first snapshot. Right-click the Observatory system-tray icon (check the hidden-icons arrow), then choose Configure local collection. Ubuntu and Wispr are optional. After collection finishes, choose Reload snapshot. Mac pairing is not required.'
                : 'No snapshot available yet.'}
            </State>
          ) : (
            <>
              <TabsContent value="activity" className="view-panel">
                <div className="view-heading">
                  <div>
                    <h1>Activity</h1>
                    <p>Recorded app activity, with away time removed.</p>
                  </div>
                  <div className="period-controls">
                    <ToggleGroup value={[period]} onValueChange={v => v[0] && setPeriod(v[0])} aria-label="Activity period" className="period-switch">
                      <ToggleGroupItem value="day">Day</ToggleGroupItem>
                      <ToggleGroupItem value="week">Week</ToggleGroupItem>
                      <ToggleGroupItem value="all">All time</ToggleGroupItem>
                    </ToggleGroup>
                    <div className="date-navigation">
                      <Button variant="ghost" aria-label={`Previous ${period}`} disabled={period==='all'||!earliest || previousDate < earliest} onClick={() => setSelectedDate(previousDate)}><ChevronLeft size={18}/></Button>
                      <span aria-live="polite">{period==='all'?`${dateLabel(earliest||'')} to ${dateLabel(newest||'')}`:period === 'week' && activeDate ? `${dateLabel(shiftDate(activeDate,-6))} to ${dateLabel(activeDate)}` : dateLabel(activeDate)}</span>
                      <Button variant="ghost" aria-label={`Next ${period}`} disabled={period==='all'||!newest || nextDate > newest} onClick={() => setSelectedDate(nextDate)}><ChevronRight size={18}/></Button>
                    </div>
                    <small>New York time</small>
                  </div>
                </div>
                <Tabs
                  value={host}
                  onValueChange={(v) => typeof v === 'string' && setHost(v)}
                  className="host-tabs"
                >
                  <TabsList
                    className="connected-buttons"
                    aria-label="Activity device"
                  >
                    {activitySources.map((a) => (
                      <TabsTrigger value={a.host} key={a.host}>
                        <span className="device-icon">
                          {a.host === 'Mac' ? (
                            <Laptop size={18} />
                          ) : (
                            <Monitor size={18} />
                          )}
                        </span>
                        <span className="device-name">{a.host}</span>
                        <span className="device-time">
                          {period === 'day' && a.status === 'ok'
                            ? (sum(a.days?.find(d => d.date === activeDate)?.categories || (a.days ? {} : a.categories)) / 3600).toFixed(1) + 'h'
                            : period === 'week' && a.status === 'ok' ? '7 days' : period==='all'&&a.status==='ok'?'Retained':'Unknown'}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                <TabsContent value={host}>
                {period==='all' && <p className="quiet-note">All retained daily summaries, up to {current?.maxDates||3650} dates per view. Collection began with the available seven-day window, not the complete ActivityWatch archive. Gaps do not mean idle time.</p>}
                {current?.latestReadStatus && current.latestReadStatus!=='ok' && <p className="quiet-note">The latest source read failed. Showing retained history as of {current.asOf?new Date(current.asOf).toLocaleString():'an unknown time'}.</p>}
                {period==='all' && !!current?.days?.length && <details className="receipt-panel"><summary>Browse retained dates</summary><div className="history-dates">{[...current.days].reverse().map(day=><Button key={day.date} variant="ghost" onClick={()=>{setSelectedDate(day.date);setPeriod('day');}}>{day.date} · {day.trackedSeconds===0&&day.seconds===0?'No tracking records':`${time(day.seconds).hours}h ${time(day.seconds).minutes}m`}</Button>)}</div></details>}
                {period === 'week' && <WeekTimeline key={host} days={weekDays} onOpenDay={date=>{setSelectedDate(date);setPeriod('day');window.scrollTo(0,0);}}/>}
                {period === 'day' && dailyActivity && <section className="daily-timeline" aria-label="Recorded activity by hour">
                  <div className="hour-track">{dailyActivity.hours.map((n, hour) => <span key={hour}
                    style={{ opacity: n ? 0.25 + 0.75 * Math.min(1, n / 3600) : 0.08 }}
                    title={`${hour}:00, ${Math.round(n / 60)} minutes recorded`} />)}</div>
                  <div className="hour-labels"><span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span></div>
                  <p>Recorded active minutes per hour. Gaps can mean idle time or missing records.</p>
                </section>}
                {current?.status === 'ok' && shownCategories ? (
                  <div className="activity-layout">
                    <section className="time-surface">
                      <div className="surface-label">
                        <Activity size={19} />
                        <span>{current.host === 'Combined' ? 'Across both devices' : `Active on ${current.host}`}</span>
                      </div>
                      <div className="big-time">
                        {clock.hours}
                        <span>h</span> {clock.minutes}
                        <span>m</span>
                      </div>
                      <p>{period==='all'?'Across retained daily summaries. Coverage may be partial.':period === 'week' ? 'Recorded in this seven-day window. Coverage may be partial.' : dailyActivity ? `Recorded on ${activeDate}` : 'Across the recorded seven-day window'}</p>
                      <div
                        className="segmented-track"
                        aria-label="Activity category proportions"
                      >
                        {Object.entries(shownCategories)
                          .filter(([, v]) => v > 0)
                          .map(([k, v]) => (
                            <span
                              key={k}
                              className={'segment ' + k.toLowerCase().replaceAll(' ', '-')}
                              style={{ flex: v }}
                              title={k + ': ' + Math.round(v / 60) + ' min'}
                            />
                          ))}
                      </div>
                      <div className="surface-bottom">
                        <span>Foreground ≠ focus</span>
                        <span>{current.host === 'Combined' ? 'Overlap counted once' : 'One device'}</span>
                      </div>
                    </section>
                    <section
                      className="category-surface"
                      aria-label="Time by app category"
                    >
                      {Object.entries(shownCategories)
                        .filter(([,v])=>v>0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => {
                          const Icon = icons[k] || Shapes;
                          return (
                            <div className="category-row" key={k}>
                              <span
                                className={'category-icon ' + k.toLowerCase().replaceAll(' ', '-')}
                              >
                                <Icon size={21} />
                              </span>
                              <div className="category-name">
                                <strong>{k === 'Mixed activity' ? 'Device overlap' : k}</strong>
                                <span>
                                  {seconds && v / seconds * 100 < 1 ? '<1' : seconds ? Math.round(v / seconds * 100) : 0}
                                  % of recorded activity
                                </span>
                                {k === 'AI apps' && <p className="category-explanation">Active foreground app time, not model execution time.</p>}
                                {k === 'Mixed activity' && <p className="category-explanation">Different categories were active at once. Counted once, without guessing your attention.</p>}
                                {shownApps[k] && k !== 'Mixed activity' && <details className="app-breakdown" open={k === 'AI apps'}>
                                  <summary>By app</summary>
                                  {Object.entries(shownApps[k]).sort((a,b)=>b[1]-a[1]).map(([app,n])=><div key={app} className="app-breakdown-row"><span>{app}</span><span>{n<60?'<1m':`${time(n).hours?time(n).hours+'h ':''}${time(n).minutes}m`}</span><i aria-hidden="true"><i style={{width:`${Math.min(100,n/v*100)}%`}}/></i></div>)}
                                  {Object.keys(shownApps[k]).includes('ChatGPT / Codex') && <small>The desktop app shares one process label, so these modes cannot be separated from foreground records.</small>}
                                </details>}
                              </div>
                              <span className="category-value">
                                {v < 60 ? '<1m' : <>{time(v).hours}<small>h</small> {time(v).minutes}<small>m</small></>}
                              </span>
                            </div>
                          );
                        })}
                    </section>
                  </div>
                ) : (
                  <State>
                    This device’s activity source is unavailable. Its activity is unknown, not zero.
                  </State>
                )}
                </TabsContent>
                </Tabs>
                <div className="lower-strip">
                  <div>
                    <span className="status-dot" />
                    <strong>{sourceCount}/{sourceTotal} sources read</strong>
                    <span>Collector snapshot</span>
                  </div>
                  <p>
                    Recognized app labels only. Window titles stay on their devices.
                  </p>
                </div>
                <details className="method-note">
                  <summary>How this is measured</summary>
                  <p>
                    ActivityWatch window intervals are intersected with non-AFK
                    intervals. AI apps and editors are separate categories. Editor time can include AI-assisted work. Foreground time does not
                    prove attention or distinguish automation from human input.
                    The combined view counts simultaneous activity once. Different categories at the same time are labeled mixed activity.
                    Missing collector history is not proof of inactivity. On daylight saving transitions, repeated clock hours share a chart cell.
                  </p>
                  <p>
                    Latest window event began:{' '}
                    {current?.latestEvent
                      ? new Date(current.latestEvent).toLocaleString()
                      : 'unknown'}
                    . Snapshot time is the last collection, not a guarantee that
                    collectors are currently running.
                  </p>
                </details>
              </TabsContent>
              <TabsContent value="tokens" className="view-panel">
                <div className="view-heading">
                  <div>
                    <h1>Tokens</h1>
                    <p>Model workload, not hours worked. Activity shows recorded computer time.</p>
                  </div>
                  <div className="period-controls">
                    <ToggleGroup value={[tokenPeriod]} onValueChange={v=>v[0] && setTokenPeriod(v[0])} aria-label="Token period" className="period-switch">
                      <ToggleGroupItem value="day">Day</ToggleGroupItem>
                      <ToggleGroupItem value="week">Week</ToggleGroupItem>
                      <ToggleGroupItem value="all">All time</ToggleGroupItem>
                    </ToggleGroup>
                    <div className="date-navigation">
                      <Button variant="ghost" aria-label={`Previous token ${tokenPeriod}`} disabled={tokenPeriod==='all'||!days.length||tokenPrevious<days[0].date} onClick={()=>setTokenDate(tokenPrevious)}><ChevronLeft size={18}/></Button>
                      <span aria-live="polite">{tokenLabel}</span>
                      <Button variant="ghost" aria-label={`Next token ${tokenPeriod}`} disabled={tokenPeriod==='all'||!days.length||tokenNext>(days.at(-1)?.date||'')} onClick={()=>setTokenDate(tokenNext)}><ChevronRight size={18}/></Button>
                    </div>
                    <small>New York time</small>
                  </div>
                </div>
                {data.quota && <details className="allowance-panel">
                  <summary>Codex limits <span>{data.quota.status==='ok'?'Latest check':'Unavailable'}</span></summary>
                  {providerWindows.map(w=><div className="allowance-row" key={w.bucket+w.window}>
                    <span>{w.bucket.replaceAll('_',' ')}<small>{w.durationMinutes==null?'Window unknown':w.durationMinutes>=1440?`${(w.durationMinutes/1440).toFixed(0)}-day window`:`${(w.durationMinutes/60).toFixed(1)}-hour window`}</small></span>
                    <strong>{w.remainingPercent.toFixed(1)}% left</strong>
                    <small>Resets {w.resetsAt?new Date(w.resetsAt).toLocaleString():'Unknown'}</small>
                  </div>)}
                  <p>Read from Codex at {data.quota.checkedAt?new Date(data.quota.checkedAt).toLocaleString():'Unknown'}. This is a snapshot, not a live countdown. Bucket IDs come from the service. No resets are redeemed.</p>
                </details>}
                <Tabs
                  value={tokenHost}
                  onValueChange={(v) =>
                    typeof v === 'string' && (setTokenHost(v),setTokenDate(''))
                  }
                  className="host-tabs"
                >
                  <TabsList
                    className="connected-buttons"
                    aria-label="Token source"
                  >
                    {tokenSources.map((t) => (
                      <TabsTrigger key={t.host} value={t.host}>
                        {t.host === 'All' ? <Layers3 size={18}/> : t.host === 'Mac' ? (
                          <Laptop size={18} />
                        ) : (
                          <Terminal size={18} />
                        )}{' '}
                        {t.host}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                <TabsContent value={tokenHost}>
                {tokenSource?.status === 'ok' && latest ? (
                  <div className="token-layout">
                    <section className="token-summary">
                      <span className="surface-label">
                        {tokenPeriod==='all'?'All time':tokenPeriod==='week'?'Selected week':'Selected day'} · {tokenLabel}
                      </span>
                      <div className="token-number">
                        {latest?.totalTokens == null
                          ? 'Unknown'
                          : compact(latest.totalTokens)}
                      </div>
                      <p>Total recorded tokens</p>
                      {tokenPeriod==='all' && <p className="small-note">All available log history, across {latest.recordedDays} recorded dates. Deleted or unlogged requests cannot be recovered.</p>}
                      {tokenHost==='All' && <p className="small-note">Mac + Ubuntu + Windows</p>}
                      <div className="token-parts">
                        <div>
                          <span>Input</span>
                          <strong>{fmt(latest?.inputTokens)}</strong>
                        </div>
                        <div>
                          <span>Cached</span>
                          <strong>{fmt(latest?.cacheReadTokens)}</strong>
                        </div>
                        <div>
                          <span>Output</span>
                          <strong>{fmt(latest?.outputTokens)}</strong>
                        </div>
                      </div>
                      <p className="small-note">
                        Reasoning is included in output.
                      </p>
                      <details className="estimate-note">
                        <summary>API comparison: {latest?.apiEstimate?.usd == null ? 'Unknown' : `$${latest.apiEstimate.usd.toFixed(2)}`} {latest?.apiEstimate?.excluded ? '(partial)' : ''}</summary>
                        <p>Hypothetical standard, short-context token price, not your bill. Covers {fmt(latest?.apiEstimate?.coveredTokens)} tokens. Inferred models and unsupported rates are excluded.</p>
                        <p>Long-context rates, Fast mode, tool fees and unreported cache writes are not estimated. Rates checked {latest?.apiEstimate?.checked || 'not yet'} against <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">OpenAI pricing</a>.</p>
                      </details>
                      {tokenHost==='All' && <section className="host-contributions" aria-label="Contribution by host">
                        <h3>By host</h3>
                        {data.tokens.map(source=>{
                          const day=selectTokenDays(source.days||[],tokenPeriod,tokenAnchor);
                          const amount=day?.totalTokens ?? 0;
                          return <div className="host-contribution" key={source.host}>
                            <span>{source.host}</span><strong>{compact(amount)}<small>{latest?.totalTokens ? `${(amount/latest.totalTokens*100).toFixed(1)}% of tokens`:'No recorded tokens'}</small></strong>
                            <span>{day ? day.apiEstimate?.usd==null?'Price unknown':`$${day.apiEstimate.usd.toFixed(2)}`:'$0.00'}<small>API comparison</small></span>
                            <i aria-hidden="true"><i style={{width:`${latest?.totalTokens?amount/latest.totalTokens*100:0}%`}}/></i>
                          </div>;
                        })}
                        <p>No shared session IDs or cross-host parent links found in this collection. Agent-review receipts and local benchmarks are separate and are not added here.</p>
                      </section>}
                    </section>
                    <section className="table-surface">
                      <div className="table-heading">
                        <h2>By model</h2>
                        <span>{tokenLabel}</span>
                      </div>
                      <div className="model-breakdown">
                        {[...(latest?.models || [])].sort((a,b) => (b.totalTokens || 0) - (a.totalTokens || 0)).map(m => {
                          const reconciled=days.filter(d=>d.date>=(tokenStart||'')&&d.date<=(tokenEnd||'')).flatMap(d=>{
                            const model=d.models.find(row=>row.model===m.model&&row.inferred===m.inferred);
                            return model?settingsCoverage(model,(settingsSource?.profiles||[]).filter(p=>p.date===d.date&&p.model===m.model)).rows:[];
                          });
                          const coverage=settingsCoverage(m,aggregateProfiles(reconciled));
                          return (
                          <details className="model-detail" key={m.model+String(m.inferred)}>
                            <summary>
                              <span className="model-label">{m.model.replace(/^gpt-/,'GPT ').replace(/-(astra|terra|sol|luna)$/i, (_, name: string) => ' ' + name[0].toUpperCase() + name.slice(1))}{m.inferred && <small>Inferred label</small>}</span>
                              <span className="model-amount" title={`${fmt(m.totalTokens)} tokens`}>{m.totalTokens == null ? 'Unknown' : compact(m.totalTokens)}<small>{m.totalTokens != null && latest?.totalTokens ? `${(m.totalTokens / latest.totalTokens * 100).toFixed(1)}% of tokens` : 'Share unknown'}</small></span>
                              <span className="model-price">{m.apiEstimate?.usd == null ? 'API estimate unknown' : `$${m.apiEstimate.usd.toFixed(2)} standard API`}{m.apiEstimate?.usd != null && latest?.apiEstimate?.usd ? <small>{(m.apiEstimate.usd/latest.apiEstimate.usd*100).toFixed(1)}% of priced usage</small>:null}</span>
                              <span className="model-share" aria-hidden="true"><span style={{width: `${Math.min(100, Math.max(0, (m.totalTokens || 0) / (latest?.totalTokens || 1) * 100))}%`}} /></span>
                              <ChevronRight className="model-expand" size={16} aria-hidden="true" />
                            </summary>
                            <p className="model-id">{m.model} · {fmt(m.totalTokens)} tokens</p>
                            <dl className="model-counts">
                              <div><dt>Uncached input</dt><dd>{fmt(m.inputTokens)}</dd></div>
                              <div><dt>Cached input</dt><dd>{fmt(m.cacheReadTokens)}</dd></div>
                              <div><dt>Cache writes</dt><dd>{fmt(m.cacheCreationTokens)}</dd></div>
                              <div><dt>Output</dt><dd>{fmt(m.outputTokens)}</dd></div>
                            </dl>
                            <p className="model-estimate">API comparison: {m.apiEstimate?.usd == null ? 'Unknown' : `$${m.apiEstimate.usd.toFixed(2)}`}<span>Not actual spend. Standard short-context scenario.</span></p>
                            {m.apiEstimate?.parts && <dl className="model-counts">{Object.entries(m.apiEstimate.parts).map(([part,usd])=><div key={part}><dt>{({input:'Input',cached:'Cache reads',cacheWrites:'Cache writes',output:'Output'} as Record<string,string>)[part]} estimate</dt><dd>${usd.toFixed(2)}</dd></div>)}</dl>}
                            <section className="settings-breakdown" aria-label="Recorded reasoning and speed">
                              <h3>Reasoning & speed</h3>
                              {coverage.rows.length ? <>
                                {coverage.rows.map((p: NonNullable<NonNullable<Report['settings']>[number]['profiles']>[number])=>{
                                  const standard=estimate([p]).usd;
                                  const cost=standard==null || p.speed==='unknown'?null:standard*(p.speed==='fast'?2:1);
                                  return <div className="settings-row" key={p.effort+p.speed}><span>{p.effort === 'unknown'?'Unknown effort':p.effort} · {p.speed === 'unknown'?'Unknown speed':p.speed}</span><strong>{compact(p.totalTokens)}<small>{m.totalTokens?`${(p.totalTokens/m.totalTokens*100).toFixed(1)}% of model tokens`:''}</small></strong><small>{cost==null?'Price unknown':`$${cost.toFixed(2)} API scenario`}</small></div>;
                                })}
                                {coverage.status==='partial' && <p>{fmt((m.totalTokens||0)-coverage.knownTokens)} tokens have no reconciled settings in this scan.</p>}
                                <p>Recorded settings, not measured reasoning time. Fast uses the published 2× short-context rates. Unknown tiers are not priced.</p>
                              </>:<p>{settingsSource?.snapshotStable===false?'Usage changed during collection. Settings detail will return after a stable collection.':coverage.status==='unreconciled'?'Settings counters do not yet match this daily report. Breakdown withheld instead of forcing the numbers.':'No matching recorded settings for this model and date.'}</p>}
                            </section>
                          </details>
                        );})}
                        {!latest?.models.length && <p>No model breakdown in this report.</p>}
                      </div>
                      <details className="model-history">
                        <summary>Choose another recorded day</summary>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="align-right">
                              Total tokens
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...days].reverse().map((d) => (
                            <TableRow key={d.date}>
                              <TableCell><Button variant="ghost" aria-pressed={tokenPeriod==='day' && tokenAnchor === d.date} onClick={() => {setTokenDate(d.date);setTokenPeriod('day');}}>{d.date}</Button></TableCell>
                              <TableCell className="align-right">
                                {fmt(d.totalTokens)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      </details>
                    </section>
                  </div>
                ) : (
                  <State>
                    {tokenSource?.status === 'ok'
                      ? 'No token records in this period. Select another date or All time.'
                      : tokenHost==='All' ? tokenSource?.status==='overlap'?'These hosts contain shared or related session records. The All total is withheld to avoid double-counting. Individual host views remain available.':'An All total needs three successful token reads and a complete cross-host overlap check. Individual host views remain available.' : tokenSource?.status === 'not-connected' ? 'This token source is not connected to this dashboard.' : 'This token source is unavailable.'}
                  </State>
                )}
                </TabsContent>
                </Tabs>
                <details className="method-note">
                  <summary>Models & counting rules</summary>
                  <p>
                    Models in this period:{' '}
                    {latest?.models
                      .map((m) => m.model + (m.inferred ? ' (inferred)' : ''))
                      .join(', ') || 'No model records'}
                    . Totals come from saved Codex usage records. Cached tokens can
                    dominate. All combines these three Codex log sources only after a cross-host session and parent-link overlap check. If overlap is detected, the combined total is withheld. This does not prove the underlying provider logs capture every request.
                    These are the latest recorded dates, which may have gaps. API comparisons are hypothetical and partial, not actual spending or remaining quota.
                  </p>
                </details>
              </TabsContent>
              <TabsContent value="agents" className="view-panel">
                <div className="view-heading">
                  <div>
                    <h1>Agent work</h1>
                    <p>Agent requests and their recorded results.</p>
                  </div>
                  <span className="source-caption">Saved handoff receipts</span>
                </div>
                <section className="agent-list">
                  {data.agents.map((a) => (
                    <article className="agent-row" key={a.id}>
                      <span
                        className={
                          'agent-icon ' + (a.status === 'failed' ? 'warn' : '')
                        }
                      >
                        <Workflow size={23} />
                      </span>
                      <div className="agent-identity">
                        <h2>{a.model}</h2>
                        <p>
                          {new Date(a.recordedAt).toLocaleDateString()} · latest
                          conversation snapshot
                        </p>
                        <p>Role: {a.role || 'Unknown'}</p>
                        {a.failure && <p>{a.failure}</p>}
                      </div>
                      <div className="agent-metric">
                        <strong>
                          {a.seconds?.toFixed(1) ?? 'Unknown'}
                          <small> s</small>
                        </strong>
                        <span>Latest call</span>
                      </div>
                      <div className="agent-metric">
                        <strong>
                          {a.total == null ? 'Unknown' : compact(a.total)}
                        </strong>
                        <span>Reported tokens</span>
                      </div>
                      <span
                        className={
                          'run-state ' + (a.status === 'failed' ? 'warn' : '')
                        }
                      >
                        {a.status === 'failed' ? 'Failed' : 'Returned'}
                      </span>
                    </article>
                  ))}
                </section>
                {!data.agents.length && (
                  <State>{data.agentSource && data.agentSource.status!=='ok'?'Handoff receipts could not be fully read. Missing records are not zero usage.':'No handoff receipts found in the configured folder.'}</State>
                )}
                {data.agentSource && data.agentSource.status!=='ok' && data.agents.length>0 && <p className="quiet-note">Receipt coverage is incomplete. Some files were unreadable or a scan limit was reached.</p>}
                <p className="small-note">Only top-level usage receipts in the configured folder are included. This is not a complete history of all agents or providers.</p>
                <div className="quiet-note">
                  <CircleHelp size={18} />
                  <p>
                    A returned response is not a review pass. Failed-call token
                    usage is unknown.
                  </p>
                </div>
                <details className="method-note">
                  <summary>What these records cover</summary>
                  <p>
                    These are existing Antigravity review receipts, not every agent or
                    terminal command. One newest snapshot per conversation
                    avoids adding cumulative counters twice. Duration is the
                    latest call, not total conversation time. The selected model
                    name is a request record, not independent proof of the
                    serving model.
                  </p>
                </details>
                {data.localModel && <section className="receipt-panel">
                  <h2>Local model runs</h2>
                  <p>Saved benchmark measurements, separate from cloud tokens and your active time.</p>
                  {data.localModel.status==='ok' ? [...new Set(localRecords.map(r=>r.model))].map(model=>{
                    const rows=localRecords.filter(r=>r.model===model);
                    const durations=rows.map(r=>r.seconds).filter((n):n is number=>n!=null);
                    const output=rows.map(r=>r.output).filter((n):n is number=>n!=null);
                    const peaks=rows.map(r=>r.peakGpuMiB).filter((n):n is number=>n!=null);
                    return <details key={model} className="local-model-detail"><summary><strong>{model}</strong><span>{rows.length} recorded calls</span></summary>
                      <dl className="model-counts"><div><dt>Completed calls</dt><dd>{rows.filter(r=>r.status==='complete').length}/{rows.length}</dd></div><div><dt>Reported output tokens</dt><dd>{output.length?fmt(output.reduce((a,b)=>a+b,0)):'Unknown'}{output.length!==rows.length?' (partial)':''}</dd></div><div><dt>Reply duration range</dt><dd>{durations.length?`${Math.min(...durations).toFixed(2)} to ${Math.max(...durations).toFixed(2)} s`:'Unknown'}</dd></div><div><dt>Peak total GPU memory</dt><dd>{peaks.length?`${(Math.max(...peaks)/1024).toFixed(2)} GiB`:'Unknown'}</dd></div></dl>
                      <p>Includes recorded cold and warm calls. GPU memory is total device use, not model-only memory. This does not indicate a model is running now or assign an API price.</p>
                    </details>;
                  }):<p>Local receipts unavailable.</p>}
                </section>}
                {!!data.settings?.length && <details className="receipt-panel tool-panel"><summary>Recorded tool calls</summary><p>Recent saved Codex logs only. Counts are requests, not proof of successful execution or time worked. General SSH commands and unlogged tools are not captured. Hosts are not added together.</p>
                  <p>Expand a tool for dated counts. Names and namespaces come from recorded metadata. Calls nested inside a wrapper are not inferred from its code or arguments.</p>
                  {data.settings.map(source=><div key={source.host} className="tool-host"><h3>{source.host}</h3>{source.status==='ok'?<ToolDetail rows={source.tools}/>:<p>Unavailable</p>}</div>)}
                </details>}
              </TabsContent>
              <TabsContent value="dictation" className="view-panel"><Dictation sources={data.dictation}/></TabsContent>
              <TabsContent value="sources" className="view-panel">
                <div className="view-heading">
                  <div>
                    <h1>Sources</h1>
                    <p>See which sources are connected and what is still missing.</p>
                  </div>
                  <span className="period-chip">{sourceCount}/{sourceTotal} read</span>
                </div>
                <div className="source-grid">
                  {sourceRows.map((s) => (
                    <div className="source-row" key={s.host + s.kind}>
                      <span className="source-icon">
                        <Database size={20} />
                      </span>
                      <div>
                        <h2>{s.host}</h2>
                        <p>{s.kind}</p>
                        <small className="source-age">{s.checkedAt?'Checked '+freshness(s.checkedAt,now || Date.now()).label:'Check time unavailable'}</small>
                      </div>
                      <span
                        className={
                          'run-state ' + (s.status === 'ok' && freshness(s.checkedAt,now || Date.now()).state!=='stale' ? '' : 'warn')
                        }
                      >
                        {s.status === 'ok' ? (
                          <>
                            <Check size={15} /> {freshness(s.checkedAt,now || Date.now()).state==='stale'?'Read · stale':'Read'}
                          </>
                        ) : (
                          'Unavailable'
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <section className="collection-panel" aria-label="Background collection">
                  <h2>Background collection</h2>
                  <p>{data.demo?'This public demo uses fixed fictional records. No devices, accounts or collectors are connected.':collector?.intervalSeconds===300?'Expected every 5 minutes while the collecting device is awake and collection is enabled.':'No recent scheduled-run status. Check the native app or your configured collector.'}</p>
                  {collector && <div className="collection-status"><span className={'run-state '+(collector.state==='failed'||collector.state==='partial'?'warn':'')}>{collectorRunning?'Collecting saved records':collector.state==='running'?'Completion overdue':collector.state==='ok'?'Last run complete':collector.state==='partial'?'Some sources unavailable':'Last run failed'}</span><span>{collector.finishedAt?'Finished '+freshness(collector.finishedAt,now || Date.now()).label:'Started '+collectorAge.label}</span></div>}
                  <p>The page checks for a newer snapshot every 30 seconds while visible. Browsing the dashboard does not launch collection or model tasks.</p>
                </section>
                <section className="coverage-panel">
                  <h2>Coverage still missing</h2>
                  <div className="coverage-tags">
                    {[
                      ...(data.quota?.status==='ok'?['Other provider limits']:['Codex limits']),
                      'Unlogged SSH commands',
                      ...(data.localModel?.status==='ok'?[]:['Local model receipts']),
                      'iPhone activity',
                      'Gemini web usage',
                    ].map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </div>
                  <p>
                    Codex tool metadata is partial history, not a system-wide recorder. iPhone activity and Gemini website tokens need separate collection methods. No browser cookies, prompts or command arguments are collected.
                  </p>
                </section>
                <details className="method-note">
                  <summary>Refresh & privacy</summary>
                  <p>
                    Collection runs on the collecting device, not in this page. The desktop app provides Refresh sources and optional launch at login. Overlapping runs are skipped, and a run is limited to four minutes. The page retains its last snapshot if a reload fails. Personal config and data are
                    excluded from the public repo. Raw titles, prompts, commands
                    and credentials are never stored here.
                  </p>
                </details>
              </TabsContent>
            </>
          )}
          <footer>
            <span>{data?.demo?'Synthetic data only. No personal activity or account records.':'Saved records stay on the dashboard host.'}</span>
            <a
              href="https://github.com/ScribleSean/workspace-observatory"
              target="_blank"
              rel="noreferrer"
            >
              Source <ArrowUpRight size={15} />
            </a>
          </footer>
        </main>
      </Tabs>
    </div>
  );
}
