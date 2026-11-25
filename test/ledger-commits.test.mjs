import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,chmod,mkdir} from 'node:fs/promises';
import {existsSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {git,makeRepo,commitFile} from './ledger-fixtures.mjs';
import {joinCommits,gitRunner,JOIN_WINDOW_MS,MAX_SQUASH_ASKS,safeRef} from '../scripts/ledger-commits.mjs';
import {repositoryResolver} from '../scripts/sources/activity.mjs';

const T=Date.parse('2026-11-10T15:00:00Z');
const MIN=60000;
const byJson=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));

test('a commit goes to the session that last wrote in its repository within the window, and the latest write wins',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'garden');
    await makeRepo(repo,T-3*3600000);
    const first=await commitFile(repo,'a.txt',T+10*MIN,'Rows');
    const second=await commitFile(repo,'b.txt',T+40*MIN,'Paths');
    const lonely=await commitFile(repo,'c.txt',T+120*MIN,'Fence');
    const sessions=[
      {key:'early',writes:[{repo,at:T}],branches:[]},
      {key:'late',writes:[{repo,at:T+5*MIN},{repo,at:T+30*MIN}],branches:[]},
    ];
    const {shipped,stats}=await joinCommits(sessions,{since:T-3600000,until:T+180*MIN});
    assert.deepEqual(shipped.get('late').commits.map(commit=>commit.sha).sort(byJson),[first,second].sort(byJson));
    assert.equal(shipped.get('early'),undefined,'the later write in the window wins the tie');
    assert.ok(!shipped.get('late').commits.some(commit=>commit.sha===lonely),'a commit long after any write is nobody\'s');
    assert.equal(stats.commits,3);
    assert.equal(stats.attributed,2);
    assert.equal(JOIN_WINDOW_MS,20*MIN);
  });
});

test('onMain follows the default branch, and a merged branch the session made counts as a merge',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'orchard');
    await makeRepo(repo,T-3*3600000);
    git(repo,['checkout','-q','-b','feature/prune']);
    const onBranch=await commitFile(repo,'prune.txt',T+5*MIN,'Prune');
    git(repo,['checkout','-q','-b','feature/idle','main']);
    const unmerged=await commitFile(repo,'idle.txt',T+6*MIN,'Idle');
    git(repo,['checkout','-q','main']);
    git(repo,['merge','-q','--no-ff','-m','Merge prune','feature/prune'],T+8*MIN);
    const sessions=[{key:'s',writes:[{repo,at:T+4*MIN},{repo,at:T+7*MIN}],
      branches:[{repo,name:'feature/prune',at:T+MIN},{repo,name:'feature/idle',at:T+MIN}]}];
    const {shipped}=await joinCommits(sessions,{since:T-3600000,until:T+60*MIN});
    const commits=shipped.get('s').commits;
    assert.equal(commits.find(commit=>commit.sha===onBranch).onMain,true);
    assert.equal(commits.find(commit=>commit.sha===unmerged).onMain,false);
    assert.equal(commits.filter(commit=>commit.merge).length,1);
    assert.deepEqual(shipped.get('s').branches.map(branch=>branch.name),['feature/prune']);
  });
});

test('a repository that is gone or past the budget is unread, so its sessions ship Unknown, not zero',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'pond');
    await makeRepo(repo,T);
    const gone=path.join(folder,'gone');
    const {unread}=await joinCommits([{key:'s',writes:[{repo,at:T},{repo:gone,at:T}],branches:[]}],{since:T-3600000,until:T+MIN,maxRepos:5});
    assert.deepEqual([...unread],[gone]);
    const capped=await joinCommits([{key:'s',writes:[{repo,at:T},{repo,at:T+1},{repo:path.join(folder,'x'),at:T}],branches:[]}],{since:T-3600000,until:T+MIN,maxRepos:1});
    assert.ok(capped.unread.has(path.join(folder,'x')));
  });
});

