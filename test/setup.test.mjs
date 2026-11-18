import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {minimumNode,nodeSupported,paths,launchAgent,infoPlist,glanceSettings,installMacApp,startMenuShortcut,systemdService,systemdTimer,crontabLine,LABEL} from '../scripts/setup.mjs';

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

test('Node 22.13 or later is required, and 22.17 or later on Windows',()=>{
  assert.equal(nodeSupported('22.13.0','darwin'),true);
  assert.equal(nodeSupported('24.1.0','darwin'),true);
  assert.equal(nodeSupported('22.12.9','darwin'),false);
  assert.equal(nodeSupported('20.18.0','darwin'),false);
  assert.equal(nodeSupported('22.17.0','win32','1.51.0'),true);
  assert.equal(nodeSupported('24.1.0','win32','1.51.0'),true);
  assert.equal(nodeSupported('22.16.0','win32','1.49.2'),false);
  assert.equal(nodeSupported('23.6.0','win32','1.49.2'),false);
  assert.equal(minimumNode('darwin'),'22.13');
  assert.equal(minimumNode('win32'),'22.17');
});

test('the glance app is built inside the clone, not in Applications',()=>{
  const mac=paths('darwin','/Users/a/Developer/observatory','/Users/a');
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

test('a dry run on a fresh clone lists every step and writes nothing',{skip:!['darwin','win32','linux'].includes(process.platform) && 'Setup runs on macOS, Windows and Linux only'},()=>import('./helpers.mjs').then(({withFolder})=>withFolder(async folder=>{
  const {execFileSync}=await import('node:child_process');
  const {existsSync}=await import('node:fs');
  const path=(await import('node:path')).default;
  const config=path.join(folder,'observatory.config.json');
  const output=execFileSync(process.execPath,['scripts/setup.mjs','--dry-run'],{env:{...process.env,OBSERVATORY_CONFIG:config},encoding:'utf8'});
  const steps=process.platform==='linux'
    ?['would write observatory.config.json','Dry run: nothing was changed.']
    :['would write observatory.config.json','would build the dashboard','would import limit history','would write the app settings','Dry run: nothing was changed.'];
  for(const step of steps)assert.ok(output.includes(step),step);
  if(process.platform==='linux')assert.ok(!output.includes('build the dashboard'));
  assert.equal(existsSync(config),false);
})));

async function linuxDryRun(options={}) {
  const {setup}=await import('../scripts/setup.mjs');
  const lines=[];
  const before=process.env.OBSERVATORY_CONFIG;
  await withFolder(async folder=>{
    process.env.OBSERVATORY_CONFIG=path.join(folder,'observatory.config.json');
    try {await setup({dryRun:true,platform:'linux',log:line=>lines.push(line),hasSystemd:async()=>true,lingerIsOff:async()=>true,...options});}
    finally {if(before===undefined)delete process.env.OBSERVATORY_CONFIG;else process.env.OBSERVATORY_CONFIG=before;}
    assert.equal((await fs.readdir(folder)).length,0,'a dry run writes nothing');
  });
  return lines.join('\n');
}

test('Linux paths follow XDG_CONFIG_HOME for the systemd user folder',()=>{
  const posix=value=>value.replaceAll(path.sep,'/');
  const plain=paths('linux','/r','/home/a',{});
  assert.equal(posix(plain.unitFolder),'/home/a/.config/systemd/user');
  assert.equal(posix(plain.timer),'/home/a/.config/systemd/user/observatory.timer');
  assert.equal(posix(plain.service),'/home/a/.config/systemd/user/observatory.service');
  assert.equal(posix(paths('linux','/r','/home/a',{XDG_CONFIG_HOME:'/etc/xdg-a'}).unitFolder),'/etc/xdg-a/systemd/user');
  assert.equal(posix(paths('linux','/r','/home/a',{XDG_CONFIG_HOME:'relative'}).unitFolder),'/home/a/.config/systemd/user');
});

test('the Linux service runs tick.mjs once with the settings file, and the timer repeats every 5 minutes',()=>{
  const service=systemdService('/opt/node 22/bin/node','/srv/obs 100%','/srv/obs 100%/observatory.config.json');
  assert.match(service,/^Type=oneshot$/m);
  assert.match(service,/^ExecStart="\/opt\/node 22\/bin\/node" "\/srv\/obs 100%%\/scripts\/tick\.mjs"$/m);
  assert.match(service,/^WorkingDirectory=\/srv\/obs 100%%$/m);
  assert.match(service,/^Environment="OBSERVATORY_CONFIG=\/srv\/obs 100%%\/observatory\.config\.json"$/m);
  assert.match(service,/^Environment="PATH=\/opt\/node 22\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin"$/m);
  const priced=systemdService('/opt/node$1/bin/node','/srv/obs$x','/srv/obs$x/observatory.config.json');
  assert.match(priced,/^Environment="OBSERVATORY_CONFIG=\/srv\/obs\$x\/observatory\.config\.json"$/m,'Environment= does not expand $, so it stays single');
  assert.match(priced,/^Environment="PATH=\/opt\/node\$1\/bin:/m);
  assert.match(priced,/^ExecStart="\/opt\/node\$\$1\/bin\/node" "\/srv\/obs\$\$x\/scripts\/tick\.mjs"$/m,'ExecStart= does, so it is doubled');
  for(const args of [['/opt/node','/srv/a\nb','/srv/c.json'],['/opt/node','/srv/a','/srv/c\n.json'],['/opt/no\rde','/srv/a','/srv/c.json']])
    assert.throws(()=>systemdService(...args),/line break/);
  const timer=systemdTimer();
  assert.match(timer,/^OnUnitActiveSec=5min$/m);
  assert.match(timer,/^OnBootSec=1min$/m);
  assert.match(timer,/^Unit=observatory\.service$/m);
  assert.match(timer,/^WantedBy=timers\.target$/m);
  assert.doesNotMatch(service+timer,/[\u2014;]/);
});

test('the crontab line quotes every path',()=>{
  assert.equal(crontabLine('/opt/n o/bin/node','/srv/o\'x','/srv/o\'x/observatory.config.json'),
    "*/5 * * * * cd '/srv/o'\\''x' && OBSERVATORY_CONFIG='/srv/o'\\''x/observatory.config.json' '/opt/n o/bin/node' scripts/tick.mjs >/dev/null 2>&1");
});

test('a Linux dry run prints the timer and service, and builds nothing',async()=>{
  const output=await linuxDryRun();
  assert.match(output,/would write observatory\.config\.json/);
  assert.match(output,/would write the systemd user timer to .*systemd.user \(runs every 5 minutes\)/);
  assert.match(output,/observatory\.service:/);
  assert.match(output,/ExecStart=.*tick\.mjs/);
  assert.match(output,/observatory\.timer:/);
  assert.match(output,/OnUnitActiveSec=5min/);
  assert.match(output,/loginctl enable-linger/);
  assert.match(output,/Dry run: nothing was changed\./);
  assert.doesNotMatch(output,/npm|dashboard|tray|menu bar|ActivityWatch|Start menu|swiftc/);
});

test('without a systemd user session a Linux dry run prints the one crontab line instead',async()=>{
  const output=await linuxDryRun({hasSystemd:async()=>false});
  assert.match(output,/systemd user services are not available/);
  assert.equal(output.split('\n').filter(line=>line.includes('*/5 * * * * cd ')).length,1);
  assert.match(output,/scripts\/tick\.mjs >\/dev\/null 2>&1/);
  assert.doesNotMatch(output,/OnUnitActiveSec/);
});

test('a Linux dry run with --no-login leaves the schedule alone',async()=>{
  const output=await linuxDryRun({login:false});
  assert.match(output,/left the timer unchanged/);
  assert.doesNotMatch(output,/OnUnitActiveSec|crontab/);
});

test('removing on Linux says what it would delete, and a dry run deletes nothing',async()=>{
  const {remove}=await import('../scripts/setup.mjs');
  const lines=[];
  await remove({platform:'linux',dryRun:true,log:line=>lines.push(line)});
  assert.match(lines.join('\n'),/Would stop and delete observatory\.timer and observatory\.service/);
});

test('a Linux computer is named by its host name, with control characters removed',async()=>{
  const {computerName}=await import('../scripts/setup.mjs');
  const name=await computerName('linux',{});
  assert.ok(name.length>0 && name.length<=40 && !Array.from(name).some(c=>c.charCodeAt(0)<32));
});

test('the app icon is named in Info.plist, and the Start menu entry uses the app\'s own icon',()=>{
  assert.match(infoPlist(),/<key>CFBundleIconFile<\/key><string>Observatory<\/string>/);
  const command=startMenuShortcut("C:\\Users\\o'brien\\observatory\\build\\windows\\ObservatoryGlance.exe");
  assert.match(command,/IconLocation='C:\\Users\\o''brien\\observatory\\build\\windows\\ObservatoryGlance\.exe,0'/);
  assert.match(command,/GetFolderPath\('Programs'\)\) 'Observatory\.lnk'/);
  assert.match(startMenuShortcut('C:\\Users\\Alex\u2019s PC\\ObservatoryGlance.exe'),/TargetPath='C:\\Users\\Alex\u2019\u2019s PC\\ObservatoryGlance\.exe'/);
});
