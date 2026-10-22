import { test } from 'node:test'; // Synthetic fixtures only, no personal records.
import assert from 'node:assert/strict';
import {
  numeric,
  category,
  cleanActivity,
  cleanSettings,
} from './snapshot-clean.mjs';
test('tool metadata survives sanitization and legacy categories remain explicit',()=>{
  const row={date:'2026-09-06',category:'Other tools',count:2};
  const result=cleanSettings({profiles:[],tools:[row,{...row,tool:'MCP.Tool',namespace:'my_tools',arguments:'PRIVATE'},
    {...row,tool:'PRIVATE NAME',namespace:'PRIVATE NAMESPACE'},{...row,count:0.5}]},'Mac');
  assert.equal(result.tools.length,3);
  assert.equal(result.tools[0].tool,null);
  assert.equal(result.tools[1].tool,'MCP.Tool');
  assert.equal(result.tools[1].namespace,'my_tools');
  assert.equal(result.tools[2].tool,'Unknown tool');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('token history is allowlisted strictly and remains separate from recent profiles',()=>{
  const profile={date:'2026-09-01',model:'gpt-6-astra',effort:'high',speed:'standard',inputTokens:8,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:10,private:'PRIVATE'};
  const result=cleanSettings({profiles:[],tools:[],tokenProfiles:[profile]},'Mac');
  assert.deepEqual(result.tokenProfiles,[{...profile,private:undefined}].map(({private:_,...safe})=>safe));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  for(const change of [{date:'bad'},{model:'PRIVATE MODEL'},{inputTokens:1.5},{totalTokens:null}])
    assert.throws(()=>cleanSettings({profiles:[],tools:[],tokenProfiles:[{...profile,...change}]},'Mac'));
});
test('numeric metrics reject coercion, negative and nonfinite values', () => {
  for (const x of [-1, NaN, Infinity, '12', null])
    assert.equal(numeric(x), null);
  assert.equal(numeric(0), 0);
});
test('activity strips titles and names, preserving allowlisted categories only', () => {
  const x = cleanActivity(
    {
      categories: { Coding: 5, Terminal: 0, Browser: 3, Other: 0, Secret: 42 },
      title: 'private',
      start: '2026-09-06',
      end: '2026-09-07',
    },
    'Mac',
  );
  assert.deepEqual(Object.keys(x.categories), [
    'Coding',
    'Terminal',
    'Browser',
    'Other',
  ]);
  assert.ok(!JSON.stringify(x).includes('private'));
  assert.ok(!JSON.stringify(x).includes('Secret'));
});
test('invalid activity fails rather than silently showing zero', () => {
  assert.throws(() => cleanActivity({ categories: {} }, 'Mac'));
  assert.throws(() =>
    cleanActivity(
      { categories: { Coding: 700000, Terminal: 0, Browser: 0, Other: 0 } },
      'Mac',
    ),
  );
});
test('categories disclose no unknown app names', () => {
  assert.equal(category('secret-project-app'), 'Other');
  assert.equal(category('iTerm2'), 'Terminal');
  assert.equal(category('ChatGPT'), 'AI apps');
  assert.equal(category('Code.exe'), 'Editors');
});