test('a worktree resolves to its main repository, and a pointer to a missing folder is not followed',async()=>{
  await withFolder(async home=>{
    const repo=path.join(home,'code','meadow');
    await makeRepo(repo,T);
    const tree=path.join(home,'trees','meadow-feature');
    git(repo,['worktree','add','-q','-b','feature/x',tree]);
    const resolve=repositoryResolver(home,'linux');
    // Repositories are keyed by their real path, as git writes it in the worktree's pointer.
    const real=realpathSync.native(repo);
    assert.equal(resolve(path.join(tree,'src')),real);
    assert.equal(resolve(path.join(repo,'docs','deep')),real);
    assert.equal(resolve('/'),null,'above home is never a repository');
    const fake=path.join(home,'code','fake');
    await mkdir(fake,{recursive:true});
    await writeFile(path.join(fake,'.git'),'gitdir: ../does-not-exist/.git/worktrees/x\n');
    assert.equal(resolve(fake),realpathSync.native(fake));
  });
});

test('a hostile repository config cannot make the join run a program',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'trap');
    await makeRepo(repo,T);
    const marker=path.join(folder,'ran.txt');
    const script=path.join(folder,'evil.sh');
    await writeFile(script,`#!/bin/sh\necho ran >> "${marker}"\ncat >/dev/null\nexit 1\n`);
    await chmod(script,0o755);
    for(const [key,value] of [['log.showSignature','true'],['gpg.program',script],['core.fsmonitor',script],['core.pager',script],['diff.external',script]])
      git(repo,['config',key,value]);
    // A commit with a signature, so showing signatures would call gpg.program.
    const tree=git(repo,['rev-parse','HEAD^{tree}']),parent=git(repo,['rev-parse','HEAD']);
    const stamp=`${Math.floor((T+MIN)/1000)} +0000`;
    const object=`tree ${tree}\nparent ${parent}\nauthor Test <test@example.invalid> ${stamp}\ncommitter Test <test@example.invalid> ${stamp}\n`+
      'gpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEEfictional\n -----END PGP SIGNATURE-----\n\nSigned change\n';
    const signed=execFileSync('git',['-C',repo,'hash-object','-t','commit','-w','--stdin'],{input:object,encoding:'utf8'}).trim();
    git(repo,['update-ref','refs/heads/main',signed]);
    // Control: plain git with the repository's config does run the program.
    try {execFileSync('git',['-C',repo,'log','-1','--format=%H'],{stdio:'ignore'});} catch {}
    assert.ok(existsSync(marker),'the trap works without the hardening');
    rmSync(marker);
    const {shipped,stats}=await joinCommits([{key:'s',writes:[{repo,at:T+MIN-1000}],branches:[{repo,name:'main',at:T}]}],{since:T-3600000,until:T+10*MIN});
    assert.equal(existsSync(marker),false,'no program from the repository ran');
    assert.equal(stats.unreadable,0);
    assert.ok(shipped.get('s').commits.some(commit=>commit.sha===signed));
  });
});

test('an origin/HEAD that names an option is never passed to git, and the join falls back to main',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'quarry');
    await makeRepo(repo,T-3600000);
    const change=await commitFile(repo,'a.txt',T+MIN,'Stone');
    const marker=path.join(folder,'marker.txt');
    await writeFile(marker,'keep me');
    await mkdir(path.join(repo,'.git','refs','remotes','origin'),{recursive:true});
    await writeFile(path.join(repo,'.git','refs','remotes','origin','HEAD'),`ref: --output=${marker}\n`);
    const {shipped}=await joinCommits([{key:'s',writes:[{repo,at:T}],branches:[]}],{since:T-3600000,until:T+10*MIN});
    assert.equal(readFileSync(marker,'utf8'),'keep me','the marker file is untouched');
    assert.equal(shipped.get('s').commits.find(commit=>commit.sha===change).onMain,true);
  });
});

test('safeRef accepts plain branch refs and refuses options and odd names',()=>{
  for(const name of ['refs/remotes/origin/main','refs/heads/feature/x-1','refs/heads/v1.2'])assert.equal(safeRef(name),true,name);
  for(const name of ['--output=/tmp/x','-x','refs/heads/-x','refs/heads/a..b','refs/tags/v1','main','refs/heads/a b','refs/heads/a\nb',null,'refs/heads/x.lock'])
    assert.equal(safeRef(name),false,String(name));
});

