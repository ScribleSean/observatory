// The Refractor: one geometry and one set of colors for the mark, the app icons, the favicon and the live icon in
// the menu bar and tray. lib/glance-icon.mjs holds them. The Mac app (glance/mac/Glance.swift, enum Mark) and the
// Windows app (glance/windows/Glance.cs, class Mark) draw from copies, checked here as source text since neither app
// runs in the tests. The icon's state is decided once, in lib/glance-view.mjs: test/glance-text-contract.test.mjs
// holds it to the dashboard's Limits view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { ICON, ICON_STATES, SNAPPED, appGeometry, appIconSvg, glanceGeometry, glanceSvg, macIconGeometry, markGeometry } from '../lib/glance-icon.mjs';
import { ICO_SIZES, SHOWN } from '../scripts/make-icons.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const swift = read('glance/mac/Glance.swift'), cs = read('glance/windows/Glance.cs');
const hex = text => Number.parseInt(text.slice(1), 16);

const FIELDS = ['ax', 'ay', 'run', 'tw', 'e', 'ew', 'px', 'py', 'k', 'lw', 'sx', 'sy', 'dot', 'barW', 'barH', 'ringR', 'ringW'];

test('the live icon is the hand-set mark at 16, 18 and 32, and other sizes scale the 18 row', () => {
  for (const side of [16, 18, 32]) {
    const g = glanceGeometry(side);
    assert.deepEqual(FIELDS.map(key => g[key]), SNAPPED[side], `side ${side}`);
    // Inside the box: the feet, the lens corner and the star.
    assert.ok(g.py + 2 * g.k + g.lw / 2 <= side && g.px - g.k - g.lw / 2 >= 0, `side ${side} feet`);
    assert.ok(g.sx + g.dot <= side && g.sy - g.barH / 2 >= 0, `side ${side} star`);
    // The eyepiece's back corner: its end less half its width across a slope of 1 in 2.
    assert.ok(g.ax - g.e - g.ew / 2 / Math.sqrt(5) >= 0, `side ${side} eyepiece`);
    // The three state shapes differ: the bar is taller than the dot, and the hollow dot's outer edge is the dot's.
    assert.ok(g.barH > 2 * g.dot, `side ${side} bar`);
    assert.equal(g.ringR + g.ringW / 2, g.dot, `side ${side} hollow dot`);
  }
  const g24 = markGeometry(24);
  FIELDS.forEach((key, index) => assert.equal(g24[key], SNAPPED[18][index] * 24 / 18, `24 ${key}`));
});

test('the app icon mark is 5/8 of the tile from 64 up and a hand-set size below', () => {
  for (const [side, m] of [[16, 12], [24, 16], [32, 18], [48, 32], [64, 40], [128, 80], [256, 160]])
    assert.deepEqual(appGeometry(side), { m, o: (side - m) / 2 }, `side ${side}`);
  assert.deepEqual(macIconGeometry(16, 1), { inset: 1, tile: 14, m: 12, o: 2, base: 12 });
  assert.deepEqual(macIconGeometry(32, 2), { inset: 6, tile: 52, m: 36, o: 14, base: 18 });
  assert.deepEqual(macIconGeometry(512, 2), { inset: 100, tile: 824, m: 515, o: 254.5, base: 257.5 });
});

test('a share of 0 draws no fill, a small one the minimum, and off none at all', () => {
  const fills = (state, fraction) => (glanceSvg(18, state, fraction).match(/<line /g) ?? []).length - 4;
  assert.equal(fills('on-pace', 0), 0);
  assert.equal(fills('on-pace', null), 0);
  assert.equal(fills('on-pace', 0.01), 1);
  assert.equal(fills('off', 0.6), 0);
  assert.doesNotMatch(glanceSvg(18, 'off', 0.6), /<circle|<rect/, 'off has no star');
  assert.match(glanceSvg(18, 'on-pace', 1.4), /opacity="0.28"\/><line x1="2.5" y1="12" x2="12.5" y2="7"/, 'a share past 1 stops at the lens');
  assert.match(glanceSvg(18, 'on-pace', 0.01), new RegExp(`x2="${2.5 + 10 * ICON.minFill}"`));
});

test('the favicon is the 32 pixel app icon', () => {
  assert.equal(read('public/favicon.svg'), appIconSvg(32));
});

