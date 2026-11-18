// The ring and dot: one geometry and one set of colors for the mark, the app icons, the favicon and the live icon in
// the menu bar and tray. lib/glance-icon.mjs holds them. The Mac app (glance/mac/Glance.swift, enum Mark) and the
// Windows app (glance/windows/Glance.cs, class Mark) draw from copies, checked here as source text since neither app
// runs in the tests. The icon's state is decided once, in lib/glance-view.mjs: test/glance-text-contract.test.mjs
// holds it to the dashboard's Limits view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON, ICON_STATES, appGeometry, appIconSvg, glanceGeometry } from '../lib/glance-icon.mjs';

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

test('the Mac and Windows apps draw from the same numbers and formulas', () => {
  const swiftNumber = name => Number(swift.match(new RegExp(`static let ${name}: (?:CGFloat|UInt32|Double)? ?= ?(0x[0-9a-f]+|[\\d.]+)`))?.[1]);
  const swiftDouble = name => Number(swift.match(new RegExp(`static let ${name} = ([\\d.]+)`))?.[1]);
  for (const key of ['trackAlpha', 'staleAlpha', 'textDim', 'gap', 'fontSize', 'tileRadius']) assert.equal(swiftNumber(key), ICON[key], `Glance.swift Mark.${key}`);
  assert.equal(swiftDouble('minArc'), ICON.minArc, 'Glance.swift Mark.minArc');
  for (const key of ['accentDark', 'accentLight', 'tileDark', 'tileLight']) assert.equal(swiftNumber(key), hex(ICON[key]), `Glance.swift Mark.${key}`);
  assert.match(swift, /let p = \(side \/ 16\)\.rounded\(\), d = side - 2 \* p, w = \(d \/ 7\)\.rounded\(\)/, 'Glance.swift glance geometry');
  assert.match(swift, /return \(p, d, w, \(d - w\) \/ 2, side \/ 2\)/);
  assert.match(swift, /if side == 16 \{ return \(12, 2, 2\) \}\s+if side == 32 \{ return \(20, 3, 3\) \}\s+return \(side \/ 2, side \/ 14, side \/ 14\)/, 'Glance.swift app geometry');
  assert.equal(Number(swift.match(/static let menuBarSide: CGFloat = (\d+)/)?.[1]), 18, 'the menu bar icon is 18 points');

  const csNumber = name => Number(cs.match(new RegExp(`public const (?:float|double|int) ${name} = (0x[0-9a-f]+|[\\d.]+)f?;`))?.[1]);
  assert.equal(csNumber('TrackAlpha'), ICON.trackAlpha);
  assert.equal(csNumber('StaleAlpha'), ICON.staleAlpha);
  assert.equal(csNumber('MinArc'), ICON.minArc);
  assert.equal(csNumber('AccentDark'), hex(ICON.accentDark));
  assert.equal(csNumber('AccentLight'), hex(ICON.accentLight));
  assert.match(cs, /float p = \(float\)Math\.Round\(side \/ 16\.0, MidpointRounding\.AwayFromZero\), d = side - 2 \* p;/, 'Glance.cs glance geometry');
  assert.match(cs, /float w = \(float\)Math\.Round\(d \/ 7\.0, MidpointRounding\.AwayFromZero\);/);
  assert.match(cs, /return new\[\] \{ p, d, w, \(d - w\) \/ 2, side \/ 2f \};/);

  // The same shapes for the same states: a dot of radius w, a w by 3w bar with radius w/2, a hollow dot with stroke w/2.
  assert.match(swift, /case \.onPace:\s+tint\.setFill\(\)\s+circle\(g\.c, g\.w\)\.fill\(\)/);
  assert.match(swift, /NSRect\(x: g\.c - g\.w \/ 2, y: g\.c - 1\.5 \* g\.w, width: g\.w, height: 3 \* g\.w\), xRadius: g\.w \/ 2/);
  assert.match(swift, /let hollow = circle\(g\.c, g\.w\)\s+hollow\.lineWidth = g\.w \/ 2/);
  assert.match(cs, /state == "on-pace"\) using \(var brush = new SolidBrush\(tint\)\) g\.FillEllipse\(brush, c - w, c - w, 2 \* w, 2 \* w\)/);
  assert.match(cs, /new RectangleF\(c - w \/ 2, c - 1\.5f \* w, w, 3 \* w\), w \/ 2\)/);
  assert.match(cs, /state == "stale"\) using \(var hollow = new Pen\(tint, w \/ 2\)\) g\.DrawEllipse\(hollow, c - w, c - w, 2 \* w, 2 \* w\)/);
  // Butt caps, from 12 o'clock clockwise, at least minArc.
  assert.match(swift, /startAngle: 90, endAngle: 90 - 360 \* share, clockwise: true/);
  assert.match(swift, /arc\.lineCapStyle = \.butt/);
  assert.match(cs, /g\.DrawArc\(arc, ring, -90, \(float\)\(360 \* share\)\)/);
  assert.match(cs, /arc\.StartCap = arc\.EndCap = LineCap\.Flat/);
});

test('both apps read the icon state from glance.json and decide nothing about pace themselves', () => {
  // The same four states, by the names glance.json uses.
  assert.deepEqual(ICON_STATES, ['on-pace', 'over-pace', 'stale', 'off']);
  assert.ok(swift.includes('enum State: String { case onPace = "on-pace", overPace = "over-pace", stale, off }'), 'Glance.swift Mark.State');
  assert.ok(cs.includes('public static readonly string[] States = { "on-pace", "over-pace", "stale", "off" };'), 'Glance.cs Mark.States');
  for (const key of ['icon', 'state', 'fraction', 'text', 'tip', 'stale', 'accent']) assert.ok(swift.includes(`["${key}"]`), `Glance.swift reads icon "${key}"`);
  for (const key of ['icon', 'state', 'fraction', 'text', 'tip', 'stale']) assert.ok(cs.includes(`, "${key}")`), `Glance.cs reads icon "${key}"`);
  // The only rule they add: once glance.json is older than a snapshot may be, the stored stale form shows.
  assert.match(swift, /if old, let stale = iconStale \{ return \(\.stale, stale\.fraction, stale\.text, stale\.tip\) \}/);
  assert.match(cs, /Old && StaleText != null \? "stale" : IconState/);
  // No pace, percent or wording of their own for the icon.
  const block = (text, start, end) => { const from = text.indexOf(start), to = text.indexOf(end, from); assert.ok(from >= 0 && to > from, start); return text.slice(from, to); };
  for (const [file, text] of [['Glance.swift', block(swift, 'enum Mark {', 'final class FloatingPanel')], ['Glance.cs', block(cs, 'static class Mark', 'static class Painter')]])
    for (const word of ['runs-out', 'leftAtReset', 'remaining', 'on pace', 'over pace'])
      assert.ok(!text.includes(word), `${file} Mark decides "${word}" itself`);
});

test('setup ships the generated icons, and npm run icons draws them with the Mac app', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.icons, 'node scripts/make-icons.mjs');
  assert.match(read('scripts/make-icons.mjs'), /'--app-icons'/);
  assert.match(swift, /arguments\.firstIndex\(of: "--app-icons"\)/);
  for (const side of [1024, 512, 128, 32, 16]) for (const theme of ['light', 'dark'])
    assert.ok(readFileSync(new URL(`../glance/icons/png/icon-${side}-${theme}.png`, import.meta.url)).length > 0, `icon-${side}-${theme}.png`);
});
