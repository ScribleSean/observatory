'use client';
import {useState} from 'react';
import {voiceOverview} from '../scripts/voice-overview.mjs';
import {Button} from '@/components/ui/button';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';

export type DictationSource = {
  host:string; status:string; checkedAt?:string; source?:string;
  days?:{date:string;transcriptions:number;words:number;audioSeconds:number;wordRecords?:number;audioRecords?:number;engines:{engine:string;transcriptions:number}[]}[];
};
const fmt=(value:number|null)=>value===null?'Unknown':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
const statuses:Record<string,string>={ok:'Recorded history','not-supported':'Tracking not yet verified',
  'not-connected':'Not connected','not-found':'No statistics found',ambiguous:'Ambiguous source',unavailable:'Unavailable'};

export default function Dictation({sources=[]}:{sources?:DictationSource[]}) {
  const [host,setHost]=useState('All');
  const [tool,setTool]=useState('All');
  const [period,setPeriod]=useState<'day'|'week'|'all'>('week');
  const [date,setDate]=useState<string|null>(null);
  const view=voiceOverview(sources,{host,tool,period,date});
  return <>
    <div className="view-heading"><div><h1>Dictation</h1><p>Your voice usage over time, by tool and device.</p></div><span className="period-chip">Partial coverage</span></div>
    <div className="dictation-controls">
      <div role="group" aria-label="Voice tool">{['All','Wispr Flow','ChatGPT'].map(value=><Button key={value} variant={tool===value?'default':'outline'} aria-pressed={tool===value} onClick={()=>{setTool(value);setDate(null);}}>{value==='All'?'All tools':value}</Button>)}</div>
      <div role="group" aria-label="Voice device">{['All','Mac','Windows'].map(value=><Button key={value} variant={host===value?'default':'outline'} aria-pressed={host===value} onClick={()=>{setHost(value);setDate(null);}}>{value==='All'?'All devices':value}</Button>)}</div>
      <div role="group" aria-label="Voice period">{(['day','week','all'] as const).map(value=><Button key={value} variant={period===value?'default':'outline'} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value==='day'?'Day':value==='week'?'Week':'All retained'}</Button>)}</div>
      {period!=='all'&&view.dates.length>0&&<label>{period==='week'?'Week ending':'Recorded day'} <select value={view.end??''} onChange={event=>setDate(event.target.value)}>{view.dates.map(value=><option key={value}>{value}</option>)}</select></label>}
    </div>
    <div className="dictation-metrics">
      <div><span>All voice time</span><strong>Unknown</strong><small>Complete coverage is not established</small></div>
      <div><span>Reporting tool/device sources</span><strong>{view.reportingSources}</strong><small>Within the selected period</small></div>
      <div><span>{period==='all'?'Latest recorded date':'Selected period ending'}</span><strong>{view.end??'Unknown'}</strong></div>
    </div>
    <section className="dictation-detail"><h2>By tool and device</h2>
      <Table><TableHeader><TableRow><TableHead>Tool</TableHead><TableHead>Device</TableHead><TableHead>Records</TableHead><TableHead>Words</TableHead><TableHead>Recorded audio minutes</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>{view.sources.map(row=><TableRow key={row.source+row.host}><TableCell>{row.source}</TableCell><TableCell>{row.host}</TableCell><TableCell>{fmt(row.records)}</TableCell><TableCell>{fmt(row.words)}{row.words!==null&&row.wordRecords!==row.records?' (partial)':''}</TableCell><TableCell>{fmt(row.audioSeconds===null?null:row.audioSeconds/60)}{row.audioSeconds!==null&&row.audioRecords!==row.records?' (partial)':''}</TableCell><TableCell>{statuses[row.status]??'Unknown'}{row.checkedAt&&<small><br/>Checked {new Date(row.checkedAt).toLocaleString()}</small>}</TableCell></TableRow>)}</TableBody>
      </Table>
    </section>
    <section className="dictation-detail"><h2>Voice over time</h2>
      {view.daily.length===0?<p>No recorded voice statistics in this scope. Missing data is not zero usage.</p>:view.sources.filter(row=>row.days.length>0).map(row=>{
        const days=(row.days as NonNullable<DictationSource['days']>).slice(-30),points=days.filter(day=>(day.audioRecords??0)>0);
        const maximum=Math.max(1,...points.map(day=>day.audioSeconds/60));
        const first=Date.parse(days[0].date),last=Date.parse(days.at(-1)!.date);
        const x=(day:string)=>20+(Date.parse(day)-first)/Math.max(86400000,last-first)*550;
        return <div key={row.source+row.host}><h3>{row.source} · {row.host}</h3>
          {points.length>0?<svg viewBox="0 0 600 140" role="img" aria-label={row.source+' on '+row.host+': recorded audio minutes by date. Missing dates are gaps.'} style={{width:'100%',maxHeight:180}}>
            <line x1="10" x2="590" y1="110" y2="110" stroke="currentColor" opacity="0.25"/>
            {points.map(day=><rect key={day.date} x={x(day.date)} y={110-day.audioSeconds/60/maximum*90} width="10" height={Math.max(1,day.audioSeconds/60/maximum*90)} fill="currentColor"><title>{day.date}: {fmt(day.audioSeconds/60)} recorded audio minutes</title></rect>)}
            <text x="10" y="135" fill="currentColor" fontSize="12">{days[0].date}</text><text x="590" y="135" textAnchor="end" fill="currentColor" fontSize="12">{days.at(-1)!.date}</text>
          </svg>:<p>Audio duration was not recorded.</p>}
          <p>Chart scale: 0 to {fmt(maximum)} recorded audio minutes. Latest 30 recorded dates shown. Missing dates are gaps, not zeros.</p>
        </div>;
      })}
      {view.daily.length>0&&<><p>Latest 60 tool/device rows. Totals above cover the full selected period.</p><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Tool</TableHead><TableHead>Device</TableHead><TableHead>Records</TableHead><TableHead>Words</TableHead><TableHead>Audio minutes</TableHead></TableRow></TableHeader><TableBody>{view.daily.slice(-60).reverse().map(row=><TableRow key={row.date+row.source+row.host}><TableCell>{row.date}</TableCell><TableCell>{row.source}</TableCell><TableCell>{row.host}</TableCell><TableCell>{fmt(row.records)}</TableCell><TableCell>{fmt(row.words)}</TableCell><TableCell>{fmt(row.audioSeconds===null?null:row.audioSeconds/60)}</TableCell></TableRow>)}</TableBody></Table></>}
    </section>
    <div className="dictation-note"><p>More local speech detection coming soon.</p><p>ChatGPT voice tracking has not been verified. General ChatGPT screen time is not voice usage. Wispr reports retained recording metadata, including silence and possibly unfinished records. Synced or imported histories can overlap, so device totals are not added together.</p><p>Dates use America/New_York. Transcripts, recordings and credentials are excluded.</p></div>
  </>;
}
