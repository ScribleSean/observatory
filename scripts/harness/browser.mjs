// Drives headless Chrome over the DevTools protocol: a screenshot of every view at desktop and phone
// size in light and dark, plus checks for horizontal overflow, clipped text, low contrast, bytes fetched
// on load and how often data is fetched again. Output goes to outputs/harness (git-ignored).
// Usage: node scripts/harness/browser.mjs --url http://127.0.0.1:5602/ --label sample [--views limits,activity] [--watch 35]
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const at=args.indexOf(name);return at>=0?args[at+1]:fallback;};
const base=option('--url','http://127.0.0.1:5602/');
const label=option('--label','sample');
const views=option('--views','home').split(',').filter(Boolean);
const watchSeconds=Number(option('--watch','0'));
const clicks=option('--click','').split(',').filter(Boolean);
const chrome=process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out=path.resolve(option('--out',`outputs/harness/${label}`));
mkdirSync(out,{recursive:true});

const profile=mkdtempSync(path.join(tmpdir(),'ob-harness-'));
const port=9300+Math.floor(Math.random()*500);
const browser=spawn(chrome,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run',
  '--no-default-browser-check','--hide-scrollbars','--disable-extensions','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

let target;
for(let i=0;i<50 && !target;i++) {
  await sleep(200);
  try {target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch {}
}
if(!target)throw Error('Chrome did not start');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let nextId=0;
const pending=new Map();
const listeners=[];
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id && pending.has(message.id)) {
    const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
    if(message.error)reject(Error(message.error.message));else resolve(message.result);
  } else for(const listener of listeners)listener(message);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;

const requests=new Map();
listeners.push(message=>{
  if(message.method==='Network.responseReceived')requests.set(message.params.requestId,{url:message.params.response.url,bytes:0,at:Date.now()});
  if(message.method==='Network.loadingFinished' && requests.has(message.params.requestId))requests.get(message.params.requestId).bytes=message.params.encodedDataLength;
});
await send('Network.enable');
await send('Page.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});

// Runs in the page: overflow, clipped text, contrast below WCAG AA, and the hero and menu numbers.
const audit=`(() => {
  const problems=[];
  const doc=document.documentElement;
  if(doc.scrollWidth>innerWidth+1)problems.push({kind:'page-overflow',detail:doc.scrollWidth+'>'+innerWidth});
  const name=el=>el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).join('.'):'');
  const parse=c=>{const m=c.match(/[\\d.]+/g);return m?m.map(Number):null;};
  const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
  const background=el=>{
    for(let node=el;node;node=node.parentElement){const c=parse(getComputedStyle(node).backgroundColor);if(c&&(c[3]===undefined||c[3]>0.5))return c;}
    return parse(getComputedStyle(document.body).backgroundColor)||[255,255,255];
  };
  for(const el of document.querySelectorAll('body *')){
    const style=getComputedStyle(el);
    if(style.display==='none'||style.visibility==='hidden')continue;
    const rect=el.getBoundingClientRect();
    if(rect.width<=1||rect.height<=1||el.closest('.ob-visually-hidden,[data-sr-only]'))continue;
    const contained=(()=>{for(let node=el.parentElement;node&&node!==document.body;node=node.parentElement){const o=getComputedStyle(node).overflowX;if(o!=='visible')return true;}return false;})();
    if(rect.right>innerWidth+1&&!contained)problems.push({kind:'off-screen',el:name(el),detail:Math.round(rect.right)+'>'+innerWidth});
    const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    if(!own)continue;
    if(el.scrollWidth>el.clientWidth+1&&style.overflow!=='visible'&&el.clientWidth>0)problems.push({kind:'clipped',el:name(el),text:el.textContent.trim().slice(0,40)});
    const fg=parse(style.color),bg=background(el);
    if(fg&&bg){
      const alpha=fg[3]===undefined?1:fg[3];
      const mixed=fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha));
      const [a,b]=[lum(mixed),lum(bg)].sort((x,y)=>y-x);
      const ratio=(a+0.05)/(b+0.05);
      const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.6&&Number(style.fontWeight)>=700);
      if(ratio<(large?3:4.5))problems.push({kind:'contrast',el:name(el),ratio:Math.round(ratio*100)/100,text:el.textContent.trim().slice(0,30)});
    }
  }
  const words=document.body.innerText.split(/\\s+/).filter(Boolean).length;
  const hero=document.querySelector('[data-hero],.ob-hero');
  return {problems,words,hero:hero?hero.textContent.trim():null,
    height:doc.scrollHeight};
})()`;

const results=[];
const sizes=[['desktop',1440,900,false],['phone',390,844,true]];
for(const [sizeName,width,height,mobile] of sizes) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});
  for(const scheme of ['light','dark']) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    for(const view of views) {
      requests.clear();
      const url=base+(view==='home'?'':`#${view}`);
      await send('Page.navigate',{url:'about:blank'});
      await sleep(100);
      await send('Page.navigate',{url});
      await sleep(1500);
      for(const selector of clicks.filter(c=>c.startsWith(view+':')).map(c=>c.slice(view.length+1))) {
        await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
        await sleep(700);
      }
      const page=await evaluate(audit);
      // Cross-surface: the number in the hero must be the one the menu bar shows.
      page.menu=await evaluate(`fetch('./local/summary.json').then(r=>r.ok?r.json():null).then(s=>s?.glance?.forecast?.menu ?? s?.glance?.title ?? null).catch(()=>null)`);
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.min(page.height,4000),scale:1}});
      const file=path.join(out,`${view}-${sizeName}-${scheme}.png`);
      writeFileSync(file,Buffer.from(shot.data,'base64'));
      const loaded=[...requests.values()];
      results.push({view,size:sizeName,scheme,file:path.relative(process.cwd(),file),words:page.words,hero:page.hero,menu:page.menu,
        jsonBytes:loaded.filter(r=>/\.json/.test(r.url)).reduce((sum,r)=>sum+r.bytes,0),
        jsonRequests:loaded.filter(r=>/\.json/.test(r.url)).length,
        fontBytes:loaded.filter(r=>/\.(ttf|woff2?)/.test(r.url)).reduce((sum,r)=>sum+r.bytes,0),
        totalBytes:loaded.reduce((sum,r)=>sum+r.bytes,0),
        problems:page.problems});
    }
  }
}

