import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {claudeAssistant,claudeResult,claudePrompt,claudeTitle,writeClaude,appendEvents,codexToken,writeCodex,jsonl,iso} from './ledger-fixtures.mjs';
import {readLedgerSources,claude,codex,SOURCES} from '../scripts/sources/index.mjs';
import {memoryCache,openParseCache} from '../scripts/sources/parse-cache.mjs';
import {readLines} from '../scripts/sources/jsonl.mjs';
import {walkFiles} from '../scripts/sources/common.mjs';
import {readCodexSessions} from '../scripts/sources/codex.mjs';
import {utimes,rename} from 'node:fs/promises';
import {shellWrites,patchFiles,toolCategory} from '../scripts/sources/activity.mjs';

const T=Date.parse('2026-11-10T15:00:00Z');
const MIN=60000;
const byJson=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
const config={sources:{claudeCode:true,codex:true}};
const read=(home,cache=memoryCache())=>readLedgerSources({config,home,env:{},since:T-30*86400000,platform:'linux',cache});
const claudeOf=result=>result.tools.find(tool=>tool.source.id==='claude');
const codexOf=result=>result.tools.find(tool=>tool.source.id==='codex');

test('every adapter has the registry shape, so a new tool is one file',()=>{
  for(const source of SOURCES) {
    assert.match(source.id,/^[a-z][a-z0-9-]*$/);
    assert.equal(typeof source.name,'string');
    assert.ok(source.limitEngine===null || typeof source.limitEngine==='string');
    for(const key of ['folder','weeklyReset','readSessions'])assert.equal(typeof source[key],'function',`${source.id}.${key}`);
    assert.ok(source.modelFamily instanceof RegExp);
  }
});

test('Claude: a streamed request counts once at its largest, subagents carry their kind, and writes find the repository',async()=>{
  await withFolder(async home=>{
    const repo=path.join(home,'code','garden');
    await mkdir(path.join(repo,'.git'),{recursive:true});
    const cwd=repo;
    await writeClaude(home,'-code-garden','s1',[
      claudeTitle('Plant the seed rows'),
      claudePrompt({at:T,cwd}),
      claudeAssistant({id:'m1',at:T+MIN,cwd,usage:[10,100,5,2]}),
      claudeAssistant({id:'m1',at:T+MIN,cwd,usage:[10,100,5,20],tools:[['t1','Edit',{file_path:path.join(repo,'src','rows.js'),old_string:'a',new_string:'b'}]]}),
      claudeResult({at:T+2*MIN,cwd,results:[['t1',false]]}),
      claudeAssistant({id:'m2',at:T+3*MIN,cwd,stop:'end_turn',tools:[['t2','Read',{file_path:path.join(home,'elsewhere','notes.md')}]]}),
    ],{subagents:[{id:'a1',meta:{agentType:'Explore',description:'Find the soil settings'},
      events:[claudeAssistant({id:'m3',at:T+2*MIN,cwd,model:'claude-haiku-5-5',agentId:'a1'})]}]});
    const result=await read(home);
    const [session]=claudeOf(result).sessions;
    assert.equal(session.id,'s1');
    assert.equal(session.title,'Plant the seed rows');
    const m1=session.requests.find(request=>request.key==='m1');
    assert.deepEqual(m1.values,[10,100,5,20]);
    assert.equal(session.requests.length,3);
    assert.deepEqual(session.agents,[{key:'a1',kind:'search'}]);
    assert.equal(session.requests.find(request=>request.key==='m3').agent,'a1');
    // The edit is a write in the repository. Reading another folder is not.
    assert.deepEqual([...new Set(session.writes.map(write=>write.repo))],[realpathSync.native(repo)]);
    assert.equal(session.live.stop,'end_turn');
    assert.deepEqual(session.typed,[T]);
  });
});

test('Claude: consecutive failures of one call with the same input make a retry run with its tool category',async()=>{
  await withFolder(async home=>{
    const cwd=path.join(home,'code','garden');
    const call=index=>claudeAssistant({id:`m${index}`,at:T+index*MIN,cwd,tools:[[`t${index}`,'Bash',{command:'cat missing.txt'}]]});
    const events=[];
    for(let index=1;index<=4;index++)events.push(call(index),claudeResult({at:T+index*MIN+1000,cwd,results:[[`t${index}`,true]]}));
    events.push(claudeAssistant({id:'m9',at:T+9*MIN,cwd,tools:[['t9','Bash',{command:'ls'}]]}),claudeResult({at:T+9*MIN+1000,cwd,results:[['t9',false]]}));
    await writeClaude(home,'-code-garden','s2',events);
    const [session]=claudeOf(await read(home)).sessions;
    assert.deepEqual(session.runs.map(run=>[run.count,run.category]),[[4,'Shell']]);
  });
});

