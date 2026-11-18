import test from 'node:test';
import assert from 'node:assert/strict';
import {weekView,joined,limitWindows,hasLastWeek,shippedPill,modelLabel,shareText,flagLines,sessionLabel} from '../lib/view-week.mjs';
import {sessionView} from '../lib/view-session.mjs';
import {sampleLedger} from '../lib/sample-ledger.mjs';
import {limitShare,LEDGER_TOP,WORK_KINDS} from '../lib/ledger-shape.mjs';
import {combine} from '../lib/combine.mjs';
import {summaryOf} from '../lib/summary.mjs';
import {ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-11-17T18:40:00Z');
const HOUR=3600000;
const iso=offset=>new Date(now+offset).toISOString();
const window=(engine,name,label,id,minutes,remaining,extra={})=>({engine,name,window:label,windowId:id,durationMinutes:minutes,remaining,
  resetsAt:iso(48*HOUR),status:'room',runoutAt:null,earliestAt:null,latestAt:null,previousUsed:null,...extra});
function feed(change=summary=>summary) {
  return change({generatedAt:iso(0),timezone:'UTC',devices:[{host:'Mac',name:'Studio Mac'},{host:'Windows',name:'Desk PC'}],
    glance:{forecast:{engines:[{engine:'claude',name:'Claude'},{engine:'codex',name:'Codex'}],scarce:{engine:'claude'}}},
    week:{windows:[
      window('claude','Claude Code','weekly','seven_day',10080,36,{status:'runs-out',runoutAt:iso(32*HOUR),previousUsed:71}),
      window('claude','Claude Code','5-hour','five_hour',300,59,{resetsAt:iso(2*HOUR)}),
      window('codex','Codex','weekly','secondary',10080,81,{resetsAt:iso(96*HOUR)}),
      window('codex','Codex','5-hour','primary',300,88,{resetsAt:iso(HOUR)})],
    ledger:['Mac','Windows'].map(host=>sampleLedger(now,{host}))}});
}
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message ?? ''} ${actual} versus ${expected}`);

test('the sample ledger matches the contract',()=>{
  for(const host of ['Mac','Windows']) {
    const row=sampleLedger(now,{host});
    assert.deepEqual(Object.keys(row),['host','status','collectedAt','tools']);
    assert.deepEqual(row,sampleLedger(now,{host}),'the same inputs give the same ledger');
    for(const tool of row.tools) {
      assert.deepEqual(tool.periods.map(period=>period.key),['current','previous']);
      for(const period of tool.periods) {
        assert.equal(Date.parse(period.end)-Date.parse(period.start),7*24*HOUR);
        assert.ok(period.sessions.length<=LEDGER_TOP);
        const listed=period.sessions.reduce((sum,session)=>sum+session.apiUsd,0);
        close(listed+period.other.apiUsd,period.apiUsd,`${host} ${tool.tool} ${period.key} adds up`);
        assert.equal(period.sessions.length+period.other.count,period.sessionCount);
        for(const session of period.sessions) {
          assert.match(session.id,/^[0-9a-f]{12}$/);
          assert.ok(session.kinds.every(part=>WORK_KINDS.includes(part.kind)));
          close(session.models.reduce((sum,model)=>sum+model.apiUsd,0),session.apiUsd,session.title);
          assert.equal(session.fanout.length>0,session.subagents>0);
          assert.deepEqual(Object.keys(session.signals),['longestRetry','retryTool','autoResumeUsd','searchOnTopModelUsd','searchOnSmallModelUsd']);
        }
      }
    }
  }
  assert.ok(!/\/Users\/|\/home\/|@|[A-Z]:\\/.test(JSON.stringify(sampleLedger(now,{host:'Mac'}))));
});

test('shares come from limitShare and add up to the part of the limit that is used',()=>{
  const join=joined(feed());
  const claude=[...join.sessions,...join.others].filter(part=>part.tool==='claude');
  close(claude.reduce((sum,part)=>sum+part.share,0),64,'every Claude session and the rest');
  const review=join.sessions.find(session=>session.title==='Release review');
  close(review.share,limitShare(1638,3640,64));
  assert.equal(join.sessions[0],review,'the largest share leads');
  const codex=[...join.sessions,...join.others].filter(part=>part.tool==='codex');
  close(codex.reduce((sum,part)=>sum+part.share,0),19,'Codex sessions add up to the Codex limit, not the Claude one');
});

test('the headline says how much is used, when it runs out and how long before the reset',()=>{
  const view=weekView(feed(),{now});
  assert.equal(view.headline.title,'Claude weekly limit');
  assert.equal(view.headline.usedText,'64% used');
  assert.deepEqual(view.headline.say,{lead:'Runs out',when:'Thu 2:45 AM',tail:'at this pace'});
  assert.equal(view.headline.pill,'16 hours before the reset');
  assert.equal(view.headline.resets,'Resets Thu 6:45 PM');
  assert.deepEqual(view.headline.segments.map(segment=>segment.label),['Release review','Docs refresh','Game prototype','API cleanup','Weekly planning','Package updates']);
  assert.equal(view.headline.segments[0].text,'29%');
  close(view.headline.segments.reduce((sum,segment)=>sum+segment.share,0)+view.headline.rest.share,64);
  assert.match(view.headline.rest.label,/^176 others$/);
  assert.equal(view.computers,'Studio Mac, Desk PC');
  const ranged=weekView(feed(summary=>{Object.assign(summary.week.windows[0],{earliestAt:iso(30*HOUR),latestAt:iso(34*HOUR)});return summary;}),{now});
  assert.deepEqual(ranged.headline.say,{lead:'May run out',when:'Thu 1–5 AM',tail:''});
  const room=weekView(feed(summary=>{Object.assign(summary.week.windows[0],{status:'room',runoutAt:null});return summary;}),{now});
  assert.equal(room.headline.say.lead,'Lasts until the reset at this pace');
  assert.equal(room.headline.pill,null);
  const out=weekView(feed(summary=>{Object.assign(summary.week.windows[0],{status:'out',remaining:0,runoutAt:null});return summary;}),{now});
  assert.equal(out.headline.say.lead,'Out until Thu 6:45 PM');
  assert.equal(out.headline.tone,'spent');
});

test('every other limit window is a quiet meter, whatever engines are present',()=>{
  const view=weekView(feed(),{now});
  assert.deepEqual(view.meters.map(meter=>[meter.label,meter.usedText]),[['Claude 5-hour','41%'],['Codex weekly','19%'],['Codex 5-hour','12%']]);
  assert.equal(view.meters[0].resets,'Resets 8:45 PM');
  const third=weekView(feed(summary=>{
    summary.glance.forecast.engines.push({engine:'grok',name:'Grok'});
    summary.week.windows.push(window('grok','Grok','weekly','weekly',10080,54));
    return summary;
  }),{now});
  assert.equal(third.meters.at(-1).label,'Grok weekly');
  const lead=weekView(feed(summary=>{summary.glance.forecast.scarce={engine:'codex'};return summary;}),{now});
  assert.equal(lead.headline.title,'Codex weekly limit');
  assert.equal(lead.tool,'codex','the table follows the headline until a tool is picked');
  assert.ok(lead.meters.some(meter=>meter.label==='Claude weekly'));
});

test('the table ranks one tool at a time, and the filter lists whichever tools the ledger has',()=>{
  const view=weekView(feed(),{now});
  assert.deepEqual(view.tools,[{id:'claude',name:'Claude Code'},{id:'codex',name:'Codex'}]);
  assert.equal(view.tool,'claude');
  assert.deepEqual(view.table.rows.map(row=>row.title),['Release review','Docs refresh','Game prototype','API cleanup','Weekly planning','Package updates','Media player fixes','Dashboard redesign']);
  const [review,docs]=view.table.rows;
  assert.deepEqual([review.machine,review.subagentsText,review.shareText,review.shipped.text,review.perChange,review.bar],['Studio Mac','372','28.8%','No change','',1]);
  assert.deepEqual([docs.shipped,docs.perChange],[{tone:'ok',text:'6 merged'},'0.9%']);
  assert.deepEqual(review.models.map(model=>[model.label,Math.round(model.part*100)]),[['Opus',92],['Sonnet',8]]);
  assert.deepEqual(view.table.rows.filter(row=>row.running).map(row=>row.title),['Game prototype','Package updates','Dashboard redesign']);
  assert.deepEqual([view.table.more.label,view.table.more.subagentsText,view.table.more.shipped,view.table.more.expandable],['174 more sessions','214','7 merged',false]);
  const few=weekView(feed(),{now,shown:3});
  assert.equal(few.table.rows.length,3);
  assert.deepEqual([few.table.more.label,few.table.more.expandable],['179 more sessions',true]);
  const codex=weekView(feed(),{now,tool:'codex'});
  assert.deepEqual(codex.table.rows.map(row=>[row.title,row.shipped.text]),[['Search indexer','1 merged'],['Upstream fix','PR open'],['Untitled session','No change']]);
  assert.equal(codex.headline.title,'Claude weekly limit','the headline stays with the scarcer engine');
  const extra=weekView(feed(summary=>{
    summary.week.ledger[0].tools.push({tool:'gemini',name:'Gemini CLI',limitEngine:null,periods:[{...summary.week.ledger[0].tools[1].periods[0]}]});
    return summary;
  }),{now,tool:'gemini'});
  assert.deepEqual(extra.tools.map(tool=>tool.name),['Claude Code','Codex','Gemini CLI']);
  assert.ok(extra.table.rows.every(row=>row.share===null && row.shareText==='Unknown' && row.bar===null),'a tool with no limit has no share to show');
});

test('Unknown stays Unknown',()=>{
  const view=weekView(feed(summary=>{summary.week.windows[0].remaining=null;return summary;}),{now});
  assert.equal(view.headline.usedText,'Unknown');
  assert.equal(view.headline.used,null);
  assert.deepEqual(view.headline.segments,[]);
  assert.equal(view.headline.say,null);
  assert.ok(view.table.rows.every(row=>row.shareText==='Unknown' && row.perChange===''));
  assert.equal(view.table.rows[0].title,'Release review','without a share the largest spend still leads');
  assert.equal(view.table.more.shareText,'Unknown');
  assert.equal(shareText(null),'Unknown');
  assert.equal(limitShare(null,10,50),null);
  const blank=weekView(feed(summary=>{
    const session=summary.week.ledger[0].tools[0].periods[0].sessions[0];
    session.shipped={estimated:true,commits:null,onMain:null,merges:null,prsOpen:null,repos:[]};
    session.subagents=null;
    return summary;
  }),{now});
  assert.deepEqual([blank.table.rows[0].shipped.text,blank.table.rows[0].subagentsText],['Unknown','Unknown']);
  assert.deepEqual(blank.shipped.figures.map(figure=>figure.value),['Unknown','Unknown','Unknown','Unknown'],'one unread session leaves the totals Unknown, not smaller');
  assert.deepEqual(shippedPill(null),{tone:'none',text:'Unknown',changes:null});
});

test('shipped totals count every tool and computer',()=>{
  const view=weekView(feed(),{now});
  assert.equal(view.shipped.title,'Shipped this week');
  assert.deepEqual(view.shipped.figures.map(figure=>[figure.label,figure.value]),
    [['Branches merged','25'],['Commits','189'],['On the default branch','141'],['Spent on no change','45%']]);
});

test('running now lists live sessions on every computer with their pace',()=>{
  const view=weekView(feed(),{now});
  assert.deepEqual(view.running.rows.map(row=>[row.title,row.meta.join(' · '),row.rateText,row.warn]),[
    ['Package updates','Desk PC · Opus · retrying','0.3%/h',true],
    ['Dashboard redesign','Studio Mac · Opus · 4 subagents','0.2%/h',false],
    ['Game prototype','Desk PC · Opus · 2 subagents','0.1%/h',false]]);
  assert.equal(view.running.aside,'3 sessions, 0.6% per hour');
  assert.equal(view.running.others,null);
  const mixed=weekView(feed(summary=>{Object.assign(summary.week.ledger[1].tools[1].periods[0].sessions[0],{running:true,state:'waiting',ratePerHour:2});return summary;}),{now});
  assert.equal(mixed.running.aside,'4 sessions','paces on different limits are not added');
  assert.deepEqual(mixed.running.others,{label:'1 others',rateText:'0.1%/h'});
  assert.equal(weekView(feed(),{now,period:'previous'}).running,null);
});

test('flags name the session, rank by share with retry loops last, and stop at four',()=>{
  const view=weekView(feed(),{now});
  assert.deepEqual(view.flags.map(flag=>[flag.tone,flag.lead,flag.rest]),[
    ['warn','Release review','fanned out to 372 subagents and took 29% of the week. No branch merged.'],
    ['note','Opus did search work','in 212 subagents. The smallest model would have cut the week by about 9.6%.'],
    ['warn','Package updates','repeated one failing Shell call 14 times.']]);
  assert.ok(view.flags.every(flag=>view.table.rows.some(row=>row.key===flag.session) || flag.session.includes('.codex.')));
  const join=joined(feed());
  assert.deepEqual(flagLines(join.sessions.find(session=>session.title==='Docs refresh'),join),[]);
});

test('last week uses the last reading of that window and says when it ended',()=>{
  const view=weekView(feed(),{now,period:'previous'});
  assert.equal(view.headline.usedText,'71% used');
  assert.match(view.headline.resets,/^Ended /);
  assert.equal(view.headline.say,null);
  assert.equal(view.shipped.title,'Shipped last week');
  assert.deepEqual(view.table.rows.map(row=>row.title),['Docs refresh','API cleanup','Game prototype','Media player fixes']);
  assert.ok(hasLastWeek(feed()));
  const unread=weekView(feed(summary=>{summary.week.windows[0].previousUsed=null;return summary;}),{now,period:'previous'});
  assert.equal(unread.headline.usedText,'Unknown');
});

test('a summary with no ledger still shows the limits, and nothing else',()=>{
  const view=weekView(feed(summary=>{summary.week.ledger=[];return summary;}),{now});
  assert.equal(view.headline.usedText,'64% used');
  assert.deepEqual([view.headline.segments,view.headline.rest,view.table,view.shipped,view.running,view.flags],[[],null,null,null,null,[]]);
  assert.equal(view.meters.length,3);
  assert.ok(!hasLastWeek({}));
  const empty=weekView({},{now});
  assert.deepEqual([empty.headline,empty.meters,empty.table],[null,[],null]);
});

test('the summary feed carries every limit window with its forecast and each computer\'s ledger',()=>{
  const at=Date.parse('2026-10-21T17:00:00Z');
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',at)},{host:'Windows',snapshot:ownSnapshot('Windows',at)}],{now:at});
  const summary=summaryOf(combined);
  assert.deepEqual(summary.week.ledger.map(row=>row.host),['Mac','Windows']);
  assert.deepEqual(summary.week.windows.map(row=>[row.engine,row.window,row.remaining]),
    [['claude','5-hour',null],['claude','weekly',null],['codex','5-hour',81],['codex','weekly',47],['grok','weekly',54]]);
  for(const row of summary.week.windows)assert.deepEqual(Object.keys(row),
    ['engine','name','window','windowId','durationMinutes','remaining','resetsAt','status','runoutAt','earliestAt','latestAt','previousUsed']);
  // A reading of the window before this one becomes last week's use.
  const reset=Date.parse(combined.view.quota.windows[1].resetsAt);
  const view={...combined.view,limitHistory:[{host:'Mac',status:'ok',points:[
    {p:'codex',w:'secondary',o:'Mac',t:new Date(reset-8*24*HOUR).toISOString(),r:40,x:new Date(reset-7*24*HOUR).toISOString(),d:10080},
    {p:'codex',w:'secondary',o:'Mac',t:new Date(reset-7.5*24*HOUR).toISOString(),r:22,x:new Date(reset-7*24*HOUR).toISOString(),d:10080}]}]};
  assert.equal(limitWindows(view,combined.glance.limits,{now:at}).find(row=>row.engine==='codex' && row.window==='weekly').previousUsed,78);
});

test('model names read as their family, and unknown ids stay as they are',()=>{
  assert.deepEqual(['claude-opus-5-5','claude-sonnet-4-20250514','claude-haiku-4-5','gpt-6-astra','',null].map(modelLabel),['Opus','Sonnet','Haiku','gpt-6-astra','Unknown','Unknown']);
});

test('the session panel shows one session: share, fan-out, where it went, what it shipped and its flags',()=>{
  const summary=feed();
  const key=weekView(summary,{now}).table.rows[0].key;
  const view=sessionView(summary,key,{now});
  assert.equal(view.title,'Release review');
  assert.deepEqual(view.meta.slice(0,2),['Studio Mac','Claude Code']);
  assert.match(view.meta[2],/^Fri [\d:]+ [AP]M to Fri [\d:]+ [AP]M$/);
  assert.equal(view.meta[3],'7h 48m');
  assert.deepEqual(view.figures.map(figure=>[figure.label,figure.value]),[['Share of the week','28.8%'],['Subagents','372'],['Output tokens','21M'],['At API prices','$1,638']]);
  assert.equal(view.fanout.peak,61);
  assert.match(view.fanout.peakText,/^Peak 61 at \d+:\d\d [AP]M$/);
  assert.equal(view.fanout.bars.length,31);
  assert.ok(view.fanout.ticks.length<=6);
  assert.deepEqual(view.kinds.map(kind=>[kind.label,kind.lead,kind.subagentsText,kind.shareText]),
    [['Search and read','Opus','212','12.4%'],['Review passes','Opus','118','10.9%'],['Main thread','Opus','0','3.7%'],['Writing','Sonnet','42','1.7%']]);
  assert.deepEqual(view.shipped,{tone:'none',text:'No change',line:['0 commits, 0 on the default branch.','In field-notes.','Cache hit 91%.']});
  assert.deepEqual(view.flags.map(flag=>[flag.ownLead,flag.ownRest]),[
    ['Fanned out to 372 subagents','and took 29% of the week. No branch merged.'],
    ['Opus did search work','in 212 subagents. The smallest model would have cut the week by about 9.6%.']]);
  assert.equal(sessionView(summary,'Mac.claude.000000000000',{now}),null);
  assert.equal(sessionView(summary,key,{now,period:'previous'}),null,'a session is looked up in the week it belongs to');
});

test('a session with nothing read says Unknown and draws no chart',()=>{
  const summary=feed(change=>{
    Object.assign(change.week.ledger[0].tools[0].periods[0].sessions[0],{tokens:{input:null,output:null,cacheRead:null,cacheWrite:null},apiUsd:null,fanout:[],
      shipped:{estimated:true,commits:null,onMain:null,merges:null,prsOpen:null,repos:[]}});
    return change;
  });
  const key=joined(summary).sessions.find(session=>session.title==='Release review').key;
  const view=sessionView(summary,key,{now});
  assert.deepEqual(view.figures.map(figure=>figure.value),['Unknown','372','Unknown','Unknown']);
  assert.equal(view.fanout,null);
  assert.deepEqual(view.shipped,{tone:'none',text:'Unknown',line:[]});
});

test('a share that is not zero never reads as zero',()=>{
  assert.deepEqual([0,0.04,0.09,0.1,2.84].map(shareText),['0.0%','<0.1%','<0.1%','0.1%','2.8%']);
  const tiny=weekView(feed(summary=>{
    const session=summary.week.ledger[0].tools[0].periods[0].sessions[1];
    Object.assign(session,{apiUsd:1,shipped:{...session.shipped,merges:0,commits:61}});
    return summary;
  }),{now});
  const row=tiny.table.rows.find(entry=>entry.title==='Docs refresh');
  assert.deepEqual([row.shareText,row.shipped.text,row.perChange],['<0.1%','61 commits','<0.1%']);
});

test('the Machine column is there only when sessions come from more than one computer',()=>{
  assert.equal(weekView(feed(),{now}).table.machines,true);
  const one=weekView(feed(summary=>{summary.week.ledger=summary.week.ledger.slice(0,1);return summary;}),{now});
  assert.equal(one.table.machines,false);
  const unnamed=weekView(feed(summary=>{summary.devices=[];return summary;}),{now});
  assert.equal(unnamed.table.rows[0].machine,'Mac','a computer with no name of its own keeps its kind');
});

test('where it went has one row per kind of work, with the rest as Other',()=>{
  const summary=feed();
  const key=weekView(summary,{now}).table.rows[0].key;
  const review=sessionView(summary,key,{now}).kinds[1];
  assert.deepEqual(review.models.map(model=>[model.label,Math.round(model.part*100)]),[['Opus',82],['Sonnet',18]]);
  const busy=feed(change=>{
    const session=change.week.ledger[0].tools[0].periods[0].sessions[0];
    session.kinds=WORK_KINDS.flatMap((kind,index)=>[
      {kind,model:'claude-opus-5-5',subagents:index,apiUsd:(index+1)*10},
      {kind,model:'claude-sonnet-4-20250514',subagents:1,apiUsd:(index+1)*5}]);
    return change;
  });
  const kinds=sessionView(busy,key,{now}).kinds;
  assert.deepEqual(kinds.map(kind=>kind.label),['Main thread','Writing','Tests','Build','Design','Review passes','Other']);
  assert.equal(kinds.at(-1).subagentsText,String(0+1+8+3),'search, research and other, on both models');
  assert.ok(kinds.every(kind=>kind.lead==='Opus' && kind.models.length===2));
  const unread=feed(change=>{change.week.ledger[0].tools[0].periods[0].sessions[0].kinds[0].apiUsd=null;return change;});
  assert.equal(sessionView(unread,key,{now}).kinds.find(kind=>kind.label==='Search and read').shareText,'Unknown');
});

test('a computer or tool that could not be read makes totals, shares and paces Unknown, never computed from what is left',()=>{
  // The whole Windows ledger is unavailable.
  const lost=joined(feed(summary=>{summary.week.ledger[1]={host:'Windows',status:'unavailable'};return summary;}));
  assert.equal(lost.tools.find(tool=>tool.id==='claude').usd,null);
  assert.equal(lost.engines.get('claude').usd,null);
  assert.ok(lost.sessions.every(session=>session.share===null),'no share is measured against a partial total');
  assert.equal(lost.shareOf('claude',10),null);
  // Windows is readable but its Claude tool is not.
  const half=joined(feed(summary=>{
    const tools=summary.week.ledger[1].tools;
    tools[tools.findIndex(tool=>tool.tool==='claude')]={tool:'claude',name:'Claude Code',limitEngine:'claude',status:'unavailable',periods:[]};
    return summary;}));
  assert.equal(half.tools.find(tool=>tool.id==='claude').usd,null);
  assert.ok(half.sessions.filter(session=>session.tool==='claude').every(session=>session.share===null));
  assert.notEqual(half.tools.find(tool=>tool.id==='codex').usd,null,'the other tool is still known');
  const view=weekView(feed(summary=>{summary.week.ledger[1]={host:'Windows',status:'unavailable'};return summary;}),{now});
  assert.ok(view.table.rows.every(row=>row.share===null));
  assert.deepEqual(view.headline.segments,[]);
  // A computer that is not connected adds nothing and changes nothing.
  const two=joined(feed()),plus=joined(feed(summary=>{summary.week.ledger.push({host:'Spare',status:'not-connected'});return summary;}));
  assert.equal(plus.tools.find(tool=>tool.id==='claude').usd,two.tools.find(tool=>tool.id==='claude').usd);
});

test('shares are of the week only for a real weekly window, else they are shares of spend everywhere',()=>{
  const guessed=summary=>{for(const row of summary.week.ledger)for(const tool of row.tools)for(const part of tool.periods)part.windowKnown=false;return summary;};
  const join=joined(feed(guessed));
  assert.equal(join.engines.get('claude').shareKind,'spend');
  assert.equal(join.shareOf('claude',10),null,'nothing is priced against a limit the period does not match');
  const claude=[...join.sessions,...join.others].filter(part=>part.tool==='claude');
  close(claude.reduce((sum,part)=>sum+part.share,0),100,'shares of spend add up to all of it');
  assert.ok(claude.every(part=>part.shareKind==='spend'));
  const view=weekView(feed(guessed),{now});
  assert.equal(view.table.title,'Sessions by share of spend');
  assert.deepEqual(view.headline.segments,[],'shares of spend are not drawn on the limit bar');
  for(const line of view.flags)assert.ok(!/of the week|cut the week/.test(line.rest+line.ownRest),line.rest);
  assert.equal(weekView(feed(),{now}).table.title,'Sessions by share of the week');
  // Only a 5-hour window is known: the tool's week is not measured against it.
  const short=joined(feed(summary=>{summary.week.windows=summary.week.windows.filter(window=>window.windowId!=='seven_day');return summary;}));
  assert.equal(short.engines.get('claude').shareKind,'spend');
  assert.equal(short.shareOf('claude',10),null);
});

test('limitShare: Unknown for a zero, negative, non-finite or impossible input, and never more than the part used',()=>{
  assert.equal(limitShare(10,0,50),null,'nothing spent in the period');
  assert.equal(limitShare(0,100,50),0,'a session that spent nothing has no share');
  assert.equal(limitShare(10,100,0),0,'nothing of the limit used');
  assert.equal(limitShare(10,100,101),null,'a percent used over 100 is not a reading');
  assert.equal(limitShare(10,100,100),10);
  for(const bad of [NaN,Infinity,-1,null,undefined,'5'])
    for(const args of [[bad,100,50],[10,bad,50],[10,100,bad]])assert.equal(limitShare(...args),null,String(args));
  assert.equal(limitShare(150,100,40),40,'a session never takes more than the part used');
  close(limitShare(25,100,40),10);
});

test('an untitled session is named from how it ran, what it was asked and where',()=>{
  const shipped=repos=>({estimated:true,commits:0,onMain:0,merges:0,prsOpen:null,repos});
  const label=(origin,task,repos=[],extra={})=>sessionLabel({origin,task,shipped:shipped(repos),...extra});
  assert.equal(label('headless','review',['cube-type']),'Review run in cube-type');
  assert.equal(label('headless',null,['cube-type']),'Headless run in cube-type');
  assert.equal(label('interactive','review',['cube-type']),'Review session in cube-type');
  assert.equal(label(null,null,['cube-type']),'Session in cube-type');
  assert.equal(label('headless',null),'Headless run');
  assert.equal(label('headless','search'),'Search run');
  assert.equal(label('headless','other',['cube-type']),'Headless run in cube-type','the other kind says nothing');
  assert.equal(label('headless','review',[],{repo:'nod'}),'Review run in nod','the folder the session ran in stands in when it wrote nowhere');
  assert.equal(label(null,null),'Untitled session');
  assert.equal(sessionLabel({}, null),null);
  assert.equal(sessionLabel({title:'Own title',origin:'headless',task:'review'}),'Own title');
  assert.equal(sessionLabel({titleHash:'3f2a9c0d1e2b',origin:'headless'}),'Session 3f2a');
});

test('a review, search or research that wrote nothing is Read-only, not No change, and is left out of the wasted share',()=>{
  const none={estimated:true,commits:0,onMain:0,merges:0,prsOpen:null,repos:[]};
  assert.deepEqual(shippedPill(none,'review'),{tone:'none',text:'Read-only',changes:null});
  assert.equal(shippedPill(none,'search').text,'Read-only');
  assert.equal(shippedPill(none,'research').text,'Read-only');
  assert.equal(shippedPill(none,'build').text,'No change');
  assert.equal(shippedPill(none,null).text,'No change');
  assert.equal(shippedPill({...none,repos:['ferns']},'review').text,'No change','a review that wrote somewhere did change something');
  assert.equal(shippedPill({...none,commits:2},'review').text,'2 commits');
  assert.equal(shippedPill({...none,commits:null},'review').text,'Unknown');
  const make=task=>feed(summary=>{
    const period=summary.week.ledger[0].tools[0].periods[0];
    period.sessions=[{...period.sessions[0],task,apiUsd:50,shipped:none},{...period.sessions[1],task:null,apiUsd:50,shipped:{...none,commits:3}}];
    period.apiUsd=100;period.other=null;
    summary.week.ledger[0].tools.splice(1);
    summary.week.ledger.splice(1);
    return summary;
  });
  const spent=view=>view.shipped.figures.find(figure=>figure.label==='Spent on no change').value;
  assert.equal(spent(weekView(make('build'),{now})),'50%');
  const readOnly=weekView(make('review'),{now});
  assert.equal(spent(readOnly),'0%');
  assert.equal(readOnly.table.rows[0].shipped.text,'Read-only');
});
