// Tests for read-settings.mjs. These port read-settings.test.mjs and check
// the saved Python results under fixtures/read-settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {
  CACHE_PAGE_SIZE,DEFAULT_LIMITS,DEFAULT_SCAN_BYTES,FIRST_LINE_BYTES,MAX_CACHE_BYTES,MAX_FILES,MAX_LINES,MAX_LINE_BYTES,MAX_READ_SECONDS,
  MAX_RETAINED_BYTES,MAX_TOTAL_BYTES,collectSettings,inventoryMetadata,pyDumps,summarize,
} from './read-settings.mjs';
import {SettingsCache,cacheEvent} from './read-settings-cache.mjs';
import {FIXTURE_NAMES,buildFixture,fixtureOptions} from './fixtures/read-settings/build.mjs';

const reader=fileURLToPath(new URL('./read-settings.mjs',import.meta.url));
const goldens=fileURLToPath(new URL('./fixtures/read-settings/',import.meta.url));
// Parsed JSON input, as the reader receives it from a log line.
const parsed=value=>JSON.parse(JSON.stringify(value));
const run=(events,cutoff=new Date('2026-01-01T00:00:00Z'))=>{
  const result=summarize(parsed(events),cutoff);
  return {result,output:JSON.stringify(result)};
};
const settings=(effort,speed)=>({timestamp:'2026-09-06T12:00:00Z',type:'event_msg',payload:{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',reasoning_effort:effort,service_tier:speed,cwd:'PRIVATE'}}});
const usage=n=>({timestamp:'2026-09-06T12:01:00Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,cached_input_tokens:n/2,cache_write_input_tokens:0,output_tokens:n/10,reasoning_output_tokens:n/20,total_tokens:n+n/10}}}});
const now=()=>new Date().toISOString();
const sum=rows=>rows.reduce((n,row)=>n+row.totalTokens,0);

function temporary() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'observatory-read-settings-')));
}
async function inTemporary(action) {
  const root=temporary();
  try {return await action(root);}
  finally {fs.rmSync(root,{recursive:true,force:true});}
}
function privateFolder(folder) {
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.chmodSync(folder,0o700);
  return folder;
}
const jsonl=rows=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
const stat=file=>fs.statSync(file,{bigint:true});
function cacheRows(cache) {
  const db=new DatabaseSync(path.join(cache,'events.sqlite'));
  try {return db.prepare('SELECT * FROM events ORDER BY key').all().map(row=>({...row}));}
  finally {db.close();}
}

test('settings split cumulative increments and preserve exclusive token categories',()=>{
  const {result:[rows],output}=run([settings('ultra','priority'),usage(100),usage(100),settings('medium','default'),usage(200)]);
  assert.equal(rows.length,2);assert.equal(rows[0].speed,'fast');assert.equal(rows[1].effort,'medium');
  assert.equal(rows[0].totalTokens,110);assert.equal(rows[1].totalTokens,110);assert.equal(rows[0].inputTokens,50);
  assert.ok(!output.includes('PRIVATE'));
});

test('unknown settings are not guessed and tool arguments never leave reader',()=>{
  const call={timestamp:'2026-09-06T12:00:00Z',type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'private-id',arguments:'SECRET'}};
  const {result:[rows,tools],output}=run([usage(100),call,call]);
  assert.equal(rows[0].effort,'unknown');assert.equal(rows[0].speed,'unknown');
  assert.equal(tools[0].count,1);assert.equal(tools[0].category,'Shell');assert.ok(!output.includes('SECRET'));assert.ok(!output.includes('private-id'));
});

