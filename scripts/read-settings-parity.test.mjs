// Parity between read-settings.py and read-settings.mjs on synthetic data.
// Delete this file together with the Python reader. The golden files it
// checks keep read-settings-node.test.mjs meaningful after that.
// Set OBSERVATORY_UPDATE_READ_SETTINGS_GOLDENS=1 to rewrite the golden files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execPython} from './test-python.mjs';
import {collectSettings,summarize} from './read-settings.mjs';
import {cacheEvent} from './read-settings-cache.mjs';
import {FIXTURE_NAMES,buildFixture,fixtureOptions} from './fixtures/read-settings/build.mjs';

const goldens=fileURLToPath(new URL('./fixtures/read-settings/',import.meta.url));
const update=process.env.OBSERVATORY_UPDATE_READ_SETTINGS_GOLDENS==='1';

const loader=`import json,sys,types,datetime as dt,pathlib
m=types.ModuleType('reader')
exec(pathlib.Path('scripts/read-settings.py').read_text(encoding='utf-8')+'\\n'+pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
`;
const collectCode=loader+`
root,now,salt,cache,budget=sys.argv[1:6]
fixed=dt.datetime.fromisoformat(now.replace('Z','+00:00'))
class Fixed(dt.datetime):
    @classmethod
    def now(cls,tz=None): return fixed
m.dt=types.SimpleNamespace(datetime=Fixed,timezone=dt.timezone,timedelta=dt.timedelta)
if salt: m.INVENTORY_SALT=salt
if cache: m.CACHE_DIRECTORY=cache
if budget: m.CACHE_SCAN_BUDGET=int(budget)
try:
    print(json.dumps({'ok':m.collect(root)},allow_nan=False))
except Exception as error:
    print(json.dumps({'error':type(error).__name__}))
`;
const pythonCollect=(root,options,cache=null,budget=null)=>JSON.parse(execPython(['-c',collectCode,root,options.now.toISOString(),
  options.inventorySalt??'',cache??'',budget===null?'':String(budget)],{maxBuffer:1<<26}).toString());
async function nodeCollect(root,options,cache=null,budget=null) {
  try {return {ok:JSON.parse(JSON.stringify(await collectSettings(root,{...options,cacheDirectory:cache,cacheScanBudget:budget})))};}
  catch(error) {return {error:error.name};}
}
// Error classes differ in name across the languages. Only failure itself must match.
const outcome=value=>value.error?{error:true}:value;

function temporary() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'observatory-read-settings-')));
}
function privateFolder(base,name) {
  const folder=path.join(base,name);
  fs.mkdirSync(folder,{mode:0o700});
  fs.chmodSync(folder,0o700);
  return folder;
}

for(const name of FIXTURE_NAMES) {
  test(`fixture ${name} matches Python without cache, with a cold cache and with a warm cache`,async()=>{
    const base=temporary();
    try {
      const root=buildFixture(path.join(base,'codex'),name);
      const options=fixtureOptions(name);
      const plain=pythonCollect(root,options);
      assert.deepEqual(outcome(await nodeCollect(root,options)),outcome(plain));
      const pythonCache=privateFolder(base,'python-cache'),nodeCache=privateFolder(base,'node-cache');
      const cached=pythonCollect(root,options,pythonCache);
      assert.deepEqual(outcome(await nodeCollect(root,options,nodeCache)),outcome(cached));
      assert.deepEqual(outcome(await nodeCollect(root,options,nodeCache)),outcome(cached));
      assert.deepEqual(outcome(pythonCollect(root,options,pythonCache)),outcome(cached));
      for(const result of [plain,cached])assert.ok(!JSON.stringify(result).includes('PRIVATE'));
      const file=path.join(goldens,`expected-${name}.json`);
      const golden={plain:outcome(plain),cached:outcome(cached)};
      if(update)fs.writeFileSync(file,JSON.stringify(golden,null,1)+'\n');
      else assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),golden);
    } finally {fs.rmSync(base,{recursive:true,force:true});}
  });
}

test('each implementation reuses a cache the other one warmed without scanning',async()=>{
  for(const name of ['basic','lineage','malformed']) {
    const base=temporary();
    try {
      const root=buildFixture(path.join(base,'codex'),name);
      const options=fixtureOptions(name);
      const fromPython=privateFolder(base,'from-python'),fromNode=privateFolder(base,'from-node');
      const expected=pythonCollect(root,options,fromPython);
      assert.ok(expected.ok);
      assert.deepEqual(await nodeCollect(root,options,fromPython,0),expected);
      assert.deepEqual(await nodeCollect(root,options,fromNode),expected);
      assert.deepEqual(pythonCollect(root,options,fromNode,0),expected);
      assert.deepEqual(fs.readFileSync(path.join(fromPython,'events.sqlite')).length>0,true);
    } finally {fs.rmSync(base,{recursive:true,force:true});}
  }
});

