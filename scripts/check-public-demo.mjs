import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,lstatSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const target=mkdtempSync(path.join(tmpdir(),'observatory-public-check-'));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const name of new Set(files)) {
  if(/(^|\/)(\.env[^/]*|local\.config\.json|\.runtime|\.native-build|node_modules|outputs|work)(\/|$)/.test(name) || name.startsWith('public/local/'))throw Error('Private path entered public source inventory');
  const source=path.join(root,name);
  if(lstatSync(source).isSymbolicLink())throw Error('Source symlink is not allowed');
  mkdirSync(path.dirname(path.join(target,name)),{recursive:true});
  cpSync(source,path.join(target,name));
}
symlinkSync(path.join(root,'node_modules'),path.join(target,'node_modules'),'dir');
for(const args of [['run','demo'],['run','build']]) {
  execFileSync('npm',args,{cwd:target,stdio:'inherit',env:{...process.env,DASHBOARD_BASE_PATH:'/observatory'}});
}
execFileSync(process.execPath,['scripts/prepare-pages.mjs'],{cwd:target,stdio:'inherit'});
console.log(`Synthetic public package verified at ${path.join(target,'dist/pages')}. No live snapshot was copied.`);
