// The Refractor: Observatory's mark, and the live icon in the menu bar and tray. A telescope on its tripod.
//
// One geometry for every surface. The glance apps draw from the same numbers and formulas
// (glance/mac/Glance.swift `enum Mark`, glance/windows/Glance.cs `class Mark`), the app icons are drawn by the Mac app
// (`npm run icons`), and public/favicon.svg is appIconSvg(32). test/glance-icon.test.mjs checks that they all match.
//
// The mark lives in a square of side m, origin top left, y down, and is seventeen numbers (`markGeometry(m)`):
//   tube      a butt-capped line of width tw from the eyepiece end A = (ax, ay) to the lens B = (ax + run, ay - run/2).
//             The slope is always exactly 1 up for 2 across, so the edges step evenly on the pixel grid.
//   eyepiece  a butt-capped line of width ew from (ax - e, ay + e/2) to (ax + e/4, ay - e/8): a stub behind A on the
//             same axis, running a quarter of its length into the tube so no seam shows.
//   legs      two round-capped lines of width lw from the apex (px, py) to the feet (px - k, py + 2k) and
//             (px + k, py + 2k). The apex sits on the tube's lower edge.
//   star      centered on (sx, sy), up and right of the lens. It is the state, which lib/glance-view.mjs decides once and
//             stores in glance.json (`icon.state`): on pace a filled dot of radius dot; over pace an upright bar barW wide
//             and barH tall with corner radius barW/4; stale a hollow dot (centerline radius ringR, stroke ringW, so its
//             outer edge is the dot's); off nothing.
// The tube is the share of the Claude weekly limit used. The whole tube is drawn first at trackAlpha. Unless the state
// is off or the share is 0, the same line is drawn again over it from A to F = (ax + run*f, ay - run*f/2), f = clamp(share, minFill, 1),
// at full strength (staleAlpha when stale). The eyepiece and legs are always full strength, the hollow dot staleAlpha.
//
// Sizes 12, 16, 18 and 32 are set by hand on the pixel grid (SNAPPED). Every other size is the 18 row times m/18.
// The live icon is the mark at the icon's side: 18 in the menu bar, 16 and 32 in the tray (`glanceGeometry`).
//
// App icon: a tile with corner radius 22.5% of the tile, and the mark in the accent color, 62% full and on pace,
// centered on it. The mark's side comes from a table up to 48 (so it reuses a hand-set size) and is 5/8 of the tile
// above that. The tile fills the square on Windows (.ico) and in the favicon. On macOS (.icns and glance/icons/png) it
// sits inside the canvas the way macOS icons do, 100 of 1024 in from each edge, and the geometry is set in points and
// multiplied by the scale, so an icon is the same at 1x and 2x.
//
// Rounding: the only rounding left is the macOS inset, round(points * 100 / 1024), which never lands on a half.

export const ICON = Object.freeze({
  trackAlpha: 0.28,   // the faint full tube behind the fill
  staleAlpha: 0.45,   // fill and hollow dot when stale
  textDim: 0.55,      // the number when stale or off
  minFill: 0.04,      // a low share still shows
  appFill: 0.62,      // the share the app icon shows
  gap: 5,             // between the icon and the number
  fontSize: 13,
  tileRadius: 0.225,
  accentDark: '#d97f57',
  accentLight: '#b5562c',
  tileDark: '#161715',
  tileLight: '#efece7',
});

export const ICON_STATES = Object.freeze(['on-pace', 'over-pace', 'stale', 'off']);

const FIELDS = ['ax', 'ay', 'run', 'tw', 'e', 'ew', 'px', 'py', 'k', 'lw', 'sx', 'sy', 'dot', 'barW', 'barH', 'ringR', 'ringW'];

/** The hand-set sizes, in pixels, in FIELDS order. */
export const SNAPPED = Object.freeze({
  //   ax    ay   run  tw   e    ew   px  py    k    lw   sx    sy   dot  barW barH ringR ringW
  12: [1.5,  8,   6.5, 3,   1,   1.5, 5,  8.5,  1.5, 1,   10,   2,   1,   1,   4,   0.75, 0.5],
  16: [1.5,  10.5, 9,  3.5, 1.5, 2,   6.5, 10.5, 2,  1.5, 13,   3,   2,   2,   6,   1.5,  1],
  18: [2.5,  12,  10,  4,   1.5, 2,   7.5, 12,  2.5, 1.5, 15,   4,   2,   2,   6,   1.5,  1],
  32: [3,    21,  20,  7,   3,   4,   13, 21,   4.5, 3,   27,   6,   3,   4,   10,  2.25, 1.5],
});

/** The mark in a square of side `m`: the seventeen numbers of the header comment, in pixels. */
export function markGeometry(m) {
  const row = SNAPPED[m] ?? SNAPPED[18].map(value => value * m / 18);
  return Object.fromEntries(FIELDS.map((name, index) => [name, row[index]]));
}

