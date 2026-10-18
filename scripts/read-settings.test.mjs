import test from 'node:test';
import assert from 'node:assert/strict';
import {execPython} from './test-python.mjs';
const code = `import importlib.util,json,sys,datetime as dt
spec=importlib.util.spec_from_file_location('reader','scripts/read-settings.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.summarize(json.load(sys.stdin),dt.datetime(2026,1,1,tzinfo=dt.timezone.utc))))`;
const settings=(effort,speed)=>({timestamp:'2026-09-06T12:00:00Z',type:'event_msg',payload:{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',reasoning_effort:effort,service_tier:speed,cwd:'PRIVATE'}}});
const usage=n=>({timestamp:'2026-09-06T12:01:00Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,cached_input_tokens:n/2,cache_write_input_tokens:0,output_tokens:n/10,reasoning_output_tokens:n/20,total_tokens:n+n/10}}}});
test('settings split cumulative increments and preserve exclusive token categories',()=>{
  const output=execPython(['-c',code],{input:JSON.stringify([settings('ultra','priority'),usage(100),usage(100),settings('medium','default'),usage(200)])}).toString();
  const [rows]=JSON.parse(output);
  assert.equal(rows.length,2);assert.equal(rows[0].speed,'fast');assert.equal(rows[1].effort,'medium');
  assert.equal(rows[0].totalTokens,110);assert.equal(rows[1].totalTokens,110);assert.equal(rows[0].inputTokens,50);
  assert.ok(!output.includes('PRIVATE'));
});
test('unknown settings are not guessed and tool arguments never leave reader',()=>{
  const call={timestamp:'2026-09-06T12:00:00Z',type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'private-id',arguments:'SECRET'}};
  const output=execPython(['-c',code],{input:JSON.stringify([usage(100),call,call])}).toString();
  const [rows,tools]=JSON.parse(output);assert.equal(rows[0].effort,'unknown');assert.equal(rows[0].speed,'unknown');
  assert.equal(tools[0].count,1);assert.equal(tools[0].category,'Shell');assert.ok(!output.includes('SECRET'));assert.ok(!output.includes('private-id'));
});

test('exact tool identities preserve case and namespace without reading arguments',()=>{
  const call=(name,namespace,id,timestamp='2026-09-06T12:00:00Z')=>({timestamp,type:'response_item',payload:{type:'function_call',name,namespace,call_id:id,arguments:'PRIVATE_ARGUMENTS'}});
  const output=execPython(['-c',code],{input:JSON.stringify([
    call('ToolName','one','a'),call('ToolName','two','b'),call('toolname','one','c'),call('ToolName','one','a'),
    call('functions.exec',undefined,'d'),call('PRIVATE NAME','BAD NAMESPACE','e'),call('x'.repeat(201),null,'f'),
    call('old_tool','one','g','2025-12-01T12:00:00Z')
  ])}).toString();
  const [,rows]=JSON.parse(output);
  assert.equal(rows.length,5);
  assert.equal(rows.find(r=>r.tool==='ToolName'&&r.namespace==='one').count,1);
  assert.equal(rows.find(r=>r.tool==='ToolName'&&r.namespace==='two').count,1);
  assert.equal(rows.find(r=>r.tool==='toolname').count,1);
  assert.equal(rows.find(r=>r.tool==='functions.exec').namespace,'');
  assert.equal(rows.find(r=>r.tool==='Unknown tool').count,2);
  for(const secret of ['PRIVATE','BAD NAMESPACE','old_tool','x'.repeat(201)]) assert.ok(!output.includes(secret));
});

test('last request usage survives a cumulative reset without counting repeated reports',()=>{
  const first=usage(100),reset=usage(20);
  reset.payload.info.last_token_usage=usage(50).payload.info.total_token_usage;
  const [rows]=JSON.parse(execPython(['-c',code],{input:JSON.stringify([settings('high','standard'),first,reset,reset])}));
  assert.equal(rows[0].totalTokens,165);
  assert.equal(rows[0].speed,'standard');
});

test('selected model changes do not relabel usage from the preceding turn',()=>{
  const context=model=>({timestamp:'2026-09-06T12:00:00Z',type:'turn_context',payload:{model,effort:'high'}});
  const selected=settings('ultra','priority');
  const [rows]=JSON.parse(execPython(['-c',code],{input:JSON.stringify([
    context('gpt-5.6-sol'),usage(100),selected,usage(200),context('gpt-6-astra'),usage(300)
  ])}));
  assert.equal(rows.filter(r=>r.model==='gpt-5.6-sol').reduce((n,r)=>n+r.totalTokens,0),220);
  const astra=rows.find(r=>r.model==='gpt-6-astra');
  assert.equal(astra.totalTokens,110);assert.equal(astra.speed,'fast');assert.equal(astra.effort,'high');
});

test('inventory keys are salted and exclude raw session metadata',()=>{
  const inventoryCode=code.slice(0,code.indexOf('print(json.dumps'))+`\npayload=json.load(sys.stdin)\na=m.inventory_metadata(payload,'salt-one'); b=m.inventory_metadata(payload,'salt-two')\nprint(json.dumps([a,b]))`;
  const output=execPython(['-c',inventoryCode],{input:JSON.stringify({type:'session_meta',payload:{id:'PRIVATE-ID',parent_thread_id:'PRIVATE-PARENT',cwd:'PRIVATE-PATH',base_instructions:'SECRET'}})}).toString();
  const [a,b]=JSON.parse(output);
  assert.match(a.keys[0],/^[a-f0-9]{64}$/);assert.notEqual(a.keys[0],b.keys[0]);assert.equal(a.parents.length,1);
  assert.ok(!output.includes('PRIVATE'));assert.ok(!output.includes('SECRET'));
});

test('saved logs use UTF-8 even with a Windows legacy text default',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile
events=json.load(sys.stdin)
stamp=dt.datetime.now(dt.timezone.utc).isoformat()
events=[dict(type='session_meta',payload=dict(id='fixture',note='PRIVATE_'+chr(129)))]+events
for event in events: event['timestamp']=stamp
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory); folder=root/'sessions'; folder.mkdir()
    (folder/'one.jsonl').write_text('\\n'.join(json.dumps(e,ensure_ascii=False) for e in events),encoding='utf-8')
    original=pathlib.Path.open
    def windows_open(self,*args,**kwargs):
        mode=kwargs.get('mode',args[0] if args else 'r')
        if 'b' not in mode: kwargs.setdefault('encoding','cp1252')
        return original(self,*args,**kwargs)
    pathlib.Path.open=windows_open
    print(json.dumps(m.collect(directory)))
`;
  const output=execPython(['-c',fixture],{input:JSON.stringify([settings('high','standard'),usage(100)])}).toString();
  const result=JSON.parse(output);
  assert.equal(result.status,'ok');assert.equal(result.profiles[0].totalTokens,110);
  assert.ok(!output.includes('PRIVATE'));
});

test('private file cache warms within budget and preserves exact totals across reuse, append and truncation',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile,os,sqlite3
exec(pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
events=json.load(sys.stdin)
stamp=dt.datetime.now(dt.timezone.utc).isoformat()
for event in events: event['timestamp']=stamp
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve(); logs=root/'logs'; (logs/'sessions').mkdir(parents=True)
    cache=root/'cache'; cache.mkdir(mode=0o700)
    def content(identity,rows):
        return '\\n'.join(json.dumps(e) for e in [dict(type='session_meta',payload=dict(id=identity,note='PRIVATE_META'))]+rows)+'\\n'
    one=logs/'sessions/one.jsonl'; two=logs/'sessions/two.jsonl'
    one.write_text(content('PRIVATE_ONE',events),encoding='utf-8')
    two.write_text(content('PRIVATE_TWO',events),encoding='utf-8')
    expected=m.collect(logs)
    m.CACHE_DIRECTORY=str(cache); m.CACHE_SCAN_BUDGET=max(one.stat().st_size,two.stat().st_size)+10
    try:
        m.collect(logs)
        raise AssertionError('Incomplete warmup reported success')
    except ValueError as error:
        assert 'warming' in str(error)
    assert m.collect(logs)==expected
    with sqlite3.connect(cache/'events.sqlite') as db:
        assert db.execute('select count(*) from events').fetchone()[0]==2
    db.close()
    check=m.SettingsCache(cache); check.events(one,one.stat()); check.events(two,two.stat())
    assert check.hits==2 and check.scanned_bytes==0; check.close()
    with sqlite3.connect(cache/'events.sqlite') as db:
        db.execute("UPDATE events SET data='[null]' WHERE key=(SELECT key FROM events LIMIT 1)")
    db.close()
    assert m.collect(logs)==expected
    m.CACHE_SCAN_BUDGET=100000
    appended=dict(events[-1]); appended['payload']=dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=200,cached_input_tokens=100,cache_write_input_tokens=0,output_tokens=20,reasoning_output_tokens=10,total_tokens=220)))
    one.write_text(content('PRIVATE_ONE',events+[appended]),encoding='utf-8')
    cached=m.collect(logs); saved=m.CACHE_DIRECTORY; del m.CACHE_DIRECTORY
    assert cached==m.collect(logs); m.CACHE_DIRECTORY=saved
    one.write_text(content('PRIVATE_ONE',events[:1]),encoding='utf-8')
    cached=m.collect(logs); del m.CACHE_DIRECTORY
    assert cached==m.collect(logs)
    assert b'PRIVATE' not in (cache/'events.sqlite').read_bytes()
    print(json.dumps(dict(ok=True)))
`;
  const call={timestamp:'2026-09-06T12:00:00Z',type:'response_item',payload:{type:'function_call',name:'exec_command',namespace:'functions',call_id:'PRIVATE_CALL_ID',arguments:'PRIVATE_ARGUMENTS'}};
  const output=execPython(['-c',fixture],{input:JSON.stringify([settings('high','standard'),call,call,usage(100)])}).toString();
  assert.deepEqual(JSON.parse(output),{ok:true});
});

test('cached allowlisted events reproduce rolling cutoff, reset and setting semantics without private text',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib
exec(pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
events=json.load(sys.stdin)
safe=[value for event in events if (value:=m.cache_event(event)) is not None]
assert all(m.cache_event(event,cached=True)==event for event in safe)
for cutoff in [dt.datetime(2026,9,6,12,0,tzinfo=dt.timezone.utc),dt.datetime(2026,9,6,12,2,tzinfo=dt.timezone.utc)]:
    assert m.summarize(events,cutoff)==m.summarize(safe,cutoff)
assert 'PRIVATE' not in json.dumps(safe)
print(json.dumps(dict(ok=True)))
`;
  const reset=usage(20);reset.timestamp='2026-09-06T12:03:00Z';reset.payload.info.last_token_usage=usage(50).payload.info.total_token_usage;
  const output=execPython(['-c',fixture],{input:JSON.stringify([settings('ultra','priority'),usage(100),usage(100),settings('medium','default'),reset,reset])}).toString();
  assert.deepEqual(JSON.parse(output),{ok:true});
});

test('cache retries one transient log change without expanding its scan budget',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile
exec(pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
events=json.load(sys.stdin)
for event in events: event['timestamp']=dt.datetime.now(dt.timezone.utc).isoformat()
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve(); logs=root/'logs'; (logs/'sessions').mkdir(parents=True)
    cache=root/'cache'; cache.mkdir(mode=0o700)
    file=logs/'sessions/one.jsonl'
    rows=[dict(type='session_meta',payload=dict(id='PRIVATE_ID'))]+events
    file.write_text('\\n'.join(json.dumps(row) for row in rows)+'\\n',encoding='utf-8')
    expected=m.collect(logs)
    original=m.SettingsCache
    class ChangingCache(original):
        attempts=0
        spent=0
        change_always=False
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs)
            ChangingCache.attempts+=1
        def events(self,file,expected):
            if ChangingCache.attempts==1 or ChangingCache.change_always:
                with file.open('a',encoding='utf-8') as stream: stream.write('\\n')
            return super().events(file,expected)
        def close(self):
            ChangingCache.spent+=self.scanned_bytes
            super().close()
    m.SettingsCache=ChangingCache; m.CACHE_DIRECTORY=str(cache); m.CACHE_SCAN_BUDGET=100000
    assert m.collect(logs)==expected
    assert ChangingCache.attempts==2 and ChangingCache.spent<=m.CACHE_SCAN_BUDGET
    ChangingCache.attempts=0; ChangingCache.change_always=True
    try:
        m.collect(logs)
        raise AssertionError('Continuously changing log reported success')
    except ValueError as error:
        assert 'warming' in str(error)
    assert ChangingCache.attempts==2
    print(json.dumps(dict(ok=True)))
`;
  const output=execPython(['-c',fixture],{input:JSON.stringify([settings('high','standard'),usage(100)])}).toString();
  assert.deepEqual(JSON.parse(output),{ok:true});
});

test('retained tokens include old archives, canonical copies and fork continuations with warm-cache parity',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile,os
exec(pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
events=json.load(sys.stdin)
old=events[0]; old['timestamp']='2024-01-01T12:00:00Z'
now=dt.datetime.now(dt.timezone.utc).isoformat()
recent=events[1]; recent['timestamp']=now
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve(); logs=root/'logs'
    (logs/'sessions').mkdir(parents=True); (logs/'archived_sessions').mkdir()
    cache=root/'cache'; cache.mkdir(mode=0o700)
    def save(path,identity,rows,parent=None,turn='PRIVATE_SHARED_TURN'):
        meta=dict(type='session_meta',payload=dict(id=identity,forked_from_id=parent,note='PRIVATE'))
        context=dict(type='turn_context',payload=dict(turn_id=turn))
        path.write_text('\\n'.join(json.dumps(row) for row in [meta,context]+rows)+'\\n',encoding='utf-8')
        os.utime(path,(1,1))
    save(logs/'sessions/parent.jsonl','parent',[old,recent])
    save(logs/'archived_sessions/copy.jsonl','parent',[old])
    child=dict(recent); child['timestamp']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=1)).isoformat()
    save(logs/'archived_sessions/child.jsonl','child',[old,child], 'parent')
    save(logs/'sessions/unrelated.jsonl','unrelated',[old])
    save(logs/'archived_sessions/stale-copy.jsonl','unrelated',[], 'parent')
    expected=m.collect(logs)
    assert sum(r['totalTokens'] for r in expected['tokenProfiles'])==440
    assert sum(r['totalTokens'] for r in expected['profiles'])==220
    assert any(r['date']=='2024-01-01' for r in expected['tokenProfiles'])
    assert all(r['date']!='2024-01-01' for r in expected['profiles'])
    m.CACHE_DIRECTORY=str(cache)
    assert m.collect(logs)==expected
    # No raw scan budget is needed when all selected files are cached.
    m.CACHE_SCAN_BUDGET=0
    assert m.collect(logs)==expected
    assert b'PRIVATE' not in (cache/'events.sqlite').read_bytes()
    # A distinct turn with identical counters and timestamp is separate usage.
    distinct=logs/'sessions/distinct.jsonl'
    save(distinct,'distinct',[old], 'parent', 'PRIVATE_OTHER_TURN')
    m.CACHE_SCAN_BUDGET=100000
    assert sum(r['totalTokens'] for r in m.collect(logs)['tokenProfiles'])==550
    distinct.unlink()
    # A changed canonical archive must replace its previous contribution.
    save(logs/'archived_sessions/child.jsonl','child',[old], 'parent')
    m.CACHE_SCAN_BUDGET=100000
    assert sum(r['totalTokens'] for r in m.collect(logs)['tokenProfiles'])==330
    print(json.dumps(dict(ok=True)))
`;
  assert.deepEqual(JSON.parse(execPython(['-c',fixture],{input:JSON.stringify([usage(100),usage(200)])})),{ok:true});
});

test('malformed session metadata preserves local token counts but withholds inventory eligibility',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile
events=json.load(sys.stdin)
for event in events: event['timestamp']=dt.datetime.now(dt.timezone.utc).isoformat()
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory); (root/'sessions').mkdir(); (root/'archived_sessions').mkdir()
    for index,payload in enumerate([None, [], 'PRIVATE_METADATA']):
        file=root/'sessions'/f'{index}.jsonl'
        rows=[dict(type='session_meta',payload=payload)]+events
        file.write_text('\\n'.join(json.dumps(row) for row in rows)+'\\n',encoding='utf-8')
    m.INVENTORY_SALT='test-salt'
    result=m.collect(root)
    assert result['status']=='ok' and result['inventory']['status']=='incomplete'
    assert sum(row['totalTokens'] for row in result['profiles'])==330
    assert sum(row['totalTokens'] for row in result['tokenProfiles'])==330
    print(json.dumps(dict(ok=True)))
`;
  assert.deepEqual(JSON.parse(execPython(['-c',fixture],{input:JSON.stringify([usage(100)])})),{ok:true});
});

