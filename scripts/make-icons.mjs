// `npm run icons` (macOS): the app icons, drawn by the Mac app's own Mark code (glance/mac/Glance.swift) from the one
// geometry in lib/glance-icon.mjs. Writes glance/icons/png (1024, 512, 128, 32 and 16, light and dark), and the dark
// set packed as glance/icons/Observatory.icns for the Mac app and glance/icons/Observatory.ico for the Windows app.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(REPO, 'glance', 'icons');
export const SHOWN_SIZES = [1024, 512, 128, 32, 16];
const ICNS = [[16, 16], [16, 32, '@2x'], [32, 32], [32, 64, '@2x'], [128, 128], [128, 256, '@2x'], [256, 256], [256, 512, '@2x'], [512, 512], [512, 1024, '@2x']];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

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
  try {
    const app = path.join(work, 'Observatory');
    await run('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', path.join(REPO, 'glance', 'mac', 'Glance.swift'), '-o', app], { timeout: 300000 });
    const drawn = path.join(work, 'drawn');
    await mkdir(drawn);
    await run(app, ['--app-icons', drawn]);
    const png = (side, theme) => path.join(drawn, `icon-${side}-${theme}.png`);
    await mkdir(path.join(OUT, 'png'), { recursive: true });
    for (const side of SHOWN_SIZES) for (const theme of ['light', 'dark'])
      await copyFile(png(side, theme), path.join(OUT, 'png', `icon-${side}-${theme}.png`));
    const iconset = path.join(work, 'Observatory.iconset');
    await mkdir(iconset);
    for (const [base, side, retina = ''] of ICNS) await copyFile(png(side, 'dark'), path.join(iconset, `icon_${base}x${base}${retina}.png`));
    await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'Observatory.icns')]);
    const images = await Promise.all(ICO_SIZES.map(async size => ({ size, data: await readFile(png(size, 'dark')) })));
    await writeFile(path.join(OUT, 'Observatory.ico'), packIco(images));
    console.log('Wrote glance/icons/png, glance/icons/Observatory.icns and glance/icons/Observatory.ico');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
