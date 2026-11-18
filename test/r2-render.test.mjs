// Round 2 shell, Overview and Sessions: each built-in spec is drawn on the server through the json-render
// renderer against the fictional fixture (lib/sample-r2.mjs), including Unknown values, a stale computer
// chip and an empty period.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sampleR2Combined} from '../lib/sample-r2.mjs';
import {BLOCK_TYPES} from '../lib/r2-blocks.mjs';
import {PINNED_QUESTIONS,VIEW_SPECS} from '../lib/r2-specs.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const load=specifier=>import(specifier);
const {createServer}=await load('vite');
const {default:react}=await load('@vitejs/plugin-react');
const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react()]});
after(()=>server.close());
const {R2Shell}=await server.ssrLoadModule('/app/viewer/r2/App.tsx');
const {PINS,OVERVIEW,SESSIONS,blockList,withoutBlocks,savedViewsFrom,askFor,scopeFor,fromAddress}=await server.ssrLoadModule('/app/viewer/r2/pins.ts');
const {Overview}=await server.ssrLoadModule('/app/viewer/r2/views/Overview.tsx');
const {SpecView}=await server.ssrLoadModule('/app/viewer/r2/registry.tsx');
const {BlockBoundary}=await server.ssrLoadModule('/app/viewer/r2/Boundary.tsx');
const {trapTab}=await server.ssrLoadModule('/app/viewer/r2/views/Sessions.tsx');
const {flagKey}=await server.ssrLoadModule('/app/viewer/r2/blocks/Flags.tsx');
const {registry}=await server.ssrLoadModule('/app/viewer/r2/registry.tsx');
const {viewFromHash,VIEWS}=await server.ssrLoadModule('/app/viewer/r2/Nav.tsx');
const data=await server.ssrLoadModule('/app/viewer/r2/data.ts');
const {default:R2App}=await server.ssrLoadModule('/app/viewer/r2/App.tsx');

const now=Date.parse('2026-11-18T15:00:00Z');
const combined=sampleR2Combined(now);
const render=props=>renderToStaticMarkup(createElement(R2Shell,{snapshot:combined,now,loaded:true,...props}));
// Each view but Overview loads on first open (App.tsx, blocks/more.tsx). Drawn on the server, the first draw shows the
// loading state, so draw each once and wait for its module before the checks.
const firstDraw=Object.fromEntries(['#sessions','#limits','#tokens','#screen-time','#drift','#settings'].map(hash=>[hash,render({initialHash:hash})]));
await Promise.all(['Sessions','Limits','Tokens','ScreenTime','Drift','Settings'].map(name=>server.ssrLoadModule(`/app/viewer/r2/views/${name}.tsx`)));
for(let turn=0;turn<5;turn++)await new Promise(resolve=>setTimeout(resolve,0));
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
  assert.equal((html.match(/class="dot stale"><\/span>Tower<small>last read Wed \d{1,2}:\d\d (AM|PM)<\/small>/g) ?? []).length,1,'the stale chip names the day of its last reading');
  assert.match(html,/Read Wed \d{1,2}:\d\d (AM|PM)</,'the header read time names its day');
  // A computer turned off in the hub's settings reads Off, never the time of its last reading (lib/combine.mjs deviceState).
  const off={...combined,devices:combined.devices.map(device=>device.host==='Windows'?{...device,state:'off',stateLabel:'Off'}:device)};
  assert.ok(render({snapshot:off}).includes('Tower<small>Off</small>'));
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
  // The known part shows beside it as secondary text, never in place of Unknown.
  assert.match(spend.atLeast.text,/^at least \$[\d,.]+, 1 day not read on Tower$/);
  assert.ok(html.includes(`<span class="c">${spend.atLeast.text}</span>`),'the spend headline says what was read');
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