/** The live icon's geometry at side `side` (16 tray, 18 menu bar, 32 tray at 200%). */
export function glanceGeometry(side) {
  return markGeometry(side);
}

/** The share of the tube that is filled, for a share above 0: a low share still shows, and it never runs past the lens. */
export function fillShare(fraction) {
  return Math.min(1, Math.max(ICON.minFill, fraction));
}

/** The app icon's mark on a full tile of `side` pixels: the mark's side `m` and its offset `o` from the tile's corner. */
export function appGeometry(side) {
  const m = { 16: 12, 24: 16, 32: 18, 48: 32 }[side] ?? side * 5 / 8;
  return { m, o: (side - m) / 2 };
}

/** The macOS app icon at `points` (16, 32, 128, 256, 512) and `scale` (1 or 2), in pixels: tile inset and side, mark side and offset from the canvas corner. */
export function macIconGeometry(points, scale) {
  const inset = { 16: 1, 32: 3 }[points] ?? Math.round(points * 100 / 1024), tile = points - 2 * inset;
  const m = { 16: 12, 32: 18 }[points] ?? tile * 5 / 8;
  return { inset: inset * scale, tile: tile * scale, m: m * scale, o: (points - m) / 2 * scale, base: m };
}

const n = value => Number(value.toFixed(3)).toString();

/**
 * The mark as SVG shapes. `m` picks the geometry, `scale` multiplies it and (ox, oy) moves it.
 * `ink` draws the track, eyepiece and legs, `mark` the fill and the star.
 */
export function markShapes(m, state, fraction, { ink = 'currentColor', mark = ink, scale = 1, ox = 0, oy = 0 } = {}) {
  const g = markGeometry(m), X = v => n(ox + v * scale), Y = v => n(oy + v * scale), S = v => n(v * scale);
  const line = (x1, y1, x2, y2, w, color, alpha, cap) => `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${color}" stroke-width="${S(w)}"`
    + (cap === 'round' ? ' stroke-linecap="round"' : '') + (alpha < 1 ? ` opacity="${alpha}"` : '') + '/>';
  const f = fillShare(fraction), stale = state === 'stale';
  let out = line(g.ax, g.ay, g.ax + g.run, g.ay - g.run / 2, g.tw, ink, ICON.trackAlpha);
  if (state !== 'off' && Number(fraction) > 0) out += line(g.ax, g.ay, g.ax + g.run * f, g.ay - g.run * f / 2, g.tw, mark, stale ? ICON.staleAlpha : 1);
  out += line(g.ax - g.e, g.ay + g.e / 2, g.ax + g.e / 4, g.ay - g.e / 8, g.ew, ink, 1);
  out += line(g.px, g.py, g.px - g.k, g.py + 2 * g.k, g.lw, ink, 1, 'round') + line(g.px, g.py, g.px + g.k, g.py + 2 * g.k, g.lw, ink, 1, 'round');
  if (state === 'on-pace') out += `<circle cx="${X(g.sx)}" cy="${Y(g.sy)}" r="${S(g.dot)}" fill="${mark}"/>`;
  if (state === 'over-pace') out += `<rect x="${X(g.sx - g.barW / 2)}" y="${Y(g.sy - g.barH / 2)}" width="${S(g.barW)}" height="${S(g.barH)}" rx="${S(g.barW / 4)}" fill="${mark}"/>`;
  if (stale) out += `<circle cx="${X(g.sx)}" cy="${Y(g.sy)}" r="${S(g.ringR)}" fill="none" stroke="${mark}" stroke-width="${S(g.ringW)}" opacity="${ICON.staleAlpha}"/>`;
  return out;
}

/** The live icon as SVG at `side` (16, 18 or 32), for previews. */
export function glanceSvg(side, state, fraction, { ink = 'currentColor', mark = ink } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${markShapes(side, state, fraction, { ink, mark })}</svg>`;
}

/** The app icon as SVG: the favicon is appIconSvg(32). */
export function appIconSvg(side, { light = false } = {}) {
  const { m, o } = appGeometry(side);
  const tile = light ? ICON.tileLight : ICON.tileDark, accent = light ? ICON.accentLight : ICON.accentDark;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">`
    + `<rect width="${side}" height="${side}" rx="${n(side * ICON.tileRadius)}" fill="${tile}"/>`
    + markShapes(m, 'on-pace', ICON.appFill, { ink: accent, ox: o, oy: o }) + '</svg>\n';
}

/** The macOS app icon as SVG, for previews: the tile inside its canvas. */
export function macIconSvg(points, scale, { light = false } = {}) {
  const { inset, tile, o, base } = macIconGeometry(points, scale), side = points * scale;
  const fill = light ? ICON.tileLight : ICON.tileDark, accent = light ? ICON.accentLight : ICON.accentDark;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">`
    + `<rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${n(tile * ICON.tileRadius)}" fill="${fill}"/>`
    + markShapes(base, 'on-pace', ICON.appFill, { ink: accent, scale, ox: o, oy: o }) + '</svg>';
}
