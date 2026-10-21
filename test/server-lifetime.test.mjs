// The menu bar and tray apps start the dashboard server with --with-parent.
// When launchd stops the app (SIGTERM), or the app is killed outright, the
// server must not keep running on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFolder} from './helpers.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const alive=pid=>{try {process.kill(pid,0);return true;}catch {return false;}};
const freePort=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const until=async(check,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return true;await new Promise(r=>setTimeout(r,100));}return false;};

for(const signal of ['SIGTERM','SIGKILL']) {
  test(`the dashboard server exits when the app that started it gets ${signal}`,{skip:process.platform==='win32' && signal==='SIGTERM'},()=>withFolder(async folder=>{
    const port=await freePort();
    const config=path.join(folder,'observatory.config.json');
    await mkdir(path.join(folder,'data','public','local'),{recursive:true});
    await writeFile(config,JSON.stringify({dataFolder:path.join(folder,'data'),dashboard:{port}}));
    const pidFile=path.join(folder,'server.pid');
    // Stands in for the glance app: starts the server the way the app does, then waits.
    const app=spawn(process.execPath,['-e',`
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,[${JSON.stringify(path.join(repo,'serve-local.mjs'))},'--with-parent'],{stdio:'ignore',env:process.env});
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
      setInterval(()=>{},1000);`],
    {stdio:'ignore',env:{...process.env,OBSERVATORY_CONFIG:config,OBSERVATORY_PARENT_CHECK_MS:'200'}});
    assert.ok(await until(async()=>(await readFile(pidFile,'utf8').catch(()=>'')).length>0,5000),'server started');
    const server=Number(await readFile(pidFile,'utf8'));
    assert.ok(await until(async()=>(await fetch(`http://127.0.0.1:${port}/`).catch(()=>null))?.status===404 || alive(server),5000));
    assert.equal(alive(server),true);
    app.kill(signal);
    const gone=await until(()=>!alive(server),5000);
    if(!gone)process.kill(server,'SIGKILL');
    assert.equal(gone,true,'server outlived its app');
  }));
}

test('both apps start the server with --with-parent, and the Mac app stops it on SIGTERM',async()=>{
  const swift=await readFile(path.join(repo,'glance/mac/Glance.swift'),'utf8');
  assert.match(swift,/serve-local\.mjs", "--with-parent"/);
  assert.match(swift,/makeSignalSource\(signal: SIGTERM/);
  assert.match(swift,/server\?\.terminate\(\)\n\s+self\?\.tick\?\.terminate\(\)/);
  const cs=await readFile(path.join(repo,'glance/windows/Glance.cs'),'utf8');
  assert.match(cs,/Node\("serve-local\.mjs", true, " --with-parent"\)/);
});
