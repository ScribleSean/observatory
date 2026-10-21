// Serve the dashboard with fictional data, for working on the pages.
// Writes nothing outside a temporary folder.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from '../test/helpers.mjs';

const now=Date.now();
const dataFolder=await mkdtemp(path.join(tmpdir(),'observatory-preview-'));
await mkdir(path.join(dataFolder,'public','local'),{recursive:true});
// Fictional agents, so the Agents tile and page have something to show.
const ago=minutes=>new Date(now-minutes*60000).toISOString();
const agents=(host,at,sessions,jobs=[])=>snapshot=>({...snapshot,agentActivity:[{host,status:'ok',checkedAt:at,claudeStatus:'ok',codexStatus:'ok',sessions,jobs}]});
const mac=ownSnapshot('Mac',now,agents('Mac',ago(1),[
  {tool:'claude-code',status:'waiting',project:'portfolio',name:'Case study layout',startedAt:ago(80),updatedAt:ago(3)},
  {tool:'claude-code',status:'working',project:'observatory',name:'Agents panel',startedAt:ago(140),updatedAt:ago(1)},
  {tool:'claude-code',status:'working',project:'field-notes',name:'Search index',startedAt:ago(35),updatedAt:ago(2)},
  {tool:'claude-code',status:'idle',project:'dotfiles',name:'Shell prompt',startedAt:ago(300),updatedAt:ago(42)},
  {tool:'claude-code',status:'done',project:'recipes',name:'Import cleanup',startedAt:ago(600),updatedAt:ago(240)},
],[
  {tool:'codex',status:'working',project:'observatory',startedAt:ago(6),finishedAt:null},
  {tool:'codex',status:'done',project:'field-notes',startedAt:ago(95),finishedAt:ago(71)},
]));
const pc=ownSnapshot('Windows',now-4*60000,agents('Windows',ago(4),[
  {tool:'claude-code',status:'working',project:'tray-app',name:'Icon rendering',startedAt:ago(25),updatedAt:ago(4)},
  {tool:'claude-code',status:'idle',project:'observatory',name:'Windows check',startedAt:ago(200),updatedAt:ago(60)},
]));
const combined=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now,generatedBy:'Mac'});
await writeFile(path.join(dataFolder,'public','local','combined.json'),JSON.stringify(combined));
const port=Number(process.env.PORT || 5602);
createLocalServer({dataFolder}).listen(port,'127.0.0.1',()=>console.log(`Fictional preview: http://127.0.0.1:${port}`));
