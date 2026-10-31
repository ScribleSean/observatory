import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {READING_FRESH_MS,DEVICE_FRESH_MS} from '../lib/freshness.mjs';

// Mistakes that kept coming back, checked across the whole repository.
// A line that must break a rule says so on that line or the line above,
// with the marker the rule names and a reason.

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(path.join(ROOT,file),'utf8');
const sources=(folders,keep)=>folders.flatMap(folder=>readdirSync(path.join(ROOT,folder),{recursive:true})
  .map(file=>path.join(folder,String(file)).split(path.sep).join('/'))
  .filter(file=>/\.(mjs|ts|tsx)$/.test(file) && !file.includes('/fixtures/') && keep(file)));

function hits(files,pattern,marker) {
  const found=[];
  for (const file of files) {
    const lines=read(file).split('\n');
    lines.forEach((line,index)=>{
      if (pattern.test(line) && !line.includes(marker) && !lines[index-1]?.includes(marker))found.push(`${file}:${index+1}: ${line.trim()}`);
    });
  }
  return found;
}

function checkStringUsage(catalog,corpus) {
  const unused=[];
  for (const [group,entries] of Object.entries(catalog)) {
    // Aliasing, iterating or indexing a whole group can use any of its keys.
    if (new RegExp(`\\b(strings|STRINGS)\\.${group}\\b(?!\\.)`).test(corpus)) continue;
    for (const key of Object.keys(entries)) {
      if (!new RegExp(`\\b(strings|STRINGS)\\.${group}\\.${key}\\b`).test(corpus)) unused.push(`${group}.${key}`);
    }
  }
  assert.deepEqual(unused,[],`Unused keys in lib/strings.json:\n${unused.join('\n')}`);
}

const stringSources=execFileSync('git',['ls-files','-z'],{cwd:ROOT,encoding:'utf8'}).split('\0')
  .filter(file=>file && !file.startsWith('docs/') && !/(^|\/)strings\.(json|generated\.ts)$/.test(file)
    && !file.includes('fixtures/') && file!=='package-lock.json'
    && /\.(js|mjs|ts|tsx|mts|cs|swift|ps1|html|json|css)$/.test(file));
const stringCorpus=stringSources.map(read).join('\n');
const catalog=JSON.parse(read('lib/strings.json'));

test('every shared string has a qualified use or its whole group is used', () => {
  checkStringUsage(catalog,stringCorpus);
});

test('the shared string rule rejects a planted unused key', () => {
  const planted={...catalog,app:{...catalog.app,unusedForRepoRule:'Unused probe'}};
  assert.throws(()=>checkStringUsage(planted,stringCorpus),/Unused keys in lib\/strings\.json:\napp\.unusedForRepoRule/);
});

test('the shared string rule accepts qualified and whole-group uses, not bare key names', () => {
  const sample={lower:{used:''},upper:{used:''},aliased:{any:''},iterated:{any:''}};
  const corpus='strings.lower.used; STRINGS.upper.used; const words = strings.aliased; Object.values(STRINGS.iterated);';
  checkStringUsage(sample,corpus);
  assert.throws(()=>checkStringUsage({lower:{used:'',unused:''}},`${corpus} unused; strings.lower.unusedSuffix;`),
    /Unused keys in lib\/strings\.json:\nlower\.unused/);
});

test('freshness thresholds live only in lib/freshness.mjs', () => {
  const app=sources(['lib','app','scripts'],file=>!file.endsWith('.test.mjs') && file!=='lib/freshness.mjs');
  const literal=/\b(10|15)\s*\*\s*60(_?000\b|\s*\*\s*1_?000\b|\b)|\b(600|900)_?000\b/;
  assert.deepEqual(hits(app,literal,'freshness-exempt:'),[],
    'A 10 or 15 minute literal decides freshness on its own. Import READING_FRESH_MS, DEVICE_FRESH_MS, readingFresh or snapshotFresh from lib/freshness.mjs. '+
    'If the duration means something else, add "// freshness-exempt: <reason>" on the line or the line above.');
});

