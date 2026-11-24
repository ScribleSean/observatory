// What the menu bar and tray apps show, worked out once per tick from the combined snapshot.
// scripts/tick.mjs writes it to public/local/glance.json. Both native apps only draw it, so the
// wording, rounding and forecast match the dashboard without a second copy in Swift and C#. The forecast and its
// words are the ones the hub stored in combined.json (glance.forecast): this file shows them and words nothing itself.
// Pure: the same snapshot, time and inputs always give the same model.
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { percent, tenths } from './panel-data.mjs';
import { snapshotFresh } from './freshness.mjs';
import { joined, storedWindows, sessionLabel } from './ledger-join.mjs';
import { lastReading, readAt, shown, shownSentence } from './forecast.mjs';

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
 * @property {GlanceIcon} icon               The menu bar and tray icon (lib/glance-icon.mjs).
 * @property {GlanceSignIn | null} signIn    Claude Code reads signed out. Null otherwise.
 *
 * @typedef {object} GlanceSignIn
 * @property {boolean} here                  Signed out on this computer: the panel offers its Sign in to Claude button,
 *                                           which runs scripts/claude-sign-in.mjs. Elsewhere it only says where.
 * @property {string} text                   "Claude Code is signed out on this computer, so its limits cannot be read."
 * @property {string} button                 "Sign in to Claude".
 * @property {string} running                "Signing in…", the button while a sign-in runs.
 * @property {string} command                The terminal command, for when the button cannot finish.
 *
 * @typedef {object} GlanceIcon
 * @property {'on-pace' | 'over-pace' | 'stale' | 'off'} state  The star the tube points at: dot, bar, hollow dot, nothing.
 * @property {number | null} fraction        Share of the Claude weekly limit used, 0 to 1. Stale keeps the last value.
 * @property {string} text                   Beside the icon on macOS: "60%", "4:25 AM" or "Off".
 * @property {string} tip                    Leads the tooltip: "60% used, on pace", "Last read 4:25 AM" or "Off".
 * @property {{fraction:number|null, text:string, tip:string} | null} stale  What the apps show instead once this file
 *                                           is older than a snapshot may be (lib/freshness.mjs). Null when off.
 * @property {boolean} accent                The accent variant (settings `glance.accent`), else a template image.
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

// The menu bar and tray icon: the tube is the share of the Claude weekly limit used and the star is the state, by
// the dashboard's rules. Used is the Limits view's number (lastReading). The pace is the stored forecast's verdict for
// that window, only while it is current: room is on pace, runs-out or out is over pace. A window too new to forecast
// (early) is never over pace: it shows the dot, and the tip says it is too early. With no current verdict (none
// stored, none for this window, or an old one) the pace is Unknown and the icon is stale, as is an old reading or an
// old snapshot, which keep their last value. Signed out: the stale shape with no reading, "Sign in" and how to.
// Off: the Claude limit is off or hidden.
// The computer whose Claude Code is signed out, by its name.
const signedOutOn = combined => {
  const host = combined?.view?.claudeLimits?.observedOn;
  const name = typeof host === 'string' ? combined?.view?.deviceNames?.[host] ?? host : null;
  return typeof name === 'string' && name.trim() ? name.trim() : strings.glance.thisComputer;
};

function iconOf(glance, forecast, { stale, updatedAt, now, timeZone, accent, signedOutOn }) {
  const off = { state: 'off', fraction: null, text: strings.glance.off, tip: strings.glance.off, stale: null, accent };
  const engine = rows(forecast.engines).find(row => row.engine === 'claude');
  const row = rows(glance.limits).find(limit => limit.provider === 'claude' && limit.window === strings.formats.weekly && !limit.absent);
  if (engine?.off === 'signed-out') return { state: 'stale', fraction: null, text: strings.glance.signIn, tip: format(strings.glance.signInTip, { name: signedOutOn }), stale: null, accent };
  if (!engine || engine.status === 'off' || !row || row.off) return off;
  // When the shown value was read, worded as every surface words it ("Wed 4:25 AM"). A time ahead of now is not a read.
  const read = [row.checkedAt, updatedAt].find(iso => time(iso) !== null && time(iso) <= now) ?? null;
  const when = readAt(read, { now, timeZone });
  const reading = lastReading(row, now, timeZone);
  const used = reading === null ? null : Math.round(100 - reading.remaining);
  const old = { fraction: used === null ? null : used / 100, text: when, tip: format(strings.glance.iconStale, { time: when }) };
  if (stale || used === null || reading.asOf) return { state: 'stale', ...old, stale: old, accent };
  const window = typeof forecast.asOf === 'string' ? rows(forecast.windows).find(record => record.engine === 'claude' && record.windowId === row.windowId) : null;
  const said = window ? shown(forecast, window, now) : null;
  const over = ['runs-out', 'out'].includes(window?.status);
  const early = window?.status === 'early';
  const pace = !said || said.stale || !(over || early || window.status === 'room') ? strings.glance.paceUnknown
    : over ? strings.glance.overPace : early ? strings.forecast.tooEarly : strings.glance.onPace;
  const tip = format(early ? strings.glance.iconTipEarly : strings.glance.iconTip, { percent: percent(used), pace });
  if (pace === strings.glance.paceUnknown) return { state: 'stale', fraction: used / 100, text: percent(used), tip, stale: old, accent };
  return { state: over ? 'over-pace' : 'on-pace', fraction: used / 100, text: percent(used), tip, stale: old, accent };
}