test('Claude: a request copied into a fork is one request, and a rate limit is noted',async()=>{
  await withFolder(async home=>{
    const cwd=path.join(home,'code','garden');
    await writeClaude(home,'-code-garden','parent',[claudeAssistant({id:'shared',at:T,cwd})]);
    await writeClaude(home,'-code-garden','fork',[claudeAssistant({id:'shared',at:T,cwd}),
      claudeAssistant({id:'limit',at:T+MIN,cwd,usage:[0,0,0,0],model:'<synthetic>',error:'rate_limit'}),
      claudeAssistant({id:'own',at:T+2*MIN,cwd})]);
    const sessions=claudeOf(await read(home)).sessions;
    const keys=sessions.flatMap(session=>session.requests.map(request=>request.key)).sort(byJson);
    // Both files hold it. The adapters return both copies and the ledger keeps one (see ledger-build tests).
    assert.deepEqual(keys,['own','shared','shared']);
    assert.deepEqual(sessions.find(session=>session.id==='fork').rateLimits,[T+MIN]);
  });
});

test('Codex: token turns, a subagent thread under its parent, a patch write and the thread name',async()=>{
  await withFolder(async home=>{
    const repo=path.join(home,'code','orchard');
    await mkdir(path.join(repo,'.git'),{recursive:true});
    const parent='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
    await writeCodex(home,parent,[
      {type:'session_meta',timestamp:iso(T),payload:{id:parent,cwd:repo,source:'cli'}},
      {type:'turn_context',timestamp:iso(T),payload:{model:'gpt-6-sol',cwd:repo}},
      {type:'event_msg',timestamp:iso(T),payload:{type:'user_message',message:'Prune the trees'}},
      {type:'response_item',timestamp:iso(T+MIN),payload:{type:'custom_tool_call',name:'apply_patch',call_id:'c1',input:'*** Begin Patch\n*** Update File: src/trees.js\n@@\n-a\n+b\n*** End Patch'}},
      {type:'response_item',timestamp:iso(T+MIN),payload:{type:'custom_tool_call_output',call_id:'c1',output:'Success'}},
      codexToken(T+MIN,[1000,800,50],[1000,800,50]),
      codexToken(T+2*MIN,[1500,1100,80],[500,300,30]),
      {type:'event_msg',timestamp:iso(T+2*MIN),payload:{type:'task_complete'}},
    ]);
    await writeCodex(home,child,[
      {type:'session_meta',timestamp:iso(T+MIN),payload:{id:child,parent_thread_id:parent,cwd:repo,agent_role:'reviewer'}},
      {type:'turn_context',timestamp:iso(T+MIN),payload:{model:'gpt-6-luna',cwd:repo}},
      codexToken(T+90000,[200,0,20],[200,0,20]),
    ]);
    await writeFile(path.join(home,'.codex','session_index.jsonl'),jsonl([{id:parent,thread_name:'Prune the orchard',updated_at:iso(T)}]));
    const [session]=codexOf(await read(home)).sessions;
    assert.equal(session.id,parent);
    assert.equal(session.title,'Prune the orchard');
    assert.deepEqual(session.requests.map(request=>[request.model,request.values,request.agent]).sort(byJson),[
      ['gpt-6-luna',[200,0,0,20],child],['gpt-6-sol',[200,800,0,50],null],['gpt-6-sol',[200,300,0,30],null]].sort(byJson));
    assert.deepEqual(session.agents,[{key:child,kind:'review'}]);
    assert.deepEqual([...new Set(session.writes.map(write=>write.repo))],[realpathSync.native(repo)]);
    assert.equal(session.live.stop,'end_turn');
    assert.equal(session.rateLimits,null,'Codex limit hits are not read, so auto-resume stays Unknown');
  });
});