test('hour totals use retained deduplicated event times across hour and daylight saving boundaries',()=>{
  const fixture=code.slice(0,code.indexOf('print(json.dumps'))+`
import pathlib,tempfile
exec(pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8'),m.__dict__)
events=json.load(sys.stdin)
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve()
    logs=root/'logs'
    (logs/'sessions').mkdir(parents=True)
    cache=root/'cache'
    cache.mkdir(mode=0o700)
    def save(name,rows,parent=None):
        meta=dict(type='session_meta',payload=dict(id=name,forked_from_id=parent))
        context=dict(type='turn_context',payload=dict(turn_id='synthetic-turn'))
        (logs/'sessions'/name).with_suffix('.jsonl').write_text('\\n'.join(json.dumps(row) for row in [meta,context]+rows)+'\\n',encoding='utf-8')
    save('parent',events)
    save('child',events,'parent')
    result=m.collect(logs)
    m.CACHE_DIRECTORY=str(cache)
    assert m.collect(logs)==result
    m.CACHE_SCAN_BUDGET=0
    assert m.collect(logs)==result
    print(json.dumps(result))
`;
  const stamps=['2024-01-01T13:59:00Z','2024-01-01T14:01:00Z',
    '2024-03-10T06:59:00Z','2024-03-10T07:01:00Z','2024-11-03T05:30:00Z','2024-11-03T06:30:00Z'];
  const events=stamps.map((timestamp,i)=>({...usage((i+1)*100),timestamp}));
  events.push({...events.at(-1)}, {...settings('high','standard'),timestamp:'2024-01-02T12:00:00Z'});
  const result=JSON.parse(execPython(['-c',fixture],{input:JSON.stringify(events)}));
  assert.deepEqual(result.hourTotals.map(row=>row.date),['2024-01-01','2024-03-10','2024-11-03']);
  assert.equal(result.hourTotals[0].hours[8],110);assert.equal(result.hourTotals[0].hours[9],110);
  assert.equal(result.hourTotals[1].hours[1],110);assert.equal(result.hourTotals[1].hours[2],0);assert.equal(result.hourTotals[1].hours[3],110);
  assert.equal(result.hourTotals[2].hours[1],220);
  for(const row of result.hourTotals) {
    assert.equal(row.hours.length,24);assert.ok(row.hours.every(value=>Number.isSafeInteger(value) && value>=0));
    assert.equal(row.hours.reduce((sum,value)=>sum+value,0),result.tokenProfiles.filter(day=>day.date===row.date).reduce((sum,day)=>sum+day.totalTokens,0));
  }
  for(const row of [...result.profiles,...result.tokenProfiles]) {
    assert.equal(Object.hasOwn(row,'hours'),false);assert.equal(Object.hasOwn(row,'hourTotals'),false);
  }
});

