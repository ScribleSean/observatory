export const categories = ['AI apps', 'Editors', 'Terminal', 'Browser', 'Other'];
export const appLabels = ['Codex', 'ChatGPT / Codex', 'Antigravity', 'VS Code', 'Cursor', 'Chrome', 'Edge', 'Safari', 'Firefox', 'Terminal', 'Other app', 'Unknown app'];
export function appLabel(raw) {
  const app = String(raw).toLowerCase();
  for (const [pattern, label] of [[/codex/,'Codex'],[/chatgpt/,'ChatGPT / Codex'],[/antigravity/,'Antigravity'],[/cursor/,'Cursor'],[/code\.exe|visual studio code/,'VS Code'],[/chrome/,'Chrome'],[/msedge|microsoft edge/,'Edge'],[/safari/,'Safari'],[/firefox/,'Firefox'],[/terminal|powershell|cmd\.exe|conhost|wezterm|ubuntu|iterm/,'Terminal']]) if (pattern.test(app)) return label;
  return 'Other app';
}
export const timezone = 'America/New_York';
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
function slot(t) {
  const p = Object.fromEntries(clock.formatToParts(t).map(p => [p.type, p.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export function cleanIntervals(rows, start, end) {
  if (!Array.isArray(rows) || rows.length > 200000) throw Error('Invalid intervals');
  const lo = Date.parse(start), hi = Date.parse(end);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || hi - lo > 7 * 86400000 + 1000) throw Error('Invalid window');
  return rows.map(r => {
    const a = Date.parse(r.start), b = Date.parse(r.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || !categories.includes(r.category)) throw Error('Invalid interval');
    return { start: Math.max(lo, a), end: Math.min(hi, b), category: r.category, app: appLabels.includes(r.app) ? r.app : 'Unknown app' };
  }).filter(r => r.end > r.start);
}

// Sweep interval boundaries instead of adding device totals. Concurrent categories
// remain explicitly mixed rather than guessing which device held attention.
export function summarize(rows, start, end) {
  const days = new Map();
  const day = date => {
    if (!days.has(date)) days.set(date, { date, seconds: 0, hours: Array(24).fill(0), categories: {}, apps: {} });
    return days.get(date);
  };
  for (let t = Date.parse(start); t < Date.parse(end); t += 3600000) day(slot(t).date);
  const events = [];
  rows.forEach((r, id) => { events.push([r.start, id, {category:r.category, app:r.app || 'Unknown app'}], [r.end, id, null]); });
  events.sort((a, b) => a[0] - b[0]);
  const active = new Map();
  let previous = events[0]?.[0];
  for (let i = 0; i < events.length;) {
    const t = events[i][0];
    if (active.size && t > previous) {
      const labels = new Set([...active.values()].map(v => v.category));
      const category = labels.size === 1 ? [...labels][0] : 'Mixed activity';
      const apps = new Set([...active.values()].map(v => v.app));
      const app = category === 'Mixed activity' ? 'Overlapping categories' : apps.size === 1 ? [...apps][0] : 'Multiple apps';
      // Split on minute boundaries to honor local midnight and DST transitions.
      for (let cursor = previous; cursor < t;) {
        const next = Math.min(t, (Math.floor(cursor / 60000) + 1) * 60000);
        const s = slot(cursor), d = day(s.date), seconds = (next - cursor) / 1000;
        d.seconds += seconds;
        d.hours[s.hour] += seconds;
        d.categories[category] = (d.categories[category] || 0) + seconds;
        d.apps[category] ||= {};
        d.apps[category][app] = (d.apps[category][app] || 0) + seconds;
        cursor = next;
      }
    }
    while (i < events.length && events[i][0] === t) {
      const [, id, label] = events[i++];
      if (label === null) active.delete(id); else active.set(id, label);
    }
    previous = t;
  }
  const totals = {};
  for (const d of days.values()) for (const [k, v] of Object.entries(d.categories)) totals[k] = (totals[k] || 0) + v;
  return { categories: totals, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function summarizeTracked(rows, tracking, start, end) {
  const result = summarize(rows,start,end);
  if (!Array.isArray(tracking)) return result;
  const through = [...tracking, ...rows].reduce((latest, row) => Math.max(latest, row.end), -Infinity);
  result.trackingThrough = Number.isFinite(through) ? new Date(through).toISOString() : null;
  // Include idle intervals and deduplicate overlapping tracking evidence.
  const observed = summarize([...tracking,...rows].map(r=>({...r,category:'Other',app:'Unknown app'})),start,end);
  result.days = result.days.map(day=>{
    const coverage=observed.days.find(d=>d.date===day.date);
    return {...day,trackedSeconds:coverage?.seconds || 0,trackedHours:coverage?.hours || Array(24).fill(0)};
  });
  return result;
}
export function trackingState(record) {
  if (!record) return 'untracked';
  if (record.seconds>0 || record.trackedSeconds>0) return 'tracked';
  return record.trackedSeconds===0?'untracked':'unknown';
}
export function threeHourBands(record) {
  return Array.from({length:8},(_,i)=>({hour:i*3,
    seconds:(record?.hours || []).slice(i*3,i*3+3).reduce((n,v)=>n+v,0),
    trackedSeconds:record?.trackedHours?(record.trackedHours.slice(i*3,i*3+3).reduce((n,v)=>n+v,0)):null,
  }));
}
