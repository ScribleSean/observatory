import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const workflows=path.join(import.meta.dirname,'..','.github','workflows');

// Every action is pinned to a full commit SHA, with the version it stands for in a comment.
// A tag can be moved to other code. A commit SHA cannot.
function unpinnedActions(text) {
  const problems=[];
  text.split(/\r?\n/).forEach((line,index)=>{
    const match=line.match(/^\s*(?:-\s*)?uses:\s*(['"]?)([^\s'"#]+)\1\s*(#.*)?$/);
    if (!match) return;
    const [,,target,comment]=match;
    if (target.startsWith('./')) return;
    const pinned=target.startsWith('docker://')
      ? /@sha256:[0-9a-f]{64}$/.test(target)
      : /^[^@\s]+@[0-9a-f]{40}$/.test(target)&&/^#\s*v\d+\.\d+\.\d+\b/.test(comment??'');
    if (!pinned) problems.push(`line ${index+1}: ${line.trim()}`);
  });
  return problems;
}

test('every workflow pins its actions to a full commit SHA with a version comment',async()=>{
  const files=(await readdir(workflows)).filter(name=>/\.ya?ml$/.test(name));
  assert.ok(files.length>0);
  for (const name of files) {
    const text=await readFile(path.join(workflows,name),'utf8');
    assert.deepEqual(unpinnedActions(text),[],`${name} has actions that are not pinned`);
  }
});

test('the check refuses tags, branches, short SHAs and pins without a version comment',()=>{
  const sha='11d5960a326750d5838078e36cf38b85af677262';
  assert.deepEqual(unpinnedActions(`      - uses: actions/checkout@${sha} # v4.4.0`),[]);
  assert.deepEqual(unpinnedActions(`    uses: "owner/repo/sub@${sha}" # v1.2.3`),[]);
  assert.deepEqual(unpinnedActions('      - uses: ./.github/actions/local'),[]);
  assert.equal(unpinnedActions('      - uses: actions/checkout@v4').length,1);
  assert.equal(unpinnedActions('      - uses: actions/checkout@main # v4.4.0').length,1);
  assert.equal(unpinnedActions('      - uses: actions/checkout@11d5960 # v4.4.0').length,1);
  assert.equal(unpinnedActions(`      - uses: actions/checkout@${sha}`).length,1);
  assert.equal(unpinnedActions(`      - uses: actions/checkout@${sha} # v4`).length,1);
  assert.equal(unpinnedActions('      - uses: docker://alpine:3').length,1);
});