test('the parse cache skips unchanged files, resumes appended ones and rereads replaced ones',async()=>{
  await withFolder(async home=>{
    const cwd=path.join(home,'code','garden');
    const file=await writeClaude(home,'-code-garden','s3',[claudeAssistant({id:'m1',at:T,cwd})]);
    const cache=memoryCache(1);
    await read(home,cache);
    assert.deepEqual(cache.stats(),{hits:0,resumed:0,read:1});
    await read(home,cache);
    assert.deepEqual(cache.stats(),{hits:1,resumed:0,read:1});
    await appendEvents(file,[claudeAssistant({id:'m2',at:T+MIN,cwd})]);
    const grown=claudeOf(await read(home,cache)).sessions[0];
    assert.equal(cache.stats().resumed,1);
    assert.deepEqual(grown.requests.map(request=>request.key).sort(byJson),['m1','m2']);
    await writeFile(file,jsonl([claudeAssistant({id:'m9',at:T,cwd})]));
    const replaced=claudeOf(await read(home,cache)).sessions[0];
    assert.deepEqual(replaced.requests.map(request=>request.key),['m9']);
  });
});

test('the parse cache survives a save and drops files no longer seen',async()=>{
  await withFolder(async folder=>{
    const file=path.join(folder,'cache.json');
    const first=await openParseCache(file,'v1');
    first.store('/a.jsonl',{size:10,mtimeMs:5,offset:10,state:{n:1}});
    first.store('/b.jsonl',{size:10,mtimeMs:5,offset:10,state:{n:2}});
    await first.save();
    const second=await openParseCache(file,'v1');
    assert.equal(second.lookup('/a.jsonl',{size:10,mtimeMs:5}).state.n,1);
    await second.save();
    assert.deepEqual(Object.keys(JSON.parse(await readFile(file,'utf8')).files),['/a.jsonl']);
    const other=await openParseCache(file,'v2');
    assert.equal(other.lookup('/a.jsonl',{size:10,mtimeMs:5}),null,'a new state version starts over');
  });
});

test('a line still being written is left for the next read',async()=>{
  await withFolder(async folder=>{
    const file=path.join(folder,'log.jsonl');
    await writeFile(file,'{"n":1}\n{"n":2');
    const seen=[];
    const first=await readLines(file,{},event=>seen.push(event.n));
    assert.deepEqual(seen,[1]);
    assert.equal(first.offset,8);
    await appendFile(file,'}\n{"n":3}\n');
    await readLines(file,{offset:first.offset},event=>seen.push(event.n));
    assert.deepEqual(seen,[1,2,3]);
  });
});

test('shell commands count as writes only when they write',()=>{
  // On Windows a path that starts with / sits on the current drive, so the expected folders resolve too.
  const at=folder=>path.resolve(folder);
  const home=at('/home/fern'),cwd=at('/home/fern/code/garden');
  assert.deepEqual(shellWrites('git status && git log --oneline | head',cwd,home).dirs,[]);
  assert.deepEqual(shellWrites('cd ~/code/orchard && git commit -am "Prune; then water" 2>&1 | tail -2',cwd,home).dirs,[at('/home/fern/code/orchard')]);
  assert.deepEqual(shellWrites('git -C /home/fern/code/pond push',cwd,home).dirs,[at('/home/fern/code/pond')]);
  assert.deepEqual(shellWrites('echo hi > notes/today.md',cwd,home).dirs,[at('/home/fern/code/garden/notes')]);
  assert.deepEqual(shellWrites("cat > /home/fern/code/pond/a.md <<'EOF'\ngit commit -m nope\nEOF",cwd,home).dirs,[at('/home/fern/code/pond')]);
  assert.deepEqual(shellWrites('ls 2>/dev/null >&2',cwd,home).dirs,[]);
  assert.deepEqual(shellWrites('echo hi > /dev/null',cwd,home).dirs,[],'the null device is not a folder');
  assert.deepEqual(shellWrites('git checkout -b feature/rows',cwd,home).branches,[{dir:cwd,name:'feature/rows'}]);
  assert.deepEqual(patchFiles('*** Begin Patch\n*** Add File: a/b.js\n*** Update File: c.md\n*** End Patch'),['a/b.js','c.md']);
  assert.deepEqual(['Bash','Edit','WebSearch','mcp__browser__click','Read'].map(toolCategory),['Shell','File edits','Research','Browser','Other tools']);
});

test('tool folders come from the environment or the home folder',()=>{
  assert.equal(claude.folder({},'/home/fern'),path.join('/home/fern','.claude'));
  assert.equal(claude.folder({CLAUDE_CONFIG_DIR:'/opt/claude'},'/home/fern'),'/opt/claude');
  assert.equal(codex.folder({CODEX_HOME:'relative'},'/home/fern'),null);
});

