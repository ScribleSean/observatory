// `npm run icons:web` (macOS, Google Chrome): public/apple-touch-icon.png, the 180 pixel home screen icon, drawn from
// the same geometry as the favicon (lib/glance-icon.mjs). The tile fills the square with no corner radius, because iOS
// rounds the corners itself. Chrome renders the SVG headless, so nothing new is installed.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { appIconSvg } from '../lib/glance-icon.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const TOUCH_SIDE = 180;

/** The home screen icon as SVG: the app icon with square corners. */
export const touchIconSvg = () => appIconSvg(TOUCH_SIDE).replace(/ rx="[^"]+"/, '');

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), 'observatory-web-icons-'));
  try {
    await writeFile(path.join(work, 'icon.svg'), touchIconSvg());
    await writeFile(path.join(work, 'page.html'), '<!doctype html><style>html,body{margin:0;overflow:hidden}img{display:block}</style>'
      + `<img src="icon.svg" width="${TOUCH_SIDE}" height="${TOUCH_SIDE}">`);
    await promisify(execFile)(CHROME, ['--headless=new', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run',
      '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', `--window-size=${TOUCH_SIDE},${TOUCH_SIDE}`,
      `--screenshot=${path.join(REPO, 'public', 'apple-touch-icon.png')}`, `file://${path.join(work, 'page.html')}`], { timeout: 60000 });
    console.log('Wrote public/apple-touch-icon.png');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