test('exact tool identities preserve case and namespace without reading arguments',()=>{
  const call=(name,namespace,id,timestamp='2026-09-06T12:00:00Z')=>({timestamp,type:'response_item',payload:{type:'function_call',name,namespace,call_id:id,arguments:'PRIVATE_ARGUMENTS'}});
  const {result:[,rows],output}=run([
    call('ToolName','one','a'),call('ToolName','two','b'),call('toolname','one','c'),call('ToolName','one','a'),
    call('functions.exec',undefined,'d'),call('PRIVATE NAME','BAD NAMESPACE','e'),call('x'.repeat(201),null,'f'),
    call('old_tool','one','g','2025-12-01T12:00:00Z'),
  ]);
  assert.equal(rows.length,5);
  assert.equal(rows.find(r=>r.tool==='ToolName'&&r.namespace==='one').count,1);
  assert.equal(rows.find(r=>r.tool==='ToolName'&&r.namespace==='two').count,1);
  assert.equal(rows.find(r=>r.tool==='toolname').count,1);
  assert.equal(rows.find(r=>r.tool==='functions.exec').namespace,'');
  assert.equal(rows.find(r=>r.tool==='Unknown tool').count,2);
  for(const secret of ['PRIVATE','BAD NAMESPACE','old_tool','x'.repeat(201)])assert.ok(!output.includes(secret));
});

test('last request usage survives a cumulative reset without counting repeated reports',()=>{
  const first=usage(100),reset=usage(20);
  reset.payload.info.last_token_usage=usage(50).payload.info.total_token_usage;
  const {result:[rows]}=run([settings('high','standard'),first,reset,reset]);
  assert.equal(rows[0].totalTokens,165);
  assert.equal(rows[0].speed,'standard');
});

test('selected model changes do not relabel usage from the preceding turn',()=>{
  const context=model=>({timestamp:'2026-09-06T12:00:00Z',type:'turn_context',payload:{model,effort:'high'}});
  const {result:[rows]}=run([context('gpt-5.6-sol'),usage(100),settings('ultra','priority'),usage(200),context('gpt-6-astra'),usage(300)]);
  assert.equal(sum(rows.filter(r=>r.model==='gpt-5.6-sol')),220);
  const astra=rows.find(r=>r.model==='gpt-6-astra');
  assert.equal(astra.totalTokens,110);assert.equal(astra.speed,'fast');assert.equal(astra.effort,'high');
});

test('inventory keys are salted and exclude raw session metadata',()=>{
  const payload=parsed({type:'session_meta',payload:{id:'PRIVATE-ID',parent_thread_id:'PRIVATE-PARENT',cwd:'PRIVATE-PATH',base_instructions:'SECRET'}});
  const a=inventoryMetadata(payload,'salt-one'),b=inventoryMetadata(payload,'salt-two');
  const output=JSON.stringify([a,b]);
  assert.match(a.keys[0],/^[a-f0-9]{64}$/);assert.notEqual(a.keys[0],b.keys[0]);assert.equal(a.parents.length,1);
  assert.ok(!output.includes('PRIVATE'));assert.ok(!output.includes('SECRET'));
});

test('saved logs are read as UTF-8 bytes',async()=>{
  await inTemporary(async root=>{
    const stamp=now();
    const events=[{type:'session_meta',payload:{id:'fixture',note:'PRIVATE_\u0081'}},settings('high','standard'),usage(100)].map(e=>({...e,timestamp:stamp}));
    fs.mkdirSync(path.join(root,'sessions'));
    fs.writeFileSync(path.join(root,'sessions/one.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'),'utf8');
    const result=await collectSettings(root);
    assert.equal(result.status,'ok');assert.equal(result.profiles[0].totalTokens,110);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  });
});

