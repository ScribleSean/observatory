// Round 2 shell, Overview and Sessions: each built-in spec is drawn on the server through the json-render
// renderer against the fictional fixture (lib/sample-r2.mjs), including Unknown values, a stale computer
// chip and an empty period.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sampleR2Combined} from '../lib/sample-r2.mjs';
import {BLOCK_TYPES} from '../lib/r2-blocks.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const load=specifier=>import(specifier);
const {createServer}=await load('vite');
const {default:react}=await load('@vitejs/plugin-react');
const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react()]});
after(()=>server.close());
const {R2Shell}=await server.ssrLoadModule('/app/viewer/r2/App.tsx');
const {PINS,OVERVIEW,SESSIONS,blockList,withoutBlocks,savedViewsFrom}=await server.ssrLoadModule('/app/viewer/r2/specs.ts');
const {registry}=await server.ssrLoadModule('/app/viewer/r2/registry.tsx');
const {viewFromHash,VIEWS}=await server.ssrLoadModule('/app/viewer/r2/Nav.tsx');
const data=await server.ssrLoadModule('/app/viewer/r2/data.ts');
const {default:Dashboard}=await server.ssrLoadModule('/app/viewer/dashboard.tsx');

const now=Date.parse('2026-11-18T15:00:00Z');
const combined=sampleR2Combined(now);
const render=props=>renderToStaticMarkup(createElement(R2Shell,{snapshot:combined,now,loaded:true,...props}));
const clean=html=>{assert.ok(!html.includes('NaN') && !html.includes('undefined') && !html.includes('[object'),'no broken value');return html;};
const text=html=>html.replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ');

test('every block of the catalog has a component, and every built-in spec names only catalog blocks',()=>{
  for(const type of BLOCK_TYPES)assert.equal(typeof registry[type],'function',type);
  for(const view of [...PINS,SESSIONS]) {
    assert.ok(view.spec.elements[view.spec.root],view.id);
    for(const element of Object.values(view.spec.elements)) {
      assert.ok(BLOCK_TYPES.includes(element.type),`${view.id}: ${element.type}`);
      for(const key of element.children ?? [])assert.ok(view.spec.elements[key],`${view.id}: ${key}`);
    }
  }
});

test('a spec holds queries, never usage data',()=>{
  for(const view of [...PINS,SESSIONS])for(const element of Object.values(view.spec.elements))
    for(const value of Object.values(element.props))assert.ok(value===null || ['string','boolean'].includes(typeof value) || (typeof value==='number' && value<=5000),`${view.id}: ${JSON.stringify(element.props)}`);
});