test('the join stops at its deadline: repositories not reached ship Unknown and no git question runs late',async()=>{
  const repos=Array.from({length:6},(_,index)=>`/fictional/code/repo-${index}`);
  // A fake clock: each git question takes 60 ms, and the join has 100 ms.
  let now=0;
  const asked=[];
  const slow=async(repo,args,options={})=>{
    asked.push({repo,at:now,timeout:options.timeout});
    now+=60;
    return args[0]==='for-each-ref'?'':args[0]==='symbolic-ref'?'':null;
  };
  const deadline=100;
  const sessions=[{key:'s',writes:repos.map(repo=>({repo,at:T})),branches:[]}];
  const {unread,stats}=await joinCommits(sessions,{since:T-3600000,until:T+MIN,git:slow,exists:()=>true,deadline,clock:()=>now});
  const byName=(a,b)=>a.localeCompare(b);
  assert.deepEqual([...unread].sort(byName),[...repos].sort(byName),'every repository not fully read is unread');
  assert.equal(stats.unreadable,6);
  assert.ok(asked.length<repos.length*3,'repositories past the deadline are never asked');
  assert.ok(asked.every(question=>question.at<deadline),'no question starts after the deadline');
  assert.ok(asked.every(question=>question.timeout<=deadline-question.at),'each question\'s time limit ends at the deadline');
});

test('a git question that fails part way makes the repository Unknown, not "not on main"',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'brook');
    await makeRepo(repo,T-3600000);
    await commitFile(repo,'a.txt',T+MIN,'Stream');
    const real=gitRunner();
    const flaky=(dir,args,options)=>args[0]==='rev-list'?Promise.resolve(null):real(dir,args,options);
    const {unread,shipped}=await joinCommits([{key:'s',writes:[{repo,at:T}],branches:[]}],{since:T-3600000,until:T+10*MIN,git:flaky});
    assert.ok(unread.has(repo));
    assert.equal(shipped.get('s'),undefined);
  });
});

test('a tie between sessions goes to the same one whatever order they are listed in',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'grove');
    await makeRepo(repo,T-3600000);
    const change=await commitFile(repo,'a.txt',T+5*MIN,'Same time');
    const a={key:'claude:aaa',writes:[{repo,at:T}],branches:[]},b={key:'codex:bbb',writes:[{repo,at:T}],branches:[]};
    for(const order of [[a,b],[b,a]]) {
      const {shipped}=await joinCommits(order,{since:T-3600000,until:T+60*MIN});
      assert.deepEqual(shipped.get('claude:aaa').commits.map(commit=>commit.sha),[change]);
      assert.equal(shipped.get('codex:bbb'),undefined);
    }
  });
});

test('the join window: a commit 20 minutes after the last write counts and one a second later does not, and a write up to 2 minutes after a commit counts',async()=>{
  await withFolder(async folder=>{
    const edge=path.join(folder,'edge'),late=path.join(folder,'late'),after=path.join(folder,'after'),tooLate=path.join(folder,'too-late');
    for(const repo of [edge,late,after,tooLate])await makeRepo(repo,T-3600000);
    const atEdge=await commitFile(edge,'a.txt',T+JOIN_WINDOW_MS,'At the edge');
    await commitFile(late,'a.txt',T+JOIN_WINDOW_MS+1000,'Past the edge');
    const before=await commitFile(after,'a.txt',T,'Logged later');
    await commitFile(tooLate,'a.txt',T,'Logged too late');
    const sessions=[{key:'s',writes:[{repo:edge,at:T},{repo:late,at:T},{repo:after,at:T+2*MIN},{repo:tooLate,at:T+2*MIN+1000}],branches:[]}];
    const {shipped}=await joinCommits(sessions,{since:T-3600000,until:T+60*MIN});
    assert.deepEqual(shipped.get('s').commits.map(commit=>commit.sha).sort(),[atEdge,before].sort());
  });
});