test('private file cache warms within budget and preserves exact totals across reuse, append and truncation',async()=>{
  await inTemporary(async root=>{
    const call={timestamp:'2026-09-06T12:00:00Z',type:'response_item',payload:{type:'function_call',name:'exec_command',namespace:'functions',call_id:'PRIVATE_CALL_ID',arguments:'PRIVATE_ARGUMENTS'}};
    const stamp=now();
    const events=[settings('high','standard'),call,call,usage(100)].map(e=>({...e,timestamp:stamp}));
    const logs=path.join(root,'logs');fs.mkdirSync(path.join(logs,'sessions'),{recursive:true});
    const cache=privateFolder(path.join(root,'cache'));
    const content=(identity,rows)=>jsonl([{type:'session_meta',payload:{id:identity,note:'PRIVATE_META'}},...rows]);
    const one=path.join(logs,'sessions/one.jsonl'),two=path.join(logs,'sessions/two.jsonl');
    fs.writeFileSync(one,content('PRIVATE_ONE',events));
    fs.writeFileSync(two,content('PRIVATE_TWO',events));
    const expected=await collectSettings(logs);
    let budget=Math.max(fs.statSync(one).size,fs.statSync(two).size)+10;
    await assert.rejects(collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:budget}),/warming/);
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:budget}),expected);
    assert.equal(cacheRows(cache).length,2);
    const check=new SettingsCache(cache);
    check.events(one,stat(one));check.events(two,stat(two));
    assert.equal(check.hits,2);assert.equal(check.scannedBytes,0);check.close();
    const db=new DatabaseSync(path.join(cache,'events.sqlite'));
    db.exec("UPDATE events SET data='[null]' WHERE key=(SELECT key FROM events LIMIT 1)");
    db.close();
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:budget}),expected);
    budget=100000;
    const appended={...events.at(-1),payload:{type:'token_count',info:{total_token_usage:{input_tokens:200,cached_input_tokens:100,cache_write_input_tokens:0,output_tokens:20,reasoning_output_tokens:10,total_tokens:220}}}};
    fs.writeFileSync(one,content('PRIVATE_ONE',[...events,appended]));
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:budget}),await collectSettings(logs));
    fs.writeFileSync(one,content('PRIVATE_ONE',events.slice(0,1)));
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:budget}),await collectSettings(logs));
    assert.ok(!fs.readFileSync(path.join(cache,'events.sqlite')).includes('PRIVATE'));
  });
});

test('cached allowlisted events reproduce rolling cutoff, reset and setting semantics without private text',()=>{
  const reset=usage(20);reset.timestamp='2026-09-06T12:03:00Z';reset.payload.info.last_token_usage=usage(50).payload.info.total_token_usage;
  const events=parsed([settings('ultra','priority'),usage(100),usage(100),settings('medium','default'),reset,reset]);
  const safe=events.map(event=>cacheEvent(event)).filter(value=>value!==null);
  for(const event of safe)assert.deepEqual(cacheEvent(event,true),event);
  for(const cutoff of [new Date('2026-09-06T12:00:00Z'),new Date('2026-09-06T12:02:00Z')])
    assert.deepEqual(summarize(events,cutoff),summarize(safe,cutoff));
  assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
});

test('cache retries one transient log change without expanding its scan budget',async()=>{
  await inTemporary(async root=>{
    const stamp=now();
    const logs=path.join(root,'logs');fs.mkdirSync(path.join(logs,'sessions'),{recursive:true});
    const cache=privateFolder(path.join(root,'cache'));
    const file=path.join(logs,'sessions/one.jsonl');
    fs.writeFileSync(file,jsonl([{type:'session_meta',payload:{id:'PRIVATE_ID'}},...[settings('high','standard'),usage(100)].map(e=>({...e,timestamp:stamp}))]));
    const expected=await collectSettings(logs);
    class ChangingCache extends SettingsCache {
      static attempts=0;
      static spent=0;
      static changeAlways=false;
      constructor(...args) {super(...args);ChangingCache.attempts+=1;}
      events(target,info) {
        if(ChangingCache.attempts===1||ChangingCache.changeAlways)fs.appendFileSync(target,'\n');
        return super.events(target,info);
      }
      close(options) {ChangingCache.spent+=this.scannedBytes;super.close(options);}
    }
    const options={cacheDirectory:cache,cacheScanBudget:100000,cacheClass:ChangingCache};
    assert.deepEqual(await collectSettings(logs,options),expected);
    assert.equal(ChangingCache.attempts,2);assert.ok(ChangingCache.spent<=100000);
    ChangingCache.attempts=0;ChangingCache.changeAlways=true;
    await assert.rejects(collectSettings(logs,options),/warming/);
    assert.equal(ChangingCache.attempts,2);
  });
});

