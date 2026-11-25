// The menu bar panel (macOS, glance/mac/Glance.swift) and the tray panel (Windows, glance/windows/Glance.cs) as each
// app lays it out. The app is compiled into a temporary folder and run with `--layout`, which writes where each named
// part of the panel landed. For each glance below, at three text sizes, no two parts may overlap, no part may leave the
// panel and no part that has text or a bar may be laid out with no width. A value drawn over its bar is how the panel once broke ("54%, as of Tue 9:50 AM" on the weekly
// bar), so the long and old values are here on purpose. Other systems have no panel, so the test skips there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const csc = process.platform === 'win32' ? path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : null;
const has = command => spawnSync('/usr/bin/which', [command], { encoding: 'utf8' }).status === 0;
const skip = process.platform === 'darwin' ? (!has('swiftc') ? 'swiftc is missing (install the Xcode command line tools)' : false)
  : process.platform === 'win32' ? (spawnSync(csc, ['/help'], { encoding: 'utf8' }).status === 0 ? false : 'the C# compiler built into Windows was not found')
  : 'the panels exist only on macOS and Windows';

const NOW = '2026-11-25T01:08:30Z';
const SCALES = [1, 1.5, 2];
const base = {
  schema: 'observatory-glance/1', updatedAt: '2026-11-25T01:08:00Z', updated: 'Updated 8:08 PM', collecting: false, stale: false,
  bar: { percent: null, ring: null, showPercent: false, text: null },
  icon: { state: 'stale', fraction: 0.54, text: 'Tue 9:50 AM', tip: 'Last read Tue 9:50 AM', stale: null, accent: false }, signIn: null,
  running: { title: 'Running now', count: 2, ratePerHour: null, summary: '2 sessions', sessions: [
    { title: 'Planner: weekly review', machine: 'Studio Mac', ratePerHour: null, rate: 'Unknown' },
    { title: 'Runner: job queue', machine: 'Studio Mac', ratePerHour: 0.4, rate: '0.4%/h' }] },
  flag: { count: 1, subject: 'Planner: weekly review', text: 'fanned out to 51 subagents and took 30% of the week. Nothing landed on main.' },
};
const limit = (engine, name, percent, fraction, resets, extra = {}) => ({ engine, name, fraction, percent, resets, tone: fraction === null ? 'muted' : 'normal', asOf: null, ...extra });

// Every glance is fictional. Each is a state the panel has to draw without anything drawn over anything else.
const GLANCES = {
  // The panel as it broke: no current reading, and the old value with its date as one long text, as glance.json
  // carried it before the date had its own field. An app must still draw an older file.
  'an old value and its date as one long text': { ...base,
    headline: { engine: null, text: 'Claude has no current reading. Grok has 1 request today.', tone: 'unknown', used: 'Used: Unknown', resets: null, fraction: null },
    limits: [limit('claude', 'Claude 5-hour', 'Unknown', null, null), limit('claude', 'Claude weekly', '54%, as of Tue 9:50 AM', 0.54, 'Fri 5 PM', { tone: 'muted' })] },
  // The same moment as glance.json says it now: the headline keeps the weekly limit's last value, and an old row's date
  // is apart from its value.
  'an old weekly reading and no 5-hour reading': { ...base,
    headline: { engine: null, text: 'Claude has no current reading. Grok has 1 request today.', tone: 'unknown', used: '54% of the week used, as of Tue 9:50 AM', resets: 'Resets Fri 5 PM', fraction: 0.54 },
    limits: [limit('claude', 'Claude 5-hour', 'Unknown', null, null), limit('codex', 'Codex weekly', '19%', 0.19, 'Mon 6 PM', { tone: 'muted', asOf: 'as of Nov 18, 4:26 AM' })] },
  // A read under way: nothing current anywhere yet.
  'a read under way with nothing current': { ...base, running: null, flag: null,
    headline: { engine: null, text: 'Unknown', tone: 'unknown', used: 'Used: Unknown', resets: null, fraction: null },
    limits: [limit('claude', 'Claude 5-hour', 'Unknown', null, null), limit('codex', 'Codex 5-hour', 'Unknown', null, null), limit('codex', 'Codex weekly', 'Off', null, null)] },
  // Long words everywhere.
  'long names and values': { ...base,
    headline: { engine: 'claude', text: 'Claude may run out Wed 3–7 PM, before it resets Fri 11:45 AM. Codex has room until it resets.', tone: 'runs-out', used: '100% of the 5-hour limit used, as of Nov 18, 11:59 PM', resets: 'Resets Nov 30, 11:45 PM', fraction: 1 },
    bar: { percent: 100, ring: 1, showPercent: true, text: '100%' },
    limits: [limit('claude', 'Claude Code weekly, all models together', '100%', 1, 'Nov 30, 11:45 PM', { tone: 'out' }),
      limit('codex', 'Codex monthly allowance on the second computer', 'Unknown', null, 'Dec 1, 12 AM', { asOf: 'as of Nov 18, 11:59 PM' })],
    running: { title: 'Running now', count: 12, ratePerHour: 12.4, summary: '12 sessions, 12.4% per hour', sessions: [
      { title: 'Builder: a very long session title that cannot fit on one line of the panel', machine: 'Second computer', ratePerHour: 9.9, rate: '9.9%/h' }] },
    updated: 'Updated 12:08 PM' },
};

