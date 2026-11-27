import { cleanIntervals, summarizeTracked } from './activity-timeline.mjs';
import {appLabelOk} from '../lib/my-apps.mjs';
import {createHmac} from 'node:crypto';
import {LEDGER_TOP,WORK_KINDS} from '../lib/ledger-shape.mjs';
import {isWorkKind} from './ledger-kinds.mjs';
import {TOOL_CATEGORIES,cleanTitle} from './sources/pure.mjs';
import {SOURCES,ENGINE_IDS,ENGINE_SETTINGS,MAX_ROLE_ALIASES} from '../lib/config.mjs';
import {ROLES} from '../lib/roles.mjs';
export {cleanLedgerHistory} from '../lib/r2-shape.mjs';
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
  if (raw.tokenProfiles === undefined) return {host,status:'ok',profiles,tools};
  if (!Array.isArray(raw.tokenProfiles) || raw.tokenProfiles.length > 50000) throw Error('Invalid token history');
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const tokenProfiles = raw.tokenProfiles.map(row => {
    if (!row || typeof row !== 'object' || !date(row.date) || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(row.model) ||
      fields.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) throw Error('Invalid token history');
    return {date:row.date,model:row.model,
      effort:['none','minimal','low','medium','high','xhigh','max','ultra'].includes(row.effort)?row.effort:'unknown',
      speed:['standard','fast'].includes(row.speed)?row.speed:'unknown',
      ...Object.fromEntries(fields.map(key=>[key,row[key]]))};
  });
  return {host,status:'ok',profiles,tools,tokenProfiles};
}
export function category(app) {
  if (/codex|chatgpt|antigravity|claude|grok|gemini|perplexity/i.test(app)) return 'AI apps';
  if (/code\.exe|visual studio|cursor|\bidea(64)?\b|intellij|pycharm|xcode|\bzed\b|sublime|windsurf|android studio/i.test(app)) return 'Editors';
  if (/terminal|powershell|cmd\.exe|conhost|wezterm|ubuntu|iterm|ghostty|\bwarp\b|alacritty|\bkitty\b|wt\.exe/i.test(app)) return 'Terminal';
  if (/chrome|firefox|msedge|brave|safari|arc\b|opera|vivaldi|mullvad browser|tor browser|orion|duckduckgo/i.test(app)) return 'Browser';
  if (/discord|slack|teams|zoom|messages|facetime|whatsapp|telegram|signal|\bmail\b|outlook/i.test(app)) return 'Communication';
  if (/steam|battle\.net|overwatch|valorant|riot client|league of legends|epicgames|minecraft|-win64-shipping/i.test(app)) return 'Games';
  return 'Other';
}
// raw.labels: the my-apps labels the reader applied (scripts/mac-activity.mjs), when the settings have rules.
export function cleanActivity(raw, host) {
  if (Array.isArray(raw.intervals)) {
    const labels = Array.isArray(raw.labels) ? raw.labels.filter(appLabelOk) : null;
    const intervals = cleanIntervals(raw.intervals, raw.start, raw.end, { labels });
    const trackingIntervals = Array.isArray(raw.trackingIntervals) ? cleanIntervals(raw.trackingIntervals.map(r=>({start:r.start,end:r.end,category:'Other'})),raw.start,raw.end) : undefined;
    return { host, status: 'ok', start: raw.start, end: raw.end,
      latestEvent: Number.isFinite(Date.parse(raw.latestEvent)) ? new Date(raw.latestEvent).toISOString() : null,
      ...summarizeTracked(intervals, trackingIntervals, raw.start, raw.end, { labeled: labels !== null }), intervals, trackingIntervals };
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

// ---- Ledger (lib/ledger-shape.mjs). A row from another computer is untrusted, so it is rebuilt field
// by field. Repository names must be folder names, never paths. Titles stay only while the
// `sessions.titles` setting is on. Off, each becomes a short hash so sessions still tell apart. The
// hash is keyed with a random secret kept in this install's private data folder (titleSalt), so a
// common title cannot be found by hashing guesses. A hash that came in already made is kept.
const LEDGER_FAIL=()=>{throw Error('Invalid ledger');};
const ledgerObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const ledgerCount=value=>value===null || (Number.isSafeInteger(value) && value>=0);
const ledgerUsd=value=>value===null || (typeof value==='number' && Number.isFinite(value) && value>=0);
const ledgerInstant=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const LEDGER_ID=/^[0-9a-f]{12}$/;
const LEDGER_TOOL=/^[a-z][a-z0-9-]{0,31}$/;
const LEDGER_MODEL=/^[a-z0-9][a-z0-9.-]{0,63}$/;
const LEDGER_REPO=/^[\p{L}\p{N}_.+ @-]{1,64}$/u;
const LEDGER_DATE=/^\d{4}-\d\d-\d\d$/;
const STATES=['working','waiting','idle'];
const need=(ok)=>{if(!ok)LEDGER_FAIL();};
const list=(value,max)=>{need(Array.isArray(value) && value.length<=max);return value;};
const nullableCount=value=>{need(ledgerCount(value ?? null));return value ?? null;};
const nullableUsd=value=>{need(ledgerUsd(value ?? null));return value ?? null;};

function cleanShipped(raw) {
  need(ledgerObject(raw));
  const repos=list(raw.repos ?? [],8).filter(name=>typeof name==='string' && LEDGER_REPO.test(name) && name!=='.' && name!=='..' && !/[\\/]/.test(name));
  return {estimated:raw.estimated!==false,commits:nullableCount(raw.commits),onMain:nullableCount(raw.onMain),merges:nullableCount(raw.merges),
    prsOpen:nullableCount(raw.prsOpen),repos};
}

const TITLE_HASH=/^[0-9a-f]{12}$/;
export const titleHash=(title,salt)=>createHmac('sha256',String(salt ?? '')).update(title).digest('hex').slice(0,12);

function cleanLedgerSession(raw,titles,salt) {
  need(ledgerObject(raw) && LEDGER_ID.test(raw.id) && ledgerInstant(raw.startedAt) && ledgerInstant(raw.lastActiveAt) &&
    typeof raw.running==='boolean' && ledgerObject(raw.tokens) && ledgerObject(raw.signals) && Number.isSafeInteger(raw.subagents) && raw.subagents>=0);
  const title=cleanTitle(raw.title);
  const signals=raw.signals;
  need(signals.retryTool===null || signals.retryTool===undefined || TOOL_CATEGORIES.includes(signals.retryTool));
  const kept=typeof raw.titleHash==='string' && TITLE_HASH.test(raw.titleHash)?raw.titleHash:null;
  const hash=titles?(title?null:kept):(title?titleHash(title,salt):kept);
  need(raw.origin===undefined || raw.origin===null || raw.origin==='headless' || raw.origin==='interactive');
  need(raw.task===undefined || raw.task===null || isWorkKind(raw.task));
  const repo=typeof raw.repo==='string' && LEDGER_REPO.test(raw.repo) && raw.repo!=='.' && raw.repo!=='..' && !/[\\/]/.test(raw.repo)?raw.repo:null;
  return {id:raw.id,title:titles?title:null,...(hash?{titleHash:hash}:{}),origin:raw.origin ?? null,task:raw.task ?? null,repo,
    startedAt:raw.startedAt,lastActiveAt:raw.lastActiveAt,running:raw.running,
    state:raw.running && STATES.includes(raw.state)?raw.state:null,ratePerHour:raw.running?nullableUsd(raw.ratePerHour):null,
    tokens:Object.fromEntries(['input','output','cacheRead','cacheWrite'].map(key=>[key,nullableCount(raw.tokens[key])])),
    apiUsd:nullableUsd(raw.apiUsd),
    models:list(raw.models,20).map(model=>{need(ledgerObject(model) && (model.model==='unknown' || LEDGER_MODEL.test(model.model)));
      return {model:model.model,apiUsd:nullableUsd(model.apiUsd),outputTokens:nullableCount(model.outputTokens)};}),
    subagents:raw.subagents,
    kinds:list(raw.kinds,60).map(part=>{need(ledgerObject(part) && WORK_KINDS.includes(part.kind) && (part.model==='unknown' || LEDGER_MODEL.test(part.model)) &&
      Number.isSafeInteger(part.subagents) && part.subagents>=0);return {kind:part.kind,model:part.model,subagents:part.subagents,apiUsd:nullableUsd(part.apiUsd)};}),
    fanout:list(raw.fanout ?? [],FANOUT_MAX).map(point=>{need(ledgerObject(point) && ledgerInstant(point.at) && Number.isSafeInteger(point.count) && point.count>=0);
      return {at:point.at,count:point.count};}),
    shipped:cleanShipped(raw.shipped),
    signals:{longestRetry:nullableCount(signals.longestRetry),retryTool:signals.retryTool ?? null,autoResumeUsd:nullableUsd(signals.autoResumeUsd),
      searchOnTopModelUsd:nullableUsd(signals.searchOnTopModelUsd),searchOnSmallModelUsd:nullableUsd(signals.searchOnSmallModelUsd)}};
}

// 15-minute slots over two weeks.
const FANOUT_MAX=2*7*96;

function cleanLedgerPeriod(raw,titles,salt) {
  need(ledgerObject(raw) && ['current','previous'].includes(raw.key) && ledgerInstant(raw.start) && ledgerInstant(raw.end) && raw.start<=raw.end &&
    typeof raw.windowKnown==='boolean');
  const sessions=list(raw.sessions,LEDGER_TOP).map(session=>cleanLedgerSession(session,titles,salt));
  need(new Set(sessions.map(session=>session.id)).size===sessions.length);
  let other=null;
  if(raw.other!==null && raw.other!==undefined) {
    need(ledgerObject(raw.other) && Number.isSafeInteger(raw.other.count) && raw.other.count>0 && Number.isSafeInteger(raw.other.subagents) && raw.other.subagents>=0);
    other={count:raw.other.count,apiUsd:nullableUsd(raw.other.apiUsd),subagents:raw.other.subagents,shipped:cleanShipped(raw.other.shipped)};
  }
  const sessionCount=nullableCount(raw.sessionCount);
  need(sessionCount===null || sessionCount>=sessions.length);
  return {key:raw.key,start:raw.start,end:raw.end,windowKnown:raw.windowKnown,apiUsd:nullableUsd(raw.apiUsd),sessionCount,sessions,other,
    days:list(raw.days ?? [],62).map(day=>{need(ledgerObject(day) && LEDGER_DATE.test(day.date));return {date:day.date,apiUsd:nullableUsd(day.apiUsd),onMain:nullableCount(day.onMain)};})};
}

export function cleanLedgerRow(raw,{titles=true,salt=null}={}) {
  need(ledgerObject(raw) && typeof raw.host==='string' && raw.host.length<=32);
  if(raw.status!=='ok') {
    need(['not-connected','unavailable'].includes(raw.status));
    return {host:raw.host,status:raw.status,...(ledgerInstant(raw.collectedAt)?{collectedAt:raw.collectedAt}:{})};
  }
  need(ledgerInstant(raw.collectedAt));
  const tools=list(raw.tools,16).map(tool=>{
    need(ledgerObject(tool) && LEDGER_TOOL.test(tool.tool) && (tool.limitEngine===null || LEDGER_TOOL.test(tool.limitEngine)));
    const periods=list(tool.periods,2).map(period=>cleanLedgerPeriod(period,titles,salt));
    need(new Set(periods.map(period=>period.key)).size===periods.length);
    return {tool:tool.tool,name:cleanTitle(tool.name)?.slice(0,40) ?? tool.tool,limitEngine:tool.limitEngine,
      ...(tool.status==='unavailable'?{status:'unavailable'}:{status:'ok'}),periods};
  });
  need(new Set(tools.map(tool=>tool.tool)).size===tools.length);
  return {host:raw.host,status:'ok',collectedAt:raw.collectedAt,tools};
}

// One computer's settings echo (lib/r2-shape.mjs ConfigEcho), local or pulled over SSH: only the known
// keys, so no path, SSH alias, data folder or program location can ride along. Throws on a wrong shape.
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const ECHO_TEXT=/^[^\u0000-\u001f\u007f]{1,64}$/;
export function cleanConfigEcho(raw,host) {
  need(ledgerObject(raw) && raw.host===host && typeof raw.name==='string' && ECHO_TEXT.test(raw.name.trim()) && ['hub','spoke'].includes(raw.role) &&
    ledgerObject(raw.sources) && ledgerObject(raw.engines) && typeof raw.titles==='boolean');
  const aliases=raw.roleAliases ?? {};
  need(ledgerObject(aliases) && Object.keys(aliases).length<=MAX_ROLE_ALIASES);
  return {host,name:raw.name.trim(),role:raw.role,
    sources:Object.fromEntries(SOURCES.map(key=>[key,raw.sources[key]===true])),
    engines:Object.fromEntries(ENGINE_IDS.map(id=>[id,ENGINE_SETTINGS.includes(raw.engines[id])?raw.engines[id]:'auto'])),
    titles:raw.titles,
    roleAliases:Object.fromEntries(Object.entries(aliases).filter(([start,role])=>ECHO_TEXT.test(start) && ROLES.includes(role))),
    checkedAt:ledgerInstant(raw.checkedAt)?raw.checkedAt:null};
}