const limitFixture = `
import pathlib,tempfile,types,json,subprocess,sys
reader_source=pathlib.Path('scripts/read-settings.py').read_text(encoding='utf-8')
cache_source=pathlib.Path('scripts/read-settings-cache.py').read_text(encoding='utf-8')
def patched(changes=None):
    source=reader_source+'\\n'+cache_source
    for name,value in (changes or {}).items():
        import re
        source,count=re.subn(r'^'+name+r' = .+$',name+' = '+repr(value),source,flags=re.M)
        assert count==1
    module=types.ModuleType('fixture_reader')
    exec(source,module.__dict__)
    return module

def unavailable(action):
    try:
        action()
    except ValueError:
        return
    raise AssertionError('Over-limit history returned a partial or successful report')

meta=json.dumps(dict(type='session_meta',payload=dict(id='synthetic')))+'\\n'
event=dict(timestamp='2026-10-01T12:00:00Z',type='event_msg',payload=dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=100,cached_input_tokens=50,output_tokens=10,reasoning_output_tokens=5,total_tokens=110))))
content=meta+json.dumps(event)+'\\n'
`;

function runLimitFixture(body) {
  assert.deepEqual(JSON.parse(execPython(['-c',limitFixture+body+`\nprint(json.dumps(dict(ok=True)))\n`])),{ok:true});
}

