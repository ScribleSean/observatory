import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// The Mac shows the shared viewer's Dictation view since M2-4, so no native Dictation source is left to check here.
// No collector writes a ChatGPT dictation row today. How the shared view lists such a row is a viewer question.
test('Mac has no native Dictation view left after M2-4', () => {
  const native = readdirSync(path.join(root, 'native')).filter(name => name.endsWith('.swift'));
  for (const name of native) {
    const swift = readFileSync(path.join(root, 'native', name), 'utf8');
    assert.ok(!swift.includes('ObservatorySegments(title: "Tool"'), `${name} still has a native Dictation tool selector`);
  }
  assert.ok(!native.includes('NativeRecordedUsage.swift'));
});