const count=(html,part)=>html.split(part).length-1;
const kpis=html=>(html.match(/class="kpi/g) ?? []).length;

test('each pinned question draws its own blocks',()=>{
  const draw=id=>clean(render({initialPin:id}));
  const today=draw('today-spend');
  assert.equal(count(today,'<h3>Where spend went</h3>'),3,'today: spend by role, model and kind');
  assert.equal(kpis(today),0,'today: no strip of headlines');
  assert.ok(today.includes('Spend and what landed'));
  const builders=draw('builders-month');
  assert.equal(kpis(builders),4,'builders: a strip of four');
  assert.equal(count(builders,'<h3>Commits on main</h3>'),2,'builders: commits on main by role and by repo');
  assert.ok(builders.includes(', Builder</span>'),'builders: the table lists Builders only');
  const week=draw('week-last');
  assert.ok(week.includes('Limits now') && week.includes('<h3>Spend over time</h3>'));
  assert.equal(kpis(week),0);
  assert.ok(!week.includes('Needs you'));
  const needs=draw('needs-me');
  assert.ok(needs.includes('Needs you') && needs.includes('Running now'));
  assert.ok(!needs.includes('Where spend went') && !needs.includes('Limits now'));
  const names=blockList(OVERVIEW.spec).map(block=>block.name);
  assert.deepEqual(names,['Headline numbers','Spend and what landed','Limits now','Sessions table','Where spend went','Running now','Needs you']);
  const without=withoutBlocks(OVERVIEW.spec,['root-6','root-0']);
  assert.ok(!without.elements['root-6'] && !without.elements.root.children.includes('root-0') && OVERVIEW.spec.elements['root-6'],'hiding a block leaves the built-in spec alone');
});

test('the dashboard draws the specs in lib/r2-specs.mjs, with no second copy',()=>{
  assert.equal(existsSync(new URL('../app/viewer/r2/specs.ts',import.meta.url)),false);
  assert.deepEqual(PINS.map(pin=>pin.id),['overview','today-spend','builders-month','week-last','needs-me']);
  assert.deepEqual(OVERVIEW.spec,VIEW_SPECS.overview.spec);
  assert.deepEqual(SESSIONS.spec,VIEW_SPECS.sessions.spec);
  PINNED_QUESTIONS.forEach((pin,index)=>assert.deepEqual(PINS[index+1].spec,pin.view.spec,pin.id));
  assert.deepEqual(PINS[2].patch,{range:{unit:'month'}});
});

test('a free question draws the blocks the rules composed and sets the range, devices and sources it named',()=>{
  const tokens=askFor('tokens by model',PINS,{now,timeZone:'America/New_York'});
  assert.equal(tokens.pin.id,'ask');
  assert.equal(tokens.missed,false);
  assert.deepEqual(blockList(tokens.pin.spec).map(block=>block.name),['Headline numbers','Where spend went','Over time']);
  const html=clean(render({initialAsk:'tokens by model'}));
  assert.ok(!html.includes('No block answers that yet'),'a rule answer is not a miss');
  assert.ok(html.includes('<h3>Tokens</h3>') && html.includes('<h3>Tokens over time</h3>'),'the composed blocks are drawn');
  assert.ok(!html.includes('Spend and what landed'),'the Overview blocks are not');
  assert.match(text(html),/ tokens in Nov 16 to 22/,'the answer line is about tokens');
  const narrowed=askFor('spend on the mac with codex yesterday',PINS,{now,timeZone:'America/New_York'});
  assert.deepEqual(narrowed.pin.patch,{range:{unit:'day',anchor:'2026-11-17'},devices:['Mac'],sources:['codex']});
  const scope=scopeFor(narrowed.pin,data.defaultScope(combined,{now}),'2026-11-18');
  assert.deepEqual([scope.range.unit,scope.range.anchor,scope.devices,scope.sources],['day','2026-11-17',['Mac'],['codex']]);
  const drawn=clean(render({initialAsk:'spend on the mac with codex yesterday'}));
  assert.ok(/aria-pressed="true"[^>]*><span class="dot"><\/span>Studio/.test(drawn),'the Mac chip is the only one on');
  assert.ok(!/aria-pressed="true"[^>]*><span class="dot"><\/span>Lab/.test(drawn));
  assert.ok(drawn.includes('Nov 17') && drawn.includes('Yesterday'),'the range moved to yesterday');
});

test('a pinned question asked in words opens its pin, and nothing matched says so over the Overview',()=>{
  const asked=askFor("Where did today's spend go?",PINS,{now,timeZone:'America/New_York'});
  assert.equal(asked.pin.id,'today-spend');
  assert.deepEqual(asked.pin.patch,{range:{unit:'day',anchor:'2026-11-18'}});
  const html=clean(render({initialAsk:"Where did today's spend go?"}));
  assert.equal(count(html,'<h3>Where spend went</h3>'),3);
  assert.ok(/class="on" aria-pressed="true">Where did today&#x27;s spend go\?</.test(html),'its pin button is on');
  assert.ok(!html.includes('No block answers that yet'));
  const missed=askFor('hello there',PINS);
  assert.deepEqual([missed.pin.id,missed.missed,missed.question],['overview',true,'hello there']);
  assert.ok(clean(render({initialAsk:'hello there'})).includes('No block answers that yet'));
});

test('a pin click opens on its own range from today, and the address is followed after back and hash edits',()=>{
  const base=data.defaultScope(combined,{now});
  const earlier=data.scopeFromSearch('?unit=week&anchor=2026-11-03',base);
  const month=scopeFor(PINS[2],earlier,'2026-11-18');
  assert.deepEqual([month.range.unit,month.range.anchor],['month','2026-11-18']);
  assert.equal(scopeFor(OVERVIEW,earlier,'2026-11-18'),earlier,'the Overview pin keeps the scope');
  assert.deepEqual(fromAddress('#limits','?unit=month'),{view:'limits',search:'?unit=month'});
  assert.deepEqual(fromAddress('','?devices=Linux'),{view:'overview',search:'?devices=Linux'});
  assert.deepEqual(fromAddress('#nothing',''),{view:'overview',search:''});
});

test('a new pin draws fresh blocks, so a role or sort chosen under one pin does not carry into the next',()=>{
  const keyOf=props=>{
    const tree=Overview({hidden:[],missed:false,onClear(){},...props});
    return [tree.props.children].flat().find(child=>child?.type===SpecView)?.key;
  };
  assert.equal(keyOf({pin:OVERVIEW,question:null}),'overview:');
  assert.equal(keyOf({pin:PINS[2],question:PINS[2].question}),'builders-month:What did Builders ship this month?');
});

test('a block that fails to draw says so in its place, and a view still loading shows the loading state',()=>{
  const boundary=new BlockBoundary({name:'Breakdown',children:null});
  boundary.state=BlockBoundary.getDerivedStateFromError();
  const html=renderToStaticMarkup(boundary.render());
  assert.ok(html.includes('role="alert"') && html.includes('<b>Breakdown could not be drawn</b>'));
  for(const type of BLOCK_TYPES)assert.equal(registry[type].displayName,`Placed(${type})`,type);
  for(const hash of ['#limits','#tokens','#settings'])assert.ok(firstDraw[hash].includes('<main><output class="grid c12" aria-busy="true" aria-label="Loading">'),hash);
});

test('session rows and group headers open from the keyboard, and the open panel holds focus over an inert page',()=>{
  const html=clean(render({}));
  const rows=html.match(/<tr class="row[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  assert.ok(rows.length>5);
  for(const row of rows)assert.ok(row.includes('<button type="button" class="nm">'),row.slice(0,120));
  const grouped=clean(render({initialHash:'#sessions'}));
  assert.ok(grouped.includes('<button type="button" class="gb" aria-expanded="true" aria-label="Hide Builder sessions, '));
  assert.match(grouped,/aria-label="Hide Builder sessions, [^"]+"><span class="car" aria-hidden="true">−<\/span><b>Builder<\/b>/,'the label is inside the button');
  assert.ok(html.includes('<div class="page">') && html.includes('<dialog class="panel" aria-modal="true"'));
  const key=data.buildSessions(combined,data.defaultScope(combined,{now}),{now,limit:5000}).rows[0].key;
  const open=clean(render({initialSelected:key}));
  assert.ok(open.includes('<div class="page" inert="">'),'the page behind is inert');
  assert.ok(open.includes('<dialog open="" class="panel on" aria-modal="true"'));
  assert.equal(trapTab(4,3,false),0,'Tab past the last control wraps to the first');
  assert.equal(trapTab(4,0,true),3,'Shift+Tab before the first wraps to the last');
  assert.equal(trapTab(4,1,false),null,'Tab inside is left to the browser');
  assert.equal(trapTab(4,-1,false),0,'focus outside the panel comes back in');
});

test('menus say they open a popup, loading says it is a status, and two identical flags keep separate keys',()=>{
  const html=clean(render({}));
  assert.ok(html.includes('aria-haspopup="true" aria-expanded="false" aria-controls="pins-menu"'));
  assert.ok(html.includes('aria-haspopup="true" aria-expanded="false" aria-controls="blocks-menu"'));
  assert.notEqual(flagKey({text:'Tower last read Wed',sessionKey:null},0),flagKey({text:'Tower last read Wed',sessionKey:null},1));
  assert.equal(flagKey({text:'x',sessionKey:'Mac.s1'},2),'2:Mac.s1');
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
  assert.ok(render({snapshot:null,loaded:false}).includes('<output class="grid c12" aria-busy="true" aria-label="Loading">'));
  assert.ok(render({snapshot:null,loaded:true}).includes('No data yet'));
  assert.ok(render({snapshot:{generatedAt:combined.generatedAt,view:{}},loaded:true}).includes('No history yet'));
});

test('the dashboard entry is the round 2 app, and its copy has no em dash or semicolon',()=>{
  assert.equal(typeof R2App,'function');
  const entry=readFileSync(new URL('../app/web/dashboard.tsx',import.meta.url),'utf8');
  assert.deepEqual([...entry.matchAll(/^import .*?['"]([^'"]+)['"]/gm)].map(match=>match[1]),['../../lib/zod-config.mjs','react-dom/client','../viewer/r2/App'],'the entry sets zod first, then loads the round 2 app and no other stylesheet');
  for(const props of [{},{initialHash:'#sessions'},{initialPin:'today-spend'},{initialAsk:'tokens by model'},{initialSearch:'?unit=month'}]) {
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

test('every runtime dependency is used by the app or the libraries', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { dependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const sources = [];
  for (const folder of ['app', 'lib', 'scripts']) {
    const base = new URL(`../${folder}/`, import.meta.url);
    for (const file of await readdir(base, { recursive: true }))
      if (/\.(mjs|ts|tsx|css)$/.test(file) && !file.includes('node_modules')) sources.push(await readFile(new URL(file, base), 'utf8'));
  }
  const all = sources.join('\n');
  for (const name of Object.keys(dependencies)) assert.ok(all.includes(`'${name}`) || all.includes(`"${name}`) || all.includes(`${name}/`), `${name} is imported somewhere`);
  assert.equal(dependencies['lucide-react'], undefined);
});

test('Limits now on the Overview leads with the stored forecast, then Claude weekly, Claude 5 hour, Grok and a quiet line for what is off',()=>{
  const html=clean(render({}));
  const block=html.slice(html.indexOf('aria-label="Limits now"'));
  const shown=text(block.slice(0,block.indexOf('</section>')));
  assert.ok(block.includes(`<p class="sayline">${combined.glance.forecast.engines.find(engine=>engine.engine==='claude').headline}</p>`),'the lead is the stored forecast sentence');
  const at=word=>shown.indexOf(word);
  for(const word of ['Claude Code weekly','Claude Code 5 hour','Grok requests'])assert.ok(at(word)>=0,word);
  assert.ok(at('Claude Code weekly')<at('Claude Code 5 hour') && at('Claude Code 5 hour')<at('Grok requests'));
  assert.ok(shown.includes('Not reported'),'a window the app left out reads Not reported');
  assert.match(shown,/Codex is off/,'a source that is off gets one quiet line');
  assert.ok(!shown.includes('Codex 30 day'),'an off source draws no meter');
  assert.equal((html.match(/aria-label="Limits now"/g)??[]).length,1);
  // The Limits view keeps its own blocks, so Grok is not drawn twice there.
  assert.ok(!text(firstDraw['#limits']).includes('Codex is off'));
});