test('old Codex rollouts never count toward the file cap, so a long history does not stop the read',async()=>{
  await withFolder(async home=>{
    const old=new Date(T-90*86400000);
    for(let index=0;index<5;index++) {
      const thread=`3333333${index}-3333-4333-8333-333333333333`;
      const file=await writeCodex(home,thread,[{type:'session_meta',timestamp:iso(T-90*86400000),payload:{id:thread,cwd:home}}],{day:`2026/08/1${index}`});
      await utimes(file,old,old);
    }
    const recent='44444444-4444-4444-8444-444444444444';
    await writeCodex(home,recent,[
      {type:'session_meta',timestamp:iso(T),payload:{id:recent,cwd:home}},
      {type:'turn_context',timestamp:iso(T),payload:{model:'gpt-6-sol',cwd:home}},
      codexToken(T+MIN,[100,0,10],[100,0,10])]);
    const older=[];
    const found=await walkFiles(path.join(home,'.codex','sessions'),{since:T-86400000,maxFiles:2,match:name=>name.endsWith('.jsonl'),older});
    assert.equal(found.length,1);
    assert.equal(older.length,5,'old files are listed apart, uncounted');
    const sessions=await readCodexSessions(path.join(home,'.codex'),{since:T-86400000,cache:memoryCache(),home,platform:'linux',maxFiles:2});
    assert.deepEqual(sessions.map(session=>session.id),[recent]);
    await assert.rejects(walkFiles(path.join(home,'.codex','sessions'),{since:0,maxFiles:2,match:name=>name.endsWith('.jsonl')}),/Too many/,'the cap still holds inside the window');
  });
});

test('the parse cache rereads a file rewritten to start the same way, or swapped in with the same size and time',async()=>{
  await withFolder(async home=>{
    const cwd=path.join(home,'code','garden');
    const first=claudeAssistant({id:'m1',at:T,cwd});
    assert.ok(JSON.stringify(first).length>256,'the shared first line is longer than the old 256-byte check');
    const file=await writeClaude(home,'-code-garden','s4',[first,claudeAssistant({id:'m2',at:T+MIN,cwd})]);
    const cache=memoryCache(1);
    await read(home,cache);
    // A resumed session rewritten in place: the same first line, then different and longer lines.
    await writeFile(file,jsonl([first,claudeAssistant({id:'m3',at:T+2*MIN,cwd,usage:[10,100,5,2000000]}),claudeAssistant({id:'m4',at:T+3*MIN,cwd})]));
    const rewritten=claudeOf(await read(home,cache)).sessions[0];
    assert.deepEqual(rewritten.requests.map(request=>request.key).sort(),['m1','m3','m4']);
    // A file put in its place with the same size and time but different contents.
    const fixed=new Date(T);
    await utimes(file,fixed,fixed);
    await read(home,cache);
    const swap=`${file}.new`;
    await writeFile(swap,(await readFile(file,'utf8')).replace('"m4"','"m9"'));
    await utimes(swap,fixed,fixed);
    await rename(swap,file);
    const swapped=claudeOf(await read(home,cache)).sessions[0];
    assert.deepEqual(swapped.requests.map(request=>request.key).sort(),['m1','m3','m9']);
  });
});

test('a last line without a newline is read once the file has stopped changing',async()=>{
  await withFolder(async home=>{
    const cwd=path.join(home,'code','garden');
    const file=await writeClaude(home,'-code-garden','s5',[claudeAssistant({id:'m1',at:T,cwd})]);
    await appendFile(file,JSON.stringify(claudeAssistant({id:'m2',at:T+MIN,cwd})));
    const cache=memoryCache(1);
    // Just written: the last line may still be growing, so it waits.
    const busy=claudeOf(await read(home,cache)).sessions[0];
    assert.deepEqual(busy.requests.map(request=>request.key),['m1']);
    // Quiet for a while: the last line is whole, so it counts.
    const quiet=new Date(Date.now()-60000);
    await utimes(file,quiet,quiet);
    const done=claudeOf(await read(home,cache)).sessions[0];
    assert.deepEqual(done.requests.map(request=>request.key).sort(),['m1','m2']);
    const seen=[];
    await readLines(file,{final:true},event=>seen.push(event.message.id));
    assert.deepEqual(seen,['m1','m2']);
    const partial=path.join(home,'partial.jsonl');
    await writeFile(partial,'{"n":1}\n{"n":2');
    const result=await readLines(partial,{final:true},()=>{});
    assert.equal(result.offset,8,'a last line that is not whole JSON is never taken');
  });
});

