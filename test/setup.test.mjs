import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeSupported,paths,launchAgent,infoPlist,glanceSettings,LABEL} from '../scripts/setup.mjs';

test('Node 22.13 or later is required',()=>{
  assert.equal(nodeSupported('22.13.0'),true);
  assert.equal(nodeSupported('24.1.0'),true);
  assert.equal(nodeSupported('22.12.9'),false);
  assert.equal(nodeSupported('20.18.0'),false);
});

test('the glance app is built inside the clone, not in Applications',()=>{
  const mac=paths('darwin','/Users/a/Developer/observatory','/Users/a');
  assert.equal(mac.app,'/Users/a/Developer/observatory/build/Observatory.app');
  assert.equal(mac.launchAgent,`/Users/a/Library/LaunchAgents/${LABEL}.plist`);
  const win=paths('win32','C:\\src\\observatory','C:\\Users\\a',{WINDIR:'C:\\Windows'});
  assert.equal(win.executable,'C:\\src\\observatory\\build\\windows\\ObservatoryGlance.exe');
  assert.equal(win.compiler,'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe');
});

test('the login item starts the app and escapes its path',()=>{
  const plist=launchAgent('/Users/a & b/build/Observatory.app/Contents/MacOS/ObservatoryGlance');
  assert.match(plist,/<string>\/Users\/a &amp; b\/build/);
  assert.match(plist,/<key>RunAtLoad<\/key><true\/>/);
  assert.match(infoPlist(),/<key>LSUIElement<\/key><true\/>/);
});

test('the app settings hold paths only, no source data',()=>{
  const settings=glanceSettings({dataFolder:'/d',dashboard:{port:5601}},'/n/node','/r','/r/observatory.config.json');
  assert.deepEqual(settings,{node:'/n/node',repo:'/r',config:'/r/observatory.config.json',dataFolder:'/d',port:5601});
});

test('the computer name falls back to Mac or PC and drops control characters',async()=>{
  const {computerName}=await import('../scripts/setup.mjs');
  assert.equal(await computerName('win32',{COMPUTERNAME:'DESK\u0007TOP'}),'DESKTOP');
  assert.equal(await computerName('win32',{}),'PC');
});

test('a status line that points at a missing bridge is noticed',()=>import('./helpers.mjs').then(({withFolder})=>withFolder(async folder=>{
  const {writeFile}=await import('node:fs/promises');
  const path=(await import('node:path')).default;
  const {brokenStatusline}=await import('../scripts/setup.mjs');
  const settings=path.join(folder,'settings.json');
  await writeFile(settings,JSON.stringify({statusLine:{type:'command',command:'"/n/node" "/gone/Observatory.app/claude-statusline-bridge.mjs" --runtime "/d"'}}));
  assert.equal(await brokenStatusline(settings),'/gone/Observatory.app/claude-statusline-bridge.mjs');
  await writeFile(settings,JSON.stringify({statusLine:{type:'command',command:'echo hi'}}));
  assert.equal(await brokenStatusline(settings),null);
  assert.equal(await brokenStatusline(path.join(folder,'missing.json')),null);
})));

test('a dry run on a fresh clone lists every step and writes nothing',()=>import('./helpers.mjs').then(({withFolder})=>withFolder(async folder=>{
  const {execFileSync}=await import('node:child_process');
  const {existsSync}=await import('node:fs');
  const path=(await import('node:path')).default;
  const config=path.join(folder,'observatory.config.json');
  const output=execFileSync(process.execPath,['scripts/setup.mjs','--dry-run'],{env:{...process.env,OBSERVATORY_CONFIG:config},encoding:'utf8'});
  for(const step of ['would write observatory.config.json','would build the dashboard','would write the app settings','Dry run: nothing was changed.'])
    assert.ok(output.includes(step),step);
  assert.equal(existsSync(config),false);
})),{skip:!['darwin','win32'].includes(process.platform) && 'setup runs on macOS and Windows only'});
