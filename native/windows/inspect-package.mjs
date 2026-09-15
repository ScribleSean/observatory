import {readFileSync,writeFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {forbiddenPackageName,containsBuildPath} from './package-content.mjs';
import {sourceState} from '../source-state.mjs';

const root=process.argv[2];
if(!root || !path.isAbsolute(root))throw Error('Absolute package directory required');
const project=fileURLToPath(new URL('../..',import.meta.url));
const required=['Fonts/InterTight.ttf','Fonts/OFL.txt','WorkspaceObservatory.exe','WorkspaceObservatory.dll','WorkspaceObservatory.runtimeconfig.json',
  'Web/index.html','Runtime/node.exe','Runtime/python/python.exe','Runtime/python/python313._pth',
  'Licenses/Node-LICENSE.txt','Licenses/Python-LICENSE.txt','Licenses/Dashboard-LICENSES.txt',
  'Licenses/Python-dependencies/LICENSE.openssl-3.txt','Licenses/Python-dependencies/LICENSE.sqlite.txt',
  'Runtime/python/observatory-python-manifest.json',
  'Licenses/Microsoft.NETCore.App.Runtime.win-x64-LICENSE.TXT','Licenses/Microsoft.NETCore.App.Runtime.win-x64-THIRD-PARTY-NOTICES.TXT',
  'Licenses/Microsoft.WindowsDesktop.App.Runtime.win-x64-LICENSE','Licenses/Microsoft.Web.WebView2-LICENSE.txt','Licenses/Microsoft.Web.WebView2-NOTICE.txt',
  'Licenses/tzdata/LICENSE','Licenses/tzdata/licenses/LICENSE_APACHE',
  'Updater/WinSparkle.dll','Updater/COPYING','Updater/COPYING.expat',
  'Updater/verify-installation.mjs','Updater/verify-manifest.mjs','Updater/package-content.mjs',
  'Updater/replace-payload.mjs','Updater/signed-receipt.mjs','Updater/verify-candidate.mjs','Updater/stage-update-helper.mjs','Updater/stage-update-payload.mjs','Updater/apply-update.mjs'];
for(const file of required)if(!existsSync(path.join(root,file)))throw Error(`Missing package component: ${file}`);
// Only inspect this generated package. Do not scan the source logs or user profile.
const roots=[process.env.USERPROFILE,project];
const files=[];
function inspect(folder) {
  if(lstatSync(folder).isSymbolicLink())throw Error('Package contains a linked directory');
  for(const name of readdirSync(folder).sort()) {
    const file=path.join(folder,name);
    const relative=path.relative(root,file).replaceAll('\\','/');
    if(relative==='package-manifest.json')continue;
    const stat=lstatSync(file);
    if(stat.isSymbolicLink() || forbiddenPackageName(name))throw Error(`Unexpected package file: ${relative}`);
    if(stat.isDirectory()){inspect(file);continue;}
    if(!stat.isFile() || stat.size>200_000_000)throw Error('Unexpected package entry');
    const bytes=readFileSync(file);
    if(containsBuildPath(bytes,roots))throw Error(`Build-machine path found in package file: ${relative}`);
    files.push({path:relative,bytes:stat.size,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
inspect(root);
const updater=JSON.parse(readFileSync(new URL('./updater-tool.json',import.meta.url)));
const dll=files.find(file=>file.path==='Updater/WinSparkle.dll');
if(dll.bytes!==updater.runtime.bytes || dll.sha256!==updater.runtime.sha256)
  throw Error('Packaged updater DLL does not match the pinned runtime');
const {revision,dirty}=sourceState(project);
const totalBytes=files.reduce((sum,file)=>sum+file.bytes,0);
writeFileSync(path.join(root,'package-manifest.json'),JSON.stringify({schema:1,platform:'win-x64',sourceRevision:revision,sourceDirty:dirty,totalBytes,files},null,2)+'\n');
console.log(JSON.stringify({packageContent:'passed',files:files.length,totalBytes,sourceRevision:revision,sourceDirty:dirty}));