// Whether `source` holds this code, however it is spaced.
const holds = (source, code) => new RegExp(code.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s*')).test(source);
const assertHolds = (source, file, ...codes) => { for (const code of codes) assert.ok(holds(source, code), `${file} does not hold: ${code}`); };

test('the Mac and Windows apps draw from the same numbers and formulas', () => {
  const swiftConstant = name => Number(swift.match(new RegExp(`static\\s+let\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*(0x[0-9a-f]+|[\\d.]+)`))?.[1]);
  for (const key of ['trackAlpha', 'staleAlpha', 'textDim', 'gap', 'fontSize', 'tileRadius']) assert.equal(swiftConstant(key), ICON[key], `Glance.swift Mark.${key}`);
  for (const key of ['accentDark', 'accentLight', 'tileDark', 'tileLight']) assert.equal(swiftConstant(key), hex(ICON[key]), `Glance.swift Mark.${key}`);
  assert.equal(swiftConstant('menuBarSide'), 18, 'the menu bar icon is 18 points');
  for (const key of ['minFill', 'appFill']) assert.equal(swiftConstant(key), ICON[key], `Glance.swift Mark.${key}`);
  // The same hand-set rows, in the same field order.
  const numbers = text => text.split(',').map(value => Number(value.trim().replace(/f$/, '')));
  for (const side of [12, 16, 18, 32])
    assert.deepEqual(numbers(swift.match(new RegExp(`\\n\\s*${side}: \\[([^\\]]+)\\]`))?.[1] ?? ''), SNAPPED[side], `Glance.swift snapped ${side}`);
  assertHolds(swift, 'Glance.swift',
    'struct Geometry { let ax, ay, run, tw, e, ew, px, py, k, lw, sx, sy, dot, barW, barH, ringR, ringW: CGFloat }',
    'let v = snapped[m] ?? snapped[18]!.map { $0 * m / 18 }',
    'let m: CGFloat = side == 16 ? 12 : side == 24 ? 16 : side == 32 ? 18 : side == 48 ? 32 : side * 5 / 8',
    'return (m, (side - m) / 2)',
    'let inset = points == 16 ? 1 : points == 32 ? 3 : (points * 100 / 1024).rounded(), tile = points - 2 * inset',
    'let m = points == 16 ? 12 : points == 32 ? 18 : tile * 5 / 8',
    'return (inset * scale, tile * scale, m * scale, (points - m) / 2 * scale, m)',
    'flip.translateX(by: offset, yBy: height - offset)', 'flip.scaleX(by: scale, yBy: -scale)');

  // The Windows tray carries every constant it draws with. It has no number beside the icon (the text leads the
  // tooltip) and draws no app tile (the .ico comes from npm run icons), so textDim, gap, fontSize and the tile
  // constants have no use there.
  const csConstant = name => Number(cs.match(new RegExp(`public\\s+const\\s+(?:float|double|int)\\s+${name}\\s*=\\s*(0x[0-9a-f]+|[\\d.]+)f?\\s*;`))?.[1]);
  assert.equal(csConstant('TrackAlpha'), ICON.trackAlpha);
  assert.equal(csConstant('StaleAlpha'), ICON.staleAlpha);
  assert.equal(csConstant('MinFill'), ICON.minFill);
  assert.equal(csConstant('AccentDark'), hex(ICON.accentDark));
  assert.equal(csConstant('AccentLight'), hex(ICON.accentLight));
  const csMark = cs.slice(cs.indexOf('static class Mark'), cs.indexOf('static class Painter'));
  for (const name of ['TextDim', 'Gap', 'FontSize', 'TileRadius', 'TileDark', 'TileLight']) assert.ok(!new RegExp(`\\b${name}\\b`).test(csMark), `Glance.cs Mark.${name} would be unused`);
  for (const side of [16, 18, 32])
    assert.deepEqual(numbers(cs.match(new RegExp(`Snapped${side} = \\{([^}]+)\\}`))?.[1] ?? ''), SNAPPED[side], `Glance.cs snapped ${side}`);
  assertHolds(cs, 'Glance.cs', 'return Array.ConvertAll(Snapped18, v => v * side / 18f);');

  // The same lines and shapes, in the same order: track, fill, eyepiece, legs, star. The tube, fill and eyepiece have
  // flat ends and the legs round ones. A dot of radius dot, a barW by barH bar with radius barW/4, a hollow dot.
  assertHolds(swift, 'Glance.swift',
    'line(g.ax, g.ay, g.ax + g.run, g.ay - g.run / 2, g.tw, ink.withAlphaComponent(trackAlpha))',
    'line(g.ax, g.ay, g.ax + g.run * f, g.ay - g.run * f / 2, g.tw, state == .stale ? ink.withAlphaComponent(staleAlpha) : mark)',
    'line(g.ax - g.e, g.ay + g.e / 2, g.ax + g.e / 4, g.ay - g.e / 8, g.ew, ink)',
    'line(g.px, g.py, g.px - g.k, g.py + 2 * g.k, g.lw, ink, round: true)', 'line(g.px, g.py, g.px + g.k, g.py + 2 * g.k, g.lw, ink, round: true)',
    'path.lineCapStyle = round ? .round : .butt',
    'NSBezierPath(ovalIn: NSRect(x: g.sx - g.dot, y: g.sy - g.dot, width: 2 * g.dot, height: 2 * g.dot)).fill()',
    'NSRect(x: g.sx - g.barW / 2, y: g.sy - g.barH / 2, width: g.barW, height: g.barH), xRadius: g.barW / 4, yRadius: g.barW / 4',
    'hollow.lineWidth = g.ringW');
  assertHolds(cs, 'Glance.cs',
    'Line(g, ax, ay, ax + run, ay - run / 2, tw, Alpha(ink, TrackAlpha), false);',
    'Line(g, ax, ay, ax + run * f, ay - run * f / 2, tw, state == "stale" ? Alpha(ink, StaleAlpha) : accent, false);',
    'Line(g, ax - e, ay + e / 2, ax + e / 4, ay - e / 8, ew, ink, false);',
    'Line(g, px, py, px - k, py + 2 * k, lw, ink, true);', 'Line(g, px, py, px + k, py + 2 * k, lw, ink, true);',
    'pen.StartCap = pen.EndCap = round ? LineCap.Round : LineCap.Flat;',
    'g.FillEllipse(brush, sx - dot, sy - dot, 2 * dot, 2 * dot);',
    'Rounded(new RectangleF(sx - barW / 2, sy - barH / 2, barW, barH), barW / 4)',
    'using (var hollow = new Pen(Alpha(ink, StaleAlpha), ringW)) g.DrawEllipse(hollow, sx - ringR, sy - ringR, 2 * ringR, 2 * ringR);');
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
  // No fill at all at 0%: the minimum fill is for a small share, not for none.
  assertHolds(swift, 'Glance.swift', 'if state != .off, let fraction, fraction > 0 {');
  assertHolds(cs, 'Glance.cs', 'if (state != "off" && fraction.HasValue && fraction.Value > 0)');
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

// Closer to `near` than to `far`, for antialiased edges at small sizes.
function assertCloser(pixel, near, far, label) {
  const distance = color => Math.hypot(...color.map((value, index) => value - pixel[index]));
  assert.ok(distance(near) < distance(far), `${label}: ${pixel} is nearer ${far} than ${near}`);
}

// The margin, the rounded corner, the tile, the filled tube, the faint tube past the fill and the star.
function assertIcon(png, { canvas, inset, o, base, scale }, theme, label) {
  assert.deepEqual([png.width, png.height], [canvas, canvas], `${label}: size`);
  const g = markGeometry(base), at = (x, y) => png.at(o + x * scale, o + y * scale);
  const tile = rgb(theme === 'light' ? ICON.tileLight : ICON.tileDark), mark = rgb(theme === 'light' ? ICON.accentLight : ICON.accentDark);
  const track = tile.map((value, index) => Math.round(value + (mark[index] - value) * ICON.trackAlpha));
  if (inset >= 1) assertColor(png.at(inset / 2, canvas / 2), null, `${label} margin`);
  assertColor(png.at(0, 0), null, `${label} rounded corner`);
  assertColor(png.at((inset + o) / 2, canvas / 2), tile, `${label} tile`);
  const point = t => [g.ax + g.run * t, g.ay - g.run * t / 2];
  const filled = at(...point(ICON.appFill / 2)), faint = at(...point((1 + ICON.appFill) / 2)), star = at(g.sx, g.sy - 0.01);
  assertCloser(filled, mark, track, `${label} filled tube`);
  assertCloser(faint, track, mark, `${label} faint tube`);
  assertCloser(faint, track, tile, `${label} faint tube on the tile`);
  assertCloser(star, mark, tile, `${label} star`);
}

test('the committed app icons are the geometry in lib/glance-icon.mjs, drawn: the macOS PNGs and the Windows .ico', () => {
  for (const [pixels, points, scale] of SHOWN) for (const theme of ['light', 'dark']) {
    const g = macIconGeometry(points, scale);
    assertIcon(decodePng(readFileSync(new URL(`../glance/icons/png/icon-${pixels}-${theme}.png`, import.meta.url))), { canvas: pixels, scale, ...g }, theme, `icon-${pixels}-${theme}`);
  }
  // The same mark at 1x and 2x: every size and inset doubles.
  for (const points of [16, 32, 128, 256, 512]) {
    const one = macIconGeometry(points, 1), two = macIconGeometry(points, 2);
    for (const key of ['inset', 'tile', 'm', 'o']) assert.equal(two[key], 2 * one[key], `${points} ${key}`);
  }
  // The .ico: every size, the full tile, the dark theme, on whole pixels up to 48.
  const ico = readFileSync(new URL('../glance/icons/Observatory.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  ICO_SIZES.forEach((size, index) => {
    const at = 6 + 16 * index, length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    if (size <= 48) for (const value of Object.values(appGeometry(size))) assert.ok(Number.isInteger(value), `ico ${size} on whole pixels`);
    const { m, o } = appGeometry(size);
    assertIcon(decodePng(ico.subarray(offset, offset + length)), { canvas: size, inset: 0, o, base: m, scale: 1 }, 'dark', `ico ${size}`);
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
