import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./windows-aggregate-activity.ps1', import.meta.url));
const source = await readFile(script, 'utf8');
const windowsOnly = {skip: process.platform !== 'win32' && 'Requires Windows PowerShell on Windows'};
const computer = 'SYNTHETIC-PC';
const early = '2026-10-01T12:00:00Z';
const late = '2026-10-02T12:00:00Z';
const pair = (hostname, suffix) => [
  {id:`window_${suffix}`, hostname, type:'currentwindow'},
  {id:`idle_${suffix}`, hostname, type:'afkstatus'},
];
const powershell = () => path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

test('filters local hosts instead of requiring one pair across all hosts', () => {
  assert.doesNotMatch(source, /Ambiguous collectors/);
  assert.match(source, /\$localNames\s*=\s*@\(\$env:COMPUTERNAME/);
  assert.match(source, /\$localNames -inotcontains \$bucket\.hostname/);
  assert.match(source, /\[System\.Net\.Dns\]::GetHostName\(\)/);
  assert.match(source, /\[StringComparer\]::Ordinal/);
});

test('output contains only fixed labels and interval fields', () => {
  const objects = [...source.matchAll(/\[pscustomobject\]@\{([^}]+)\}/g)].map(match => match[1]);
  assert.equal(objects.length, 3);
  for (const object of objects) assert.doesNotMatch(object, /bucket|hostname|windowId|localNames|\$w\b|\$a\b|\.Name\b/i);
  assert.match(objects.at(-1), /host='Windows'/);
  assert.match(source, /\[ValidateRange\(1, 65535\)\]\[int\]\$Port = 5600/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$Port\/api\/0/);
});

async function collect(t, buckets, {crossOnly = false} = {}) {
  const queries = [], events = [], unexpected = [];
  const server = createServer(async (request, response) => {
    let payload;
    if (request.method === 'GET' && request.url === '/api/0/buckets/') {
      payload = Object.fromEntries(buckets.map((bucket, index) => [`entry_${index}`, bucket]));
    } else if (request.method === 'POST' && request.url === '/api/0/query/') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const query = JSON.parse(body).query[0];
      const ids = [...query.matchAll(/query_bucket\(("(?:[^"\\]|\\.)*")\)/g)].map(match => JSON.parse(match[1]));
      queries.push(ids);
      const include = !crossOnly || (ids[0] === 'window_current' && ids[1] === 'idle_alias');
      payload = [include ? [{timestamp:early, duration:60, data:{app:'code.exe', title:'Synthetic private title'}}] : []];
    } else if (request.method === 'GET' && /^\/api\/0\/buckets\/[^/]+\/events\?limit=1$/.test(request.url)) {
      const id = decodeURIComponent(request.url.split('/')[4]);
      events.push(id);
      payload = [{timestamp:id === 'window_alias' ? late : early}];
    } else {
      unexpected.push(request.url);
      response.statusCode = 404;
      payload = {};
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let stdout = '', error;
  try {
    ({stdout} = await exec(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Port', String(server.address().port)], {
      env:{...process.env, COMPUTERNAME:computer}, timeout:30000, maxBuffer:1024 * 1024,
    }));
  } catch (caught) { error = caught; }
  assert.deepEqual(unexpected, []);
  return {stdout, error, queries, events};
}

function report(result) {
  assert.ifError(result.error);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output).sort(), ['host', 'status', 'start', 'end', 'latestEvent', 'intervals', 'trackingIntervals'].sort());
  assert.equal(output.host, 'Windows');
  assert.equal(output.status, 'ok');
  assert.doesNotMatch(result.stdout, /window_|idle_|SYNTHETIC-PC|Synthetic private title|code\.exe/);
  return output;
}

test('ignores old host buckets and reads only the current pair case insensitively', windowsOnly, async t => {
  const result = await collect(t, [...pair('SYNTHETIC-OLD-PC', 'old'), ...pair(computer.toLowerCase(), 'current')]);
  const output = report(result);
  assert.deepEqual(result.queries, [['window_current', 'idle_current'], ['window_current', 'idle_current']]);
  assert.deepEqual(result.events, ['window_current']);
  assert.equal(output.intervals.length, 1);
  assert.equal(output.trackingIntervals.length, 1);
  assert.equal(output.intervals[0].category, 'Editors');
  assert.equal(output.intervals[0].app, 'VS Code');
  assert.equal(output.latestEvent, early);
});

test('reads cross-alias watchers and reports the latest window event', windowsOnly, async t => {
  const {stdout} = await exec(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[System.Net.Dns]::GetHostName()']);
  const alias = stdout.trim();
  assert.notEqual(alias.toLowerCase(), computer.toLowerCase());
  const result = await collect(t, [...pair(computer, 'current'), ...pair(alias, 'alias')], {crossOnly:true});
  const output = report(result);
  assert.equal(result.stdout.toLowerCase().includes(alias.toLowerCase()), false);
  const combinations = ['window_current/idle_current', 'window_current/idle_alias', 'window_alias/idle_current', 'window_alias/idle_alias'];
  assert.deepEqual(result.queries.map(ids => ids.join('/')).sort(), [...combinations, ...combinations].sort());
  assert.deepEqual(result.events.sort(), ['window_alias', 'window_current']);
  assert.equal(output.intervals.length, 1);
  assert.equal(output.trackingIntervals.length, 1);
  assert.equal(output.latestEvent, late);
});

test('rejects two window buckets under one local hostname before reading', windowsOnly, async t => {
  const result = await collect(t, [...pair(computer, 'current'), {...pair(computer, 'duplicate')[0]}]);
  assert.ok(result.error);
  assert.match(result.error.stderr, /Ambiguous local activity pair/);
  assert.deepEqual(result.queries, []);
  assert.deepEqual(result.events, []);
});

test('rejects buckets with no local hostname before reading', windowsOnly, async t => {
  const result = await collect(t, pair('SYNTHETIC-OLD-PC', 'old'));
  assert.ok(result.error);
  assert.match(result.error.stderr, /No bounded local activity pairs/);
  assert.deepEqual(result.queries, []);
  assert.deepEqual(result.events, []);
});
