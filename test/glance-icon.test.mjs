// The ring and dot: one geometry and one set of colors for the mark, the app icons, the favicon and the live icon in
// the menu bar and tray. lib/glance-icon.mjs holds them. The Mac app (glance/mac/Glance.swift, enum Mark) and the
// Windows app (glance/windows/Glance.cs, class Mark) draw from copies, checked here as source text since neither app
// runs in the tests. The icon's state is decided once, in lib/glance-view.mjs: test/glance-text-contract.test.mjs
// holds it to the dashboard's Limits view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { ICON, ICON_STATES, appGeometry, appIconSvg, glanceGeometry, macIconGeometry } from '../lib/glance-icon.mjs';
import { ICO_SIZES, SHOWN } from '../scripts/make-icons.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const swift = read('glance/mac/Glance.swift'), cs = read('glance/windows/Glance.cs');
const hex = text => Number.parseInt(text.slice(1), 16);

test('the glance icon geometry is the spec table at 16, 18 and 32', () => {
  // [side, padding, diameter, stroke, centerline radius]. The dot radius is the stroke, the bar is w by 3w.
  for (const [side, p, d, w, r] of [[16, 1, 14, 2, 6], [18, 1, 16, 2, 7], [32, 2, 28, 4, 12]])
    assert.deepEqual(glanceGeometry(side), { p, d, w, r, c: side / 2 }, `side ${side}`);
});

test('the app icon mark is half the tile from 64 up and sits on whole pixels at 32 and 16', () => {
  for (const [side, d, w, dot] of [[1024, 512, 512 / 7, 512 / 7], [512, 256, 256 / 7, 256 / 7], [128, 64, 64 / 7, 64 / 7], [32, 20, 3, 3], [16, 12, 2, 2]])
    assert.deepEqual(appGeometry(side), { d, w, dot }, `side ${side}`);
});

test('the favicon is the 32 pixel app icon', () => {
  assert.equal(read('public/favicon.svg'), appIconSvg(32));
});