test('the native apps copy the freshness thresholds from lib/freshness.mjs', () => {
  const swift=read('glance/mac/Glance.swift'),cs=read('glance/windows/Glance.cs');
  const seconds=(name)=>{
    const match=swift.match(new RegExp(`static let ${name}: TimeInterval = ([\\d\\s*]+)\\n`));
    assert.ok(match,`glance/mac/Glance.swift must declare "static let ${name}: TimeInterval" next to its PanelState constants.`);
    return match[1].split('*').reduce((product,factor)=>product*Number(factor),1);
  };
  const minutes=(name)=>{
    const match=cs.match(new RegExp(`public const double ${name} = (\\d+);`));
    assert.ok(match,`glance/windows/Glance.cs must declare "public const double ${name}" in PanelState.`);
    return Number(match[1]);
  };
  assert.equal(seconds('readingFresh')*1000,READING_FRESH_MS,'Glance.swift readingFresh differs from READING_FRESH_MS in lib/freshness.mjs.');
  assert.equal(seconds('deviceFresh')*1000,DEVICE_FRESH_MS,'Glance.swift deviceFresh differs from DEVICE_FRESH_MS in lib/freshness.mjs.');
  assert.equal(minutes('ReadingFreshMinutes')*60000,READING_FRESH_MS,'Glance.cs ReadingFreshMinutes differs from READING_FRESH_MS in lib/freshness.mjs.');
  assert.equal(minutes('DeviceFreshMinutes')*60000,DEVICE_FRESH_MS,'Glance.cs DeviceFreshMinutes differs from DEVICE_FRESH_MS in lib/freshness.mjs.');
  const inline=[
    ...swift.split('\n').map((line,index)=>[`glance/mac/Glance.swift:${index+1}`,line])
      .filter(([,line])=>/timeIntervalSince\([^)]*\)\s*[<>]=?\s*(600|900|(10|15)\s*\*\s*60)\b/.test(line)),
    ...cs.split('\n').map((line,index)=>[`glance/windows/Glance.cs:${index+1}`,line])
      .filter(([,line])=>/Total(Minutes\s*[<>]=?\s*(10|15)|Seconds\s*[<>]=?\s*(600|900))\b/.test(line)),
  ].map(([where,line])=>`${where}: ${line.trim()}`);
  assert.deepEqual(inline,[],'Compare against readingFresh or deviceFresh (Swift) and ReadingFreshMinutes or DeviceFreshMinutes (C#), not a number.');
});

test('views never turn an Unknown into zero with ?? 0 or || 0', () => {
  const views=sources(['lib','app'],file=>file!=='lib/strings.generated.ts');
  // Adding to a running total kept in a Map or object, as in (totals.get(key) ?? 0) + value, is allowed.
  const accumulator=/(\.get\([^()]*\)|\[[^\]]*\])\s*(\?\?|\|\|)\s*0\)\s*\+/;
  const fallback=/(\?\?|\|\|)\s*0(?![.\dxXn_])/;
  const found=hits(views,{test:line=>fallback.test(line) && !accumulator.test(line)},'zero-ok:');
  assert.deepEqual(found,[],
    'Unknown is never shown as zero. Keep null and let the view say Unknown: sum with recordedSum from lib/panel-data.mjs (null when any value is Unknown), '+
    'or narrow with a type guard. If the zero is not a reading (a count of computers, a flag), add "// zero-ok: <reason>" on the line or the line above.');
});

test('tests wait for a signal, not for a fixed time', () => {
  const tests=[...sources(['test'],file=>file.endsWith('.test.mjs')),...sources(['scripts'],file=>/^scripts\/[^/]+\.test\.mjs$/.test(file))];
  const sleep=/await\s+(new Promise\(.*setTimeout|delay\(|sleep\(|setTimeout\()/;
  // A short pause inside a polling loop that checks a condition each time is a wait for a signal.
  const polling=/\b(for|while)\s*\(/;
  const found=hits(tests,{test:line=>sleep.test(line) && !polling.test(line)},'sleep-ok:');
  assert.deepEqual(found,[],
    'A fixed sleep fails on a busy machine. Await a promise the code under test resolves (see "holding" in test/run-lock.test.mjs), '+
    'poll a condition in a loop with a deadline (see "until" in test/server-lifetime.test.mjs), or use mock.timers. '+
    'If a real pause is the behaviour under test, add "// sleep-ok: <reason>" on the line or the line above.');
});