const summarizeCode=loader+`
cases=json.load(sys.stdin)
out=[]
for case in cases:
    cutoff=dt.datetime.fromisoformat(case['cutoff'].replace('Z','+00:00'))
    safe=[]
    for event in case['events']:
        try:
            safe.append(m.cache_event(event))
        except Exception as error:
            safe.append({'error':type(error).__name__})
    result={'safe':safe}
    for key,events in (('raw',case['events']),('cached',[e for e in safe if e is not None and 'error' not in e])):
        retained,seen,hours={},set(),{}
        try:
            rows,tools=m.summarize(events,cutoff,retained,seen,hours)
            result[key]={'ok':[rows,tools,list(retained.values()),sorted(hours.items())]}
        except Exception as error:
            result[key]={'error':type(error).__name__}
    out.append(result)
print(json.dumps(out))
`;
function nodeSummaries(cases) {
  return JSON.parse(JSON.stringify(cases.map(({cutoff,events})=>{
    const safe=events.map(event=>{
      try {return cacheEvent(event);}
      catch(error) {return {error:error.name};}
    });
    const result={safe};
    for(const [key,list] of [['raw',events],['cached',safe.filter(e=>e!==null&&!e.error)]]) {
      const retained=new Map(),seen=new Set(),hours=new Map();
      try {
        const [rows,tools]=summarize(list,new Date(cutoff),{retained,seen,hourTotals:hours});
        result[key]={ok:[rows,tools,[...retained.values()],[...hours.entries()].sort((a,b)=>a[0]<b[0]?-1:1)]};
      } catch(error) {result[key]={error:error.name};}
    }
    return result;
  })));
}
function compareSummaries(cases) {
  const python=JSON.parse(execPython(['-c',summarizeCode],{input:JSON.stringify(cases),maxBuffer:1<<26}).toString());
  const node=nodeSummaries(cases);
  assert.equal(node.length,python.length);
  const errorsOnly=value=>value?.error?{error:true}:value;
  python.forEach((expected,i)=>{
    const actual=node[i];
    assert.deepEqual(actual.safe.map(errorsOnly),expected.safe.map(errorsOnly),`cache events for case ${i}`);
    assert.deepEqual(errorsOnly(actual.raw),errorsOnly(expected.raw),`raw summary for case ${i}`);
    assert.deepEqual(errorsOnly(actual.cached),errorsOnly(expected.cached),`cached summary for case ${i}`);
  });
  return python;
}