// The limit tests use the same synthetic lines as the Python tests, in Python's JSON format.
const meta=pyDumps({type:'session_meta',payload:{id:'synthetic'}})+'\n';
const event={timestamp:'2026-10-01T12:00:00Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:50,output_tokens:10,reasoning_output_tokens:5,total_tokens:110}}}};
const content=meta+pyDumps(event)+'\n';
const bytes=text=>Buffer.byteLength(text);
function sessionsFolder(root) {
  const logs=path.join(root,'logs');
  fs.mkdirSync(path.join(logs,'sessions'),{recursive:true});
  return logs;
}

test('a long non-ASCII session metadata line keeps its identity and invalid UTF-8 still fails closed',async()=>{
  await inTemporary(async root=>{
    const logs=sessionsFolder(root);
    const file=path.join(logs,'sessions/one.jsonl');
    const tail=pyDumps(event)+'\n';
    const line=JSON.stringify({type:'session_meta',payload:{id:'synthetic-session',note:'€'.repeat(400_000)}})+'\n';
    assert.ok(bytes(line)>1_000_000&&line.length<1_000_000);
    fs.writeFileSync(file,line+tail);
    const result=await collectSettings(logs,{inventorySalt:'synthetic-salt'});
    assert.equal(result.status,'ok');
    assert.equal(result.inventory.status,'ok');
    fs.writeFileSync(file,Buffer.concat([Buffer.from('{"type":"session_meta","payload":{"id":"synthetic'),Buffer.from([0xff]),Buffer.from('"}}\n'+tail)]));
    await assert.rejects(collectSettings(logs,{inventorySalt:'synthetic-salt'}));
  });
});

test('retained tokens include old archives, canonical copies and fork continuations with warm-cache parity',async()=>{
  await inTemporary(async root=>{
    const [old,recent]=parsed([usage(100),usage(200)]);
    old.timestamp='2024-01-01T12:00:00Z';
    recent.timestamp=now();
    const logs=path.join(root,'logs');
    fs.mkdirSync(path.join(logs,'sessions'),{recursive:true});fs.mkdirSync(path.join(logs,'archived_sessions'));
    const cache=privateFolder(path.join(root,'cache'));
    const save=(file,identity,rows,parent=null,turn='PRIVATE_SHARED_TURN')=>{
      const target=path.join(logs,file);
      fs.writeFileSync(target,jsonl([{type:'session_meta',payload:{id:identity,forked_from_id:parent,note:'PRIVATE'}},{type:'turn_context',payload:{turn_id:turn}},...rows]));
      fs.utimesSync(target,1,1);
    };
    save('sessions/parent.jsonl','parent',[old,recent]);
    save('archived_sessions/copy.jsonl','parent',[old]);
    const child={...recent,timestamp:new Date(Date.now()+1000).toISOString()};
    save('archived_sessions/child.jsonl','child',[old,child],'parent');
    save('sessions/unrelated.jsonl','unrelated',[old]);
    save('archived_sessions/stale-copy.jsonl','unrelated',[],'parent');
    const expected=await collectSettings(logs);
    assert.equal(sum(expected.tokenProfiles),440);
    assert.equal(sum(expected.profiles),220);
    assert.ok(expected.tokenProfiles.some(r=>r.date==='2024-01-01'));
    assert.ok(expected.profiles.every(r=>r.date!=='2024-01-01'));
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache}),expected);
    // No raw scan budget is needed when all selected files are cached.
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:0}),expected);
    assert.ok(!fs.readFileSync(path.join(cache,'events.sqlite')).includes('PRIVATE'));
    // A distinct turn with identical counters and timestamp is separate usage.
    save('sessions/distinct.jsonl','distinct',[old],'parent','PRIVATE_OTHER_TURN');
    assert.equal(sum((await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:100000})).tokenProfiles),550);
    fs.unlinkSync(path.join(logs,'sessions/distinct.jsonl'));
    // A changed canonical archive must replace its previous contribution.
    save('archived_sessions/child.jsonl','child',[old],'parent');
    assert.equal(sum((await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:100000})).tokenProfiles),330);
  });
});

