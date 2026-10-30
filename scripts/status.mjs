// npm run status [-- --json]. Reads this computer's combined.json and prints usage status.
// No network, no server, no writes. Exit 0 with a current reading, 3 without one.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultDataFolder, loadConfig, localFolder} from '../lib/config.mjs';
import {agentStatus, WINDOWS} from '../lib/agent-status.mjs';
import {durationText} from './display-format.mjs';

export const EXIT_NO_READING = 3;
const names = {claude: 'Claude', codex: 'Codex', grokbot: 'GrokBot'};
const windowNames = {five_hour: '5-hour', weekly: 'weekly'};

async function dataFolder() {
  try { return localFolder(await loadConfig()); }
  catch (error) {
    if (!process.env.OBSERVATORY_CONFIG && error.message.startsWith('No settings file')) return path.join(defaultDataFolder(), 'public', 'local');
    throw error;
  }
}

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
  lines.push(`${names.grokbot}: Unknown (Observatory cannot measure it)`);
  const pick = status.route.code;
  lines.push(`Route code, review, research: ${pick.engine ? names[pick.engine] : 'none'}. ${pick.reason}`);
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2), now = Date.now()) {
  let combined = null;
  try { combined = JSON.parse(await readFile(path.join(await dataFolder(), 'combined.json'), 'utf8')); }
  catch { combined = null; }
  const status = agentStatus(combined, now);
  process.stdout.write((args.includes('--json') ? JSON.stringify(status, null, 2) : describe(status)) + '\n');
  return status.current ? 0 : EXIT_NO_READING;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main();