test('Codex reader constants pin the requested scale and unchanged line skip',()=>{
  runLimitFixture(`
m=patched()
assert m.MAX_FILES==100_000
assert m.MAX_TOTAL_BYTES==2*1024**3
assert m.MAX_LINES==3_000_000
assert m.MAX_LINE_BYTES==8_000_000
assert m.MAX_READ_SECONDS==45
assert m.MAX_CACHE_BYTES==2*1024**3
assert m.CACHE_PAGE_SIZE==4096
assert m.MAX_CACHE_PAGES==524288
assert m.MAX_RETAINED_BYTES==256*1024**2
assert m.DEFAULT_SCAN_BYTES==2*1024**3
`);
});

for (const limit of ['MAX_FILES','MAX_TOTAL_BYTES','MAX_LINES']) {
  test(`${limit} accepts below and at the cap and refuses one past it with and without cache`,()=>{
    runLimitFixture(`
for cached in (False,True):
    for offset in (1,0,-1):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory).resolve()
            logs=root/'logs'
            (logs/'sessions').mkdir(parents=True)
            (logs/'sessions/one.jsonl').write_text(content,encoding='utf-8')
            (logs/'sessions/two.jsonl').write_text(content.replace('synthetic','second-id'),encoding='utf-8')
            # The inventory reads the first line before the full session scan.
            amount={'MAX_FILES':2,'MAX_TOTAL_BYTES':2*len((meta+content).encode()),'MAX_LINES':6}['${limit}']
            m=patched({'${limit}':amount+offset})
            if cached:
                cache=root/'cache'
                cache.mkdir(mode=0o700)
                m.CACHE_DIRECTORY=str(cache)
            if offset<0:
                unavailable(lambda:m.collect(logs))
            else:
                result=m.collect(logs)
                assert result['status']=='ok'
                assert result['tokenProfiles'][0]['totalTokens']==220
`);
  });
}

