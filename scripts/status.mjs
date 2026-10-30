// npm run status [-- --json] [-- --wait <engine> [--timeout <minutes>]].
// Reads this computer's combined.json and prints usage status. No network, no server, no writes.
// Exit 0 with a current reading, 3 without one. --wait exits 0 once the engine is not out,
// 4 on timeout and 2 on bad arguments.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultDataFolder, loadConfig, localFolder} from '../lib/config.mjs';
import {agentStatus, ENGINES, WINDOWS} from '../lib/agent-status.mjs';
import {durationText} from './display-format.mjs';

export const EXIT_BAD_ARGUMENTS = 2;
export const EXIT_NO_READING = 3;
export const EXIT_TIMEOUT = 4;
// How often --wait reads again when no reset time is known.
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

const clockTime = at => new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(at));

export function describe(status) {
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
  const pick = status.route.code;
  lines.push(`Route code, review, research: ${pick.engine ? names[pick.engine] : 'none'}. ${pick.reason}`);
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

// Blocks until the engine is not out. A 0% reading that goes stale before its reset
// (for example, collection stopped) still counts as out until that reset time has passed.
async function waitFor(engine, timeout, {read, clock, sleep}) {
  const deadline = timeout === null ? Infinity : clock() + timeout * 60000;
  let until = -Infinity;
  for (;;) {
    const now = clock();
    const status = agentStatus(await read(), now);
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
  fail = text => process.stderr.write(text)} = {}) {
  const options = parse(args);
  if (options.error) { fail(options.error + '\n'); return EXIT_BAD_ARGUMENTS; }
  if (options.wait) {
    const {status, code} = await waitFor(options.wait, options.timeout, {read, clock, sleep});
    write(JSON.stringify(status, null, 2) + '\n');
    return code;
  }
  const status = agentStatus(await read(), clock());
  write((options.json ? JSON.stringify(status, null, 2) : describe(status)) + '\n');
  return status.current ? 0 : EXIT_NO_READING;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main();
