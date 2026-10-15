import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedDesignTokens } from './build-design-tokens.mjs';
import { generatedStrings } from './build-strings.mjs';

const css = readFileSync(new URL('../app/observatory.css', import.meta.url), 'utf8');
const nativeTokens = JSON.parse(readFileSync(new URL('../native/design-tokens.json', import.meta.url), 'utf8'));
test('both native shells use the current shared design tokens', () => {
  for (const [path, expected] of generatedDesignTokens()) {
    assert.equal(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'), expected, path);
  }
});
test('all platforms use the current shared strings', () => {
  for (const [path, expected] of generatedStrings()) {
    assert.equal(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'), expected, path);
  }
});
function luminance(hex) {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map(x => x + x).join('');
  const rgb = digits.match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
for (const theme of ['light', 'dark']) {
  test(`${theme} native text, links and selected chips meet 4.5:1 contrast`, () => {
    const tokens = Object.fromEntries(Object.entries(nativeTokens.colors).map(([name, values]) => [name, '#' + values[theme === 'light' ? 0 : 1]]));
    for (const foreground of ['text', 'muted', 'strong', 'accent']) {
      for (const background of ['background', 'surface']) {
        const a = luminance(tokens[foreground]), b = luminance(tokens[background]);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background}`);
      }
    }
  });
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