test('retained event limit accepts below and at the cap and refuses one past on cold and warm cache',()=>{
  runLimitFixture(`
for warm in (False,True):
    for offset in (1,0,-1):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory).resolve()
            logs=root/'logs'
            (logs/'sessions').mkdir(parents=True)
            (logs/'sessions/one.jsonl').write_text(content,encoding='utf-8')
            cache=root/'cache'
            cache.mkdir(mode=0o700)
            m=patched()
            amount=len(json.dumps(m.cache_event(event)))
            m.CACHE_DIRECTORY=str(cache)
            if warm:
                assert m.collect(logs)['status']=='ok'
            m=patched({'MAX_RETAINED_BYTES':amount+offset})
            m.CACHE_DIRECTORY=str(cache)
            if offset<0:
                unavailable(lambda:m.collect(logs))
            else:
                assert m.collect(logs)['tokenProfiles'][0]['totalTokens']==110
`);
});

test('cache file size accepts below and at the cap and refuses one past it',()=>{
  runLimitFixture(`
for offset in (1,0,-1):
    with tempfile.TemporaryDirectory() as directory:
        root=pathlib.Path(directory).resolve()
        root.chmod(0o700)
        m=patched()
        cache=m.SettingsCache(root)
        assert cache.db.execute('PRAGMA max_page_count').fetchone()[0]==524288
        cache.close()
        amount=(root/'events.sqlite').stat().st_size
        m=patched({'MAX_CACHE_BYTES':amount+offset})
        if offset<0:
            unavailable(lambda:m.SettingsCache(root))
        else:
            cache=m.SettingsCache(root)
            cache.close()
`);
});