test('Claude: a headless run without a title keeps its origin and the kind of its first prompt, never the prompt',async()=>{
  await withFolder(async home=>{
    const repo=path.join(home,'code','garden');
    await mkdir(path.join(repo,'.git'),{recursive:true});
    const user=(at,content,extra={})=>({type:'user',timestamp:iso(at),cwd:repo,entrypoint:'sdk-cli',message:{role:'user',content},...extra});
    await writeClaude(home,'-code-garden','headless',[
      user(T,'<command-name>/clear</command-name>'),
      user(T+1,'You are a helper',{isMeta:true}),
      user(T+2,[{type:'text',text:'<system-reminder>ignore</system-reminder>'},{type:'text',text:'Review the watering schedule for mistakes'}]),
      user(T+3,'Plant the new rows'),
      claudeAssistant({id:'h1',at:T+MIN,cwd:repo}),
    ]);
    await writeClaude(home,'-code-garden','desktop',[
      {...user(T,'Fix the gate'),entrypoint:'claude-desktop'},
      claudeAssistant({id:'d1',at:T+MIN,cwd:repo}),
    ]);
    await writeClaude(home,'-code-garden','unknown',[
      {type:'user',timestamp:iso(T),cwd:repo,message:{role:'user',content:[{type:'tool_result',tool_use_id:'x',content:'ok'}]}},
      claudeAssistant({id:'u1',at:T+MIN,cwd:repo}),
    ]);
    const sessions=new Map(claudeOf(await read(home)).sessions.map(session=>[session.id,session]));
    assert.equal(sessions.get('headless').title,null);
    assert.deepEqual([sessions.get('headless').origin,sessions.get('headless').task],['headless','review']);
    assert.deepEqual([sessions.get('desktop').origin,sessions.get('desktop').task],['interactive','build']);
    assert.deepEqual([sessions.get('unknown').origin,sessions.get('unknown').task],[null,null]);
    assert.ok(!JSON.stringify([...sessions.values()]).includes('watering schedule'),'no prompt text in a record');
    assert.equal(sessions.get('headless').gitRepo,realpathSync.native(repo),'a git repository is resolved');
  });
});

test('Claude: a session in a folder that is not a git repository has no repository',async()=>{
  await withFolder(async home=>{
    const folder=path.join(home,'Documents','letters');
    await mkdir(folder,{recursive:true});
    await writeClaude(home,'-Documents-letters','plain',[
      {type:'user',timestamp:iso(T),cwd:folder,message:{role:'user',content:'Sort these'}},
      claudeAssistant({id:'p1',at:T+MIN,cwd:folder}),
    ]);
    const session=claudeOf(await read(home)).sessions.find(item=>item.id==='plain');
    assert.equal(session.gitRepo,null);
  });
});

test('Codex: an exec run is headless and its first prompt is kept only as a kind',async()=>{
  await withFolder(async home=>{
    const repo=path.join(home,'code','cube');
    await mkdir(path.join(repo,'.git'),{recursive:true});
    const exec='33333333-3333-4333-8333-333333333333',chat='44444444-4444-4444-8444-444444444444';
    await writeCodex(home,exec,[
      {type:'session_meta',timestamp:iso(T),payload:{id:exec,cwd:repo,source:'exec',originator:'codex_exec'}},
      {type:'response_item',timestamp:iso(T),payload:{type:'message',role:'user',content:[{type:'input_text',text:'# AGENTS.md instructions for cube'}]}},
      {type:'event_msg',timestamp:iso(T),payload:{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'# AGENTS.md instructions for cube'}]}}},
      {type:'event_msg',timestamp:iso(T),payload:{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'Review the scoring module for bugs'}]}}},
      {type:'turn_context',timestamp:iso(T),payload:{model:'gpt-6-sol',cwd:repo}},
      codexToken(T+MIN,[1000,800,50],[1000,800,50]),
    ]);
    await writeCodex(home,chat,[
      {type:'session_meta',timestamp:iso(T),payload:{id:chat,cwd:repo,source:'cli',originator:'codex_cli_rs'}},
      {type:'event_msg',timestamp:iso(T),payload:{type:'user_message',message:'Fix the timer'}},
      codexToken(T+MIN,[500,100,20],[500,100,20]),
    ]);
    const sessions=new Map(codexOf(await read(home)).sessions.map(session=>[session.id,session]));
    assert.deepEqual([sessions.get(exec).origin,sessions.get(exec).task],['headless','review']);
    assert.deepEqual([sessions.get(chat).origin,sessions.get(chat).task],['interactive','build']);
    assert.ok(!JSON.stringify([...sessions.values()]).includes('scoring module'));
  });
});
