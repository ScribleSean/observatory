// The agents reader may surface status, project and session names and times.
// It must never surface prompts, messages, job output, paths or secrets, and it
// must not even open the files that hold them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readAgents} from '../scripts/read-agents.mjs';
import {combine} from '../lib/combine.mjs';
import {withFolder,ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const SECRETS=['PROMPT-TEXT','MESSAGE-TEXT','JOB-OUTPUT','sk-ant-FAKEKEY','/Users/private-person','private.sock','SESSION-UUID','HOST-UUID','BRIDGE-UUID'];
const SESSION_KEYS=['name','project','startedAt','status','tool','updatedAt','via'];
const JOB_KEYS=['finishedAt','project','startedAt','status','tool'];

async function hostileFixture(folder) {
  const claude=path.join(folder,'claude'),sessions=path.join(claude,'sessions'),jobs=path.join(folder,'codex-jobs');
  await mkdir(sessions,{recursive:true});await mkdir(jobs,{recursive:true});
  // A session record with every field the real one has, plus fields a future
  // version might add that carry content.
  await writeFile(path.join(sessions,'111.json'),JSON.stringify({pid:111,sessionId:'SESSION-UUID',hostSessionId:'HOST-UUID',bridgeSessionId:'BRIDGE-UUID',
    cwd:'/Users/private-person/Developer/client-project',name:'Release prep',status:'busy',startedAt:now-600000,statusUpdatedAt:now-60000,
    messagingSocketPath:'/tmp/private.sock',entrypoint:'claude-desktop',lastPrompt:'PROMPT-TEXT',lastMessage:{text:'MESSAGE-TEXT'},
    env:{ANTHROPIC_API_KEY:'sk-ant-FAKEKEY'},summary:'MESSAGE-TEXT'}));
  // A secret key file and a transcript beside it.
  await writeFile(path.join(sessions,'111.0123abcd.key'),'sk-ant-FAKEKEY');
  await mkdir(path.join(claude,'projects','p'),{recursive:true});
  await writeFile(path.join(claude,'projects','p','session.jsonl'),JSON.stringify({message:{content:'PROMPT-TEXT MESSAGE-TEXT'}})+'\n');
  // A session file that is a link to a secret elsewhere.
  await writeFile(path.join(folder,'elsewhere.json'),JSON.stringify({pid:222,name:'PROMPT-TEXT',status:'busy',statusUpdatedAt:now}));
  await symlink(path.join(folder,'elsewhere.json'),path.join(sessions,'222.json')).catch(()=>{});
  // A record far too large to be a status file.
  await writeFile(path.join(sessions,'333.json'),JSON.stringify({pid:333,name:'x',status:'busy',padding:'MESSAGE-TEXT'.repeat(10000)}));
  // Job output, with the final message unreadable to prove it is never opened.
  const done=path.join(jobs,'20261021-160000-client-project-444.md');
  await writeFile(done,'JOB-OUTPUT');
  await writeFile(path.join(jobs,'20261021-163000-client-project-555.running'),'JOB-OUTPUT');
  await writeFile(path.join(jobs,'notes-PROMPT-TEXT.md'),'JOB-OUTPUT');
  if(process.platform!=='win32')await chmod(done,0o000);
  return {claudeSessions:sessions,codexJobs:jobs};
}

test('only status, names and times leave the reader',()=>withFolder(async folder=>{
  const result=await readAgents({folders:await hostileFixture(folder),now,alive:pid=>[111,222,333,555].includes(pid)});
  const text=JSON.stringify(result);
  for(const secret of SECRETS)assert.ok(!text.includes(secret),secret);
  assert.deepEqual(result.sessions.map(s=>s.name),['Release prep']);
  for(const session of result.sessions)assert.deepEqual(Object.keys(session).sort((a,b)=>a.localeCompare(b)),SESSION_KEYS);
  assert.equal(result.sessions[0].project,'client-project');
  assert.deepEqual(result.jobs.map(j=>j.status).sort((a,b)=>a.localeCompare(b)),['done','working']);
  for(const job of result.jobs)assert.deepEqual(Object.keys(job).sort((a,b)=>a.localeCompare(b)),JOB_KEYS);
}));

test('nothing private reaches combined.json, the menu lines or the dashboard data',()=>withFolder(async folder=>{
  const agents=await readAgents({folders:await hostileFixture(folder),now,alive:()=>true});
  const at=new Date(now).toISOString();
  const mac=ownSnapshot('Mac',now,s=>({...s,agentActivity:[{host:'Mac',status:'ok',checkedAt:at,...agents}]}));
  const text=JSON.stringify(combine([{host:'Mac',snapshot:mac}],{now}));
  for(const secret of SECRETS)assert.ok(!text.includes(secret),secret);
}));

test('a session name is shortened and stripped of control characters',()=>withFolder(async folder=>{
  const sessions=path.join(folder,'sessions');
  await mkdir(sessions);
  await writeFile(path.join(sessions,'7.json'),JSON.stringify({pid:7,name:'line one\nline two\u0000'+'z'.repeat(300),status:'idle',statusUpdatedAt:now}));
  const {sessions:[session]}=await readAgents({folders:{claudeSessions:sessions,codexJobs:path.join(folder,'none')},now,alive:()=>true});
  assert.ok(session.name.length<=80);
  // oxlint-disable-next-line no-control-regex -- checking that control characters are gone
  assert.ok(!/[\u0000-\u001f]/.test(session.name));
}));