test('malformed session metadata preserves local token counts but withholds inventory eligibility',async()=>{
  await inTemporary(async root=>{
    fs.mkdirSync(path.join(root,'sessions'));fs.mkdirSync(path.join(root,'archived_sessions'));
    const stamp=now();
    [null,[],'PRIVATE_METADATA'].forEach((payload,index)=>{
      fs.writeFileSync(path.join(root,'sessions',`${index}.jsonl`),jsonl([{type:'session_meta',payload},{...usage(100),timestamp:stamp}]));
    });
    const result=await collectSettings(root,{inventorySalt:'test-salt'});
    assert.equal(result.status,'ok');assert.equal(result.inventory.status,'incomplete');
    assert.equal(sum(result.profiles),330);
    assert.equal(sum(result.tokenProfiles),330);
  });
});

test('hour totals use retained deduplicated event times across hour and daylight saving boundaries',async()=>{
  const stamps=['2024-01-01T13:59:00Z','2024-01-01T14:01:00Z',
    '2024-03-10T06:59:00Z','2024-03-10T07:01:00Z','2024-11-03T05:30:00Z','2024-11-03T06:30:00Z'];
  const events=stamps.map((timestamp,i)=>({...usage((i+1)*100),timestamp}));
  events.push({...events.at(-1)},{...settings('high','standard'),timestamp:'2024-01-02T12:00:00Z'});
  const result=await inTemporary(async root=>{
    const logs=sessionsFolder(root);
    const cache=privateFolder(path.join(root,'cache'));
    const save=(name,parent=null)=>fs.writeFileSync(path.join(logs,'sessions',`${name}.jsonl`),
      jsonl([{type:'session_meta',payload:{id:name,forked_from_id:parent}},{type:'turn_context',payload:{turn_id:'synthetic-turn'}},...events]));
    save('parent');
    save('child','parent');
    const value=await collectSettings(logs);
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache}),value);
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache,cacheScanBudget:0}),value);
    return value;
  });
  assert.deepEqual(result.hourTotals.map(row=>row.date),['2024-01-01','2024-03-10','2024-11-03']);
  assert.equal(result.hourTotals[0].hours[8],110);assert.equal(result.hourTotals[0].hours[9],110);
  assert.equal(result.hourTotals[1].hours[1],110);assert.equal(result.hourTotals[1].hours[2],0);assert.equal(result.hourTotals[1].hours[3],110);
  assert.equal(result.hourTotals[2].hours[1],220);
  for(const row of result.hourTotals) {
    assert.equal(row.hours.length,24);assert.ok(row.hours.every(value=>Number.isSafeInteger(value)&&value>=0));
    assert.equal(row.hours.reduce((total,value)=>total+value,0),sum(result.tokenProfiles.filter(day=>day.date===row.date)));
  }
  for(const row of [...result.profiles,...result.tokenProfiles]) {
    assert.equal(Object.hasOwn(row,'hours'),false);assert.equal(Object.hasOwn(row,'hourTotals'),false);
  }
});

test('private settings cache recovers an empty file and refuses other formats',async()=>{
  await inTemporary(async root=>{
    for(const kind of ['empty','table','non-SQLite','schema-free','version','application-id']) {
      const cache=privateFolder(path.join(root,kind));
      const file=path.join(cache,'events.sqlite');
      fs.closeSync(fs.openSync(file,'wx',0o600));
      if(kind==='non-SQLite')fs.writeFileSync(file,'synthetic invalid database');
      else if(kind!=='empty') {
        const db=new DatabaseSync(file);
        if(kind==='table')db.exec('CREATE TABLE other(value TEXT)');
        else if(kind==='application-id')db.exec('PRAGMA application_id=123');
        else if(kind==='version') {
          db.exec('CREATE TABLE events (key TEXT PRIMARY KEY, signature TEXT NOT NULL, data TEXT NOT NULL)');
          db.exec('PRAGMA user_version=2');
        } else db.exec('PRAGMA user_version=1');
        db.close();
      }
      if(kind==='empty') {
        const log=path.join(root,'synthetic.jsonl');
        for(const effort of ['high','medium']) {
          const line={type:'turn_context',payload:{model:'synthetic-model',effort}};
          fs.writeFileSync(log,JSON.stringify(line)+'\n');
          let check=new SettingsCache(cache);
          assert.equal(check.db.prepare('PRAGMA user_version').get().user_version,1);
          const expected=[cacheEvent(line)];
          assert.deepEqual(check.events(log,stat(log)),expected);
          check.close();
          check=new SettingsCache(cache);
          assert.deepEqual(check.events(log,stat(log)),expected);
          assert.equal(check.hits,1);
          check.close();
        }
      } else {
        const before=fs.readFileSync(file);
        assert.ok(before.length>0);
        assert.throws(()=>new SettingsCache(cache),
          error=>error.message===(kind==='non-SQLite'?'file is not a database':'Unsupported cache format'));
        assert.deepEqual(fs.readFileSync(file),before);
      }
    }
  });
});

