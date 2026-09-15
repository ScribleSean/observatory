'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {threeHourBands,trackingState} from '../scripts/activity-timeline.mjs';
import {durationText as duration} from '../scripts/display-format.mjs';

type Day={date:string;seconds:number;hours:number[];trackedSeconds?:number;trackedHours?:number[]};
const hour=(n:number)=>n===0||n===24?'12 AM':n===12?'Noon':`${n%12 || 12} ${n<12?'AM':'PM'}`;
const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});

export default function WeekTimeline({days,onOpenDay}:{days:{date:string;record?:Day}[];onOpenDay:(date:string)=>void}) {
  const [hover,setHover]=useState<{date:string;index:number}|null>(null);
  const [selected,setSelected]=useState<{date:string;index:number}|null>(null);
  const active=hover || selected;
  const record=days.find(d=>d.date===active?.date)?.record;
  const band=active && record?threeHourBands(record)[active.index]:null;
  return <section className="weekly-timeline" aria-label="Recorded activity over seven days">
    <div className="week-timeline-heading"><h2>Week overview</h2><span>Three-hour bands</span></div>
    <div className="week-time-axis" aria-hidden="true"><div><span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span></div></div>
    {days.map(({date,record})=>{
      const state=trackingState(record);
      return <div className={'week-row '+(state==='tracked'?'':'week-untracked')} key={date}>
        <Button variant="ghost" className="week-date" disabled={state!=='tracked'} aria-label={`${date}. ${state==='tracked'?'Open day details':state==='untracked'?'No tracking records':'Tracking coverage unknown'}`} onClick={()=>onOpenDay(date)}>
          <strong>{new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'})}</strong><small>{dateLabel(date)}</small>
        </Button>
        {state==='tracked'?<div className="week-bands">
          {threeHourBands(record).map((b,index)=><Button variant="ghost" key={index} className="week-band" data-highlight={active?.index===index || undefined}
            aria-label={`${date}, ${hour(b.hour)} to ${hour(b.hour+3)}. ${duration(b.seconds)} active. ${b.trackedSeconds===0?'No tracking records in this band.':''}`}
            aria-pressed={selected?.date===date && selected.index===index}
            onMouseEnter={()=>setHover({date,index})} onMouseLeave={()=>setHover(null)}
            onFocus={()=>setHover({date,index})} onBlur={()=>setHover(null)}
            onClick={()=>setSelected({date,index})}>
            <span className={b.trackedSeconds===0?'band-untracked':''}><i style={{opacity:b.seconds?0.3+0.7*Math.min(1,b.seconds/10800):0}}/></span>
          </Button>)}
        </div>:<div className="week-no-history"><span>{state==='untracked'?'No tracking records':'Coverage unknown'}</span></div>}
        <span className="week-total">{state==='tracked'?duration(record?.seconds || 0):''}</span>
      </div>;
    })}
    <div className="week-band-detail" role="status">
      {band && active ? <><strong>{dateLabel(active.date)} · {hour(band.hour)} to {hour(band.hour+3)}</strong><span>{duration(band.seconds)} active{band.trackedSeconds!=null?` · ${duration(band.trackedSeconds)} of tracking records`:''}</span></>:<span>Hover or tap a band for detail. Select a day name to open it.</span>}
    </div>
    <p>Muted days have no tracking records. A tracked day with no active time shows 0m. Partial tracking is not a full-day inactivity record.</p>
  </section>;
}
