import {execFile} from 'node:child_process';
import {readdir, readFile, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {defaultDataFolder, loadConfig, localFolder} from '../lib/config.mjs';
import {agentStatus, ENGINES, WINDOWS} from '../lib/agent-status.mjs';
import {durationText} from './display-format.mjs';

export const EXIT_BAD_ARGUMENTS = 2;
export const EXIT_NO_READING = 3;
export const EXIT_TIMEOUT = 4;
export const POLL_MS = 30000;
const MAX_TIMER_MS = 2 ** 31 - 1;
const names = {claude: 'Claude', codex: 'Codex'};
const windowNames = {five_hour: '5-hour', weekly: 'weekly'};

async function dataFolder() {
  try { return localFolder(await loadConfig()); }
  catch (error) {
    if (!process.env.OBSERVATORY_CONFIG && error.message.startsWith('No settings file')) return path.join(defaultDataFolder(), 'public', 'local');
    throw error;
  }
}

async function readCombined() {
  try { return JSON.parse(await readFile(path.join(await dataFolder(), 'combined.json'), 'utf8')); }
  catch { return null; }
}

// Codex jobs running now: codex-job and codex-job-on leave a <id>.running marker in this
// host's own state folder while a job runs, and the id ends in the wrapper's PID. A marker
// whose PID is a live codex-job process here counts however long the job has run; a dead PID
// never counts. When the PID cannot be read or checked, a marker older than STALE_MARKER_MS
// (its mtime is the job's start) is taken to be from a killed job, and the rest count by age.
export const STALE_MARKER_MS = 6 * 3600000;
const markerPid = name => Number(/^\d{8}-\d{6}-.+-(\d+)\.running$/.exec(name)?.[1]) || null;

// true or false when this host can tell whether pid is a running codex-job; null when it cannot.
export async function codexJobAlive(pid) {
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code !== 'EPERM') return null; }
  if (process.platform === 'win32') return null;
  try {
    const {stdout} = await promisify(execFile)('ps', ['-p', String(pid), '-o', 'command=']);
    return /codex-job/.test(stdout);
  } catch (error) { return error.code === 'ENOENT' ? null : false; }
}

export async function countCodexJobs(folder = path.join(os.homedir(), '.local', 'state', 'codex-jobs'), now = Date.now(), {alive = codexJobAlive} = {}) {
  let names;
  try { names = (await readdir(folder)).filter(name => name.endsWith('.running')); }
  catch { return null; }
  const seen = await Promise.all(names.map(async name => {
    const pid = markerPid(name);
    const live = pid === null ? null : await alive(pid);
    if (live !== null) return live ? 'pid' : null;
    return stat(path.join(folder, name)).then(info => now - info.mtimeMs < STALE_MARKER_MS ? 'age' : null, () => null);
  }));
  return {running: seen.filter(Boolean).length, byAge: seen.filter(item => item === 'age').length};
}

const clockTime = at => new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(at));

export function describe(status, byAge = 0) {
  const lines = [];
  for (const id of ['claude', 'codex']) {
    const engine = status.engines[id];
    const parts = WINDOWS.map(windowId => {
      const item = engine.windows[windowId];
      if (item.percentLeft === null) return `${windowNames[windowId]} Unknown`;
      const reset = item.minutesToReset === null ? 'reset Unknown' : `resets in ${durationText(item.minutesToReset * 60)}`;
      const burn = item.burnPerHour === null ? '' : `, ${item.burnPerHour}%/h`;
      return `${windowNames[windowId]} ${item.percentLeft}% left, ${reset}${burn}, ${item.pace}`;
    });
    lines.push(`${names[id]}: ${parts.join(' | ')}`);
  }
  for (const [id, back] of Object.entries(status.nextReturn))
    lines.push(`${names[id]} back at ${back.resetsAt ? clockTime(back.resetsAt) : 'Unknown'}`);
  const routed = hint => `${hint.engine ? names[hint.engine] : 'none'}. ${hint.reason}`;
  lines.push(`Route code: ${routed(status.route.code)}`);
  lines.push(`Route review, research: ${routed(status.route.review)}`);
  const age = byAge > 0 ? `, ${byAge} by marker age only` : '';
  lines.push(`Job cap: ${status.cap.total} (Claude ${status.cap.claude}, Codex ${status.cap.codex}${status.cap.codexRunning === null ? '' : `, ${status.cap.codexRunning} Codex running${age}`}).`);
  return lines.join('\n');
}

function parse(args) {
  const at = args.indexOf('--wait');
  const wait = at === -1 ? null : args[at + 1];
  if (at !== -1 && !ENGINES.includes(wait)) return {error: `--wait needs one of ${ENGINES.join(', ')}`};
  const timeoutAt = args.indexOf('--timeout');
  const timeout = timeoutAt === -1 ? null : Number(args[timeoutAt + 1]);
  if (timeout !== null && !(timeout > 0)) return {error: '--timeout needs a number of minutes above 0'};
  return {json: args.includes('--json') || wait !== null, wait, timeout};
}

// running() gives {running, byAge}, a bare count, or null when it cannot tell.
async function jobs(running) {
  const found = await running();
  return typeof found === 'number' ? {codexRunning: found, codexByAge: 0}
    : {codexRunning: found?.running ?? null, codexByAge: found?.byAge ?? 0};
}

async function waitFor(engine, timeout, {read, clock, sleep, running}) {
  const deadline = timeout === null ? Infinity : clock() + timeout * 60000;
  let until = -Infinity;
  for (;;) {
    const now = clock();
    const status = agentStatus(await read(), now, await jobs(running));
    const back = status.nextReturn[engine];
    if (back?.resetsAt) until = Math.max(until, Date.parse(back.resetsAt));
    const out = status.engines[engine].status === 'out' || now < until;
    if (!out) return {status, code: 0};
    if (now >= deadline) return {status, code: EXIT_TIMEOUT};
    const next = now < until ? until - now : POLL_MS;
    await sleep(Math.min(Math.max(next, 1000), deadline - now, MAX_TIMER_MS));
  }
}

export async function main(args = process.argv.slice(2), {read = readCombined, clock = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), write = text => process.stdout.write(text),
  fail = text => process.stderr.write(text), running = countCodexJobs} = {}) {
  const options = parse(args);
  if (options.error) { fail(options.error + '\n'); return EXIT_BAD_ARGUMENTS; }
  if (options.wait) {
    const {status, code} = await waitFor(options.wait, options.timeout, {read, clock, sleep, running});
    write(JSON.stringify(status, null, 2) + '\n');
    return code;
  }
  const counted = await jobs(running);
  const status = agentStatus(await read(), clock(), counted);
  write((options.json ? JSON.stringify(status, null, 2) : describe(status, counted.codexByAge)) + '\n');
  return status.current ? 0 : EXIT_NO_READING;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main();
