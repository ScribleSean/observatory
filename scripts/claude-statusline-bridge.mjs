#!/usr/bin/env node
// Claude Code runs this as its status line command. It saves the two limit
// windows for Observatory, then prints what the person's earlier status line
// command prints. It must stay fast and must never fail the status line.
import {spawn} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {CLAUDE_LIMITS_FOLDER,CLAUDE_STATUSLINE_FILE,extractClaudeLimits,recordClaudeLimits} from './claude-limits.mjs';

const limit=1024*1024;

function readInput() {
  return new Promise(resolve=>{
    const chunks=[];let size=0,done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve(Buffer.concat(chunks));};
    const timer=setTimeout(finish,2000);
    process.stdin.on('data',chunk=>{size+=chunk.length;if(size>limit){chunks.length=0;finish();}else chunks.push(chunk);});
    process.stdin.on('end',finish);process.stdin.on('error',finish);
  });
}

async function previousCommand(runtime) {
  try {
    const file=path.join(runtime,CLAUDE_LIMITS_FOLDER,CLAUDE_STATUSLINE_FILE);
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.size>16384)return null;
    const saved=JSON.parse(await readFile(file,'utf8'));
    const command=saved?.previous?.type==='command'?saved.previous.command:null;
    return typeof command==='string' && command.trim() && !command.includes('claude-statusline-bridge.mjs')?command:null;
  } catch {return null;}
}

function passThrough(command,input) {
  return new Promise(resolve=>{
    let done=false;
    const child=spawn(command,{shell:true,stdio:['pipe','inherit','ignore'],windowsHide:true});
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{child.kill();finish();},5000);
    child.once('error',finish);child.once('close',finish);
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}

export function ownLine(input,now=Date.now()) {
  const record=extractClaudeLimits(input,now);
  if(!record)return '';
  const part=(name,label)=>record.windows[name]?`${label} ${Math.round(100-record.windows[name].usedPercentage)}% left`:null;
  return [part('five_hour','5h'),part('seven_day','7d')].filter(Boolean).join(' · ');
}

export async function runBridge(argv,raw) {
  const index=argv.indexOf('--runtime');
  const runtime=index>=0?argv[index+1]:'';
  let input=null;
  try {input=JSON.parse(raw.toString('utf8'));}catch{}
  if(typeof runtime==='string' && path.isAbsolute(runtime)) {
    try {await recordClaudeLimits(runtime,input);}catch{}
    const command=await previousCommand(runtime);
    if(command) {await passThrough(command,raw);return;}
  }
  const line=ownLine(input);
  if(line)process.stdout.write(line+'\n');
}

if(process.argv[1] && path.basename(process.argv[1])==='claude-statusline-bridge.mjs')
  readInput().then(raw=>runBridge(process.argv.slice(2),raw)).catch(()=>{}).finally(()=>{process.exitCode=0;});
