import { cleanIntervals, summarizeTracked } from './activity-timeline.mjs';
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
