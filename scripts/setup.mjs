// npm run setup: check prerequisites, write a starter settings file, build the
// dashboard and the glance app on this computer, and start it at login.
// Run it again after `git pull`. `npm run setup -- --dry-run` changes nothing.
// `--no-login` builds without starting the app. `npm run setup -- --remove` removes the login item and stops the app.
import {execFile,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {REPO,CONFIG_FILE,loadConfig,defaultDataFolder} from '../lib/config.mjs';
import {sshTransport} from './hub-transport.mjs';

const execute=promisify(execFile);
export const LABEL='io.github.observatory.glance';
export const MAC_EXECUTABLE='ObservatoryGlance';
export const WINDOWS_EXECUTABLE='ObservatoryGlance.exe';
export const STARTUP_NAME='ObservatoryGlance';
const OLD_EXECUTABLES={darwin:'WorkspaceObservatory',win32:'WorkspaceObservatory.exe'};
const MIN_NODE=[22,13];

export function nodeSupported(version=process.versions.node) {
  const [major,minor]=version.split('.').map(Number);
  return major>MIN_NODE[0] || (major===MIN_NODE[0] && minor>=MIN_NODE[1]);
}

export function paths(platform=process.platform,repo=REPO,home=homedir(),environment=process.env) {
  if(platform==='darwin') {
    const app=path.join(repo,'build','Observatory.app');
    return {app,executable:path.join(app,'Contents','MacOS',MAC_EXECUTABLE),settings:path.join(app,'Contents','Resources','glance.json'),
      launchAgent:path.join(home,'Library','LaunchAgents',`${LABEL}.plist`)};
  }
  const folder=path.win32.join(repo,'build','windows');
  const windir=environment.WINDIR || environment.SystemRoot || 'C:\\Windows';
  return {app:folder,executable:path.win32.join(folder,WINDOWS_EXECUTABLE),settings:path.win32.join(folder,'glance.json'),
    compiler:path.win32.join(windir,'Microsoft.NET','Framework64','v4.0.30319','csc.exe')};
}

const xml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${LABEL}</string>
<key>CFBundleName</key><string>Observatory</string>
<key>CFBundleExecutable</key><string>${MAC_EXECUTABLE}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>2.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
`;
}

export function launchAgent(executable) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(executable)}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>
`;
}

export function glanceSettings(config,node=process.execPath,repo=REPO,configFile=CONFIG_FILE) {
  return {node,repo,config:configFile,dataFolder:config.dataFolder,port:config.dashboard.port};
}

async function quiet(file,args,options={}) {
  try {return (await execute(file,args,{windowsHide:true,timeout:120000,maxBuffer:8_000_000,...options})).stdout;}
  catch {return null;}
}

async function activityWatchUp() {
  try {return (await fetch('http://127.0.0.1:5600/api/0/info',{signal:AbortSignal.timeout(2000)})).ok;}
  catch {return false;}
}

async function oldAppRunning(platform) {
  const name=OLD_EXECUTABLES[platform];
  if(platform==='darwin')return (await quiet('/usr/bin/pgrep',['-x',name]))!==null;
  const list=await quiet('tasklist.exe',['/FI',`IMAGENAME eq ${name}`,'/NH']);
  return typeof list==='string' && list.toLowerCase().includes(name.toLowerCase());
}

function npm(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:REPO,stdio:'inherit',shell:process.platform==='win32'});
    child.once('error',reject);
    child.once('close',code=>code===0?resolve():reject(Error(`npm ${args.join(' ')} failed`)));
  });
}