test('Codex reader constants pin the requested scale and unchanged line skip',()=>{
  assert.equal(MAX_FILES,100_000);
  assert.equal(MAX_TOTAL_BYTES,2*1024**3);
  assert.equal(MAX_LINES,3_000_000);
  assert.equal(MAX_LINE_BYTES,8_000_000);
  assert.equal(MAX_READ_SECONDS,45);
  assert.equal(FIRST_LINE_BYTES,4_000_000);
  assert.equal(MAX_CACHE_BYTES,2*1024**3);
  assert.equal(CACHE_PAGE_SIZE,4096);
  assert.equal(Math.floor(MAX_CACHE_BYTES/CACHE_PAGE_SIZE),524288);
  assert.equal(MAX_RETAINED_BYTES,64*1024**2);
  assert.equal(DEFAULT_SCAN_BYTES,2*1024**3);
});

test('a first line longer than the first line limit follows the invalid metadata path without decoding',async()=>{
  for(const cached of [false,true]) {
    await inTemporary(async root=>{
      const logs=sessionsFolder(root);
      const file=path.join(logs,'sessions/one.jsonl');
      const options={inventorySalt:'synthetic-salt',cacheDirectory:cached?privateFolder(path.join(root,'cache')):null};
      const tail=pyDumps(event)+'\n';
      fs.writeFileSync(file,'invalid metadata\n'+tail);
      const expected=await collectSettings(logs,options);
      const first=' '.repeat(3_999_999)+'€\n';
      assert.deepEqual([...Buffer.from(first).subarray(3_999_999,4_000_002)],[0xe2,0x82,0xac]);
      fs.writeFileSync(file,first+tail);
      const result=await collectSettings(logs,options);
      assert.deepEqual(result,expected);
      assert.equal(result.status,'ok');
      assert.equal(result.inventory.status,'incomplete');
      assert.equal(result.tokenProfiles[0].totalTokens,110);
    });
  }
});

test('an interrupted byte limited pass keeps cached entries for unreached files',async()=>{
  await inTemporary(async root=>{
    const logs=sessionsFolder(root);
    const one=path.join(logs,'sessions/one.jsonl'),two=path.join(logs,'sessions/two.jsonl');
    const first=content.replaceAll('synthetic','a'),second=content.replaceAll('synthetic','b');
    fs.writeFileSync(one,first);fs.writeFileSync(two,second);
    const cache=privateFolder(path.join(root,'cache'));
    assert.equal((await collectSettings(logs,{cacheDirectory:cache})).status,'ok');
    const saved=cacheRows(cache);
    assert.equal(saved.length,2);
    // Invalidate the first entry so its scan exceeds the inventory byte allowance.
    fs.writeFileSync(one,first+'\n');
    const amount=bytes(first.split('\n')[0]+'\n')+bytes(second.split('\n')[0]+'\n');
    const reached=[];
    class TrackingCache extends SettingsCache {
      events(file,info) {reached.push(file);return super.events(file,info);}
    }
    const options={cacheDirectory:cache,cacheScanBudget:2*1024**3,cacheClass:TrackingCache};
    await assert.rejects(collectSettings(logs,{...options,limits:{maxTotalBytes:amount}}),/Session read limit/);
    assert.deepEqual(reached,[one]);
    assert.deepEqual(cacheRows(cache),saved);
    assert.equal((await collectSettings(logs,options)).tokenProfiles[0].totalTokens,220);
    fs.renameSync(two,path.join(logs,'sessions/two.txt'));
    assert.equal((await collectSettings(logs,options)).tokenProfiles[0].totalTokens,110);
    assert.equal(cacheRows(cache).length,1);
  });
});

