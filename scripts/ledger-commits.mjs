// What each session shipped, estimated from git. Transcripts rarely hold the commit itself, so a commit
// counts for the session that last wrote in that repository within JOIN_WINDOW_MS before it (or up to
// AFTER_MS after it). Between sessions the latest write wins, and equal times go to the smaller
// session key, so the answer never depends on the order sessions are listed in. Only writes count: file edits, and shell commands that
// commit, merge, add, push or write into a folder. Reading a repository does not.
// Repositories are found from the written paths only. Git is asked a fixed number of questions per
// repository, each with a time limit, and the answers are cached by the repository's refs.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {promisify} from 'node:util';
import {execFile} from '../lib/cycle-processes.mjs';

const run=promisify(execFile);
export const JOIN_WINDOW_MS=20*60000;
// A write logged a moment after the commit it made (the tool call's time is when it was asked for).
const AFTER_MS=2*60000;
export const MAX_REPOS=60;
const GIT_TIMEOUT_MS=8000;
const AT_ONCE=4;

// The repositories come from paths an agent wrote, so they are untrusted: an agent may have cloned
// anything, and a repository's own config can name programs for git to run (fsmonitor, a signature
// checker, a pager, an external diff, hooks). Every call turns those off on the command line, which
// wins over the repository's config, and reads no system or user config.
export const GIT_SAFE_ARGS=Object.freeze(['-c','core.fsmonitor=false','-c','log.showSignature=false','-c','gpg.program=false',
  '-c',`core.hooksPath=${process.platform==='win32'?'NUL':'/dev/null'}`,'-c','diff.external=','-c','core.pager=cat']);
export function gitEnv(platform=process.platform,environment=process.env) {
  return {...Object.fromEntries(Object.entries(environment).filter(([key])=>!key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'};
}
export function gitRunner(exec=run) {
  return (repo,args,{timeout=GIT_TIMEOUT_MS}={})=>exec('git',[...GIT_SAFE_ARGS,'-C',repo,...args],{timeout,maxBuffer:32_000_000,env:gitEnv()})
    .then(({stdout})=>String(stdout),()=>null);
}

// A ref name read back from a repository is untrusted too: origin/HEAD can point at any text, such
// as an option. Only plain branch refs are passed back to git, and always after --end-of-options.
const SAFE_REF=/^refs\/(?:heads|remotes)\/(?!-)[A-Za-z0-9._/-]+$/;
export function safeRef(name) {
  return typeof name==='string' && SAFE_REF.test(name) && !name.includes('..') && !name.includes('//') && !name.endsWith('/') && !name.endsWith('.lock') && !/\/[-.]/.test(name);
}

// The default branch: origin/HEAD, else main, else master.
export async function defaultBranch(git,repo) {
  const remote=(await git(repo,['symbolic-ref','-q','refs/remotes/origin/HEAD']))?.trim();
  if(remote && safeRef(remote))return remote;
  for(const name of ['refs/heads/main','refs/heads/master'])
    if((await git(repo,['rev-parse','--verify','-q','--end-of-options',name]))?.trim())return name;
  return null;
}

// Commits since `since` on any ref, which of them the default branch reaches, and local branches
// with their tips, whether merged into the default branch and their tip's time.
async function repoFacts(git,repo,since,cache) {
  const refs=await git(repo,['for-each-ref','--format=%(objectname) %(refname)']);
  if(refs===null)return null;
  const key=`git2:${repo}`,digest=createHash('sha1').update(refs).digest('hex');
  const saved=cache?.get(key);
  if(saved && saved.digest===digest && saved.since<=since)
    return {...saved,commits:saved.commits.filter(commit=>commit.at>=since)};
  const base=await defaultBranch(git,repo);
  const after=`--since=@${Math.floor(since/1000)}`;
  const log=await git(repo,['log','--no-show-signature','--all',after,'--format=%H %ct %P']);
  if(log===null)return null;
  // A question that fails makes the whole repository unreadable, so nothing reads as false that is Unknown.
  const reached=base?await git(repo,['rev-list',after,'--end-of-options',base]):'';
  if(reached===null)return null;
  const onMain=new Set(reached.split('\n').filter(Boolean));
  const commits=log.split('\n').filter(Boolean).map(line=>{
    const [sha,time,...parents]=line.trim().split(' ');
    const merge=parents.filter(Boolean).length>1;
    // A merge's second parent is the tip of the branch it brought in.
    return {sha,at:Number(time)*1000,merge,...(merge?{mergedTip:parents.filter(Boolean)[1]}:{}),onMain:onMain.has(sha)};
  }).filter(commit=>Number.isFinite(commit.at));
  const branches={};
  if(base) {
    const mergedText=await git(repo,['for-each-ref',`--merged=${base}`,'--format=%(refname:short)','refs/heads']);
    const tips=await git(repo,['for-each-ref','--format=%(refname:short) %(committerdate:unix) %(objectname)','refs/heads']);
    if(mergedText===null || tips===null)return null;
    const merged=new Set(mergedText.split('\n').filter(Boolean));
    for(const line of tips.split('\n')) {
      const [name,time,tip]=line.trim().split(' ');
      if(name)branches[name]={at:Number(time)*1000,tip:tip ?? null,merged:merged.has(name) && `refs/heads/${name}`!==base};
    }
  }
  const facts={digest,since,commits,branches,hasDefault:base!==null};
  cache?.set(key,facts);
  return facts;
}

// Runs work a few at a time. No item starts after the deadline. Returns the items never started.
async function eachLimited(items,limit,deadline,work,clock=Date.now) {
  let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length && clock()<deadline)await work(items[next++]);}));
  return items.slice(next);
}

