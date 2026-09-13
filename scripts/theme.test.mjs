import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/observatory.css', import.meta.url), 'utf8');
test('native allowance charts use the Observatory palette, not the system accent', () => {
  const panel = readFileSync(new URL('../native/QuotaPanel.swift', import.meta.url), 'utf8');
  assert.ok(!panel.includes('Color.accentColor'));
  assert.match(panel, /y: \.value\("Tokens", tokens\)\)\.foregroundStyle\(ObservatoryTheme\.purple\)/);
});
function luminance(hex) {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map(x => x + x).join('');
  const rgb = digits.match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
for (const theme of ['light', 'dark']) {
  test(`${theme} theme text token pairs meet 4.5:1 contrast`, () => {
    const block = theme === 'light' ? css.match(/:root \{([^}]+)\}/)[1]
      : css.match(/:root\[data-theme='dark'\] \{([^}]+)\}/)[1];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]+);/g)].map(m => [m[1], m[2]]));
    const pairs = [
      ['m3-ink','m3-surface'], ['m3-ink','m3-low'], ['m3-secondary','m3-high'],
      ['m3-on-primary','m3-primary'], ['m3-on-container','m3-container'],
      ['status-good-ink','status-good-bg'], ['status-warn-ink','status-warn-bg'],
      ['browser-ink','browser-bg'], ['terminal-ink','terminal-bg']
    ];
    for (const [fg, bg] of pairs) {
      const a = luminance(tokens[fg]), b = luminance(tokens[bg]);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, `${fg} on ${bg}`);
    }
  });
}
