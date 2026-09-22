'use client';
import {useEffect, useState} from 'react';
import {quotaPace} from '../scripts/quota-pace.mjs';
import {durationText} from '../scripts/display-format.mjs';

type Window = {bucket:string; window:string; remainingPercent:number; durationMinutes:number|null; resetsAt:string|null};
export type Quota = {status:string; checkedAt?:string; windows?:Window[]; history?:{checkedAt:string; windows:Window[]}[]};
export type PeerQuota = Quota & {host?:string; provider?:string; receivedAt?:string};
const duration = (milliseconds:number) => {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60000));
  return durationText(minutes * 60);
};
export default function Allowances({quota, peerQuota, receivedFrom, receivedAt, demo = false}:{quota?:Quota; peerQuota?:PeerQuota|null; receivedFrom?:string; receivedAt?:string; demo?:boolean}) {
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const clock = demo ? Date.parse(quota?.checkedAt || '') : now;
  const paces = Number.isFinite(clock) && clock > 0 ? quotaPace(quota, clock) : [];
  const windows = (quota?.windows || []).filter(w => !/spark|bengal[-_ ]?fox/i.test(w.bucket));
  const peer = !receivedFrom && peerQuota && ['Mac','Windows'].includes(peerQuota.host || '') ? peerQuota : null;
  return <>
    <div className="view-heading"><div>{receivedFrom ? <h2>Shared from {receivedFrom}</h2> : <h1>Allowances</h1>}<p>{receivedFrom ? `Received: ${receivedAt || 'Unknown'}. Separate account observation, never added to this device's totals.` : demo ? 'Fictional account history' : 'Observed on this device'}</p></div><span className="period-chip">{quota?.status === 'ok' ? receivedFrom ? 'Received reading' : 'Latest reading' : 'Saved source status'}</span></div>
    {!windows.length && <div className="usage-card"><h2>No account connected</h2><p>Enable an available account source in local source settings. Saved token records are separate from account limits.</p></div>}
    <div className="usage-grid">{windows.map(w => {
      const pace = paces.find((p:{bucket:string;window:string}) => p.bucket === w.bucket && p.window === w.window);
      const reset = Date.parse(w.resetsAt || '');
      const exhaustion = pace?.status === 'resets-first' ? reset : Date.parse(pace?.estimatedExhaustionAt || '');
      const projected = ['projected','resets-first'].includes(pace?.status || '') && exhaustion > clock && reset > clock;
      const coverage = projected ? Math.min(1, (exhaustion-clock)/(reset-clock)) : null;
      const points = (quota?.history || []).flatMap(sample => {
        const row = sample.windows.find(row => row.bucket === w.bucket && row.window === w.window);
        const at = Date.parse(sample.checkedAt);
        return row && Number.isFinite(at) && row.remainingPercent >= 0 && row.remainingPercent <= 100 ? [{at, used:100-row.remainingPercent, reset:row.resetsAt}] : [];
      });
      const first = points[0]?.at || clock, last = points.at(-1)?.at || clock;
      const x = (at:number) => 32 + (at-first)/Math.max(1,last-first)*468;
      const paths:string[] = [];
      const hourly = new Map<number,{used:number;ms:number}>();
      points.forEach((p,i) => {
        const previous = points[i-1];
        const continuous = previous && p.at > previous.at && p.at-previous.at <= 630000 && p.used >= previous.used && p.reset === previous.reset;
        paths.push(`${continuous?'L':'M'}${x(p.at)},${140-p.used*1.2}`);
        if (continuous && Math.floor(previous.at/3600000) === Math.floor((p.at-1)/3600000)) {
          const hour = Math.floor(previous.at/3600000)*3600000, value = hourly.get(hour) || {used:0,ms:0};
          hourly.set(hour,{used:value.used+p.used-previous.used,ms:value.ms+p.at-previous.at});
        }
      });
      const hours = [...hourly].map(([at,value]) => ({at,rate:value.used*3600000/value.ms}));
      const maxRate = Math.max(1,...hours.map(h=>h.rate));
      return <section className="usage-card" key={w.bucket+w.window}>
        <header><h2>{w.window}</h2><span>{w.remainingPercent.toFixed(1)}% left</span></header>
        <p>{w.bucket.replaceAll('_',' ')}</p>
        <progress value={w.remainingPercent} max={100} aria-label={`${w.window} allowance remaining`}/>
        <p className="usage-number">{projected ? exhaustion >= reset ? 'Until reset' : duration(exhaustion-clock) : pace?.status === 'exhausted' ? 'Allowance used' : 'Learning your pace'}</p>
        <p>{projected ? `Estimated at ${pace!.percentagePointsPerHour!.toFixed(1)} percentage points / hour` : 'An estimate needs recent, continuous readings.'}</p>
        <p>{reset > clock ? `Reset in ${duration(reset-clock)}` : 'Waiting for the next reset reading'}</p>
        {coverage !== null && <><progress className="pace-coverage" value={coverage} max={1} aria-label="Estimated time coverage until reset"/><div className="usage-axis"><span>Now</span><span>{Math.round(coverage*100)}% of time to reset covered</span><span>Reset</span></div></>}
        <h2 style={{marginTop:24}}>Allowance used</h2>
        {points.length ? <svg className="usage-history" viewBox="0 0 520 180" role="img" aria-label="Recorded used percentage. Gaps and resets are separate segments.">
          {[0,50,100].map(n=><g key={n}><line className="chart-grid" x1="32" x2="500" y1={140-n*1.2} y2={140-n*1.2}/><text x="0" y={144-n*1.2}>{n}%</text></g>)}
          <path className="chart-line" d={paths.join(' ')}/>
          <text x="32" y="168">{new Date(first).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</text><text x="500" y="168" textAnchor="end">{new Date(last).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</text>
        </svg> : <p>History begins with the first successful reading.</p>}
        {hours.length > 0 && <><h2>Usage pace by hour</h2><svg className="usage-history" viewBox="0 0 520 180" role="img" aria-label="Observed percentage points per hour">
          {hours.map((h,i)=><g key={h.at}><rect className="chart-bar" x={32+i*468/hours.length} y={140-h.rate/maxRate*110} width={Math.max(2,468/hours.length-12)} height={h.rate/maxRate*110} rx="4"><title>{h.rate.toFixed(1)} percentage points per hour</title></rect>{i % Math.max(1,Math.ceil(hours.length/4)) === 0 && <text x={32+i*468/hours.length} y="168">{new Date(h.at).getHours()}:00</text>}</g>)}
        </svg><small>Only observed intervals contribute. Missing readings are not zero.</small></>}
      </section>;
    })}</div>
    {peer && <section aria-label={`Shared allowance history from ${peer.host}`}><Allowances quota={peer} receivedFrom={peer.host} receivedAt={peer.receivedAt} demo={demo}/></section>}
  </>;
}
