import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {combine} from '../lib/combine.mjs';
import {refusalText} from '../lib/view-sources.mjs';
import {ownSnapshot} from './helpers.mjs';

// Vite loads the TSX views for server rendering, as the build does.
const root=fileURLToPath(new URL('..',import.meta.url));
const load=specifier=>import(specifier);
const {createServer}=await load('vite');
const {default:react}=await load('@vitejs/plugin-react');
const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react()]});
after(()=>server.close());
const {DashboardView,sectionFromHash}=await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const {SourcesView}=await server.ssrLoadModule('/app/viewer/sources/SourcesView.tsx');
const {useSkin}=await server.ssrLoadModule('/app/viewer/skin.ts');

const now=Date.parse('2026-10-21T17:00:00Z');
const both=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
const noPc=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',name:'PC',snapshot:null,error:'unreachable'}],{now});
const render=props=>renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,limitStyle:'bar',css:'',className:'',onSectionChange:()=>{},...props}));

for(const section of ['limits','agents','activity','tokens','sources']) {
  test(`the ${section} page renders from combined.json`,()=>{
    const html=render({combined:both,section});
    for(const title of ['Limits','Agents','Screen time today','Cost today'])assert.ok(html.includes(title),title);
    assert.ok(html.includes('both computers, not deduplicated'));
    assert.ok(!html.includes('NaN'));
    assert.ok(!html.includes('undefined'));
  });
}

test('a missing computer shows Unknown and the reason, never zero',()=>{
  const html=render({combined:noPc,section:'limits'});
  assert.ok(html.includes('No snapshot'));
  assert.ok(html.includes('Last pull failed: unreachable'));
  const time=html.slice(html.indexOf('Screen time today'));
  assert.ok(time.includes('class="ob-hero">Unknown<'));
  const cost=html.slice(html.indexOf('Cost today'));
  assert.ok(cost.includes('class="ob-hero">Unknown<'));
});

test('the Agents page lists status words with each session',()=>{
  const at=new Date(now).toISOString();
  const mac=ownSnapshot('Mac',now,s=>({...s,agentActivity:[{host:'Mac',status:'ok',checkedAt:at,claudeStatus:'ok',codexStatus:'not-found',
    sessions:[{tool:'claude-code',status:'waiting',project:'portfolio',name:'Case study',updatedAt:at}],jobs:[]}]}));
  const combined=combine([{host:'Mac',snapshot:mac}],{now});
  const html=render({combined,section:'agents'});
  assert.ok(html.includes('Waiting on you'));
  assert.ok(html.includes('portfolio'));
  assert.ok(html.includes('1 waiting on you'));
  assert.ok(html.includes('Messages, prompts and job output are never read'));
});

test('without combined.json the page says how to get one',()=>{
  const html=render({combined:null,section:'limits'});
  assert.ok(html.includes('No combined.json yet'));
  assert.ok(!html.includes('Cost today'));
});

test('unknown hashes open Limits and only the read-only pages exist',()=>{
  assert.equal(sectionFromHash('#tokens'),'tokens');
  assert.equal(sectionFromHash('#settings'),'limits');
  assert.equal(sectionFromHash('#setup'),'limits');
  const html=render({combined:both,section:'limits'});
  for(const removed of ['Settings','Dictation','Check for updates'])assert.ok(!html.includes(`>${removed}<`),removed);
});

test('source refusals are described, not copied',()=>{
  for(const refusal of ['synthetic-private-code','ancestor-refused']) {
    const html=renderToStaticMarkup(createElement(SourcesView,{now,snapshot:{activity:[{host:'Mac',status:'unavailable',refusal,checkedAt:'2026-10-21T16:58:00Z'}]}}));
    assert.ok(!html.includes(refusal));
    assert.ok(html.includes(refusalText(refusal)));
  }
});

test('the skin hook returns Sage',()=>{
  const seen=[];
  const Probe=()=>{seen.push(useSkin());return null;};
  renderToStaticMarkup(createElement(Probe));
  assert.equal(seen[0].skinId,'sage');
  assert.match(seen[0].css,/--ob-background/);
});

test('the Agents page has clear empty, off and error states',()=>{
  const empty=render({combined:{...both,glance:{...both.glance,agents:[]}},section:'agents'});
  assert.ok(empty.includes('No agent status yet'));
  const off=render({combined:{...both,glance:{...both.glance,agents:[{host:'Mac',name:'Mac',status:'off'}]}},section:'agents'});
  assert.ok(off.includes('Set sources.agents to true'));
  const failed=render({combined:{...both,glance:{...both.glance,agents:[{host:'Mac',name:'Mac',status:'unknown'}]}},section:'agents'});
  assert.ok(failed.includes('could not be read'));
  assert.ok(failed.includes('>Unknown<'));
  const noCodexJob=render({combined:{...both,glance:{...both.glance,agents:[{host:'Mac',name:'Mac',status:'ok',counts:{},sessions:[],jobs:[],claudeFound:true,codexFound:false}]}},section:'agents'});
  assert.ok(!noCodexJob.includes('Codex jobs'));
  assert.ok(noCodexJob.includes('No sessions in the last day'));
});
