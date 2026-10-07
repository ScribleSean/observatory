import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('../app/observatory.css', import.meta.url),
  'utf8',
);

test('narrow icon-only reload styling is scoped to header actions', () => {
  // Settings reuses the reload style for a text-only appearance button.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const iconOnly = rules.filter(
    ([, selector, body]) =>
      selector.includes('.reload') &&
      (/\bwidth:\s*44px\b/.test(body) || /\bdisplay:\s*none\b/.test(body)),
  );
  assert.equal(iconOnly.length, 2);
  for (const [, selector] of iconOnly) {
    assert.match(
      selector.trim(),
      /^\.app-actions\s+\.reload(?:\s+span)?$/,
      'Icon-only sizing and hidden labels must not affect Settings text buttons',
    );
  }
});