test('tiny time budget exits without partial JSON through the existing collector failure path',()=>{
  runLimitFixture(`
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve()
    (root/'sessions').mkdir()
    (root/'sessions/one.jsonl').write_text(content,encoding='utf-8')
    script=root/'reader.py'
    script.write_text(reader_source.replace('MAX_READ_SECONDS = 45','MAX_READ_SECONDS = 0.000000001'),encoding='utf-8')
    result=subprocess.run([sys.executable,str(script),str(root)],capture_output=True,text=True)
    assert result.returncode!=0
    assert result.stdout==''
    assert 'ValueError: Read time limit' in result.stderr
`);
});

test('one synthetic retained history above the old 16 MB cap reads and reuses its cache',()=>{
  runLimitFixture(`
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory).resolve()
    logs=root/'logs'
    (logs/'sessions').mkdir(parents=True)
    cache=root/'cache'
    cache.mkdir(mode=0o700)
    m=patched()
    safe=json.dumps(m.cache_event(event))
    count=16_000_000//len(safe)+1
    assert count*len(safe)>16_000_000
    (logs/'sessions/one.jsonl').write_text(meta+(json.dumps(event)+'\\n')*count,encoding='utf-8')
    m.CACHE_DIRECTORY=str(cache)
    result=m.collect(logs)
    assert result['status']=='ok'
    assert result['tokenProfiles'][0]['totalTokens']==110
    assert m.collect(logs)==result
`);
});