test('Overview draws the strip, the chart, the sessions table, the breakdown, running and needs you from the fixture',()=>{
  const html=clean(render({}));
  const overview=data.buildOverview(combined,data.defaultScope(combined,{now}),{now});
  for(const title of ['Spend and what landed','Sessions','Where spend went','Running now','Needs you','Group by role'])assert.ok(html.includes(title),title);
  for(const label of ['Spend','Branches merged','Commits on main','Churn','Cost per landed change','Spend with no commits'])assert.ok(html.includes(label),label);
  assert.ok(html.includes(`>${overview.headline.spend.text}<`),'the spend headline shows the view-model text');
  assert.ok(html.includes(overview.frame.period.label));
  assert.equal((html.match(/class="kpi/g) ?? []).length,6,'six headline cells');
  assert.ok(html.includes('aria-current="page"') && html.includes('href="#screen-time"'));
  for(const [,name] of VIEWS)assert.ok(html.includes(`>${name}</a>`),name);
  assert.ok(!html.includes('class="drawer"'),'no breakdown is open until a headline is clicked');
});

test('a stale computer shows a hollow dot and the time it was last read, and the live ones do not',()=>{
  const html=render({});
  const chips=data.buildFrame(combined,data.defaultScope(combined,{now}),{now}).devices;
  assert.deepEqual(chips.map(chip=>chip.state),['live','stale','live']);
  assert.equal((html.match(/class="dot stale"><\/span>Tower<small>off /g) ?? []).length,1);
  assert.ok(html.includes('class="dot"></span>Studio</button>') && html.includes('class="dot"></span>Lab</button>'));
  assert.ok(text(html).includes('Tower last read'),'Needs you names the stale computer');
});

test('a day a computer could not read is Unknown, never zero, and the strip says why',()=>{
  const html=clean(render({initialSearch:'?unit=month'}));
  const scope=data.scopeFromSearch('?unit=month',data.defaultScope(combined,{now}));
  const spend=data.metric(combined,'spend',scope,{now});
  assert.equal(spend.value,null);
  assert.equal(spend.text,'Unknown');
  assert.ok(html.includes('class="v unk">Unknown<'),'the headline reads Unknown');
  assert.ok(text(html).includes('Tower could not be read on Nov 9'));
  assert.ok(!/class="v[^"]*">\$0(\.00)?</.test(html),'no headline shows a zero for an Unknown');
});

test('the scope in the address is followed: one device, a range and a step back',()=>{
  const one=clean(render({initialSearch:'?devices=Linux&unit=week'}));
  assert.ok(/aria-pressed="true"[^>]*><span class="dot"><\/span>Lab/.test(one));
  assert.ok(!text(one).includes('Studio spend'),'one device is not stacked by device');
  const earlier=clean(render({initialSearch:'?unit=week&anchor=2026-11-10'}));
  assert.ok(earlier.includes('Nov 9 to 15') && earlier.includes('Last week'));
  assert.ok(!earlier.includes('Running now'),'running now is shown for the current period only');
  const all=clean(render({initialSearch:'?unit=all'}));
  assert.ok(all.includes('All time') && all.includes('per month'));
  assert.ok(/<button[^>]*disabled=""[^>]*aria-label="Earlier"|aria-label="Earlier"[^>]*disabled=""|disabled="" title="Earlier"/.test(all),'all time cannot step');
});

test('an empty period says so instead of drawing zeros as readings',()=>{
  const html=clean(render({initialSearch:'?devices=Linux&unit=day&anchor=2026-08-01',initialHash:'#sessions'}));
  assert.ok(html.includes('<b>No sessions</b>'));
  assert.ok(text(html).includes('Nothing ran in Aug 1'));
});

test('Sessions draws the strip and the full table, grouped by role, with role tabs and sortable headers',()=>{
  const html=clean(render({initialHash:'#sessions'}));
  const vm=data.buildSessions(combined,data.defaultScope(combined,{now}),{now,groupBy:'role',limit:5000});
  assert.ok(html.includes('All roles') && html.includes('Started') && html.includes('Spend ↓'));
  for(const group of vm.groups)assert.ok(html.includes(`<b>${group.label}</b>`),group.label);
  assert.ok(html.includes('role="switch" aria-checked="true"'));
  assert.ok(html.includes('class="role">[Builder] </span>'),'the role is a prefix on the name');
  assert.equal((html.match(/class="kpi/g) ?? []).length,6);
  assert.ok(!html.includes('Blocks<small>'),'the Blocks menu belongs to Overview');
});

test('views route on plain hash names and fall back to Overview',()=>{
  assert.deepEqual(VIEWS.map(([id])=>id),['overview','sessions','limits','tokens','screen-time','drift','settings']);
  for(const [id] of VIEWS)assert.equal(viewFromHash(`#${id}`),id);
  assert.equal(viewFromHash(''),'overview');
  assert.equal(viewFromHash('#view=limits&x=1'),'overview');
});

test('each pinned question draws its own blocks and an answer built from the same numbers',()=>{
  for(const pin of PINS.filter(row=>row.question)) {
    const html=clean(render({initialPin:pin.id}));
    assert.ok(text(html).includes(pin.question.replace("'",'&#x27;')) || html.includes(pin.title.replace("'",'&#x27;')),pin.id);
  }
  const names=blockList(OVERVIEW.spec).map(block=>block.name);
  assert.deepEqual(names,['Headline numbers','Spend and what landed','Sessions table','Limits now','Where spend went','Running now','Needs you']);
  const without=withoutBlocks(OVERVIEW.spec,['flags','strip']);
  assert.ok(!without.elements.flags && !without.elements.root.children.includes('strip') && OVERVIEW.spec.elements.flags,'hiding a block leaves the built-in spec alone');
});

test('saved views are drawn only when they name catalog blocks, and a missing file is no views',()=>{
  const good={id:'my-view',title:'My view',question:'What ran?',savedAt:'2026-11-18T00:00:00.000Z',origin:'composed',spec:{root:'root',elements:{root:{type:'Section',props:{title:null,columns:12},children:['a']},a:{type:'Flags',props:{}}}}};
  const bad={...good,id:'bad',spec:{root:'root',elements:{root:{type:'Script',props:{}}}}};
  assert.deepEqual(savedViewsFrom(null),[]);
  const stray={...good,id:'stray',spec:{root:'root',elements:{root:{type:'Section',props:{title:null,columns:12},children:['a']},a:{type:'Flags',props:{spend:642}}}}};
  assert.deepEqual(savedViewsFrom({views:[good,bad,stray,{id:'x'}]}).map(view=>view.id),['my-view'],'the catalog check refuses a number carried in a stray prop');
  const html=clean(render({saved:savedViewsFrom([good]),initialPin:'my-view'}));
  assert.ok(html.includes('>My view</button>') && html.includes('Needs you'));
});

test('before a snapshot arrives the shell shows loading, then says when there is no data or no history',()=>{
  assert.ok(render({snapshot:null,loaded:false}).includes('aria-busy="true"'));
  assert.ok(render({snapshot:null,loaded:true}).includes('No data yet'));
  assert.ok(render({snapshot:{generatedAt:combined.generatedAt,view:{}},loaded:true}).includes('No history yet'));
});

test('the dashboard entry is the round 2 app, and its copy has no em dash or semicolon',()=>{
  assert.equal(typeof Dashboard,'function');
  for(const props of [{},{initialHash:'#sessions'},{initialPin:'spend-today'},{initialSearch:'?unit=month'}]) {
    const words=text(render(props)).replace(/&[a-z#0-9]+;/gi,' ');
    assert.ok(!/[—;]/.test(words),words.match(/.{0,40}[—;].{0,40}/)?.[0]);
  }
});

test('the dashboard bundles Geist and Geist Mono and loads no font or stylesheet from the network', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const root = new URL('../app/', import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.css'));
  for (const file of files) {
    const css = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//, `${file} loads something from the network`);
  }
  const fonts = await readFile(new URL('viewer/r2/fonts.css', root), 'utf8');
  const faces = [...fonts.matchAll(/font-family:"([^"]+)";font-style:normal;font-weight:(\d+);font-display:swap;src:url\("([^"]+)"\) format\("woff2"\)/g)].map(match => [match[1], match[2], match[3]]);
  assert.deepEqual(faces.map(([family, weight]) => `${family} ${weight}`), ['Geist 400', 'Geist 500', 'Geist 600', 'Geist Mono 400', 'Geist Mono 500']);
  assert.ok(faces.every(([, , src]) => /^@fontsource\/geist-(sans|mono)\/files\/[a-z0-9-]+\.woff2$/.test(src)));
  const { dependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(dependencies['@fontsource/geist-sans'], '5.3.0', 'pinned exactly');
  assert.equal(dependencies['@fontsource/geist-mono'], '5.3.0', 'pinned exactly');
});