for(const [limit,amount] of [['maxFiles',2],['maxTotalBytes',2*bytes(meta+content)],['maxLines',6]]) {
  test(`${limit} accepts below and at the cap and refuses one past it with and without cache`,async()=>{
    for(const cached of [false,true]) {
      for(const offset of [1,0,-1]) {
        await inTemporary(async root=>{
          const logs=sessionsFolder(root);
          fs.writeFileSync(path.join(logs,'sessions/one.jsonl'),content);
          fs.writeFileSync(path.join(logs,'sessions/two.jsonl'),content.replaceAll('synthetic','second-id'));
          // The inventory reads the first line before the full session scan.
          const options={limits:{[limit]:amount+offset},cacheDirectory:cached?privateFolder(path.join(root,'cache')):null};
          if(offset<0)await assert.rejects(collectSettings(logs,options),/Too many files|Session read limit/);
          else {
            const result=await collectSettings(logs,options);
            assert.equal(result.status,'ok');
            assert.equal(result.tokenProfiles[0].totalTokens,220);
          }
        });
      }
    }
  });
}

test('retained event limit accepts below and at the cap and refuses one past on cold and warm cache',async()=>{
  const amount=pyDumps(cacheEvent(parsed(event))).length;
  for(const warm of [false,true]) {
    for(const offset of [1,0,-1]) {
      await inTemporary(async root=>{
        const logs=sessionsFolder(root);
        fs.writeFileSync(path.join(logs,'sessions/one.jsonl'),content);
        const cache=privateFolder(path.join(root,'cache'));
        if(warm)assert.equal((await collectSettings(logs,{cacheDirectory:cache})).status,'ok');
        const options={cacheDirectory:cache,limits:{maxRetainedBytes:amount+offset}};
        if(offset<0)await assert.rejects(collectSettings(logs,options),/Private event cache entry limit/);
        else assert.equal((await collectSettings(logs,options)).tokenProfiles[0].totalTokens,110);
      });
    }
  }
});

test('cache file size accepts below and at the cap and refuses one past it',async()=>{
  for(const offset of [1,0,-1]) {
    await inTemporary(async root=>{
      fs.chmodSync(root,0o700);
      let cache=new SettingsCache(root);
      assert.equal(cache.db.prepare('PRAGMA max_page_count').get().max_page_count,524288);
      cache.close();
      const amount=fs.statSync(path.join(root,'events.sqlite')).size;
      const limits={...DEFAULT_LIMITS,maxCacheBytes:amount+offset};
      if(offset<0)assert.throws(()=>new SettingsCache(root,undefined,{limits}),/Unsafe cache file/);
      else {
        cache=new SettingsCache(root,undefined,{limits});
        cache.close();
      }
    });
  }
});

