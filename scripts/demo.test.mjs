import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkDemo} from './demo.mjs';
import {shiftDemoClock} from '../lib/demo-clock.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from '../test/helpers.mjs';
import {activityView} from '../lib/view-activity.mjs';
import {tokensView} from '../lib/view-tokens.mjs';
import {sourceGroups} from '../lib/view-sources.mjs';
import {freshness} from '../lib/panel-data.mjs';

const fictional={demo:true,devices:[{host:'Mac',name:'Studio Mac'},{host:'Windows',name:'Desk PC'}]};

async function demoFolder({html='<script type="module" src="./assets/index-a1.js"></script>',data=fictional,extra={}}={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'observatory-demo-'));
  await mkdir(path.join(dir,'assets'));
  await mkdir(path.join(dir,'local'));
  const files={'index.html':html,'assets/index-a1.js':'fetch("./local/combined.json")','local/combined.json':JSON.stringify(data),...extra};
  for (const [file,text] of Object.entries(files)) await writeFile(path.join(dir,file),text);
  return dir;
}

test('the demo check passes fictional output and refuses anything else',async()=>{
  assert.deepEqual(await checkDemo(await demoFolder()),[]);
  const refused=async options=>(await checkDemo(await demoFolder(options))).length>0;
  assert.ok(await refused({data:{...fictional,demo:undefined}}));
  assert.ok(await refused({data:{...fictional,devices:[{name:'Real Laptop'}]}}));
  assert.ok(await refused({data:{...fictional,path:'/Users/someone/project'}}));
  assert.ok(await refused({data:{...fictional,path:'/home/someone/project'}}));
  assert.ok(await refused({data:{...fictional,path:'C:\\Users\\someone'}}));
  assert.ok(await refused({extra:{'assets/index-a1.js':'fetch("http://127.0.0.1:5601/local/combined.json")'}}));
  assert.ok(await refused({extra:{'assets/index-a1.js.map':'{}'}}));
  assert.ok(await refused({html:'<script type="module" src="/assets/index-a1.js"></script>'}));
});

test('the demo stays recent a week after build, including across UTC midnight',()=>{
  const built=Date.parse('2026-02-25T23:50:00Z');
  const snapshot=ownSnapshot('Mac',built);
  snapshot.limitHistory=[{host:'Mac',status:'ok',checkedAt:snapshot.collectedAt,points:[{
    p:'codex',w:'primary',o:'Mac',t:snapshot.collectedAt,r:81,x:snapshot.quota.windows[0].resetsAt,d:300,
  }]}];
  const data={demo:true,...combine([{host:'Mac',snapshot}],{now:built,generatedBy:'Mac'})};
  const original=structuredClone(data);
  for (const elapsed of [7*86400000,7*86400000+20*60000]) {
    const now=built+elapsed;
    assert.equal(activityView(data.view,{host:'Mac',period:'week',now}).series.at(-1).value,null);
    assert.equal(freshness(data.devices[0].collectedAt,now).stale,true);
    const shifted=shiftDemoClock(data,now);
    const today=new Date(now).toISOString().slice(0,10);
    assert.equal(shifted.generatedAt,new Date(now).toISOString());
    assert.equal(freshness(shifted.devices[0].collectedAt,now).stale,false);
    const activity=activityView(shifted.view,{host:'Mac',period:'week',now});
    assert.equal(activity.anchor,today);
    assert.equal(activity.series.at(-1).date,today);
    assert.ok(activity.series.every(day=>day.value>0));
    const tokens=tokensView(shifted.view,{host:'Mac',period:'week',now});
    assert.equal(tokens.codex.status,'ok');
    assert.equal(tokens.codex.days.at(-1).date,today);
    assert.ok(tokens.codex.days.at(-1).total>0);
    const read=sourceGroups(shifted.view,now).find(group=>group.id==='activity').rows[0].check;
    assert.equal(now-Date.parse(read.iso),120000);
    assert.equal(read.label,'Checked 2m ago');
    for (const row of [shifted.view,...Object.values(shifted.snapshots)]) {
      assert.equal(Date.parse(row.quota.windows[0].resetsAt)-now,225*60000);
      assert.equal(Date.parse(row.limitHistory[0].points[0].t),Date.parse(snapshot.collectedAt)+elapsed);
      assert.equal(Date.parse(row.limitHistory[0].points[0].x)-now,225*60000);
    }
    // The shared sample's project rows fail cleaning, so check their shift on the raw rows.
    const raw=shiftDemoClock({demo:true,generatedAt:data.generatedAt,projectTokens:snapshot.projectTokens},now).projectTokens[0];
    assert.equal(raw.date,today);
    assert.equal(Date.parse(raw.projects[0].sessions[0].start),Date.parse(snapshot.projectTokens[0].projects[0].sessions[0].start)+elapsed);
  }
  assert.deepEqual(data,original);
  const live={...data,demo:false};
  assert.strictEqual(shiftDemoClock(live,built+7*86400000),live);
  const unmarked={...data};
  delete unmarked.demo;
  assert.strictEqual(shiftDemoClock(unmarked,built+7*86400000),unmarked);
  const invalid={...data,generatedAt:'unknown'};
  assert.strictEqual(shiftDemoClock(invalid,built),invalid);
});

test('the demo hourly spread follows the viewer\'s hour, not the build hour',()=>{
  const sum=hours=>hours.reduce((total,value)=>total+value,0);
  for (const [builtAt,viewedAt] of [['2026-02-25T01:41:00Z','2026-03-04T20:30:00Z'],['2026-02-25T22:50:00Z','2026-03-04T03:10:00Z']]) {
    const built=Date.parse(builtAt), now=Date.parse(viewedAt);
    const snapshot=ownSnapshot('Mac',built);
    const data={demo:true,...combine([{host:'Mac',snapshot}],{now:built,generatedBy:'Mac'})};
    const shifted=shiftDemoClock(data,now);
    const today=viewedAt.slice(0,10), hour=new Date(now-120000).getUTCHours();
    const nowView=activityView(shifted.view,{host:'Mac',period:'now',now});
    assert.ok(nowView.total>0,`${builtAt} viewed ${viewedAt}: Now reads ${nowView.total}`);
    const day=activityView(shifted.view,{host:'Mac',period:'day',now});
    const shown=day.hourly.filter(row=>row.value!==null);
    assert.equal(shown.length,hour+1);
    assert.equal(sum(shown.map(row=>row.value)),day.total);
    for (const source of [...shifted.view.activity,...shifted.view.tokens].filter(row=>Array.isArray(row.days))) {
      const reading=new Date(source.checkedAt);
      const original=data.view[shifted.view.activity.includes(source)?'activity':'tokens'].find(row=>row.host===source.host);
      const index=source.days.findIndex(row=>row.date===reading.toISOString().slice(0,10));
      assert.equal(index,0);
      const hours=source.days[index].hours;
      assert.equal(sum(hours),sum(original.days[index].hours));
      assert.ok(hours[reading.getUTCHours()]>0);
      assert.ok(hours.slice(reading.getUTCHours()+1).every(value=>value===0));
    }
  }
});
