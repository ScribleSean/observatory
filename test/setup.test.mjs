import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {nodeSupported,paths,launchAgent,infoPlist,glanceSettings,installMacApp,startMenuShortcut,LABEL} from '../scripts/setup.mjs';

for(const failure of ['compiler','executable','plist','sign','verify','swap','rollback',null]) {
  test(`staged Mac install: ${failure ?? 'success'}`,()=>withFolder(async folder=>{
    const target=paths('darwin',folder,folder);
    await fs.mkdir(path.dirname(target.executable),{recursive:true});
    await fs.writeFile(target.executable,'old');
    const events=[];
    let running=true;
    let backup;
    const settings='{"test":true}\n';
    const run=async(file,args)=>{
      if(file==='/usr/bin/xcrun') {
        events.push('compile');
        if(failure==='compiler')throw Error('compiler failed');
        const executable=args.at(-1);
        const staged=path.dirname(path.dirname(path.dirname(executable)));
        assert.equal(path.dirname(path.dirname(staged)),path.dirname(target.app));
        if(failure!=='executable')await fs.writeFile(executable,'new',{mode:0o755});
        if(failure==='plist')await fs.rm(path.join(path.dirname(path.dirname(executable)),'Info.plist'));
      } else {
        assert.equal(file,'/usr/bin/codesign');
        const step=args[0]==='--verify'?'verify':'sign';
        events.push(step);
        assert.equal(await fs.readFile(path.join(args.at(-1),'Contents','Resources','glance.json'),'utf8'),settings);
        assert.match(await fs.readFile(path.join(args.at(-1),'Contents','Resources','telescope.svg'),'utf8'),/<svg/);
        assert.ok((await fs.stat(path.join(args.at(-1),'Contents','Resources','Observatory.icns'))).size>0);
        if(failure===step)throw Error(`${step} failed`);
      }
    };
    const injectedFs={...fs,rename:async(from,to)=>{
      if(from===target.app) {backup=to;events.push('backup');}
      else if(to===target.app) {
        if(from===backup) {
          events.push('restore');
          if(failure==='rollback')throw Error('restore failed');
        } else {
          events.push('swap');
          if(failure==='swap' || failure==='rollback')throw Error('swap failed');
        }
      }
      return fs.rename(from,to);
    }};
    const stop=async()=>{
      events.push('stop');
      assert.equal(await fs.readFile(target.executable,'utf8'),'old');
      assert.deepEqual(events,['compile','sign','verify','stop']);
      running=false;
    };
    const install=()=>installMacApp(target,settings,{fs:injectedFs,run,stop});
    if(failure)await assert.rejects(install,error=>{
      if(failure==='executable' || failure==='plist')assert.equal(error.code,'ENOENT');
      else assert.match(error.message,new RegExp(`${failure} failed`));
      return true;
    });
    else await install();
    if(failure==='rollback') {
      assert.equal(await fs.readFile(path.join(backup,'Contents','MacOS','ObservatoryGlance'),'utf8'),'old');
      return;
    }
    assert.equal(await fs.readFile(target.executable,'utf8'),failure?'old':'new');
    assert.deepEqual(await fs.readdir(path.dirname(target.app)),['Observatory.app']);
    if(!failure) {
      assert.equal(await fs.readFile(target.settings,'utf8'),settings);
      assert.deepEqual(events,['compile','sign','verify','stop','backup','swap']);
    } else if(failure==='swap')assert.deepEqual(events,['compile','sign','verify','stop','backup','swap','restore']);
    assert.equal(running,Boolean(failure && failure!=='swap'));
  }));
}

test('Node 22.13 or later is required',()=>{
  assert.equal(nodeSupported('22.13.0'),true);
  assert.equal(nodeSupported('24.1.0'),true);
  assert.equal(nodeSupported('22.12.9'),false);
  assert.equal(nodeSupported('20.18.0'),false);
});

test('the glance app is built inside the clone, not in Applications',()=>{
  const mac=paths('darwin','/Users/a/Developer/observatory','/Users/a');
  // The macOS branch joins with the host's separator, so compare with forward slashes on any host.
  const posix=value=>value.replaceAll(path.sep,'/');
  assert.equal(posix(mac.app),'/Users/a/Developer/observatory/build/Observatory.app');
  assert.equal(posix(mac.launchAgent),`/Users/a/Library/LaunchAgents/${LABEL}.plist`);
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

test('a status line that still runs the removed bridge is reported, and the settings file is left alone',()=>import('./helpers.mjs').then(({withFolder})=>withFolder(async folder=>{
  const {writeFile,readFile}=await import('node:fs/promises');
  const path=(await import('node:path')).default;
  const {leftoverStatusline,claudeSettingsPath}=await import('../scripts/setup.mjs');
  const settings=path.join(folder,'settings.json');
  const text=JSON.stringify({statusLine:{type:'command',command:'"/n/node" "/repo/scripts/claude-statusline-bridge.mjs" --runtime "/d"'}});
  await writeFile(settings,text);
  assert.equal(await leftoverStatusline(settings),'/repo/scripts/claude-statusline-bridge.mjs');
  assert.equal(await readFile(settings,'utf8'),text);
  await writeFile(settings,JSON.stringify({statusLine:{type:'command',command:'echo hi'}}));
  assert.equal(await leftoverStatusline(settings),null);
  assert.equal(await leftoverStatusline(path.join(folder,'missing.json')),null);
  assert.equal(claudeSettingsPath({CLAUDE_CONFIG_DIR:'/c'}),path.join('/c','settings.json'));
})));

test('a dry run on a fresh clone lists every step and writes nothing',{skip:!['darwin','win32'].includes(process.platform) && 'Setup runs on macOS and Windows only'},()=>import('./helpers.mjs').then(({withFolder})=>withFolder(async folder=>{
  const {execFileSync}=await import('node:child_process');
  const {existsSync}=await import('node:fs');
  const path=(await import('node:path')).default;
  const config=path.join(folder,'observatory.config.json');
  const output=execFileSync(process.execPath,['scripts/setup.mjs','--dry-run'],{env:{...process.env,OBSERVATORY_CONFIG:config},encoding:'utf8'});
  for(const step of ['would write observatory.config.json','would build the dashboard','would import limit history','would write the app settings','Dry run: nothing was changed.'])
    assert.ok(output.includes(step),step);
  assert.equal(existsSync(config),false);
})),{skip:!['darwin','win32'].includes(process.platform) && 'setup runs on macOS and Windows only'});

test('the app icon is named in Info.plist, and the Start menu entry uses the app\'s own icon',()=>{
  assert.match(infoPlist(),/<key>CFBundleIconFile<\/key><string>Observatory<\/string>/);
  const command=startMenuShortcut("C:\\Users\\o'brien\\observatory\\build\\windows\\ObservatoryGlance.exe");
  assert.match(command,/IconLocation='C:\\Users\\o''brien\\observatory\\build\\windows\\ObservatoryGlance\.exe,0'/);
  assert.match(command,/GetFolderPath\('Programs'\)\) 'Observatory\.lnk'/);
  assert.match(startMenuShortcut('C:\\Users\\Alex\u2019s PC\\ObservatoryGlance.exe'),/TargetPath='C:\\Users\\Alex\u2019\u2019s PC\\ObservatoryGlance\.exe'/);
});
