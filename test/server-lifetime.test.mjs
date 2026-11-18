import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,utimes,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFolder} from './helpers.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const alive=pid=>{try {process.kill(pid,0);return true;}catch {return false;}};
const freePort=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const until=async(check,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return true;await new Promise(r=>setTimeout(r,100));}return false;};

const unsupported=!['darwin','win32'].includes(process.platform) && 'The dashboard server runs on macOS and Windows only';

for(const signal of ['SIGTERM','SIGKILL']) {
  test(`the dashboard server exits when the app that started it gets ${signal}`,
    {skip:unsupported || (process.platform==='win32' && signal==='SIGTERM' && 'Windows cannot send SIGTERM to a process')},()=>withFolder(async folder=>{
    const port=await freePort();
    const config=path.join(folder,'observatory.config.json');
    await mkdir(path.join(folder,'data','public','local'),{recursive:true,mode:0o700});
    await writeFile(config,JSON.stringify({dataFolder:path.join(folder,'data'),dashboard:{port}}));
    const pidFile=path.join(folder,'server.pid');
    const app=spawn(process.execPath,['-e',`
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,[${JSON.stringify(path.join(repo,'serve-local.mjs'))},'--with-parent'],{stdio:'ignore',env:process.env});
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
      setInterval(()=>{},1000);`],
    {stdio:'ignore',env:{...process.env,OBSERVATORY_CONFIG:config,OBSERVATORY_PARENT_CHECK_MS:'200'}});
    try {
      assert.ok(await until(async()=>(await readFile(pidFile,'utf8').catch(()=>'')).length>0,5000),'server started');
      const server=Number(await readFile(pidFile,'utf8'));
      assert.ok(await until(async()=>Boolean(await fetch(`http://127.0.0.1:${port}/`).catch(()=>null)),10000),'server listening');
      assert.equal(alive(server),true);
      app.kill(signal);
      const gone=await until(()=>!alive(server),5000);
      if(!gone)process.kill(server,'SIGKILL');
      assert.equal(gone,true,'server outlived its app');
    } finally {
      if(app.exitCode===null && app.signalCode===null)app.kill('SIGKILL');
    }
  }));
}

test('both apps start the server with --with-parent, and the Mac app stops it on SIGTERM',async()=>{
  const swift=await readFile(path.join(repo,'glance/mac/Glance.swift'),'utf8');
  assert.match(swift,/serve-local\.mjs", "--with-parent"/);
  assert.match(swift,/makeSignalSource\(signal: SIGTERM/);
  assert.match(swift,/self\?\.stopProcesses\(\)/);
  assert.match(swift,/running\.terminate\(\)\n\s+running\.waitUntilExit\(\)/);
  const cs=await readFile(path.join(repo,'glance/windows/Glance.cs'),'utf8');
  assert.match(cs,/Node\("serve-local\.mjs", true, " --with-parent"\)/);
});

test('a server whose app was already gone when it started exits at once',async()=>{
  const {watchParent}=await import('../serve-local.mjs');
  let exited=0;
  watchParent(process.pid,{exit:()=>{exited++;},currentParent:()=>12345})();
  assert.equal(exited,1);
  if(process.platform!=='win32') {watchParent(1,{exit:()=>{exited++;}})();assert.equal(exited,2);}
  const stop=watchParent(process.pid,{exit:()=>{exited+=10;},currentParent:()=>process.pid});
  stop();
  assert.ok(exited<10);
});

// A server started before an update keeps its old code in memory while it serves the new page from disk,
// so the new page asks for data the old code never makes (the Week view stayed on its first-run screen).
for(const {change,rebuild} of [{change:'a new page',rebuild:page=>writeFile(page,'<script src="/assets/new.js"></script>')},
  {change:'the same page',rebuild:page=>utimes(page,new Date(),new Date(Date.now()+60000))}]) {
  test(`a server exits once the dashboard is rebuilt to ${change}`,()=>withFolder(async folder=>{
    const {watchBuild}=await import('../serve-local.mjs');
    const page=path.join(folder,'index.html');
    await writeFile(page,'<script src="/assets/old.js"></script>');
    let exited=0;
    const stop=watchBuild(page,{intervalMs:50,exit:()=>{exited++;}});
    try {
      await new Promise(resolve=>setTimeout(resolve,200)); // sleep-ok: several checks of an unchanged build must pass without an exit
      assert.equal(exited,0,'an unchanged build keeps the server');
      await rebuild(page);
      assert.ok(await until(()=>exited>0,2000),'the server kept serving after the rebuild');
    } finally {stop();}
  }));
}

test('the command-line server watches the build it serves',async()=>{
  const source=await readFile(path.join(repo,'serve-local.mjs'),'utf8');
  assert.match(source,/watchBuild\(path\.join\(here,'dist\/dashboard','index\.html'\)/);
});
