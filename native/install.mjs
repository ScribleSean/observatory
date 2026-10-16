import {checkInstallTarget} from './mac/install-guard.mjs';
import {appNames} from './app-names.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,writeFileSync,readFileSync,lstatSync,renameSync,chmodSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (!process.argv.includes('--install')) throw Error('Pass --install to install the verified local app and migrate its collector.');
const root=fileURLToPath(new URL('..',import.meta.url));
const home=homedir();
const runtime=path.join(home,'Library/Application Support',appNames.visible.dataFolder);
const applications=path.join(home,'Applications');
const app=path.join(applications,appNames.visible.macBundle);
const {legacyBundles}=checkInstallTarget({applicationsFolders:[applications,'/Applications'],
  dataParent:path.dirname(runtime),
  runningProcesses:()=>execFileSync('/bin/ps',['-axo','args='],{encoding:'utf8',timeout:10000})});
const {bundle:source}=JSON.parse(readFileSync(path.join(root,'.native-build/app.json'),'utf8'));
if(typeof source!=='string' || !source.startsWith(path.join(tmpdir(),'observatory-build-')) || path.basename(source)!==appNames.visible.macBundle)throw Error('Invalid build artifact');
const binary=`Contents/MacOS/${appNames.internal.macExecutable}`;
for(const folder of [runtime,applications]) {
  if(existsSync(folder) && lstatSync(folder).isSymbolicLink())throw Error('Installation folders must not be symlinks');
}
execFileSync('/usr/bin/codesign',['--verify','--strict',source]);
execFileSync(path.join(source,binary),['--self-test'],{stdio:'inherit'});
const python=execFileSync('/usr/bin/which',['python3'],{encoding:'utf8'}).trim();
if(!path.isAbsolute(python) || !path.isAbsolute(process.execPath))throw Error('Absolute installed runtimes required');
mkdirSync(runtime,{recursive:true,mode:0o700});
chmodSync(runtime,0o700);
mkdirSync(applications,{recursive:true});
const backups=path.join(runtime,'Backups');
mkdirSync(backups,{recursive:true,mode:0o700});
const stamp=new Date().toISOString().replaceAll(':','-');
if(existsSync(app)) {
  if(!process.argv.includes('--update'))throw Error('An app is already installed. Use --update after quitting Observatory.');
  renameSync(app,path.join(backups,`${appNames.visible.productName}-${stamp}.app.backup`));
}
for(const legacy of legacyBundles)if(path.dirname(legacy)===applications)
  renameSync(legacy,path.join(backups,`${appNames.legacy.productName}-${stamp}.app.backup`));
cpSync(source,app,{recursive:true,errorOnExist:true,force:false});
execFileSync('/usr/bin/codesign',['--verify','--strict',app]);
cpSync(path.join(app,'Contents/Resources/Collector/scripts'),path.join(runtime,'scripts'),{recursive:true});
writeFileSync(path.join(runtime,'native-runtime.json'),JSON.stringify({python,node:process.execPath}),{mode:0o600});
const local=path.join(runtime,'public/local');
mkdirSync(local,{recursive:true,mode:0o700});
for(const name of ['usage.json','collector.json']) {
  const from=path.join(root,'public/local',name),to=path.join(local,name);
  if(existsSync(from) && !existsSync(to)) {cpSync(from,to);chmodSync(to,0o600);}
}
// Disable only the previous collector for this exact checkout. Its files remain recoverable.
const old=path.join(home,'Library/LaunchAgents/io.ai-usage-dashboard.collector.plist');
if(existsSync(old)) {
  const value=readFileSync(old,'utf8');
  if(!value.includes(path.join(root,'scripts/run-collector.py')))throw Error('An unrelated collector is configured. No login job was changed.');
  spawnSync('/bin/launchctl',['bootout',`gui/${process.getuid()}/io.ai-usage-dashboard.collector`],{stdio:'ignore'});
  renameSync(old,path.join(backups,`collector-${stamp}.plist`));
}
const login=spawnSync(path.join(app,binary),['--enable-login'],{encoding:'utf8'});
console.log(JSON.stringify({app,runtime,legacyBundlesLeft:legacyBundles.filter(bundle=>path.dirname(bundle)!==applications),login:login.stdout?.trim() || 'registration-failed',legacyCollector:'backed-up-if-present'}));
execFileSync('/usr/bin/open',['-a',app,'--args','--show']);