test('a merge commit names the branch tip it brought in, and the merged branch carries its tip',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'hedge');
    await makeRepo(repo,T-3*3600000);
    git(repo,['checkout','-q','-b','feature/trim']);
    const tip=await commitFile(repo,'trim.txt',T+5*MIN,'Trim');
    git(repo,['checkout','-q','main']);
    git(repo,['merge','-q','--no-ff','-m','Merge trim','feature/trim'],T+8*MIN);
    const {shipped}=await joinCommits([{key:'s',writes:[{repo,at:T+4*MIN},{repo,at:T+7*MIN}],branches:[{repo,name:'feature/trim',at:T+MIN}]}],{since:T-3600000,until:T+60*MIN});
    const merge=shipped.get('s').commits.find(commit=>commit.merge);
    assert.equal(merge.mergedTip,tip);
    assert.equal(shipped.get('s').branches[0].tip,tip);
  });
});

// A branch with two commits, landed on main as one squash commit after main moved on.
async function squashRepo(repo) {
  await makeRepo(repo,T-3*3600000);
  git(repo,['checkout','-q','-b','feature/graft']);
  await commitFile(repo,'graft.txt',T+5*MIN,'Graft');
  const tip=await commitFile(repo,'scion.txt',T+6*MIN,'Scion');
  git(repo,['checkout','-q','-b','feature/other','main']);
  await commitFile(repo,'other.txt',T+6*MIN,'Other');
  git(repo,['checkout','-q','main']);
  await commitFile(repo,'moved.txt',T+7*MIN,'Main moved on');
  git(repo,['merge','-q','--squash','feature/graft']);
  git(repo,['commit','-qm','Graft and scion'],T+8*MIN);
  return tip;
}
const squashSessions=repo=>[{key:'s',writes:[{repo,at:T+4*MIN}],branches:[{repo,name:'feature/graft',at:T+MIN},{repo,name:'feature/other',at:T+MIN}]}];

test('a branch that landed on the default branch as one squash commit counts as merged, and one beside it does not',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'nursery');
    const tip=await squashRepo(repo);
    assert.equal(git(repo,['branch','--merged','main','--format=%(refname:short)']),'main','git itself calls neither branch merged');
    const before=git(repo,['count-objects','-v']),refs=git(repo,['for-each-ref']);
    const cache=new Map();
    const {shipped,unread}=await joinCommits(squashSessions(repo),{since:T-3600000,until:T+60*MIN,cache});
    assert.deepEqual(shipped.get('s').branches,[{repo,name:'feature/graft',at:T+MIN,tip}]);
    assert.deepEqual(shipped.get('s').unsure,[],'the unmerged branch is read as unmerged, not Unknown');
    assert.equal(unread.size,0);
    assert.equal(shipped.get('s').commits.filter(commit=>commit.merge).length,0,'a squash is not a merge commit');
    assert.equal(git(repo,['count-objects','-v']),before,'nothing was written into the repository');
    assert.equal(git(repo,['for-each-ref']),refs);
    // The answers are kept with the repository's facts, so a second run asks nothing more about the branches.
    const real=gitRunner(),asked=[];
    const counting=(dir,args,options)=>{asked.push(args[0]);return real(dir,args,options);};
    const again=await joinCommits(squashSessions(repo),{since:T-3600000,until:T+60*MIN,cache,git:counting});
    assert.deepEqual(asked,['for-each-ref']);
    assert.deepEqual(again.shipped.get('s').branches.map(branch=>branch.name),['feature/graft']);
  });
});

test('a squash of other work does not make a branch merged, and a branch made after its tip is not counted',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'arbor');
    await makeRepo(repo,T-3*3600000);
    git(repo,['checkout','-q','-b','feature/vine']);
    await commitFile(repo,'vine.txt',T+5*MIN,'Vine');
    git(repo,['checkout','-q','-b','feature/half','main']);
    await commitFile(repo,'half-a.txt',T+5*MIN,'Half a');
    await commitFile(repo,'half-b.txt',T+6*MIN,'Half b');
    git(repo,['checkout','-q','main']);
    // Main gets a change to the same file as feature/vine with other text, and only part of feature/half.
    await writeFile(path.join(repo,'vine.txt'),'something else\n');
    await writeFile(path.join(repo,'half-a.txt'),`Half a ${T+5*MIN}\n`);
    git(repo,['add','.']);
    git(repo,['commit','-qm','Unrelated'],T+8*MIN);
    const sessions=[{key:'s',writes:[{repo,at:T+4*MIN}],branches:[{repo,name:'feature/vine',at:T+MIN},{repo,name:'feature/half',at:T+MIN}]}];
    const {shipped}=await joinCommits(sessions,{since:T-3600000,until:T+60*MIN});
    assert.deepEqual(shipped.get('s').branches,[]);
    assert.deepEqual(shipped.get('s').unsure,[]);
    const squashed=path.join(folder,'bower');
    await squashRepo(squashed);
    // The session made its branch long after the squashed branch's last commit: an older branch of the same name.
    const later=await joinCommits([{key:'s',writes:[{repo:squashed,at:T+4*MIN}],branches:[{repo:squashed,name:'feature/graft',at:T+30*MIN}]}],{since:T-3600000,until:T+60*MIN});
    assert.equal(later.shipped.get('s').branches.length,0);
  });
});