// A deterministic generator so failures can be replayed.
function random(seed) {
  return ()=>{
    seed|=0;seed=seed+0x6d2b79f5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
const TIMESTAMPS=['2026-10-14T10:00:00Z','2026-10-14T10:00:00.5Z','2026-10-14T10:00:00.500Z','2026-10-14T10:00:00.123456Z',
  '2026-10-14T23:30:00-05:00','2026-10-15T03:30:00Z','2026-10-14T10:00:00+05:45','2026-10-14 10:00:00Z','2026-10-14T10Z',
  '2026-10-14T10:00Z','2026-10-14T10:00:00','2026-10-14','2026-13-14T10:00:00Z','2026-10-14T10:00:00+25:00','not a time',
  '2026-11-01T05:59:59Z','2026-11-01T06:00:00Z','2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-10-07T12:00:00Z',
  '2026-10-07T11:59:59.999999Z','2026-10-07T07:00:00-05:00','2026-10-07T12:00:00.000001Z','2026-10-14T10:00:00\u2014ZZ',
  '2026-10-14\ud83d\ude0010:00:00Z','2026-10-14\ud80010:00:00Z','2026-10-14T10:00:00+00:00:00.000001','2026-10-14T10:00:00-00:00',
  '1883-11-18T16:59:59Z','1883-11-18T17:00:00Z','0001-01-01T05:00:00Z','0001-01-01T04:56:01Z','9999-12-31T23:59:59Z',
  '9999-12-31T23:59:59+01:00','2026-02-29T00:00:00Z','2024-02-29T00:00:00Z','2026-10-14T24:00:00Z','2026-10-14T10:60:00Z',
  '2026-10-14T10:00:60Z','2026-10-14T10:00:00.1234567Z','2026-10-14T10:00:00,123Z','2026-10-14T10:00:00.123+05:30:15.250000',
  '2026-10-14T10:00:00+99:00','2026-10-14T10:00:00-23:59:59.999999','2026-10-14T10:00:00+23:59:60','2026-10-14T1',
  '2026-10-14T10:0','2026-10-14T10:00:00Z ','2026-10-14T10:00:00\u0000','2026-10-14T10\u0000'];
// Stamps that stop the raw reader appear rarely, so most streams reach a summary.
const FAILING=new Set(['2026-10-14T10:00:00','2026-10-14','0001-01-01T04:56:01Z','2026-10-14T10:00:00\u0000','2026-10-14T10\u0000']);
const COMMON=TIMESTAMPS.filter(timestamp=>!FAILING.has(timestamp));
const MODELS=['gpt-6-astra','gpt-5.6-sol','gpt-6-astra','PRIVATE MODEL',null,5,'x'.repeat(101),'model/é:1',''];
const EFFORTS=['high','medium','ultra','low','bogus',null,'xhigh'];
const TIERS=['priority','default','fast','standard','flex',null,7];
const TOOLS=['exec_command','apply_patch','browser_click','web.search','history.read','notes__write','spawn_agent','Bad Name',null,'shell','cua_click'];
function randomStream(next) {
  const pick=list=>list[Math.floor(next()*list.length)];
  const events=[];
  let total=0;
  const counters=(n,{bad=false}={})=>({input_tokens:n,cached_input_tokens:Math.floor(n/3),cache_write_input_tokens:Math.floor(n/7),
    output_tokens:bad?-1:Math.floor(n/4),reasoning_output_tokens:Math.floor(n/9),total_tokens:n+Math.floor(n/4)});
  const count=5+Math.floor(next()*30);
  for(let i=0;i<count;i++) {
    const roll=next();
    const timestamp=next()<0.08?undefined:next()<0.03?pick([...FAILING]):pick(COMMON);
    let event;
    if(roll<0.15) {
      const settings={};
      if(next()<0.8)settings.model=pick(MODELS);
      if(next()<0.6)settings.reasoning_effort=pick(EFFORTS);
      if(next()<0.6)settings.service_tier=pick(TIERS);
      event={type:pick(['event_msg','event_msg','turn_context','other']),payload:{type:'thread_settings_applied',thread_settings:settings}};
    } else if(roll<0.3) {
      const payload={model:pick(MODELS),effort:pick(EFFORTS),turn_id:pick(['turn-1','turn-2','turn-3',null])};
      if(next()<0.3)payload.service_tier=pick(TIERS);
      if(next()<0.1)payload.usage_turn_key=pick(['key-1',3,0,'',true]);
      event={type:'turn_context',payload};
    } else if(roll<0.75) {
      const step=next();
      if(step<0.6)total+=Math.floor(next()*500);
      else if(step<0.7)total=Math.floor(next()*100);
      const info={total_token_usage:counters(total,{bad:next()<0.05})};
      if(next()<0.25)info.last_token_usage=counters(Math.floor(next()*300),{bad:next()<0.05});
      if(next()<0.05)info.total_token_usage.total_tokens+=5;
      if(next()<0.05)delete info.total_token_usage.cache_write_input_tokens;
      event={type:'event_msg',payload:{type:'token_count',info}};
    } else if(roll<0.95) {
      const payload={type:pick(['function_call','custom_tool_call']),name:pick(TOOLS),call_id:pick(['c1','c2','c3','c4','c5',null])};
      if(next()<0.3)payload.namespace=pick(['functions','history','notes','mcp__x','BAD NS']);
      event={type:'response_item',payload};
    } else {
      event={type:pick(['event_msg','response_item']),payload:pick([null,[],'text',{type:'message'},0])};
    }
    if(timestamp!==undefined)event.timestamp=timestamp;
    events.push(event);
  }
  return events;
}

test('timestamps parse, convert to New York days and compare with the cutoff as Python does',()=>{
  const context={type:'turn_context',payload:{model:'gpt-6-astra',effort:'high',turn_id:'turn'}};
  const cases=TIMESTAMPS.map((timestamp,i)=>({cutoff:'2026-10-07T12:00:00.000Z',events:[context,
    {timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100+i,cached_input_tokens:0,output_tokens:10,reasoning_output_tokens:0,total_tokens:110+i}}}},
    {timestamp,type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'c'}}]}));
  const python=compareSummaries(cases);
  assert.ok(python.some(row=>row.raw.ok?.[0].length)&&python.some(row=>row.raw.error));
});

test('random synthetic event streams summarize identically, raw and through the cache filter',()=>{
  const next=random(20261015);
  const cases=Array.from({length:300},()=>({cutoff:'2026-10-07T12:00:00.000Z',events:randomStream(next)}));
  const python=compareSummaries(cases);
  assert.ok(python.filter(row=>row.raw.ok?.[0].length).length>150);
});
