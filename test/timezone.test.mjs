import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {resolveTimeZone,validTimeZone} from '../lib/timezone.mjs';
import {withFolder} from './helpers.mjs';

test('the zone follows the override, then this computer, then UTC',()=>{
  assert.equal(resolveTimeZone({OBSERVATORY_TIMEZONE:'Asia/Tokyo'}),'Asia/Tokyo');
  assert.equal(resolveTimeZone({OBSERVATORY_TIMEZONE:'Not/AZone'}),Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(validTimeZone(''),false);
});

test('a reader counts days in the chosen zone',()=>withFolder(async folder=>{
  const file=path.join(folder,'projects','p','log.jsonl');
  await mkdir(path.dirname(file),{recursive:true});
  // 20:30 UTC on Sept 25 is Sept 26 in Tokyo and Sept 25 in New York.
  await writeFile(file,JSON.stringify({type:'assistant',timestamp:'2026-09-25T20:30:00Z',requestId:'r',message:{role:'assistant',id:'m',model:'claude-opus-5-5',
    usage:{input_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:1}}})+'\n');
  const day=zone=>JSON.parse(execFileSync(process.execPath,['scripts/read-claude-usage.mjs',folder],
    {env:{...process.env,OBSERVATORY_TIMEZONE:zone},encoding:'utf8'})).days[0].date;
  assert.equal(day('Asia/Tokyo'),'2026-09-26');
  assert.equal(day('America/New_York'),'2026-09-25');
}));
