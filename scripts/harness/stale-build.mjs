// Fails when the built dashboard is older than the last commit that changed its source,
// or when a running dashboard serves a different build than the one on disk.
// Usage: node scripts/harness/stale-build.mjs [checkout] [--url http://127.0.0.1:5601]
import {execFileSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';

const args=process.argv.slice(2);
const urlAt=args.indexOf('--url');
const url=urlAt>=0?args[urlAt+1]:null;
const checkout=path.resolve(args.find((arg,index)=>!arg.startsWith('--') && index!==urlAt+1) ?? '.');
const index=path.join(checkout,'dist/dashboard/index.html');

const result={checkout:path.basename(checkout),ok:true,problems:[]};
const sourceAt=Number(execFileSync('git',['-C',checkout,'log','-1','--format=%ct','--','app','lib'],{encoding:'utf8'}).trim())*1000;
result.lastSourceCommit=new Date(sourceAt).toISOString();
let built=null;
try {built=statSync(index).mtimeMs;}catch {}
result.builtAt=built?new Date(built).toISOString():null;
if(!built) result.problems.push('no build');
else if(built<sourceAt) result.problems.push(`build is ${Math.round((sourceAt-built)/3600000)}h older than the last source commit`);

if(url && built) {
  try {
    const served=await (await fetch(url,{signal:AbortSignal.timeout(3000)})).text();
    const script=text=>text.match(/assets\/[\w.-]+\.js/)?.[0] ?? null;
    result.served=script(served);
    result.onDisk=script(readFileSync(index,'utf8'));
    if(result.served!==result.onDisk) result.problems.push('the running server serves a different build');
  } catch(error) {result.problems.push(`server unreachable: ${error.message}`);}
}
result.ok=result.problems.length===0;
console.log(JSON.stringify(result,null,1));
process.exitCode=result.ok?0:1;
