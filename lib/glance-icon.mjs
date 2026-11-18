// The ring and dot: Observatory's mark, and the live icon in the menu bar and tray.
//
// One geometry for every surface. The glance apps draw from the same numbers and formulas
// (glance/mac/Glance.swift `enum Mark`, glance/windows/Glance.cs `class Mark`), the app icons are drawn by the Mac app
// (`npm run icons`), and public/favicon.svg is appIconSvg(32). test/glance-icon.test.mjs checks that they all match.
//
// Glance icon of side s: padding p = round(s/16), mark diameter d = s - 2p, stroke w = round(d/7), ring centerline
// radius r = (d - w)/2, center s/2. The ring is the share of the Claude weekly limit used, from 12 o'clock clockwise.
// The center is the state, which lib/glance-view.mjs decides once and stores in glance.json (`icon.state`):
// a dot of radius w on pace, a w by 3w bar over pace, a hollow dot (radius w, stroke w/2) when stale, nothing when off.
//
// App icon of side s: a tile with corner radius 22.5% of s and the mark centered. From 64 up the mark is half the
// tile, the stroke d/7 and the dot diameter 2d/7. 32 and 16 are drawn on whole pixels.

export const ICON = Object.freeze({
  trackAlpha: 0.28,   // the faint full ring behind the arc
  staleAlpha: 0.45,   // arc and hollow dot when stale
  textDim: 0.55,      // the number when stale or off
  minArc: 0.04,       // a low share still shows
  gap: 5,             // between the icon and the number
  fontSize: 13,
  tileRadius: 0.225,
  accentDark: '#d97f57',
  accentLight: '#b5562c',
  tileDark: '#161715',
  tileLight: '#efece7',
});

export const ICON_STATES = Object.freeze(['on-pace', 'over-pace', 'stale', 'off']);

/** The glance icon's geometry at side `side` (16 tray, 18 menu bar, 32 tray at 200%). */
export function glanceGeometry(side) {
  const p = Math.round(side / 16), d = side - 2 * p, w = Math.round(d / 7);
  return { p, d, w, r: (d - w) / 2, c: side / 2 };
}

/** The app icon's mark at tile side `side`: outer diameter, stroke and dot radius. */
export function appGeometry(side) {
  if (side === 16) return { d: 12, w: 2, dot: 2 };
  if (side === 32) return { d: 20, w: 3, dot: 3 };
  return { d: side / 2, w: side / 14, dot: side / 14 };
}

const n = value => Number(value.toFixed(3)).toString();

/** The app icon as SVG: the favicon is appIconSvg(32). */
export function appIconSvg(side, { light = false } = {}) {
  const { d, w, dot } = appGeometry(side), c = side / 2;
  const tile = light ? ICON.tileLight : ICON.tileDark, mark = light ? ICON.accentLight : ICON.accentDark;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">`
    + `<rect width="${side}" height="${side}" rx="${n(side * ICON.tileRadius)}" fill="${tile}"/>`
    + `<circle cx="${n(c)}" cy="${n(c)}" r="${n((d - w) / 2)}" fill="none" stroke="${mark}" stroke-width="${n(w)}"/>`
    + `<circle cx="${n(c)}" cy="${n(c)}" r="${n(dot)}" fill="${mark}"/></svg>\n`;
}

