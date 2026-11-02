import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {READING_FRESH_MS,DEVICE_FRESH_MS} from '../lib/freshness.mjs';
import strings from '../lib/strings.json' with {type:'json'};
import {LIMIT_LOW_PERCENT,LIMIT_SPENT_PERCENT} from '../lib/glance-limits.mjs';
import {compact} from '../lib/panel-data.mjs';

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

function codeOnly(source) {
  const keep=text=>/^[A-Za-z_$][\w$]*$/.test(text)?text:'';
  const templates=[];
  let out='',prev='',i=0;
  while (i<source.length) {
    const c=source[i];
    if (c==='/' && source[i+1]==='/') { i=source.indexOf('\n',i); if (i<0) break; continue; }
    if (c==='/' && source[i+1]==='*') { const end=source.indexOf('*/',i+2); i=end<0?source.length:end+2; out+=' '; continue; }
    if (c==='"' || c==="'") {
      let j=i+1;
      while (j<source.length && source[j]!==c && source[j]!=='\n') j+=source[j]==='\\'?2:1;
      out+=c+keep(source.slice(i+1,j))+c; prev=c; i=j+1; continue;
    }
    if (c==='`' || (c==='}' && templates.at(-1)===0)) {
      if (c==='}') templates.pop();
      let j=i+1;
      while (j<source.length && source[j]!=='`' && !(source[j]==='$' && source[j+1]==='{')) j+=source[j]==='\\'?2:1;
      if (source[j]==='`') { out+=c==='`'?`\`${keep(source.slice(i+1,j))}\``:'}`'; i=j+1; }
      else { out+=c==='`'?'`${':'}${'; templates.push(0); i=j+2; }
      prev='`'; continue;
    }
    if (c==='/' && /^$|[(,=:[!&|?{};+\-*%~^]/.test(prev)) {
      let j=i+1,inClass=false;
      while (j<source.length && source[j]!=='\n' && (inClass || source[j]!=='/')) {
        if (source[j]==='[') inClass=true; else if (source[j]===']') inClass=false;
        j+=source[j]==='\\'?2:1;
      }
      out+=' '; prev='/'; i=j+1; continue;
    }
    if (templates.length && c==='{') templates[templates.length-1]++;
    if (templates.length && c==='}') templates[templates.length-1]--;
    out+=c; if (!/\s/.test(c)) prev=c; i++;
  }
  return out;
}

function checkStringUsage(catalog,sources) {
  const code=sources.map(codeOnly).join('\n')
    .replace(/\b(strings|STRINGS)\s*\[\s*(['"`])(\w+)\2\s*\]/g,'$1.$3[]')
    .replace(/\{([^{}]*)\}\s*=\s*(strings|STRINGS)\.(\w+)\b(?!\s*[.[])/g,(_,names,root,group)=>names.includes('...')?`${root}.${group}`:
      names.split(',').map(name=>name.trim().match(/^[\w$]+/)?.[0]).filter(Boolean).map(key=>`${root}.${group}.${key};`).join(''));
  const unused=[];
  for (const [group,entries] of Object.entries(catalog)) {
    if (new RegExp(`\\b(strings|STRINGS)\\.${group}\\b(?!\\s*\\.)`).test(code)) continue;
    for (const key of Object.keys(entries)) {
      if (!new RegExp(`\\b(strings|STRINGS)\\.${group}\\.${key}\\b`).test(code)) unused.push(`${group}.${key}`);
    }
  }
  assert.deepEqual(unused,[],`Unused keys in lib/strings.json:\n${unused.join('\n')}`);
}

const stringSources=execFileSync('git',['ls-files','-z'],{cwd:ROOT,encoding:'utf8'}).split('\0')
  .filter(file=>file && !file.startsWith('docs/') && !file.endsWith('strings.generated.ts') && !file.includes('fixtures/')
    && /\.(js|mjs|ts|tsx|mts|cs|swift)$/.test(file))
  .map(read);
const catalog=JSON.parse(read('lib/strings.json'));

test('every shared string has a qualified use or its whole group is used', () => {
  checkStringUsage(catalog,stringSources);
});

test('the shared string rule rejects a planted unused key', () => {
  const planted={...catalog,app:{...catalog.app,unusedForRepoRule:'Unused probe'}};
  assert.throws(()=>checkStringUsage(planted,stringSources),/Unused keys in lib\/strings\.json:\napp\.unusedForRepoRule/);
});

test('the shared string rule accepts qualified and whole-group uses, not bare key names', () => {
  const sample={lower:{used:''},upper:{used:''},aliased:{any:''},iterated:{any:''},bracketed:{any:''},templated:{used:''}};
  const corpus='strings.lower.used; STRINGS.upper.used; const words = strings.aliased; Object.values(STRINGS.iterated);'+
    " STRINGS['bracketed'][period]; const line = `${STRINGS.templated.used} and ${count}`;";
  checkStringUsage(sample,[corpus]);
  assert.throws(()=>checkStringUsage({lower:{used:'',unused:''}},[`${corpus} unused; strings.lower.unusedSuffix;`]),
    /Unused keys in lib\/strings\.json:\nlower\.unused\n/);
});

test('the shared string rule ignores comments and strings and reads destructuring key by key', () => {
  const sample={notes:{inLine:'',inBlock:'',quoted:'',templated:''},periods:{now:'',renamed:'',later:''}};
  const corpus=[
    '// STRINGS.notes.inLine',
    '/* strings.notes.inBlock */',
    "const label = 'STRINGS.notes.quoted';",
    'const text = `see STRINGS.notes.templated`;',
    'const { now, renamed: other } = STRINGS.periods;',
  ].join('\n');
  assert.throws(()=>checkStringUsage(sample,[corpus]),
    /Unused keys in lib\/strings\.json:\nnotes\.inLine\nnotes\.inBlock\nnotes\.quoted\nnotes\.templated\nperiods\.later\n/);
  checkStringUsage({periods:{all:''}},['const { now, ...rest } = STRINGS.periods;']);
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
  const polling=/\b(for|while)\s*\(/;
  const found=hits(tests,{test:line=>sleep.test(line) && !polling.test(line)},'sleep-ok:');
  assert.deepEqual(found,[],
    'A fixed sleep fails on a busy machine. Await a promise the code under test resolves (see "holding" in test/run-lock.test.mjs), '+
    'poll a condition in a loop with a deadline (see "until" in test/server-lifetime.test.mjs), or use mock.timers. '+
    'If a real pause is the behaviour under test, add "// sleep-ok: <reason>" on the line or the line above.');
});

test('the native panels use the dashboard limit thresholds and wording', () => {
  const swift=read('glance/mac/Glance.swift'),cs=read('glance/windows/Glance.cs');
  assert.equal(Number(swift.match(/static let low = ([\d.]+)/)?.[1]),LIMIT_LOW_PERCENT,'Glance.swift PanelState.low differs from LIMIT_LOW_PERCENT in lib/glance-limits.mjs.');
  assert.equal(Number(cs.match(/public const double Low = ([\d.]+);/)?.[1]),LIMIT_LOW_PERCENT,'Glance.cs PanelState.Low differs from LIMIT_LOW_PERCENT in lib/glance-limits.mjs.');
  assert.ok(swift.includes(`$0 <= ${LIMIT_SPENT_PERCENT} ? palette.error`),'Glance.swift spent tint differs from LIMIT_SPENT_PERCENT.');
  assert.ok(cs.includes(`value <= ${LIMIT_SPENT_PERCENT} ? p.Error`),'Glance.cs spent tint differs from LIMIT_SPENT_PERCENT.');
  // Each shared phrase, split at its placeholders, must appear in both panels.
  const phrases=[strings.overview.today,strings.today.screenTimeOff,strings.labels.screenTime,strings.sections.tokens,strings.tokens.apiEstimate,strings.overview.lastSeen,strings.formats.resetsIn,
    strings.status.updatedAgo,strings.actions.openDashboard,strings.actions.refresh,strings.tokens.underCent,strings.status.unknown];
  for (const phrase of phrases) for (const part of phrase.split(/\{[A-Za-z]+\}/).map(text=>text.trim()).filter(Boolean)) {
    assert.ok(swift.includes(part),`glance/mac/Glance.swift does not say "${part}" like lib/strings.json.`);
    assert.ok(cs.includes(part),`glance/windows/Glance.cs does not say "${part}" like lib/strings.json.`);
  }
  // The panels draw "{value}% left" as the percent followed by the word in the dim label color.
  const leftWord=strings.limitHistory.left.split('% ')[1];
  assert.ok(swift.includes(`Text("${leftWord}")`),`glance/mac/Glance.swift does not end a limit value with "${leftWord}" like lib/strings.json.`);
  assert.ok(cs.includes(`" ${leftWord}"`),`glance/windows/Glance.cs does not end a limit value with "${leftWord}" like lib/strings.json.`);
  // The Mac app keeps a copy of the telescope for runs outside its bundle. It must be the same drawing.
  for (const d of [...read('public/brand/telescope.svg').matchAll(/ d="([^"]+)"/g)].map(match=>match[1]))
    assert.ok(swift.includes(` d="${d}"`),'Glance.swift Brand.svg differs from public/brand/telescope.svg.');
  // JavaScript and Swift round halves up. C# Math.Round rounds halves to even unless told otherwise.
  assert.deepEqual([...cs.matchAll(/Math\.Round\(([^;]*)/g)].map(match=>match[1]).filter(call=>!call.includes('MidpointRounding.AwayFromZero')),[],
    'Glance.cs rounds with Math.Round without MidpointRounding.AwayFromZero, so 2.5 minutes would show as 2m.');
  for (const text of [swift,cs]) assert.ok(!text.includes('No current reading'),'Panels show each window as a row, not a missing-readings line.');
});

test('one token format: under 10 of a unit one decimal, from 10 whole, on the dashboard and both panels', () => {
  const table=[[0,'0'],[999,'999'],[999.6,'1K'],[1000,'1K'],[1500,'1.5K'],[9400,'9.4K'],[9960,'10K'],[12345,'12K'],
    [671400,'671K'],[999600,'1M'],[2e6,'2M'],[9.4e6,'9.4M'],[21e6,'21M'],[43.5e6,'44M'],[14.3e6,'14M'],[1.7e6,'1.7M'],[3.21e9,'3.2B']];
  assert.deepEqual(table.map(([value])=>compact(value)),table.map(([,text])=>text));
  // The panels cannot be run here, so their copies must carry the same rule: whole from 10, one decimal below with ".0" dropped.
  const swift=read('glance/mac/Glance.swift'),cs=read('glance/windows/Glance.cs');
  assert.match(swift,/scaled >= 10 \|\| divisor == 1 \? String\(Int\(scaled\.rounded\(\)\)\) : String\(format: "%\.1f", scaled\)/);
  assert.match(swift,/if text\.hasSuffix\("\.0"\) \{ text\.removeLast\(2\) \}/);
  assert.match(cs,/scaled >= 10 \|\| units\[index\]\.Item2 == "" \? Math\.Round\(scaled, MidpointRounding\.AwayFromZero\)[^:]*: scaled\.ToString\("0\.#"/);
  for (const text of [swift,cs]) assert.match(text,/"1000"/,'both panels step 1000K up to 1M');
});
