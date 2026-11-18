// What the menu bar and tray apps show, worked out once per tick from the combined snapshot.
// scripts/tick.mjs writes it to public/local/glance.json. Both native apps only draw it, so the
// wording, rounding and forecast match the dashboard without a second copy in Swift and C#. The forecast and its
// words are the ones the hub stored in combined.json (glance.forecast): this file shows them and words nothing itself.
// Pure: the same snapshot, time and inputs always give the same model.
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { percent, tenths } from './panel-data.mjs';
import { limitRemaining } from './glance-limits.mjs';
import { snapshotFresh } from './freshness.mjs';
import { joined, storedWindows, sessionLabel } from './ledger-join.mjs';

export const GLANCE_SCHEMA = 'observatory-glance/1';
export const RUNNING_SHOWN = 3;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = value => Array.isArray(value) ? value.filter(object) : [];
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const oneDecimal = value => (Math.round(value * 10) / 10).toFixed(1);
// The same, as text: a pace that is not zero never reads 0.0.
const paceText = value => value > 0 && value < 0.1 ? tenths(value) : oneDecimal(value);

/**
 * @typedef {object} GlanceModel
 * @property {string} schema
 * @property {string | null} updatedAt       The combined snapshot's time.
 * @property {string} updated                "Updated 1:40 PM".
 * @property {boolean} collecting            Nothing has been read yet: no forecast, no limit and no sessions. The apps show "Collecting".
 * @property {boolean} stale                 The combined snapshot was already old when this was made.
 * @property {{percent:number|null, ring:number|null, showPercent:boolean, text:string|null}} bar
 * @property {{engine:string|null, text:string, tone:string, used:string, resets:string|null, fraction:number|null}} headline
 * @property {GlanceLimit[]} limits          Every other window present, any engine.
 * @property {GlanceRunning | null} running  Null when no computer reported its sessions.
 * @property {{count:number, subject:string|null, text:string} | null} flag
 *
 * @typedef {object} GlanceLimit
 * @property {string} engine
 * @property {string} name                   "Codex weekly".
 * @property {number | null} fraction        Share used, 0 to 1.
 * @property {string} percent                "19%", "Unknown" or "Off".
 * @property {string | null} resets          "Mon 6 PM".
 * @property {'out' | 'low' | 'normal' | 'muted'} tone
 *
 * @typedef {object} GlanceRunning
 * @property {string} title                  "Running now".
 * @property {number} count
 * @property {number | null} ratePerHour     Percent of the limit per hour, all running sessions.
 * @property {string} summary                "9 sessions, 1.3% per hour".
 * @property {{title:string, machine:string, ratePerHour:number|null, rate:string}[]} sessions  The fastest few.
 */

// Each computer's newest ledger row. The collector stores them on the merged view; older shapes are read too.
function ledgerRows(combined) {
  const found = [...rows(combined?.view?.ledger), ...rows(combined?.ledger),
    ...Object.values(object(combined?.snapshots) ? combined.snapshots : {}).flatMap(snapshot => rows(snapshot?.ledger))];
  const newest = new Map();
  for (const row of found) {
    if (typeof row.host !== 'string') continue;
    const kept = newest.get(row.host);
    if (!kept || (time(row.collectedAt) ?? -Infinity) > (time(kept.collectedAt) ?? -Infinity)) newest.set(row.host, row);
  }
  return [...newest.values()];
}

function machineName(combined, host) {
  const device = rows(combined?.devices).find(row => row.host === host);
  return typeof device?.name === 'string' && device.name.trim() ? device.name.trim() : host;
}

// Percent of the weekly limit used per hour, from the same join the Week page draws (lib/ledger-join.mjs):
// the session's API-priced pace over everything its engine spent this week on every computer, times the
// part of the week used. Unknown when any computer could not be read or the window is not a real weekly one.
function paceOf(combined) {
  const all = ledgerRows(combined);
  const join = joined({ week: { windows: storedWindows(combined), ledger: all } });
  return (tool, usdPerHour) => join.shareOf(String(tool), amount(usdPerHour));
}

function running(combined, now, titles) {
  const ledger = ledgerRows(combined).filter(row => row.status === 'ok' && snapshotFresh(time(row.collectedAt), now));
  if (!ledger.length) return null;
  const pace = paceOf(combined);
  const live = ledger.flatMap(row => rows(row.tools).flatMap(tool => {
    const period = rows(tool.periods).find(entry => entry.key === 'current');
    return rows(period?.sessions).filter(session => session.running === true).map(session => ({
      // The same name the Week page gives it: its title, its title hash with titles off ("Session 3f2a"), or how it
      // ran ("Review run in cube-type").
      title: sessionLabel(titles ? session : { titleHash: session.titleHash, origin: session.origin, task: session.task, shipped: session.shipped, repo: session.repo }),
      machine: machineName(combined, row.host),
      ratePerHour: pace(tool.tool, session.ratePerHour),
    }));
  }));
  const fastest = [...live].sort((a, b) => (b.ratePerHour ?? -1) - (a.ratePerHour ?? -1)).slice(0, RUNNING_SHOWN);
  // One Unknown pace makes the total Unknown rather than too small.
  const total = live.length && live.every(session => session.ratePerHour !== null)
    ? live.reduce((sum, session) => sum + session.ratePerHour, 0) : null;
  const count = live.length === 1 ? strings.glance.oneSession : format(strings.glance.sessions, { count: live.length });
  return {
    title: strings.glance.running,
    count: live.length,
    ratePerHour: total === null ? null : Number(oneDecimal(total)),
    summary: !live.length ? strings.glance.noneRunning : total === null ? count : format(strings.glance.perHour, { sessions: count, rate: paceText(total) }),
    sessions: fastest.map(session => ({ ...session,
      ratePerHour: session.ratePerHour === null ? null : Number(oneDecimal(session.ratePerHour)),
      rate: session.ratePerHour === null ? strings.status.unknown : format(strings.glance.sessionRate, { rate: paceText(session.ratePerHour) }) })),
  };
}

