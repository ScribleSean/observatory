// What a session did, as the ledger needs it: where it wrote, which branches it made and which tool
// calls failed again and again. Paths and commands are read here and in the private parse cache only.
// The snapshot gets a repository folder name, a count or a tool category, never the path or command.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {repositoryRoot} from '../read-projects.mjs';

export const hashKey=text=>createHash('sha1').update(text).digest('hex').slice(0,10);

export {TOOL_CATEGORIES} from './pure.mjs';
export function toolCategory(name) {
  const tool=String(name ?? '').toLowerCase();
  if(['bash','exec_command','write_stdin','shell','exec','powershell'].some(word=>tool===word || tool.endsWith('__'+word)) || tool.includes('exec_command'))return 'Shell';
  if(['edit','write','multiedit','notebookedit','apply_patch'].includes(tool) || tool.includes('apply_patch'))return 'File edits';
  if(['browser','chrome','cua','computer'].some(word=>tool.includes(word)))return 'Browser';
  if(['webfetch','websearch','web_search','web-fetch'].includes(tool) || ['web','search','fetch'].some(word=>tool.includes(word)))return 'Research';
  return 'Other tools';
}

export const FILE_TOOLS=Object.freeze({Edit:'file_path',Write:'file_path',MultiEdit:'file_path',NotebookEdit:'notebook_path'});

// ---- Retries: the longest run of failed calls to one tool with the same input. ----
const MAX_PENDING=200;
export const retryState=()=>({pend:{},run:null,runs:[]});
export function retryCall(state,id,name,input) {
  if(typeof id!=='string' || !id)return;
  state.pend[id]=[toolCategory(name),hashKey(`${name}\0${typeof input==='string'?input:JSON.stringify(input ?? null)}`)];
  const ids=Object.keys(state.pend);
  if(ids.length>MAX_PENDING)delete state.pend[ids[0]];
}
export function retryResult(state,id,failed,at) {
  const call=state.pend[id];
  if(!call)return;
  delete state.pend[id];
  const [category,key]=call;
  if(failed && state.run && state.run[0]===key) {state.run[1]++;state.run[3]=at;return;}
  if(state.run && state.run[1]>=2)state.runs.push([state.run[3],state.run[1],state.run[2]]);
  state.run=failed?[key,1,category,at]:null;
}
// Finished runs plus the one still going, as {at, count, category}.
export const retryRuns=state=>[...state.runs,...(state.run && state.run[1]>=2?[[state.run[3],state.run[1],state.run[2]]]:[])]
  .map(([at,count,category])=>({at,count,category}));

// ---- Shell commands that write. ----
const OPERATORS=new Set(['&&','||',';','|','&','\n','(',')']);
// Splits one command line into words and operators. Quotes are honoured, $(...) and backticks stay as text.
function words(line) {
  const out=[];
  let word=null,i=0;
  const push=()=>{if(word!==null)out.push(word);word=null;};
  while(i<line.length) {
    const c=line[i];
    if(c==="'") {const end=line.indexOf("'",i+1);word=(word ?? '')+line.slice(i+1,end<0?line.length:end);i=end<0?line.length:end+1;continue;}
    if(c==='"') {
      let j=i+1,text='';
      while(j<line.length && line[j]!=='"') {if(line[j]==='\\' && j+1<line.length) {text+=line[j+1];j+=2;} else text+=line[j++];}
      word=(word ?? '')+text;i=j+1;continue;
    }
    if(c==='\\' && i+1<line.length) {word=(word ?? '')+line[i+1];i+=2;continue;}
    if(/\s/.test(c)) {push();i++;continue;}
    // 2>&1 and >&2 copy a stream and write no file.
    const dup=/^[0-9]?>&[0-9-]/.exec(line.slice(i,i+4));
    if(dup && (word===null || /^[0-9]$/.test(word))) {word=null;push();i+=dup[0].length;continue;}
    const two=line.slice(i,i+2);
    if(['&&','||','>>','&>'].includes(two)) {push();out.push(two==='&>'?'>':two);i+=2;continue;}
    if(c==='>') {if(/^[0-9]$/.test(word ?? ''))word=null;push();out.push('>');i+=line[i+1]==='|'?2:1;continue;}
    if(OPERATORS.has(c)) {push();out.push(c);i++;continue;}
    word=(word ?? '')+c;i++;
  }
  push();
  return out;
}

