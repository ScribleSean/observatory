import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoData,writeDemo} from './demo.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectTokenDays} from './token-periods.mjs';
import {cleanDictation,summarizeDictation} from './dictation-aggregates.mjs';
import {cleanWispr} from './wispr.mjs';
import {quotaPace} from './quota-pace.mjs';
test('demo creation refuses existing snapshots without changing their bytes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'observatory-demo-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.equal((await writeDemo(dir)).code,0);
  assert.equal(JSON.parse(await readFile(path.join(dir,'usage.json'),'utf8')).demo,true);
  const marker='fictional existing snapshot, do not replace';
  await writeFile(path.join(dir,'usage.json'),marker);
  const result=await writeDemo(dir);
  assert.equal(result.code,1);
  assert.match(result.message,/already exists.*Not overwritten/);
  assert.equal(result.message.split('\n').length,1);
  assert.equal(await readFile(path.join(dir,'usage.json'),'utf8'),marker);
});
test('demo is deterministic and covers every delivered view without live reads',()=>{
  const d=demoData();
  assert.deepEqual(d,demoData());
  assert.equal(d.demo,true);
  assert.equal(d.quota.history.length,25);
  assert.ok(quotaPace(d.quota,Date.parse(d.collectedAt)).every(p=>['projected','resets-first'].includes(p.status)));
  assert.equal(d.peerQuota.host,'Windows');
  assert.equal(d.peerQuota.windows[0].remainingPercent,43);
  assert.notEqual(d.peerQuota.windows[0].remainingPercent,d.quota.windows[0].remainingPercent);
  const peerOnly={...d,quota:undefined};
  assert.equal(peerOnly.quota,undefined);
  assert.equal(peerOnly.peerQuota.history.length,2);
  assert.equal(d.dictation.length,2);
  for (const source of d.dictation) {
    assert.equal(cleanDictation(source,source.host).status,'ok');
    assert.equal(source.source,'Wispr Flow');
    assert.equal(cleanWispr(source,source.host).status,'ok');
    assert.ok(summarizeDictation(source).transcriptions>0);
  }
  assert.equal(d.combinedTokens.status,'ok');
  assert.equal(d.activityHistory[0].days.length,14);
  assert.equal(d.activity[0].days.length,7);
  assert.ok(d.agents.some(r=>r.status==='failed'&&r.total===null));
  assert.ok(d.settings.every(r=>r.tools.every(t=>t.tool&&t.namespace)));
  for(const row of d.tokens) {
    assert.equal(selectTokenDays(row.days,'all','2026-09-08').totalTokens,row.days.reduce((n,r)=>n+r.totalTokens,0));
    assert.ok(row.days.every(r=>r.totalTokens===r.models.reduce((n,m)=>n+m.totalTokens,0)));
  }
  const history=d.activityHistory.find(r=>r.host==='Mac').days;
  assert.equal(history.find(r=>r.date==='2026-09-02').trackedSeconds,0);
  assert.ok(history.find(r=>r.date==='2026-09-03').trackedSeconds>0);
  assert.equal(history.find(r=>r.date==='2026-09-03').seconds,0);
  assert.ok(!JSON.stringify(d).includes('/Users/'));
  assert.ok(!JSON.stringify(d).includes('/home/'));
});
