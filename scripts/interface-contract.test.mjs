import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('public copy contains no em dashes', async () => {
  for (const file of ['README.md', 'AGENTS.md', 'docs/DESIGN.md']) {
    const text = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.equal(text.includes(String.fromCodePoint(0x2014)), false, file);
  }
});