test('a squash question git cannot answer leaves the branch Unknown, never unmerged',async()=>{
  await withFolder(async folder=>{
    const repo=path.join(folder,'thicket');
    const tip=await squashRepo(repo);
    const real=gitRunner();
    for(const failing of ['patch-id','diff','log -p']) {
      const cache=new Map();
      const flaky=(dir,args,options)=>(args[0]===failing || (failing==='log -p' && args[0]==='log' && args.includes('-p')))?Promise.resolve(null):real(dir,args,options);
      const {shipped,unread}=await joinCommits(squashSessions(repo),{since:T-3600000,until:T+60*MIN,cache,git:flaky});
      assert.deepEqual(shipped.get('s').branches,[],failing);
      assert.deepEqual(shipped.get('s').unsure.map(branch=>branch.name).sort(),['feature/graft','feature/other'],failing);
      assert.equal(unread.size,0,'the repository itself was read, so its commits still count');
      assert.ok(shipped.get('s').commits.length>0);
      // The failure is not remembered: the next run asks again and gets the answer.
      const healed=await joinCommits(squashSessions(repo),{since:T-3600000,until:T+60*MIN,cache});
      assert.deepEqual(healed.shipped.get('s').branches,[{repo,name:'feature/graft',at:T+MIN,tip}],failing);
      assert.deepEqual(healed.shipped.get('s').unsure,[]);
    }
  });
});

test('squash questions are bounded for each repository in a run, and branches past the bound are Unknown',async()=>{
  const repo='/fictional/code/hedgerow';
  const names=Array.from({length:MAX_SQUASH_ASKS+5},(_,index)=>`feature/b${index}`);
  const asked=[];
  const fake=async(dir,args)=>{
    asked.push(args[0]);
    if(args[0]==='for-each-ref' && args.some(arg=>arg.startsWith('--merged')))return '';
    if(args[0]==='for-each-ref' && args.some(arg=>arg.includes('committerdate')))return names.map((name,index)=>`${name} ${Math.floor(T/1000)+index} ${'a'.repeat(40)}`).join('\n');
    if(args[0]==='for-each-ref')return 'refs';
    if(args[0]==='symbolic-ref')return 'refs/remotes/origin/main';
    if(args[0]==='log' && args.includes('-p'))return `commit ${'b'.repeat(40)}\ndiff --git a/x b/x\n`;
    if(args[0]==='diff')return 'diff --git a/y b/y\n';
    if(args[0]==='patch-id')return `${'c'.repeat(40)} ${'0'.repeat(40)}\n`;
    return '';
  };
  const sessions=[{key:'s',writes:[{repo,at:T}],branches:names.map(name=>({repo,name,at:T-MIN}))}];
  const {shipped}=await joinCommits(sessions,{since:T-3600000,until:T+MIN,git:fake,exists:()=>true});
  assert.equal(asked.filter(name=>name==='diff').length,MAX_SQUASH_ASKS);
  assert.equal(asked.filter(name=>name==='log').length,2,'the default branch is read once for all of them');
  // The fake gives every patch the same id, so each branch asked about reads as landed.
  assert.equal(shipped.get('s').branches.length,MAX_SQUASH_ASKS);
  assert.equal(shipped.get('s').unsure.length,5);
});