// Whether `source` holds this code, however it is spaced.
const holds = (source, code) => new RegExp(code.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s*')).test(source);
const assertHolds = (source, file, ...codes) => { for (const code of codes) assert.ok(holds(source, code), `${file} does not hold: ${code}`); };

test('the Mac and Windows apps draw from the same numbers and formulas', () => {
  const swiftConstant = name => Number(swift.match(new RegExp(`static\\s+let\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*(0x[0-9a-f]+|[\\d.]+)`))?.[1]);
  for (const key of ['trackAlpha', 'staleAlpha', 'textDim', 'minArc', 'gap', 'fontSize', 'tileRadius']) assert.equal(swiftConstant(key), ICON[key], `Glance.swift Mark.${key}`);
  for (const key of ['accentDark', 'accentLight', 'tileDark', 'tileLight']) assert.equal(swiftConstant(key), hex(ICON[key]), `Glance.swift Mark.${key}`);
  assert.equal(swiftConstant('menuBarSide'), 18, 'the menu bar icon is 18 points');
  assertHolds(swift, 'Glance.swift',
    'let p = (side / 16).rounded(), d = side - 2 * p, w = (d / 7).rounded()', 'return (p, d, w, (d - w) / 2, side / 2)',
    'case 16: return (12, 2, 2)', 'case 24: return (16, 2, 2)', 'case 32: return (20, 3, 3)', 'case 48: return (28, 4, 4)',
    'default: return (side / 2, side / 14, side / 14)',
    'let small: [CGFloat]? = points == 16 ? [1, 10, 2, 2] : points == 32 ? [3, 16, 2, 2] : nil',
    'let inset = small?[0] ?? (points * 100 / 1024).rounded(), tile = points - 2 * inset',
    'let mark = small.map { Array($0[1...]) } ?? [tile / 2, tile / 14, tile / 14]',
    'return (inset * scale, tile * scale, mark[0] * scale, mark[1] * scale, mark[2] * scale)');
  // The tables above are the ones in lib/glance-icon.mjs.
  for (const [side, d, w, dot] of [[16, 12, 2, 2], [24, 16, 2, 2], [32, 20, 3, 3], [48, 28, 4, 4]]) assert.deepEqual(appGeometry(side), { d, w, dot });
  assert.deepEqual(macIconGeometry(16, 1), { inset: 1, tile: 14, d: 10, w: 2, dot: 2 });
  assert.deepEqual(macIconGeometry(32, 1), { inset: 3, tile: 26, d: 16, w: 2, dot: 2 });
  assert.deepEqual(macIconGeometry(512, 2), { inset: 100, tile: 824, d: 412, w: 412 / 7, dot: 412 / 7 });

  // The Windows tray carries every constant it draws with. It has no number beside the icon (the text leads the
  // tooltip) and draws no app tile (the .ico comes from npm run icons), so textDim, gap, fontSize and the tile
  // constants have no use there.
  const csConstant = name => Number(cs.match(new RegExp(`public\\s+const\\s+(?:float|double|int)\\s+${name}\\s*=\\s*(0x[0-9a-f]+|[\\d.]+)f?\\s*;`))?.[1]);
  assert.equal(csConstant('TrackAlpha'), ICON.trackAlpha);
  assert.equal(csConstant('StaleAlpha'), ICON.staleAlpha);
  assert.equal(csConstant('MinArc'), ICON.minArc);
  assert.equal(csConstant('AccentDark'), hex(ICON.accentDark));
  assert.equal(csConstant('AccentLight'), hex(ICON.accentLight));
  const csMark = cs.slice(cs.indexOf('static class Mark'), cs.indexOf('static class Painter'));
  for (const name of ['TextDim', 'Gap', 'FontSize', 'TileRadius', 'TileDark', 'TileLight']) assert.ok(!new RegExp(`\\b${name}\\b`).test(csMark), `Glance.cs Mark.${name} would be unused`);
  assertHolds(cs, 'Glance.cs',
    'float p = (float)Math.Round(side / 16.0, MidpointRounding.AwayFromZero), d = side - 2 * p;',
    'float w = (float)Math.Round(d / 7.0, MidpointRounding.AwayFromZero);', 'return new[] { p, d, w, (d - w) / 2, side / 2f };');

  // The same shapes for the same states: a dot of radius w, a w by 3w bar with radius w/2, a hollow dot with stroke w/2.
  assertHolds(swift, 'Glance.swift', 'case .onPace: tint.setFill() circle(g.c, g.w).fill()',
    'NSRect(x: g.c - g.w / 2, y: g.c - 1.5 * g.w, width: g.w, height: 3 * g.w), xRadius: g.w / 2, yRadius: g.w / 2',
    'let hollow = circle(g.c, g.w) hollow.lineWidth = g.w / 2',
    'startAngle: 90, endAngle: 90 - 360 * share, clockwise: true', 'arc.lineCapStyle = .butt');
  assertHolds(cs, 'Glance.cs', 'if (state == "on-pace") using (var brush = new SolidBrush(tint)) g.FillEllipse(brush, c - w, c - w, 2 * w, 2 * w);',
    'Rounded(new RectangleF(c - w / 2, c - 1.5f * w, w, 3 * w), w / 2)',
    'else if (state == "stale") using (var hollow = new Pen(tint, w / 2)) g.DrawEllipse(hollow, c - w, c - w, 2 * w, 2 * w);',
    'g.DrawArc(arc, ring, -90, (float)(360 * share));', 'arc.StartCap = arc.EndCap = LineCap.Flat;');
});

test('both apps read the icon state from glance.json and decide nothing about pace themselves', () => {
  // The same four states, by the names glance.json uses.
  assert.deepEqual(ICON_STATES, ['on-pace', 'over-pace', 'stale', 'off']);
  assert.ok(swift.includes('enum State: String { case onPace = "on-pace", overPace = "over-pace", stale, off }'), 'Glance.swift Mark.State');
  assert.ok(cs.includes('public static readonly string[] States = { "on-pace", "over-pace", "stale", "off" };'), 'Glance.cs Mark.States');
  for (const key of ['icon', 'state', 'fraction', 'text', 'tip', 'stale', 'accent']) assert.ok(swift.includes(`["${key}"]`), `Glance.swift reads icon "${key}"`);
  for (const key of ['icon', 'state', 'fraction', 'text', 'tip', 'stale']) assert.ok(cs.includes(`, "${key}")`), `Glance.cs reads icon "${key}"`);
  // The only rule they add: once glance.json is older than a snapshot may be, the stored stale form shows.
  assertHolds(swift, 'Glance.swift', 'if old, let stale = iconStale { return (.stale, stale.fraction, stale.text, stale.tip) }');
  assertHolds(cs, 'Glance.cs', 'Old && StaleText != null ? "stale" : IconState');
  // Without an icon in glance.json nothing is known: the stale shape and Unknown, never Off.
  assert.match(swift, /var icon\s*=\s*Mark\.State\.stale\s+var iconFraction: Double\?\s+var iconText\s*=\s*"Unknown"\s+var iconTip\s*=\s*"Unknown"/);
  assert.match(cs, /public string IconState\s*=\s*"stale",\s*IconText\s*=\s*"Unknown",\s*IconTip\s*=\s*"Unknown"/);
  // A missing snapshot time, or one well ahead of the clock, counts as old.
  assert.match(swift, /guard let updated else \{ return true \}[\s\S]{0,120}age > Self\.deviceFresh \|\| age < -Self\.futureSlack/);
  assert.match(cs, /if \(!Updated\.HasValue\) return true;[\s\S]{0,140}age > DeviceFreshMinutes \|\| age < -FutureSlackMinutes/);
  assert.equal(Number(swift.match(/static let futureSlack: TimeInterval = (\d+) \* 60/)?.[1]), Number(cs.match(/FutureSlackMinutes = (\d+);/)?.[1]));
  // No arc at all at 0%: the minimum arc is for a small share, not for none.
  assertHolds(swift, 'Glance.swift', 'if let fraction, fraction > 0 {');
  assertHolds(cs, 'Glance.cs', 'if (fraction.HasValue && fraction.Value > 0)');
  // No pace, percent or wording of their own for the icon.
  const block = (text, start, end) => { const from = text.indexOf(start), to = text.indexOf(end, from); assert.ok(from >= 0 && to > from, start); return text.slice(from, to); };
  for (const [file, text] of [['Glance.swift', block(swift, 'enum Mark {', 'final class FloatingPanel')], ['Glance.cs', block(cs, 'static class Mark', 'static class Painter')]])
    for (const word of ['runs-out', 'leftAtReset', 'remaining', 'on pace', 'over pace'])
      assert.ok(!text.includes(word), `${file} Mark decides "${word}" itself`);
});

// An 8-bit RGBA PNG, as the Mac app writes it: its size and a pixel reader.
function decodePng(data) {
  assert.equal(data.subarray(1, 4).toString('latin1'), 'PNG');
  let at = 8, width = 0, height = 0;
  const idat = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at), type = data.subarray(at + 4, at + 8).toString('latin1'), body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.deepEqual([body[8], body[9], body[12]], [8, 6, 0], 'RGBA, 8 bits, not interlaced'); }
    if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0, up = y ? pixels[(y - 1) * stride + x] : 0, corner = x >= 4 && y ? pixels[(y - 1) * stride + x - 4] : 0;
      const guess = left + up - corner, pa = Math.abs(guess - left), pb = Math.abs(guess - up), pc = Math.abs(guess - corner);
      const add = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : corner][filter];
      pixels[y * stride + x] = (line[x] + add) & 255;
    }
  }
  return { width, height, at: (x, y) => [...pixels.subarray((Math.floor(y) * width + Math.floor(x)) * 4, (Math.floor(y) * width + Math.floor(x)) * 4 + 4)] };
}

