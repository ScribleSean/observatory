import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanIntervals, summarizeTracked, appLabel } from './activity-timeline.mjs';
import { estimate } from './api-estimate.mjs';
import { collectLegacyQuota } from './legacy-quota.mjs';
import { pythonReport } from './python-report.mjs';
import { readSettingsSnapshot } from './settings-snapshot.mjs';
import { combineTokens, combineSettings } from './combine-tokens.mjs';
import { combineActivity } from './combine-activity.mjs';
import { randomBytes } from 'node:crypto';
import { powershellCommand } from './powershell-command.mjs';
import { hostname, homedir } from 'node:os';
import { cleanDictation } from './typewhisper.mjs';
import { cleanWispr } from './wispr.mjs';
import { selectActivityPairs } from './activity-buckets.mjs';
import { readBoundedReceipts as readAgentReceipts } from './bounded-receipts.mjs';
import {cleanLocalModel} from './legacy-workflows.mjs';
export { cleanReceipts } from './agent-receipts.mjs';
import {previousActivityHistory,retainActivityHistory} from './activity-history.mjs';
import {cachedSettingsScript} from './cached-settings.mjs';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fields = [
  'inputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
];
export function numeric(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
}
export function cleanSettings(raw, host) {
  if (!Array.isArray(raw.profiles) || !Array.isArray(raw.tools)) throw Error('Invalid settings report');
  const profiles = raw.profiles.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^[a-zA-Z0-9._:/-]{1,100}$/.test(r.model)).map(r => ({
    date:r.date, model:r.model,
    effort:['none','minimal','low','medium','high','xhigh','max','ultra'].includes(r.effort)?r.effort:'unknown',
    speed:['standard','fast'].includes(r.speed)?r.speed:'unknown',
    ...Object.fromEntries(fields.map(k=>[k,numeric(r[k])])),
  }));
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,199}$/.test(value);
  const tools = raw.tools.filter(r => !['history','notes'].includes(r.namespace) && !/^(history|notes)(\.|__)/.test(r.tool || '') && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && ['Shell','File edits','Browser','Research','Other tools'].includes(r.category) && Number.isSafeInteger(r.count) && r.count>=0).map(r=>({
    date:r.date,category:r.category,count:r.count,
    tool:r.tool===undefined?null:identifier(r.tool)?r.tool:'Unknown tool',
    namespace:identifier(r.namespace)?r.namespace:'',
  }));
  return {host,status:'ok',profiles,tools};
}
export function category(app) {
  if (/codex|chatgpt|antigravity/i.test(app)) return 'AI apps';
  if (
    /codex|chatgpt|code\.exe|visual studio|cursor|antigravity|idea|pycharm/i.test(
      app,
    )
  )
    return 'Editors';
  if (/terminal|powershell|cmd\.exe|conhost|wezterm|ubuntu|iterm/i.test(app))
    return 'Terminal';
  if (/chrome|firefox|msedge|brave|safari/i.test(app)) return 'Browser';
  return 'Other';
}
export function cleanTokens(raw, host) {
  if (!Array.isArray(raw.daily)) throw Error('Unsupported report');
  const days = raw.daily
    .map((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw Error('Invalid date');
      const models = Object.entries(d.models || {}).map(([model, m]) => ({
        model: /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) ? model : 'unknown',
        ...Object.fromEntries(fields.map((k) => [k, numeric(m[k])])),
        inferred: m.isFallback === true,
      }));
      return {
        date: d.date,
        ...Object.fromEntries(fields.map((k) => [k, numeric(d[k])])),
        models: models.map(m => ({ ...m, apiEstimate: estimate([m]) })),
        apiEstimate: estimate(models),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { host, status: 'ok', days };
}
export function cleanActivity(raw, host) {
  if (Array.isArray(raw.intervals)) {
    const intervals = cleanIntervals(raw.intervals, raw.start, raw.end);
    const trackingIntervals = Array.isArray(raw.trackingIntervals) ? cleanIntervals(raw.trackingIntervals.map(r=>({start:r.start,end:r.end,category:'Other'})),raw.start,raw.end) : undefined;
    return { host, status: 'ok', start: raw.start, end: raw.end,
      latestEvent: Number.isFinite(Date.parse(raw.latestEvent)) ? new Date(raw.latestEvent).toISOString() : null,
      ...summarizeTracked(intervals, trackingIntervals, raw.start, raw.end), intervals, trackingIntervals };
  }
  const categories = Object.fromEntries(
    ['Coding', 'Terminal', 'Browser', 'Other'].map((k) => [
      k,
      numeric(raw.categories?.[k]),
    ]),
  );
  if (
    Object.values(categories).some((x) => x === null) ||
    Object.values(categories).reduce((a, b) => a + b, 0) > 7 * 86400 + 1
  )
    throw Error('Invalid activity');
  const stamp = (x) =>
    typeof x === 'string' && Number.isFinite(Date.parse(x))
      ? new Date(x).toISOString()
      : null;
  return {
    host,
    status: 'ok',
    start: stamp(raw.start),
    end: stamp(raw.end),
    latestEvent: stamp(raw.latestEvent),
    categories,
  };
}
async function command(file, args) {
  const { stdout } = await exec(file, args, {
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
async function api(suffix, body) {
  const r = await fetch('http://127.0.0.1:5600/api/0' + suffix, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error('ActivityWatch unavailable');
  return r.json();
}
export async function macActivity({raw=false}={}) {
  const buckets = Object.values(await api('/buckets/'));
  const hostnames = [hostname()];
  // Watchers can use the Bonjour name while the server uses the Unix hostname.
  if (process.platform === 'darwin') {
    const {stdout} = await exec('/usr/sbin/scutil', ['--get','LocalHostName'], {timeout:5000,maxBuffer:4096});
    hostnames.push(stdout.trim());
  }
  const pairs = selectActivityPairs(buckets,hostnames);
  const end = new Date(), start = new Date(end - 7 * 86400000);
  const reports = await Promise.all(pairs.map(async ({window:w,afk:a}) => {
  const q = `w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); a = filter_keyvals(a, "status", ["not-afk"]); RETURN = filter_period_intersect(w, a);`;
  const [events] = await api('/query/', {
    query: [q],
    timeperiods: [`${start.toISOString()}/${end.toISOString()}`],
  });
  const intervals = events.map(e => {
    if (numeric(e.duration) === null) throw Error('Invalid duration');
    return { start: e.timestamp, end: new Date(Date.parse(e.timestamp) + e.duration * 1000).toISOString(), category: category(String(e.data?.app)), app:appLabel(e.data?.app) };
  });
  const [observed] = await api('/query/', {
    query:[`w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); RETURN = filter_period_intersect(w, a);`],
    timeperiods:[`${start.toISOString()}/${end.toISOString()}`],
  });
  const trackingIntervals = observed.map(e=>{
    if (numeric(e.duration)===null) throw Error('Invalid tracking duration');
    return {start:e.timestamp,end:new Date(Date.parse(e.timestamp)+e.duration*1000).toISOString()};
  });
  const latest = await api(`/buckets/${encodeURIComponent(w)}/events?limit=1`);
  return {intervals,trackingIntervals,latestEvent:latest[0]?.timestamp};
  }));
  const report={
    intervals:reports.flatMap(r=>r.intervals),
    trackingIntervals:reports.flatMap(r=>r.trackingIntervals),
    start:start.toISOString(), end:end.toISOString(),
    latestEvent:reports.map(r=>r.latestEvent).filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1),
  };
  return raw?report:cleanActivity(report,'Mac');
}
export async function guarded(host, fn) {
  try {
    const result=await fn();
    const checkedAt=typeof result.checkedAt==='string' && Number.isFinite(Date.parse(result.checkedAt))
      ? result.checkedAt : new Date().toISOString();
    return {...result, checkedAt};
  } catch {
    return { host, status: 'unavailable', checkedAt:new Date().toISOString() };
  }
}
export async function collect() {
  const previousHistory=await previousActivityHistory(path.join(root,'public/local/usage.json'));
  const config = JSON.parse(
    await readFile(path.join(root, 'local.config.json'), 'utf8'),
  );
  for (const key of ['macCcusage', 'ubuntuCcusage'])
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(config[key]))
      throw Error('Invalid configured executable');
  if (config.codexExecutable && !/^\/[a-zA-Z0-9_./-]+$/.test(config.codexExecutable)) throw Error('Invalid Codex executable');
  if (config.windowsCodexHome && !/^\/mnt\/[a-z]\/[a-zA-Z0-9_./-]+$/.test(config.windowsCodexHome))
    throw Error('Invalid Windows log directory');
  for (const key of ['windowsHost', 'ubuntuHost'])
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config[key]))
      throw Error('Invalid SSH alias');
  if (
    typeof config.receiptDirectory !== 'string' ||
    !path.isAbsolute(config.receiptDirectory)
  )
    throw Error('Invalid receipt directory');
  const ps = await readFile(
    path.join(root, 'scripts/windows-aggregate-activity.ps1'),
    'utf8',
  );
  const readTokens = host => guarded(host, async () => {
    if (host === 'Mac') return cleanTokens(await command(config.macCcusage,
      ['codex','daily','--offline','--no-cost','--timezone','America/New_York','--json']),host);
    if (host === 'Windows' && !config.windowsCodexHome) return {host,status:'not-connected'};
    const prefix = host === 'Windows' ? 'env CODEX_HOME=' + config.windowsCodexHome + ' ' : '';
    return cleanTokens(await command('ssh',['-oBatchMode=yes','-oConnectTimeout=8',config.ubuntuHost,
      prefix + config.ubuntuCcusage + ' codex daily --offline --no-cost --timezone America/New_York --json']),host);
  });
  const [mac, windows, macTokens, wslTokens, windowsTokens, quota, localModel] = await Promise.all([
    guarded('Mac', macActivity),
    guarded('Windows', async () =>
      cleanActivity(
        await command('ssh', [
          '-oBatchMode=yes',
          '-oConnectTimeout=8',
          config.windowsHost,
          powershellCommand(ps),
        ]),
        'Windows',
      ),
    ),
    readTokens('Mac'),
    readTokens('Ubuntu'),
    readTokens('Windows'),
    guarded('Codex', () => collectLegacyQuota(root)),
    config.localModelResults ? guarded('Ubuntu', async () => {
      const raw=await pythonReport(config.ubuntuHost, await readFile(path.join(root,'scripts/read-local-model.py'),'utf8'),config.localModelResults);
      return cleanLocalModel(raw);
    }) : Promise.resolve({host:'Ubuntu',status:'not-connected'}),
  ]);
  // Comparison keys change every collection and never enter the saved report.
  const settingsScript = `INVENTORY_SALT = '${randomBytes(32).toString('hex')}'\n` + await readFile(path.join(root,'scripts/read-settings.py'),'utf8');
  const inventories = {};
  const tokenSources = [macTokens, wslTokens, windowsTokens];
  const settings = await Promise.all([
    ['Mac',null,config.macCodexHome], ['Ubuntu',config.ubuntuHost,config.ubuntuCodexHome], ['Windows',config.ubuntuHost,config.windowsCodexHome]
  ].map(([host,ssh,folder],index)=>folder?guarded(host,async()=>{
    const result = await readSettingsSnapshot(tokenSources[index], () => readTokens(host),
      async () => {
        const script=host==='Mac' ? await cachedSettingsScript(root,settingsScript) : settingsScript;
        const raw = await pythonReport(ssh,script,folder);
        inventories[host] = raw.inventory;
        return cleanSettings(raw,host);
      });
    if (result.tokens.status === 'ok') tokenSources[index] = result.tokens;
    else inventories[host] = {status:'incomplete'};
    return result.settings;
  }):Promise.resolve({host,status:'not-connected'})));
  const receipts = await readAgentReceipts(config.receiptDirectory);
  const dictationScript = await readFile(path.join(root,'scripts/read-typewhisper.py'),'utf8');
  const wisprScript = await readFile(path.join(root,'scripts/read-wispr.py'),'utf8');
  const dictation = await Promise.all(['Wispr Flow','TypeWhisper'].flatMap(source => ['Mac','Windows'].map(async host => {
    const enabled = config.dictation?.[host.toLowerCase()] === true;
    if (!enabled || (host === 'Windows' && !config.windowsCodexHome)) return {host,source,status:'not-connected'};
    const nativeWindows = host === 'Windows' && source === 'Wispr Flow';
    const result = await guarded(host,async () => (source === 'Wispr Flow' ? cleanWispr : cleanDictation)(await pythonReport(
      host === 'Mac' ? null : nativeWindows ? config.windowsHost : config.ubuntuHost,
      `MODE = '${host.toLowerCase()}'\n` + (source === 'Wispr Flow' ? wisprScript : dictationScript),
      host === 'Mac' ? homedir() : path.posix.dirname(config.windowsCodexHome),
      {nativeWindows},
    ),host));
    return {...result,source};
  })));
  const combined = combineActivity([mac, windows]);
  const combinedTokens = combineTokens(tokenSources,inventories);
  const data = {
    schema: 2,
    collectedAt: new Date().toISOString(),
    timezone: 'America/New_York',
    activity: [mac, windows].map(({ intervals, trackingIntervals, ...safe }) => safe),
    combined,
    tokens: tokenSources,
    combinedTokens,
    combinedSettings: combinedTokens.status === 'ok' ? combineSettings(tokenSources,settings) : {host:'All',status:'unavailable'},
    agents: receipts.agents,
    agentSource: receipts.source,
    quota,
    localModel,
    dictation,
    settings,
  };
  data.activityHistory=retainActivityHistory(previousHistory,[combined,...data.activity],data.collectedAt);
  const folder = path.join(root, 'public/local');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = path.join(folder, 'usage.json');
  await writeFile(target + '.tmp', JSON.stringify(data), { mode: 0o600 });
  await rename(target + '.tmp', target);
  console.log(
    JSON.stringify({
      collectedAt: data.collectedAt,
      sources: [...data.activity, ...data.tokens].map((x) => ({
        host: x.host,
        status: x.status,
      })),
      agentSnapshots: data.agents.length,
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await collect();