// Heredoc bodies are text, not commands.
function commandLines(command) {
  const lines=String(command).split('\n'),out=[];
  for(let i=0;i<lines.length;i++) {
    out.push(lines[i]);
    const marker=/<<-?\s*['"]?([A-Za-z_][\w-]*)['"]?/.exec(lines[i]);
    if(marker)while(i+1<lines.length && lines[i+1].trim()!==marker[1])i++;
  }
  return out;
}

const PREFIX=new Set(['sudo','time','command','env','nohup','exec','builtin','nice']);
const GIT_WRITES=new Set(['commit','merge','add','push','cherry-pick','rebase','am','revert','pull','apply','rm','mv','tag']);

// The folders a shell command writes into, and the branches it creates.
// cwd is the folder the command ran in. Only literal paths are followed: one with $ (other than
// $HOME), a glob or a command substitution is skipped.
export function shellWrites(command,cwd,home) {
  const dirs=[],branches=[];
  if(typeof command!=='string' || typeof cwd!=='string' || !path.isAbsolute(cwd))return {dirs,branches};
  let here=cwd;
  const resolve=(arg,base=here)=>{
    if(typeof arg!=='string' || !arg)return null;
    let text=arg;
    if(home) text=text.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/,home);
    // Checked before resolving: on Windows /dev/null resolves to a folder on the current drive.
    if(/[$`*?[\]{}]/.test(text) || text==='-' || text.startsWith('/dev/'))return null;
    return path.resolve(base,text);
  };
  const fileDir=arg=>{const full=resolve(arg);if(full)dirs.push(path.dirname(full));};
  for(const line of commandLines(command)) {
    const all=words(line);
    let segment=[];
    const run=()=>{
      const tokens=segment;segment=[];
      // Redirections write a file wherever they sit in the segment.
      const plain=[];
      for(let i=0;i<tokens.length;i++) {
        if(tokens[i]==='>' || tokens[i]==='>>') {fileDir(tokens[i+1]);i++;continue;}
        plain.push(tokens[i]);
      }
      let k=0;
      while(k<plain.length && (PREFIX.has(plain[k]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(plain[k])))k++;
      const [name,...args]=plain.slice(k);
      if(!name)return;
      const operands=args.filter(arg=>!arg.startsWith('-'));
      if(name==='cd' || name==='pushd') {const to=resolve(operands[0] ?? home);if(to)here=to;return;}
      if(name==='tee')return operands.forEach(fileDir);
      if(name==='touch' || name==='rm')return operands.forEach(fileDir);
      if(name==='mkdir')return operands.forEach(arg=>{const full=resolve(arg);if(full)dirs.push(full);});
      if(['cp','mv','install','ln','rsync'].includes(name) && operands.length>=2) {
        const full=resolve(operands.at(-1));
        if(full)dirs.push(fs.existsSync(full) && fs.statSync(full,{throwIfNoEntry:false})?.isDirectory()?full:path.dirname(full));
        return;
      }
      if((name==='sed' || name==='perl') && args.some(arg=>/^-[a-zA-Z]*i/.test(arg)) && operands.length)return fileDir(operands.at(-1));
      if(name!=='git')return;
      let at=here,j=0;
      while(j<args.length && args[j].startsWith('-')) {
        if(args[j]==='-C') {at=resolve(args[j+1],at) ?? at;j+=2;continue;}
        if(args[j]==='-c' || args[j]==='--git-dir' || args[j]==='--work-tree') {j+=2;continue;}
        j++;
      }
      const sub=args[j],rest=args.slice(j+1);
      if(GIT_WRITES.has(sub))dirs.push(at);
      const flagged=flags=>{const index=rest.findIndex(arg=>flags.includes(arg));return index>=0?rest[index+1]:null;};
      let branch=null;
      if(sub==='checkout')branch=flagged(['-b','-B']);
      else if(sub==='switch')branch=flagged(['-c','-C','--create']);
      else if(sub==='branch' && rest.length && !rest[0].startsWith('-'))branch=rest[0];
      else if(sub==='worktree' && rest[0]==='add')branch=flagged(['-b','-B']);
      // Making a branch is a write in that repository too.
      if(branch && /^[\w./-]{1,200}$/.test(branch) && !branch.startsWith('-')) {branches.push({dir:at,name:branch});if(!GIT_WRITES.has(sub))dirs.push(at);}
    };
    for(const token of all) {
      if(OPERATORS.has(token) || token==='&&' || token==='||') {run();continue;}
      segment.push(token);
    }
    run();
  }
  return {dirs:[...new Set(dirs)],branches};
}

// File paths an apply_patch body adds, updates, deletes or moves to.
export function patchFiles(text) {
  const body=String(text ?? '').includes('\n')?String(text):String(text ?? '').replace(/\\n/g,'\n');
  return [...body.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map(match=>(match[1] ?? match[2]).trim());
}

// ---- Folders to repositories. ----
// The repository a folder belongs to: the main checkout for a worktree (through the worktree's
// commondir), else the folder that holds .git. Never the home folder or above, and never a folder
// macOS guards with a privacy prompt. Folders that no longer exist walk up to one that does.
export function repositoryResolver(home,platform=process.platform) {
  const memo=new Map();
  // Git writes a worktree's pointer as the real path, so every repository is keyed by its real path
  // (macOS /var is /private/var, Windows short names are spelled out) and a worktree and its main
  // checkout share one key.
  const canonical=dir=>{try {return fs.realpathSync.native(dir);} catch {return dir;}};
  const main=root=>{
    const dotGit=path.join(root,'.git');
    let info;
    try {info=fs.lstatSync(dotGit);} catch {return null;}
    if(info.isDirectory())return root;
    if(!info.isFile())return null;
    // Only file reads here. A pointer is followed only to a real folder (not a link), and nothing
    // found there is run.
    const folder=target=>{try {const found=fs.lstatSync(target);return found.isDirectory() && !found.isSymbolicLink();} catch {return false;}};
    try {
      const gitdir=/^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit,'utf8').slice(0,4096))?.[1]?.trim();
      if(!gitdir)return root;
      const own=path.resolve(root,gitdir);
      if(!folder(own))return root;
      let common=own;
      try {
        const pointed=path.resolve(own,fs.readFileSync(path.join(own,'commondir'),'utf8').slice(0,4096).trim());
        if(folder(pointed))common=pointed;
      } catch {}
      const main=path.dirname(common);
      return path.basename(common)==='.git' && folder(main)?main:root;
    } catch {return root;}
  };
  return dir=>{
    if(typeof dir!=='string' || !path.isAbsolute(dir))return null;
    if(memo.has(dir))return memo.get(dir);
    const root=repositoryRoot(dir,home,platform);
    const repo=root?main(root):null;
    const found=repo?canonical(repo):null;
    memo.set(dir,found);
    return found;
  };
}

// Writes kept per repository as whole seconds, in order, once per second.
export function addWrite(state,repo,at) {
  if(!repo || !Number.isFinite(at))return;
  const second=Math.floor(at/1000);
  const list=state.writes[repo] ??= [];
  if(list.at(-1)!==second)list.push(second);
}