const rgb = text => [hex(text) >> 16 & 255, hex(text) >> 8 & 255, hex(text) & 255];
function assertColor(pixel, expected, label) {
  if (expected === null) { assert.equal(pixel[3], 0, `${label}: transparent, got ${pixel}`); return; }
  assert.equal(pixel[3], 255, `${label}: opaque, got ${pixel}`);
  for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixel[channel] - expected[channel]) <= 40, `${label}: ${pixel} is not ${expected}`);
}

// Along the middle row, from the edge to the center: margin, tile, ring, the tile between ring and dot, the dot.
function assertIcon(png, { canvas, inset, d, w, dot }, theme, label) {
  assert.deepEqual([png.width, png.height], [canvas, canvas], `${label}: size`);
  const c = canvas / 2, r = (d - w) / 2, tile = rgb(theme === 'light' ? ICON.tileLight : ICON.tileDark), mark = rgb(theme === 'light' ? ICON.accentLight : ICON.accentDark);
  if (inset >= 1) assertColor(png.at(inset / 2, c), null, `${label} margin`);
  assertColor(png.at(0, 0), null, `${label} rounded corner`);
  assertColor(png.at((inset + c - d / 2) / 2, c), tile, `${label} tile`);
  assertColor(png.at(c - r, c), mark, `${label} ring`);
  assertColor(png.at(c - (dot + r - w / 2) / 2, c), tile, `${label} gap`);
  assertColor(png.at(c, c), mark, `${label} dot`);
}

test('the committed app icons are the geometry in lib/glance-icon.mjs, drawn: the macOS PNGs and the Windows .ico', () => {
  for (const [pixels, points, scale] of SHOWN) for (const theme of ['light', 'dark']) {
    const g = macIconGeometry(points, scale);
    assertIcon(decodePng(readFileSync(new URL(`../glance/icons/png/icon-${pixels}-${theme}.png`, import.meta.url))), { canvas: pixels, ...g }, theme, `icon-${pixels}-${theme}`);
  }
  // The same mark at 1x and 2x: every size and inset doubles.
  for (const points of [16, 32, 128, 256, 512]) {
    const one = macIconGeometry(points, 1), two = macIconGeometry(points, 2);
    for (const key of ['inset', 'tile', 'd', 'w', 'dot']) assert.equal(two[key], 2 * one[key], `${points} ${key}`);
  }
  // The .ico: every size, the full tile, the dark theme, on whole pixels up to 48.
  const ico = readFileSync(new URL('../glance/icons/Observatory.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  ICO_SIZES.forEach((size, index) => {
    const at = 6 + 16 * index, length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    if (size <= 48) for (const value of Object.values(appGeometry(size))) assert.ok(Number.isInteger(value), `ico ${size} on whole pixels`);
    assertIcon(decodePng(ico.subarray(offset, offset + length)), { canvas: size, inset: 0, ...appGeometry(size) }, 'dark', `ico ${size}`);
  });
  // The .icns holds the dark macOS set.
  assert.equal(readFileSync(new URL('../glance/icons/Observatory.icns', import.meta.url)).subarray(0, 4).toString('latin1'), 'icns');
});

test('setup ships the generated icons, and npm run icons draws them with the Mac app', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.icons, 'node scripts/make-icons.mjs');
  assert.match(read('scripts/make-icons.mjs'), /'--app-icons'/);
  assert.match(swift, /arguments\.firstIndex\(of: "--app-icons"\)/);
});
