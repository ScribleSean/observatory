// A headless Chromium driven over the DevTools protocol, with nothing to install: it uses a Chrome, Chromium or Edge
// already on the computer (or the one CHROME names) with a throwaway profile. test/layout.test.mjs measures the
// dashboard's layout with it; findChromium() returns null when there is no browser, and the test skips.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** The path of a Chromium-family browser on this computer, or null. */
export function findChromium(env=process.env,platform=process.platform) {
  if(env.CHROME)return existsSync(env.CHROME)?env.CHROME:null;
  if(platform==='darwin') {
    return ['Google Chrome','Chromium','Microsoft Edge'].map(name=>`/Applications/${name}.app/Contents/MacOS/${name}`).find(file=>existsSync(file)) ?? null;
  }
  if(platform==='win32') {
    const roots=[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(root=>[path.join(root,'Google','Chrome','Application','chrome.exe'),path.join(root,'Microsoft','Edge','Application','msedge.exe')])
      .find(file=>existsSync(file)) ?? null;
  }
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']) {
    const found=spawnSync('/usr/bin/which',[name],{encoding:'utf8'});
    if(found.status===0 && found.stdout.trim())return found.stdout.trim();
  }
  return null;
}

/** How long a browser may take to start. */
const START_MS=120000;

/**
 * Starts the browser and returns one page: open(url, {width, height, scheme, now}) loads an address at a window size and
 * colour scheme (and with the page's clock started at `now` when given), evaluate(body) runs the body of an async function in the page and returns what it returns,
 * screenshot(file, clip?) writes a PNG, close() stops the browser and removes its profile.
 */
export async function launchChromium(executable) {
  const profile=mkdtempSync(path.join(tmpdir(),'observatory-chromium-'));
  // No sandbox: CI runners (and containers) cannot start one, and the only pages loaded are the local fictional preview.
  const browser=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-sandbox',
    '--no-default-browser-check','--hide-scrollbars','--disable-extensions','--disable-gpu','about:blank'],{stdio:['ignore','ignore','pipe']});
  const close=async()=>{
    browser.kill();
    await new Promise(resolve=>browser.exitCode===null?browser.once('exit',resolve):resolve());
    for(let attempt=0;attempt<10;attempt++) {
      try {rmSync(profile,{recursive:true,force:true});break;}catch {await sleep(200);} // Windows frees the profile a moment after exit
    }
  };
  try {
    // The browser prints the address it listens on, so no port has to be guessed.
    // The browser says where it listens twice: a line on stderr and a DevToolsActivePort file in its profile. Either
    // one is enough. A first start on a fresh Windows runner can take well over 30 seconds while the new chrome.exe
    // is scanned, so the wait is long, and a failure says how long it waited and whether the browser was still running.
    const started=Date.now();
    const port=await new Promise((resolve,reject)=>{
      let text='',done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);if(error)reject(error);else resolve(value);};
      const timer=setTimeout(()=>finish(Error(`The browser did not start in ${Math.round((Date.now()-started)/1000)} s (still running: ${browser.exitCode===null}): ${text.slice(-300)}`)),START_MS);
      const poll=setInterval(()=>{
        try {const found=readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').match(/^(\d+)\n/);if(found)finish(null,found[1]);}catch {}
      },100);
      browser.stderr.on('data',chunk=>{
        text+=chunk;
        const found=text.match(/DevTools listening on (ws:\/\/\S+)/);
        if(found)finish(null,new URL(found[1]).port);
      });
      browser.once('exit',code=>finish(Error(`The browser exited with ${code}: ${text.slice(-300)}`)));
      if(browser.exitCode!==null)finish(Error(`The browser exited with ${browser.exitCode}: ${text.slice(-300)}`));
    });
    if(process.env.CI)console.error(`# browser started in ${((Date.now()-started)/1000).toFixed(1)} s`);
    let target;
    for(let attempt=0;attempt<50 && !target;attempt++) {
      try {target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(each=>each.type==='page');}catch {}
      if(!target)await sleep(100);
    }
    if(!target)throw Error('The browser opened no page');
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('No DevTools connection')),{once:true});});
    let nextId=0;
    const pending=new Map(),waiting=new Map();
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id && pending.has(message.id)) {
        const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
        if(message.error)reject(Error(message.error.message));else resolve(message.result);
      } else if(waiting.has(message.method)) {const resolve=waiting.get(message.method);waiting.delete(message.method);resolve();}
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const event=(method,ms)=>Promise.race([new Promise(resolve=>waiting.set(method,resolve)),sleep(ms)]);
    await send('Page.enable');
    let clockScript=null;
    return {
      async open(url,{width=1280,height=900,scheme='dark',now}={}) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        // now: the page's clock starts at this instant and runs on from there, to match a fixture made for that instant.
        if(clockScript){await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:clockScript});clockScript=null;}
        if(now!==undefined)clockScript=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`{const T=${Number(now)},R=Date,b=R.now();class D extends R{constructor(...a){a.length?super(...a):super(T+R.now()-b);}static now(){return T+R.now()-b;}}globalThis.Date=D;}`})).identifier;
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
        // A blank page first: an address that differs only by its hash would not load again.
        const blank=event('Page.loadEventFired',30000);
        await send('Page.navigate',{url:'about:blank'});
        await blank;
        const loaded=event('Page.loadEventFired',30000);
        await send('Page.navigate',{url});
        await loaded;
      },
      async evaluate(body) {
        const result=await send('Runtime.evaluate',{expression:`(async()=>{${body}\n})()`,returnByValue:true,awaitPromise:true});
        if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      async screenshot(file,clip) {
        const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,...(clip?{clip:{...clip,scale:1}}:{})});
        writeFileSync(file,Buffer.from(shot.data,'base64'));
      },
      async close() {socket.close();await close();},
    };
  } catch(error) {
    await close();
    throw error;
  }
}
