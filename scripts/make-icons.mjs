// `npm run icons` (macOS): the app icons, drawn by the Mac app's own Mark code (glance/mac/Glance.swift) from the one
// geometry in lib/glance-icon.mjs. Writes glance/icons/png (1024, 512, 128, 32 and 16 pixels, light and dark, the macOS
// icon), glance/icons/Observatory.icns (the macOS icon, dark) and glance/icons/Observatory.ico (the full tile, dark,
// for the Windows app). Everything is drawn and packed in a staging folder first, then moved into place, so a failure
// leaves the old set as it was.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(REPO, 'glance', 'icons');
// The committed PNG set: its pixel size and the macOS icon it is (points, scale).
export const SHOWN = [[1024, 512, 2], [512, 512, 1], [128, 128, 1], [32, 32, 1], [16, 16, 1]];
const ICNS_POINTS = [16, 32, 128, 256, 512];
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TIMEOUT = 300000;

/** A .ico that holds PNG images, which Windows Vista and later read. */
export function packIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const at = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}

async function main() {
  if (process.platform !== 'darwin') throw Error('npm run icons runs on macOS: the icons are drawn by the Mac app.');
  const work = await mkdtemp(path.join(tmpdir(), 'observatory-icons-'));
  // Next to the targets, so the final moves are renames on one volume.
  const staging = await mkdtemp(path.join(OUT, '.staging-'));
  try {
    const app = path.join(work, 'Observatory');
    await run('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', path.join(REPO, 'glance', 'mac', 'Glance.swift'), '-o', app], { timeout: TIMEOUT });
    const drawn = path.join(work, 'drawn');
    await mkdir(drawn);
    await run(app, ['--app-icons', drawn], { timeout: TIMEOUT });
    const mac = (points, scale, theme) => path.join(drawn, `mac-${points}@${scale}x-${theme}.png`);
    await mkdir(path.join(staging, 'png'));
    for (const [pixels, points, scale] of SHOWN) for (const theme of ['light', 'dark'])
      await copyFile(mac(points, scale, theme), path.join(staging, 'png', `icon-${pixels}-${theme}.png`));
    const iconset = path.join(work, 'Observatory.iconset');
    await mkdir(iconset);
    for (const points of ICNS_POINTS) {
      await copyFile(mac(points, 1, 'dark'), path.join(iconset, `icon_${points}x${points}.png`));
      await copyFile(mac(points, 2, 'dark'), path.join(iconset, `icon_${points}x${points}@2x.png`));
    }
    await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(staging, 'Observatory.icns')], { timeout: TIMEOUT });
    const images = await Promise.all(ICO_SIZES.map(async size => ({ size, data: await readFile(path.join(drawn, `full-${size}-dark.png`)) })));
    await writeFile(path.join(staging, 'Observatory.ico'), packIco(images));
    // Everything is drawn: swap it in.
    await rm(path.join(OUT, 'png'), { recursive: true, force: true });
    for (const name of ['png', 'Observatory.icns', 'Observatory.ico']) await rename(path.join(staging, name), path.join(OUT, name));
    console.log('Wrote glance/icons/png, glance/icons/Observatory.icns and glance/icons/Observatory.ico');
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
