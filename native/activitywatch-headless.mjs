import {checkInstallTarget} from './mac/install-guard.mjs';
import {appNames} from './app-names.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,readFileSync,renameSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

if(!process.argv.includes('--install'))throw Error('Pass --install only after removing the ActivityWatch GUI login item.');
const executable='/Applications/ActivityWatch.app/Contents/MacOS/aw-qt';
if(!existsSync(executable))throw Error('ActivityWatch is not installed at the verified location');
const help=execFileSync(executable,['--help'],{encoding:'utf8'});
if(!help.includes('--no-gui'))throw Error('This installation does not offer headless operation');
const home=homedir(),label=appNames.internal.macActivityWatchLabel;
const target=path.join(home,'Library/LaunchAgents',`${label}.plist`);
const backup=path.join(home,'Library/Application Support',appNames.visible.dataFolder,'Backups');
checkInstallTarget({applicationsFolders:[path.join(home,'Applications'),'/Applications'],
  dataParent:path.join(home,'Library/Application Support'),
  runningProcesses:()=>execFileSync('/bin/ps',['-axo','args='],{encoding:'utf8',timeout:10000})});
mkdirSync(backup,{recursive:true,mode:0o700});
if(existsSync(target)) {
  if(!readFileSync(target,'utf8').includes(executable))throw Error('Unexpected existing startup job');
  renameSync(target,path.join(backup,`activitywatch-${Date.now()}.plist`));
}
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${executable}</string><string>--no-gui</string><string>--autostart-modules</string><string>aw-server,aw-watcher-afk,aw-watcher-window</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>\n`;
writeFileSync(target,xml,{mode:0o600});
const inventory=()=>execFileSync('/bin/ps',['-axo','pid=,comm='],{encoding:'utf8'}).trim().split('\n')
  .map(line=>line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean)
  .filter(row=>row[2].startsWith('/Applications/ActivityWatch.app/Contents/'))
  .map(row=>({pid:Number(row[1]),command:row[2]}));
const processes=inventory();
for(const process of processes) {
  try{globalThis.process.kill(process.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
}
for(let tries=0;tries<50 && inventory().length;tries++)await new Promise(resolve=>setTimeout(resolve,100));
if(inventory().length)throw Error('ActivityWatch did not stop. Startup file is prepared but was not activated.');
spawnSync('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`],{stdio:'ignore'});
execFileSync('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,target],{stdio:'inherit'});
console.log('ActivityWatch configured to track in the background without a tray icon. Verify fresh events before declaring success.');