let refetch=null;
if(watchSeconds>0) {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  requests.clear();
  await send('Page.navigate',{url:base});
  await sleep(watchSeconds*1000);
  const json=[...requests.values()].filter(r=>/\.json/.test(r.url));
  refetch={seconds:watchSeconds,requests:json.length,bytes:json.reduce((sum,r)=>sum+r.bytes,0)};
}

socket.close();
browser.kill();
await sleep(300);
rmSync(profile,{recursive:true,force:true});

const count=kind=>results.reduce((sum,r)=>sum+r.problems.filter(p=>p.kind===kind).length,0);
const summary={label,url:base,shots:results.length,overflow:count('page-overflow')+count('off-screen'),clipped:count('clipped'),contrast:count('contrast'),
  maxJsonOnLoad:Math.max(...results.map(r=>r.jsonBytes)),homeJsonOnLoad:results.find(r=>r.view===views[0])?.jsonBytes ?? null,maxJsonRequestsOnLoad:Math.max(...results.map(r=>r.jsonRequests)),
  fontBytes:Math.max(...results.map(r=>r.fontBytes)),homeWords:results.find(r=>r.view===views[0])?.words ?? null,
  hero:results[0]?.hero ?? null,menu:results[0]?.menu ?? null,
  heroMatchesMenu:results.filter(r=>r.view==='home').every(r=>r.hero!==null && r.menu!==null && r.menu.endsWith(' '+r.hero)),refetch};
writeFileSync(path.join(out,'results.json'),JSON.stringify({summary,results},null,1));
console.log(JSON.stringify(summary,null,1));