// sessions: [{key, writes: [{repo, at}], branches: [{repo, name, at}]}], repo being an absolute path.
// Returns per session key the commits it gets ({repo, sha, at, onMain, merge}) and the branches it
// made that are now merged ({repo, name, at}), plus counts for checking the join. `deadline` (epoch ms)
// bounds the whole join: no git question runs past it, and repositories not reached by then are
// unread, so their sessions ship Unknown. What was learned is in `cache` for the next run.
export async function joinCommits(sessions,{since,until=Date.now(),git=gitRunner(),cache=null,maxRepos=MAX_REPOS,exists=fs.existsSync,deadline=Infinity,clock=Date.now}={}) {
  const ask=(repo,args)=>{
    const left=deadline-clock();
    return left<=0?Promise.resolve(null):git(repo,args,{timeout:Math.max(1,Math.min(GIT_TIMEOUT_MS,left))});
  };
  const byRepo=new Map();
  for(const session of sessions)for(const write of session.writes) {
    if(write.at<since-JOIN_WINDOW_MS || write.at>until+AFTER_MS)continue;
    let rows=byRepo.get(write.repo);
    if(!rows) {rows=new Map();byRepo.set(write.repo,rows);}
    if(!rows.has(session.key))rows.set(session.key,[]);
    rows.get(session.key).push(write.at);
  }
  // The busiest repositories first, when there are more than the git budget allows.
  const ranked=[...byRepo].sort((a,b)=>[...b[1].values()].flat().length-[...a[1].values()].flat().length);
  const repos=ranked.slice(0,maxRepos).filter(([repo])=>exists(repo));
  // Repositories that could not be asked: past the budget, gone, or git failed. Their sessions' shipped counts are Unknown.
  const unread=new Set(ranked.map(([repo])=>repo).filter(repo=>!repos.some(([kept])=>kept===repo)));
  const shipped=new Map(),stats={repos:repos.length,commits:0,attributed:0,unreadable:unread.size};
  const give=(key,entry,field)=>{
    if(!shipped.has(key))shipped.set(key,{commits:[],branches:[]});
    shipped.get(key)[field].push(entry);
  };
  const skipped=await eachLimited(repos,AT_ONCE,deadline,async ([repo,writers])=>{
    const facts=await repoFacts(ask,repo,since,cache);
    if(!facts) {stats.unreadable++;unread.add(repo);return;}
    const lists=[...writers].map(([key,times])=>[key,times.sort((a,b)=>a-b)]);
    for(const commit of facts.commits) {
      if(commit.at>until)continue;
      stats.commits++;
      let best=null;
      for(const [key,times] of lists) {
        // The last write at or before the commit (allowing AFTER_MS), within the join window.
        let low=0,high=times.length;
        while(low<high) {const mid=(low+high)>>1;if(times[mid]<=commit.at+AFTER_MS)low=mid+1;else high=mid;}
        const last=low?times[low-1]:null;
        if(last===null || commit.at-last>JOIN_WINDOW_MS)continue;
        if(!best || last>best.last || (last===best.last && key<best.key))best={key,last};
      }
      if(!best)continue;
      stats.attributed++;
      give(best.key,{repo,sha:commit.sha,at:commit.at,onMain:facts.hasDefault?commit.onMain:null,merge:commit.merge,...(commit.mergedTip?{mergedTip:commit.mergedTip}:{})},'commits');
    }
    for(const session of sessions)for(const branch of session.branches) {
      if(branch.repo!==repo)continue;
      const now=facts.branches[branch.name];
      // A branch counts as merged when its tip has work from after the session made it.
      if(now?.merged && now.at>=branch.at-AFTER_MS)give(session.key,{repo,name:branch.name,at:branch.at,tip:now.tip ?? null},'branches');
    }
  },clock);
  for(const [repo] of skipped) {unread.add(repo);stats.unreadable++;}
  return {shipped,unread,stats};
}
