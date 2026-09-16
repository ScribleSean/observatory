import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(process.platform!=='win32')throw Error('Windows build host required');
const dotnet=process.argv[2];
if(!dotnet || !path.isAbsolute(dotnet))throw Error('Pass the absolute .NET executable');
const root=fileURLToPath(new URL('../..',import.meta.url));
const scratch=mkdtempSync(path.join(tmpdir(),'observatory-trust-build-'));
const key=Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex').toString('base64');
const trust={schema:1,platform:'windows-x64',feedUrl:'https://scriblesean.github.io/observatory/updates/windows-x64.xml',publicKey:key};
const run=(args)=>spawnSync(dotnet,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,windowsHide:true});
const build=(name,configuration)=>{
  const output=path.join(scratch,name);
  const args=['build','native/windows/WorkspaceObservatory.csproj','-c','Release','--no-restore','-o',output];
  if(configuration) {
    const file=path.join(scratch,name+'.json');
    writeFileSync(file,JSON.stringify(configuration));
    args.push('-p:ObservatoryUpdateTrustFile='+file);
  }
  const result=run(args);
  assert.equal(result.status,0,result.stdout+result.stderr+String(result.error??''));
  return path.join(output,'WorkspaceObservatory.dll');
};
const check=(binary,expected,status=0)=>{
  const result=run([binary,'--test-update-trust',expected]);
  assert.equal(result.status,status,result.stdout+result.stderr+String(result.error??''));
};
try {
  check(build('without'),'none');
  const trusted=build('trusted',trust);
  check(trusted,key);
  check(trusted,'none',1);
  check(trusted,Buffer.alloc(32,1).toString('base64'),1);
  const published=path.join(scratch,'published');
  const publication=run(['publish','native/windows/WorkspaceObservatory.csproj','-c','Release','-r','win-x64',
    '--self-contained','true','--no-restore','-o',published,'-p:ObservatoryUpdateTrustFile='+path.join(scratch,'trusted.json')]);
  assert.equal(publication.status,0,publication.stdout+publication.stderr+String(publication.error??''));
  const publishedCheck=spawnSync(path.join(published,'WorkspaceObservatory.exe'),['--test-update-trust',key],
    {encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(publishedCheck.status,0,publishedCheck.stdout+publishedCheck.stderr+String(publishedCheck.error??''));
  check(build('wrong-feed',{...trust,feedUrl:'https://example.invalid/updates'}),key,1);
  check(build('without-again'),'none');
  const missing=run(['build','native/windows/WorkspaceObservatory.csproj','-c','Release','--no-restore',
    '-p:ObservatoryUpdateTrustFile='+path.join(scratch,'absent.json')]);
  assert.notEqual(missing.status,0);
  assert.match(missing.stdout+missing.stderr,/explicit update trust file does not exist/);
  console.log('PASS: build and self-contained publish public trust, mismatched key/feed refusal, missing input and unconfigured rebuild. No updater started.');
} finally {
  rmSync(scratch,{recursive:true,force:true});
}
