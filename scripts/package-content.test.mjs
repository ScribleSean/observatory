import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {forbiddenPackageName,containsBuildPath} from '../native/windows/package-content.mjs';

test('Windows updater runtime has an explicit self-contained package dependency list',t=>{
  const source=new URL('../native/windows/',import.meta.url);
  const project=readFileSync(new URL('WorkspaceObservatory.csproj',source),'utf8');
  const group=project.match(/<Content Include="([^"]+)">\s*<Link>Updater\/%\(Filename\)%\(Extension\)<\/Link>/);
  assert.ok(group,'Explicit updater content group is required');
  const files=group[1].split(';');
  assert.deepEqual(files.sort(),['package-content.mjs','replace-payload.mjs','signed-receipt.mjs','verify-candidate.mjs','verify-installation.mjs','verify-manifest.mjs']);
  const root=mkdtempSync(path.join(tmpdir(),'observatory-updater-runtime-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const file of files)copyFileSync(new URL(file,source),path.join(root,file));
  const entry=path.join(root,'verify-installation.mjs');
  const result=spawnSync(process.execPath,['--input-type=module','-e',
    'const m=await import(process.argv[1]); if(typeof m.replaceSignedInstallation!=="function")process.exit(1);',
    pathToFileURL(entry).href],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const inspector=readFileSync(new URL('inspect-package.mjs',source),'utf8');
  for(const file of files)assert.ok(inspector.includes("'Updater/"+file+"'"));
});

test('real package inspector requires the dashboard font and its license',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'observatory-font-package-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const inspector=fileURLToPath(new URL('../native/windows/inspect-package.mjs',import.meta.url));
  function missing(name) {
    const result=spawnSync(process.execPath,[inspector,root],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.ok(result.stderr.includes('Missing package component: '+name));
  }
  missing('Fonts/InterTight.ttf');
  mkdirSync(path.join(root,'Fonts'));
  writeFileSync(path.join(root,'Fonts','InterTight.ttf'),'Synthetic presence fixture, not a font');
  missing('Fonts/OFL.txt');
  writeFileSync(path.join(root,'Fonts','OFL.txt'),'Synthetic license presence fixture');
  missing('WorkspaceObservatory.exe');
});

test('package guard rejects private data, cache and debug names without depending on case',()=>{
  for(const name of ['usage.json','Usage.JSON','COLLECTOR.CONFIG.JSON','.env.local','capture.sqlite','session.JSONL','app.PDB','__pycache__','WebViewCache'])assert.equal(forbiddenPackageName(name),true,name);
  for(const name of ['LICENSE.txt','node.exe','python313.zip','package-manifest.json'])assert.equal(forbiddenPackageName(name),false,name);
});
test('package guard rejects private runtime directories and detached SQLite sidecars',()=>{
  for(const name of ['private-quota','PRIVATE-QUOTA','private-codex','private-sync','private-repair','PRIVATE-REPAIR','private-sync-retired-fixture',
    'state.sqlite-wal','state.sqlite-shm','state.sqlite-journal','cache.SQLITE3-WAL','cache.db-journal'])
    assert.equal(forbiddenPackageName(name),true,name);
  for(const name of ['quota-store.mjs','private-sync-acl.ps1','_sqlite3.so','sqlite3.dll','state-machine.js'])
    assert.equal(forbiddenPackageName(name),false,name);
});
test('package guard detects plain, escaped, UTF-16 and case-varied build paths',()=>{
  const root='C:\\Users\\SyntheticBuilder';
  for(const value of [root,root.toUpperCase(),root.replaceAll('\\','/'),JSON.stringify(root).slice(1,-1)]) {
    assert.equal(containsBuildPath(Buffer.from(`prefix ${value} suffix`),[root]),true);
    assert.equal(containsBuildPath(Buffer.from(`prefix ${value} suffix`,'utf16le'),[root]),true);
  }
  assert.equal(containsBuildPath(Buffer.from('Public product files only'),[root]),false);
  assert.equal(containsBuildPath(Buffer.from('Public product files only'),[undefined,'']),false);
});
