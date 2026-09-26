'use client';
import {antigravityAllowanceDisplay} from '../scripts/provider-allowance-display.mjs';

export type ProviderAllowance = {
  provider:'antigravity'; host:'Mac'|'Windows'; status:string; checkedAt:string; scope:string;
  windows:{bucket:string;window:string;remainingPercent:number;durationMinutes:number;resetsAt:string}[];
};
type DisplayWindow = Omit<ProviderAllowance['windows'][number],'durationMinutes'> & {pool:string;label:string;resetReached:boolean;stale:boolean};

export default function ProviderAllowances({sources,now}:{sources?:ProviderAllowance[];now:number}) {
  const source=sources?.find(item=>item.provider==='antigravity');
  const view=antigravityAllowanceDisplay(source,now);
  return <section aria-label="Antigravity allowances">
    <div className="view-heading"><div><h2>Antigravity</h2><p>Current provider limits. Token history is not connected.</p></div><span className="period-chip">{view.status}</span></div>
    <p>{view.guidance}</p>
    <p>{view.checkedAt?`Last checked: ${new Date(view.checkedAt).toLocaleString()}`:'Last checked: Unknown'}</p>
    <div className="usage-grid">{view.windows.map((window:DisplayWindow)=><section className="usage-card" key={window.bucket+window.window}>
      <header><h2>{window.pool}</h2><span>{window.remainingPercent.toFixed(1)}% observed remaining</span></header>
      <p>{window.label}</p>
      <progress value={window.remainingPercent} max={100} aria-label={`${window.pool}, ${window.label}, observed allowance remaining`}/>
      <p>Reset: {new Date(window.resetsAt).toLocaleString()}</p>
      {window.resetReached && <p>Reset time reached. Refresh sources for a new reading.</p>}
      {window.stale && <p>Saved observation. Current allowance is Unknown.</p>}
    </section>)}</div>
  </section>;
}