// Parts of one row: "limit.0.name" belongs to "limit.0", "footer.open" to "footer", "used" and "resets" to the head line.
const group = name => /^(limit|session)\.\d+\./.test(name) ? name.split('.').slice(0, 2).join('.')
  : ['used', 'resets'].includes(name) ? 'head' : name.split('.')[0];
const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

test('no part of the panel is drawn over another or outside it, at any text size', { skip, timeout: 600000 }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'observatory-panel-'));
  try {
    const app = path.join(folder, process.platform === 'win32' ? 'Glance.exe' : 'Glance');
    if (process.platform === 'darwin')
      await run('/usr/bin/xcrun', ['swiftc', '-Onone', '-swift-version', '5', path.join(root, 'glance', 'mac', 'Glance.swift'), '-o', app], { timeout: 480000 });
    else
      await run(csc, ['/nologo', '/target:winexe', `/out:${app}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', path.join(root, 'glance', 'windows', 'Glance.cs')], { timeout: 480000 });
    const problems = [];
    for (const [name, glance] of Object.entries(GLANCES)) {
      const input = path.join(folder, 'glance.json');
      await writeFile(input, JSON.stringify(glance));
      for (const scale of SCALES) {
        const output = path.join(folder, 'layout.json');
        await rm(output, { force: true });
        await run(app, ['--layout', input, output, NOW, '--text-scale', String(scale)], { timeout: 60000 });
        const { width, height, frames } = JSON.parse(await readFile(output, 'utf8'));
        const at = `${name}, text x${scale}`;
        // The parts the panel always has: a missing one means the layout was not measured, which must not pass.
        const needed = ['headline', 'used', 'footer.open', 'footer.updated', ...glance.limits.flatMap((_, index) => ['name', 'bar', 'value'].map(part => `limit.${index}.${part}`))];
        for (const part of needed) if (!frames[part]) problems.push(`${at}: ${part} was not laid out`);
        for (const [part, box] of Object.entries(frames)) {
          if (box[0] < -0.5 || box[0] + box[2] > width + 0.5 || box[1] < -0.5 || box[1] + box[3] > height + 0.5)
            problems.push(`${at}: ${part} leaves the panel (${box.map(Math.round)} in ${width} by ${height})`);
          if (/\.(name|bar|value|asOf)$|^(headline|used)$/.test(part) && !(box[2] > 0.5 && box[3] > 0.5)) problems.push(`${at}: ${part} has no size`);
          if (part.endsWith('.bar') && box[2] < 12) problems.push(`${at}: ${part} is ${box[2]} wide`);
        }
        const parts = Object.entries(frames);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
          const [a, boxA] = parts[i], [b, boxB] = parts[j];
          // Any two parts, in one row or across rows and sections: a section drawn too short shows here too.
          if (overlap(boxA, boxB) > 0.5) problems.push(`${at}: ${a} and ${b} overlap${group(a) === group(b) ? '' : ' (different rows)'}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