test('tiny time budget exits without partial JSON through the command line failure path',async()=>{
  await inTemporary(async root=>{
    fs.mkdirSync(path.join(root,'sessions'));
    fs.writeFileSync(path.join(root,'sessions/one.jsonl'),content);
    const script=`import {main} from ${JSON.stringify(new URL('./read-settings.mjs',import.meta.url).href)};
main([${JSON.stringify(root)}],{limits:{maxReadSeconds:1e-9}}).catch(error=>{process.stderr.write(error.name+': '+error.message+'\\n');process.exitCode=1;});`;
    const result=spawnSync(process.execPath,['--no-warnings','--input-type=module','-e',script],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.equal(result.stdout,'');
    assert.ok(result.stderr.includes('ValueError: Read time limit'));
  });
});

test('command line prints the same report and fails without output for a missing folder',async()=>{
  await inTemporary(async root=>{
    const codex=buildFixture(path.join(root,'codex'),'lineage');
    const printed=JSON.parse(execFileSync(process.execPath,['--no-warnings',reader,codex],{encoding:'utf8'}));
    const direct=await collectSettings(codex);
    assert.deepEqual(printed.tokenProfiles,direct.tokenProfiles);
    assert.deepEqual(printed.hourTotals,direct.hourTotals);
    const cache=privateFolder(path.join(root,'cache'));
    const cachedRun=JSON.parse(execFileSync(process.execPath,['--no-warnings',reader,codex,cache],{encoding:'utf8'}));
    assert.deepEqual(cachedRun.tokenProfiles,direct.tokenProfiles);
    assert.ok(fs.statSync(path.join(cache,'events.sqlite')).size>0);
    const missing=spawnSync(process.execPath,['--no-warnings',reader,path.join(root,'missing')],{encoding:'utf8'});
    assert.equal(missing.status,1);
    assert.equal(missing.stdout,'');
  });
});

test('one synthetic retained history above the old 16 MB cap reads and reuses its cache',async()=>{
  await inTemporary(async root=>{
    const logs=sessionsFolder(root);
    const cache=privateFolder(path.join(root,'cache'));
    const safe=pyDumps(cacheEvent(parsed(event)));
    const count=Math.floor(16_000_000/safe.length)+1;
    assert.ok(count*safe.length>16_000_000);
    fs.writeFileSync(path.join(logs,'sessions/one.jsonl'),meta+(pyDumps(event)+'\n').repeat(count));
    const result=await collectSettings(logs,{cacheDirectory:cache});
    assert.equal(result.status,'ok');
    assert.equal(result.tokenProfiles[0].totalTokens,110);
    assert.deepEqual(await collectSettings(logs,{cacheDirectory:cache}),result);
  });
});

test('elapsed budget during cold and warm reads withholds already accumulated totals',async()=>{
  for(const warm of [false,true]) {
    await inTemporary(async root=>{
      const logs=sessionsFolder(root);
      fs.writeFileSync(path.join(logs,'sessions/one.jsonl'),content);
      const cache=privateFolder(path.join(root,'cache'));
      let clock=0;
      const options={cacheDirectory:cache,limits:{maxReadSeconds:0.001},clock:()=>clock};
      if(warm)assert.equal((await collectSettings(logs,options)).status,'ok');
      // Time passes after the session is summarized, before the cache is finished.
      class SlowCache extends SettingsCache {
        close(closing) {clock+=0.002;super.close(closing);}
      }
      await assert.rejects(collectSettings(logs,{...options,cacheClass:SlowCache}),/Read time limit/);
    });
  }
});

test('skipped oversized lines still consume the total read budget',async()=>{
  for(const cached of [false,true]) {
    await inTemporary(async root=>{
      const logs=sessionsFolder(root);
      const data=meta+'x'.repeat(8_000_001)+'\n'+pyDumps(event)+'\n';
      fs.writeFileSync(path.join(logs,'sessions/one.jsonl'),data);
      const amount=bytes(meta+data);
      for(const offset of [0,-1]) {
        const options={limits:{maxTotalBytes:amount+offset,maxLines:4},cacheDirectory:cached?privateFolder(path.join(root,`cache${offset}`)):null};
        if(offset<0)await assert.rejects(collectSettings(logs,options),/Session read limit/);
        else assert.equal((await collectSettings(logs,options)).tokenProfiles[0].totalTokens,110);
      }
    });
  }
});

// Saved Python results for the synthetic fixtures. They stay valid after the Python reader is removed.
for(const name of FIXTURE_NAMES) {
  test(`fixture ${name} matches the saved Python result without and with a cache`,async()=>{
    const expected=JSON.parse(fs.readFileSync(path.join(goldens,`expected-${name}.json`),'utf8'));
    await inTemporary(async root=>{
      const codex=buildFixture(path.join(root,'codex'),name);
      const options=fixtureOptions(name);
      for(const [mode,cache] of [['plain',null],['cached',privateFolder(path.join(root,'cache'))],['cached',path.join(root,'cache')]]) {
        let actual;
        try {actual={ok:JSON.parse(JSON.stringify(await collectSettings(codex,{...options,cacheDirectory:cache})))};}
        catch {actual={error:true};}
        assert.deepEqual(actual,expected[mode],`${name} ${mode}`);
        assert.ok(!JSON.stringify(actual).includes('PRIVATE'));
      }
    });
  });
}