// Signed out of Claude Code: on this computer (settings.host) the panel offers to sign in. On another computer it says which.
function signInOf(combined, forecast, host) {
  const engine = rows(forecast.engines).find(row => row.engine === 'claude');
  if (engine?.off !== 'signed-out') return null;
  const on = combined?.view?.claudeLimits?.observedOn;
  const here = typeof host === 'string' && on === host;
  const S = strings.claudeSignIn;
  return { here, text: here ? S.here : format(S.elsewhere, { name: signedOutOn(combined) }), button: S.button, running: S.running, command: S.command };
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
 * @param {{now:number, timeZone:string, flags?:{text:string, subject?:string}[]|null, settings?:{titles?:boolean, accent?:boolean, host?:string}}} options
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
  // An old snapshot shows no number at all. Within a current one, an old reading shows its last value and when it was read.
  const headReading = headRow && !stale ? lastReading(headRow, now, timeZone) : null;
  const headUsed = headReading === null ? null : Math.round(100 - headReading.remaining);
  // The stored words, as lib/forecast.mjs shown() gives them now: dated once old, Unknown past the reset or when none were stored.
  const stored = typeof forecast.asOf === 'string';
  const sentence = shownSentence(forecast, now) ?? strings.status.unknown;
  const windows = stored ? rows(forecast.windows) : [];
  const said = lead ? shown(forecast, lead, now) : null;
  const headline = {
    engine: lead?.engine ?? null,
    text: said ? said.headline : sentence,
    tone: lead ? String(lead.status) : 'unknown',
    used: headUsed === null ? strings.glance.usedUnknown
      : format(headRow.window === strings.formats.weekly ? strings.glance.weekUsed : strings.glance.windowUsed, { percent: percent(headUsed), window: headRow.window }) + (headReading.asOf ? `, ${headReading.asOf}` : ''),
    resets: headRow && !headRow.off ? said?.resets ?? null : null,
    fraction: headUsed === null ? null : headUsed / 100,
  };
  // The bar shows the percent used only while a limit is forecast to run out before it resets.
  const showPercent = !stale && headUsed !== null && !headReading.asOf && ['runs-out', 'out'].includes(headline.tone);
  const bar = { percent: stale ? null : headUsed, ring: stale ? null : headline.fraction, showPercent, text: showPercent ? percent(headUsed) : null };

  const limits = limitRows.filter(row => row !== headRow).map(row => {
    const reading = row.off || stale ? null : lastReading(row, now, timeZone);
    const used = reading === null ? null : Math.round(100 - reading.remaining);
    return {
      engine: row.provider,
      name: `${names.get(row.provider) ?? row.name} ${row.window}`,
      fraction: used === null ? null : used / 100,
      percent: row.off ? strings.glance.off : percent(used) + (reading?.asOf ? `, ${reading.asOf}` : ''),
      resets: row.off || !(time(row.resetsAt) > now) ? null : windows.find(window => window.engine === row.provider && window.windowId === row.windowId)?.resetsWhen ?? null,
      tone: used === null || reading.asOf ? 'muted' : row.spent ? 'out' : row.low ? 'low' : 'normal',
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
    icon: iconOf(glance, forecast, { stale, updatedAt, now, timeZone, accent: settings.accent === true, signedOutOn: signedOutOn(combined) }),
    signIn: signInOf(combined, forecast, settings.host),
  };
}