test('elapsed budget during cold and warm reads withholds already accumulated totals',()=>{
  runLimitFixture(`
for warm in (False,True):
    with tempfile.TemporaryDirectory() as directory:
        root=pathlib.Path(directory).resolve()
        logs=root/'logs'
        (logs/'sessions').mkdir(parents=True)
        (logs/'sessions/one.jsonl').write_text(content,encoding='utf-8')
        cache=root/'cache'
        cache.mkdir(mode=0o700)
        m=patched({'MAX_READ_SECONDS':0.001})
        m.CACHE_DIRECTORY=str(cache)
        clock=[0.0]
        m.time=types.SimpleNamespace(monotonic=lambda:clock[0])
        if warm:
            assert m.collect(logs)['status']=='ok'
        original=m.summarize
        def slow_summary(*args,**kwargs):
            result=original(*args,**kwargs)
            clock[0]+=0.002
            return result
        m.summarize=slow_summary
        unavailable(lambda:m.collect(logs))
`);
});

test('skipped oversized lines still consume the total read budget',()=>{
  runLimitFixture(`
for cached in (False,True):
    with tempfile.TemporaryDirectory() as directory:
        root=pathlib.Path(directory).resolve()
        logs=root/'logs'
        (logs/'sessions').mkdir(parents=True)
        skipped='x'*8_000_001+'\\n'
        data=meta+skipped+json.dumps(event)+'\\n'
        (logs/'sessions/one.jsonl').write_text(data,encoding='utf-8')
        amount=len((meta+data).encode())
        for offset in (0,-1):
            m=patched({'MAX_TOTAL_BYTES':amount+offset,'MAX_LINES':4})
            if cached:
                cache=root/('cache'+str(offset))
                cache.mkdir(mode=0o700)
                m.CACHE_DIRECTORY=str(cache)
            if offset<0:
                unavailable(lambda:m.collect(logs))
            else:
                assert m.collect(logs)['tokenProfiles'][0]['totalTokens']==110
`);
});