// The top flag from lib/ledger-flags.mjs, passed in by the caller. Each flag is {text, subject?}, most important first.
function topFlag(flags) {
  const list = rows(flags).filter(flag => typeof flag.text === 'string' && flag.text.trim());
  if (!list.length) return null;
  const { text, subject } = list[0];
  const named = typeof subject === 'string' && subject.trim() ? subject.trim() : null;
  const rest = named && text.startsWith(named) ? text.slice(named.length).trimStart() : text;
  return { count: list.length, subject: named, text: rest };
}

/**
 * @param {any} combined the object scripts/hub.mjs writes to combined.json
 * @param {{now:number, timeZone:string, flags?:{text:string, subject?:string}[]|null, settings?:{titles?:boolean}}} options
 * @returns {GlanceModel}
 */
export function glanceView(combined, { now, timeZone, flags = null, settings = {} }) {
  const glance = object(combined?.glance) ? combined.glance : {};
  const forecast = object(glance.forecast) ? glance.forecast : {};
  const engines = rows(forecast.engines);
  const names = new Map(engines.map(engine => [engine.engine, engine.name]));
  // A provider row with no window is a source that is not set up, and an absent one is a limit the provider does not have.
  const limitRows = rows(glance.limits).filter(row => typeof row.provider === 'string' && row.window && !row.absent);
  const updatedAt = typeof combined?.generatedAt === 'string' ? combined.generatedAt : null;
  const stale = !snapshotFresh(time(updatedAt), now);

  const lead = engines.find(engine => engine.engine === forecast.scarce?.engine) ?? null;
  const headRow = lead ? limitRows.find(row => row.provider === lead.engine && row.window === lead.window) ?? null : null;
  const headLeft = headRow ? limitRemaining(headRow, now) : null;
  const headUsed = headLeft === null ? null : Math.round(100 - headLeft);
  // A snapshot from before the forecast was stored with its words has no headline: it reads Unknown.
  const stored = typeof forecast.asOf === 'string';
  const sentence = stored && typeof forecast.sentence === 'string' && forecast.sentence ? forecast.sentence : strings.status.unknown;
  const windows = stored ? rows(forecast.windows) : [];
  const headline = {
    engine: lead?.engine ?? null,
    text: lead ? (stored && typeof lead.headline === 'string' ? lead.headline : strings.status.unknown) : sentence,
    tone: lead ? String(lead.status) : 'unknown',
    used: headUsed === null ? strings.glance.usedUnknown
      : format(headRow.window === strings.formats.weekly ? strings.glance.weekUsed : strings.glance.windowUsed, { percent: percent(headUsed), window: headRow.window }),
    resets: headRow && !headRow.off && stored && typeof lead.resets === 'string' ? lead.resets : null,
    fraction: headUsed === null ? null : headUsed / 100,
  };
  // The bar shows the percent used only while a limit is forecast to run out before it resets.
  const showPercent = !stale && headUsed !== null && ['runs-out', 'out'].includes(headline.tone);
  const bar = { percent: stale ? null : headUsed, ring: stale ? null : headline.fraction, showPercent, text: showPercent ? percent(headUsed) : null };

  const limits = limitRows.filter(row => row !== headRow).map(row => {
    const left = row.off ? null : limitRemaining(row, now);
    const used = left === null ? null : Math.round(100 - left);
    return {
      engine: row.provider,
      name: `${names.get(row.provider) ?? row.name} ${row.window}`,
      fraction: used === null ? null : used / 100,
      percent: row.off ? strings.glance.off : percent(used),
      resets: row.off ? null : windows.find(window => window.engine === row.provider && window.windowId === row.windowId)?.resetsWhen ?? null,
      tone: used === null ? 'muted' : row.spent ? 'out' : row.low ? 'low' : 'normal',
    };
  });

  const live = running(combined, now, settings.titles !== false);
  const collecting = engines.length === 0 && limitRows.length === 0 && live === null;
  const clock = updatedAt === null ? null : new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(time(updatedAt));
  return {
    schema: GLANCE_SCHEMA,
    updatedAt,
    updated: clock === null ? strings.status.updatedUnknown : format(strings.glance.updatedAt, { time: clock }),
    collecting,
    stale,
    bar,
    headline,
    limits,
    running: live,
    flag: topFlag(flags),
  };
}
