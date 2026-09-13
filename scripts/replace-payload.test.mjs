import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,symlinkSync,realpathSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {replacePayload,inspectPayloadRecovery} from '../native/windows/replace-payload.mjs';
import {spawnSync} from 'node:child_process';

function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'observatory-replacement-test-'));
  // macOS exposes its temporary directory through an alias.
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}
function setup(t) {
  const root=realpathSync(fixture(t));
  for(const name of ['installed','staged','private-data'])mkdirSync(path.join(root,name));
  writeFileSync(path.join(root,'installed','payload'),'old');
  writeFileSync(path.join(root,'staged','payload'),'new');
  writeFileSync(path.join(root,'private-data','history'),'private fixture unchanged');
  const verify=(folder,kind)=>{
    assert.equal(readFileSync(path.join(folder,'payload'),'utf8'),kind==='previous'?'old':'new');
    return {sourceRevision:(kind==='previous'?'a':'b').repeat(40),buildNumber:kind==='previous'?7:8};
  };
  return {root,installed:path.join(root,'installed'),staged:path.join(root,'staged'),verify};
}
test('promotion retains old payload and a durable journal without touching private data',t=>{
  const f=setup(t),result=replacePayload(f);
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'new');
  assert.equal(readFileSync(path.join(result.previous,'payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(f.root,'private-data','history'),'utf8'),'private fixture unchanged');
  assert.equal(existsSync(f.staged),false);
  const states=readFileSync(result.journal,'utf8').trim().split('\n').map(line=>JSON.parse(line).state);
  assert.deepEqual(states,['prepared','previous-retained','candidate-promoted','payload-verified']);
});
test('failed post-promotion verification restores the old payload and retains the rejected candidate',t=>{
  const f=setup(t),base=f.verify;
  f.verify=(folder,kind)=>{
    if(folder===f.installed && kind==='candidate')throw Error('Injected candidate failure');
    return base(folder,kind);
  };
  let failure;
  try {replacePayload(f);}catch(error){failure=error;}
  assert.ok(failure?.restored);
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(failure.recovery,'rejected','payload'),'utf8'),'new');
  assert.match(readFileSync(path.join(failure.recovery,'transaction.jsonl'),'utf8'),/previous-restored/);
});
test('preflight failure and stale versions leave both payloads untouched',t=>{
  const f=setup(t);
  for(const verify of [()=>{throw Error('Invalid payload');},()=>({sourceRevision:'a'.repeat(40),buildNumber:7})])
    assert.throws(()=>replacePayload({...f,verify}));
  assert.deepEqual(readdirSync(f.root).sort(),['installed','private-data','staged']);
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(f.staged,'payload'),'utf8'),'new');
});
test('a failed promotion restores the previous directory without deleting the candidate',t=>{
  const f=setup(t),base=f.verify,moved=path.join(f.root,'moved-candidate');
  f.verify=(folder,kind)=>{
    const identity=base(folder,kind);
    if(kind==='candidate')renameSync(f.staged,moved);
    return identity;
  };
  assert.throws(()=>replacePayload(f),error=>error.restored===true);
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(moved,'payload'),'utf8'),'new');
});
test('blocked rollback retains every payload and reports recovery required',t=>{
  const f=setup(t),base=f.verify;
  f.verify=(folder,kind)=>{
    if(folder===f.installed && kind==='candidate') {
      const recovery=path.join(f.root,readdirSync(f.root).find(name=>name.startsWith('.observatory-update-')));
      mkdirSync(path.join(recovery,'rejected'));
      writeFileSync(path.join(recovery,'rejected','unrelated'),'preserve');
      throw Error('Injected rollback obstruction');
    }
    return base(folder,kind);
  };
  let failure;
  try {replacePayload(f);}catch(error){failure=error;}
  assert.equal(failure?.restored,false);
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'new');
  assert.equal(readFileSync(path.join(failure.recovery,'previous','payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(failure.recovery,'rejected','unrelated'),'utf8'),'preserve');
  assert.match(readFileSync(path.join(failure.recovery,'transaction.jsonl'),'utf8'),/recovery-required/);
});
test('linked and nested candidates are refused before any move',t=>{
  const f=setup(t),linked=path.join(f.root,'linked');
  symlinkSync(f.staged,linked,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>replacePayload({...f,staged:linked}));
  const nested=path.join(f.installed,'nested');mkdirSync(nested);
  assert.throws(()=>replacePayload({...f,staged:nested}));
  assert.throws(()=>replacePayload({...f,staged:f.installed}));
  assert.equal(readFileSync(path.join(f.installed,'payload'),'utf8'),'old');
});

test('recovery inspects retained payloads instead of trusting journal claims',t=>{
  const f=setup(t),recovery=path.join(f.root,'.observatory-update-interrupted');mkdirSync(recovery);
  const options={...f,recovery};
  writeFileSync(path.join(recovery,'transaction.jsonl'),'untrusted or truncated journal');
  assert.equal(inspectPayloadRecovery(options).state,'previous-active');
  renameSync(f.installed,path.join(recovery,'previous'));
  assert.equal(inspectPayloadRecovery(options).state,'previous-awaiting-restore');
  renameSync(f.staged,f.installed);
  assert.equal(inspectPayloadRecovery(options).state,'candidate-active');
  writeFileSync(path.join(f.installed,'payload'),'corrupt');
  assert.equal(inspectPayloadRecovery(options).state,'manual-inspection');
  assert.equal(readFileSync(path.join(recovery,'previous','payload'),'utf8'),'old');
  assert.equal(readFileSync(path.join(recovery,'transaction.jsonl'),'utf8'),'untrusted or truncated journal');
});

test('a killed replacement process retains a verifiable candidate and old app',t=>{
  const f=setup(t);
  const code=`
    import {readFileSync} from 'node:fs';
    import path from 'node:path';
    import {replacePayload} from ${JSON.stringify(new URL('../native/windows/replace-payload.mjs',import.meta.url).href)};
    const installed=${JSON.stringify(f.installed)},staged=${JSON.stringify(f.staged)};
    replacePayload({installed,staged,verify:(folder,kind)=>{
      if(folder===installed && kind==='candidate')process.kill(process.pid,'SIGKILL');
      if(readFileSync(path.join(folder,'payload'),'utf8')!==(kind==='previous'?'old':'new'))throw Error('Invalid fixture');
      return {sourceRevision:(kind==='previous'?'a':'b').repeat(40),buildNumber:kind==='previous'?7:8};
    }});
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:10000,encoding:'utf8'});
  assert.notEqual(child.status,0);
  const folders=readdirSync(f.root).filter(name=>name.startsWith('.observatory-update-'));
  assert.equal(folders.length,1);
  const recovery=path.join(f.root,folders[0]);
  assert.equal(inspectPayloadRecovery({...f,recovery}).state,'candidate-active');
  const states=readFileSync(path.join(recovery,'transaction.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).state);
  assert.deepEqual(states,['prepared','previous-retained','candidate-promoted']);
  assert.equal(readFileSync(path.join(f.root,'private-data','history'),'utf8'),'private fixture unchanged');
});

test('recovery rejects linked paths and ambiguous verification',t=>{
  const f=setup(t),recovery=path.join(f.root,'.observatory-update-test');mkdirSync(recovery);
  assert.equal(inspectPayloadRecovery({...f,recovery,verify:()=>({sourceRevision:'a'.repeat(40),buildNumber:7})}).state,'manual-inspection');
  symlinkSync(f.staged,path.join(recovery,'previous'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>inspectPayloadRecovery({...f,recovery}));
  assert.throws(()=>inspectPayloadRecovery({...f,recovery:f.root}));
});