export async function setup({dryRun=false,login=true,platform=process.platform,log=console.log}={}) {
  const step=(text)=>log(`- ${text}`);
  const act=async(text,action)=>{step(dryRun?`would ${text}`:text);if(!dryRun)return action();};
  if(!['darwin','win32'].includes(platform))throw Error('Observatory runs on macOS and Windows only.');
  if(!nodeSupported())throw Error(`Node ${MIN_NODE.join('.')} or later is required. This is Node ${process.versions.node}.`);
  step(`Node ${process.versions.node}`);

  const configFile=process.env.OBSERVATORY_CONFIG || CONFIG_FILE;
  if(!existsSync(configFile)) {
    await act('write observatory.config.json from the example. Edit it, then run setup again',async()=>{
      const example=JSON.parse(await readFile(path.join(REPO,'observatory.config.example.json'),'utf8'));
      if(platform==='win32')example.device.name='PC';
      await writeFile(configFile,JSON.stringify(example,null,2)+'\n',{flag:'wx'});
    });
    if(dryRun)return;
  }
  const config=await loadConfig(configFile,{platform});
  step(`Settings: ${config.device.name}, ${config.role}, sources on: ${Object.entries(config.sources).filter(([,on])=>on).map(([key])=>key).join(', ') || 'none'}`);

  // The older app writes usage.json in the same default data folder.
  if(config.dataFolder===defaultDataFolder(platform) && await oldAppRunning(platform)) {
    const message='The older Observatory app is running and writes the same files. Quit it (and turn off its login item) first, then run setup again.';
    if(!dryRun)throw Error(message);
    log(`  Note: ${message}`);
  }
  if(config.sources.screenTime && !await activityWatchUp())
    log('  Note: ActivityWatch is not answering on 127.0.0.1:5600. Screen time stays Unknown until it runs.');

  if(!existsSync(path.join(REPO,'node_modules','vite')))await act('install build tools with npm ci',()=>npm(['ci']));
  await act('build the dashboard into dist/dashboard',()=>npm(['run','build']));

  const target=paths(platform);
  if(platform==='darwin') {
    await act(`build the menu bar app at ${path.relative(REPO,target.app)}`,async()=>{
      if(await quiet('/usr/bin/xcrun',['--find','swiftc'])===null)
        throw Error('The Swift compiler is missing. Install the Xcode Command Line Tools with: xcode-select --install');
      await rm(target.app,{recursive:true,force:true});
      await mkdir(path.dirname(target.executable),{recursive:true});
      await mkdir(path.dirname(target.settings),{recursive:true});
      await writeFile(path.join(target.app,'Contents','Info.plist'),infoPlist());
      await execute('/usr/bin/xcrun',['swiftc','-O','-swift-version','5',path.join(REPO,'glance','mac','Glance.swift'),'-o',target.executable],{timeout:300000});
      // Ad hoc signature so macOS runs the locally built app without a download warning.
      await quiet('/usr/bin/codesign',['--force','--sign','-',target.app]);
    });
  } else {
    await act(`build the tray app at ${path.relative(REPO,target.app)}`,async()=>{
      if(!existsSync(target.compiler))throw Error(`The .NET Framework C# compiler was not found at ${target.compiler}.`);
      await mkdir(target.app,{recursive:true});
      await execute(target.compiler,['/nologo','/target:winexe','/optimize+',`/out:${target.executable}`,
        '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',
        path.win32.join(REPO,'glance','windows','Glance.cs')],{windowsHide:true,timeout:300000});
    });
  }
  await act('write the app settings (glance.json)',()=>writeFile(target.settings,JSON.stringify(glanceSettings(config,process.execPath,REPO,path.resolve(configFile)),null,2)+'\n'));

  if(config.role==='hub') for(const spoke of config.hub.spokes) {
    if(dryRun) {step(`would check SSH to ${spoke.name} (${spoke.ssh})`);continue;}
    try {await sshTransport().pull(spoke);step(`${spoke.name}: reached over SSH and read its snapshot`);}
    catch(error) {log(`  Note: ${spoke.name} (${spoke.ssh}): ${error.message}. Check that "ssh ${spoke.ssh}" works without a password prompt, and that setup has run there.`);}
  }

  if(!login)step('left the login item unchanged (--no-login)');
  else if(platform==='darwin') {
    await act('start the menu bar app now and at login',async()=>{
      await mkdir(path.dirname(target.launchAgent),{recursive:true});
      await writeFile(target.launchAgent,launchAgent(target.executable));
      const domain=`gui/${process.getuid()}`;
      await quiet('/bin/launchctl',['bootout',`${domain}/${LABEL}`]);
      await execute('/bin/launchctl',['bootstrap',domain,target.launchAgent]);
    });
  } else {
    await act('start the tray app now and at login',async()=>{
      await quiet('taskkill.exe',['/IM',WINDOWS_EXECUTABLE,'/F']);
      await execute('reg.exe',['add','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v',STARTUP_NAME,'/t','REG_SZ','/d',`"${target.executable}"`,'/f'],{windowsHide:true});
      spawn(target.executable,[],{detached:true,stdio:'ignore'}).unref();
    });
  }
  log(`Done. Dashboard: http://127.0.0.1:${config.dashboard.port} (use Open dashboard in the ${platform==='darwin'?'menu bar':'tray'} menu).`);
}

export async function remove({platform=process.platform,log=console.log}={}) {
  const target=paths(platform);
  if(platform==='darwin') {
    await quiet('/bin/launchctl',['bootout',`gui/${process.getuid()}/${LABEL}`]);
    await rm(target.launchAgent,{force:true});
  } else {
    await quiet('reg.exe',['delete','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v',STARTUP_NAME,'/f']);
    await quiet('taskkill.exe',['/IM',WINDOWS_EXECUTABLE,'/F']);
  }
  log('Removed the login item and stopped the app. Your data folder and settings file are unchanged.');
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.includes('--remove'))await remove();
    else await setup({dryRun:process.argv.includes('--dry-run'),login:!process.argv.includes('--no-login')});
  } catch(error) {
    console.error(`Setup stopped: ${error.message}`);
    process.exitCode=1;
  }
}

